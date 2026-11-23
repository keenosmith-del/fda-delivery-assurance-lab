import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from '../src/db/migrations.ts';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { fixtureScope } from '../../scripts/fda-fixture.ts';
import { FDA_EVENTS } from '../../shared/contracts/fda-ingestion.ts';
import { ADOPTION_ASSURANCE, ADOPTION_OBSERVATIONS } from '../../shared/contracts/adoption-assurance.ts';
import type { AdoptionAction, Observation } from '../../shared/contracts/adoption-assurance.ts';
import { WORKFLOW_ASSESSMENTS } from '../../shared/contracts/workflow-assessments.ts';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { createFixtureDelivery } from '../../tests/support/workflow-review.ts';
import { exerciseDownstreamEvidence } from '../../scripts/downstream-evidence-fixture.ts';
import { fixtureWindows } from '../../scripts/adoption-fixture.ts';
import { measureWindow, compareWindows } from '../src/modules/adoption/assurance-metrics.ts';

const token = 'synthetic_adoption_source_token_0001';
const serviceToken = 'synthetic_downstream_token_0000001';
const access = { origin: 'https://lab.example.test', operator: 'synthetic-delivery-operator', viewer: 'synthetic-delivery-viewer' };
const headers = (role: 'operator' | 'viewer') => ({
  authorization: 'Basic ' + Buffer.from(role + ':' + access[role]).toString('base64'), origin: access.origin,
});
const source = { authorization: 'Bearer ' + token };
const reason = 'Reviewed the linked synthetic usage observations.';
let db: Awaited<ReturnType<typeof openTestDatabase>>;
let app: ReturnType<typeof createApp>;
let caseId: string;
let operationId: string;
let fixtures: ReturnType<typeof fixtureWindows>;
const assessment = WORKFLOW_ASSESSMENTS + '/workflow-003';
const caseUrl = () => ADOPTION_ASSURANCE + '/cases/' + caseId;
const read = async () => (await app.inject({ url: caseUrl(), headers: headers('viewer') })).json();
const publish = (payload: Observation | object, auth = source) => app.inject({ method: 'POST', url: ADOPTION_OBSERVATIONS, payload, headers: auth });
const save = (payload: AdoptionAction | object, role: 'operator' | 'viewer' = 'operator') =>
  app.inject({ method: 'POST', url: caseUrl() + '/actions', payload, headers: headers(role) });

beforeAll(async () => {
  const migrations = await mkdtemp(join(tmpdir(), 'fda-before-adoption-'));
  try {
    for (const file of await readdir('database/migrations')) {
      if (file < '010') await copyFile(join('database/migrations', file), join(migrations, file));
    }
    db = await openTestDatabase(migrations);
  } finally { await rm(migrations, { recursive: true, force: true }); }
  app = createApp({ pool: db.pool, access, fdaSource: { ...fixtureScope, token }, downstream: { enabled: true, token: serviceToken } });
  for (const scenario of ['normal', 'assurance-complete-window']) {
    await publishScenario(async event => {
      const result = await app.inject({ method: 'POST', url: FDA_EVENTS, payload: event as object, headers: source });
      return { status: result.statusCode, body: result.json() };
    }, scenario);
  }
  await createFixtureDelivery(async (url, payload) => {
    const result = await app.inject({ method: 'POST', url, payload, headers: headers('operator') });
    expect(result.statusCode).toBe(200);
    return result.json();
  }, assessment);
  caseId = (await app.inject({ url: assessment, headers: headers('viewer') })).json().deliveryCases[0].id;
  const execution = await exerciseDownstreamEvidence(db.pool, caseId, 'pre-commit');
  operationId = execution.operation.id;
  expect(execution.operation.dispatches).toBe(2);
  await migrate(db.pool, 'database/migrations');
  fixtures = fixtureWindows({ caseId, workflowId: 'workflow-003', operationId,
    verifiedAt: execution.operation.updated_at.toISOString() });
}, 30_000);

afterAll(async () => { await app?.close(); await db?.close(); });

test('verified delivery starts with unknown adoption and enforces viewer and source scope', async () => {
  expect(await read()).toMatchObject({ status: 'awaiting-adoption-evidence', windows: [], operation: { id: operationId } });
  const event = fixtures.events('baseline')[0]!;
  expect((await publish(event, { authorization: 'Bearer ' + serviceToken })).statusCode).toBe(401);
  expect((await publish(event, { authorization: '' })).statusCode).toBe(401);
  expect((await save({}, 'viewer')).statusCode).toBe(403);
  expect((await app.inject(caseUrl() + '/export')).statusCode).toBe(401);
  expect((await publish({ ...event, sourceId: 'source-999' })).statusCode).toBe(403);
  expect((await publish({ ...event, caseId: randomUUID() })).statusCode).toBe(404);
  expect((await publish({ ...event, bogus: 'x'.repeat(5000) })).statusCode).toBe(413);
});

test('out-of-order observations, concurrent replay, conflict receipts and worker retries retain distinct counts', async () => {
  const events = fixtures.events('baseline').reverse();
  const first = events.shift()!;
  expect((await Promise.all([publish(first), publish(first)])).map(r => r.statusCode).sort()).toEqual([200, 201]);
  expect((await publish({ ...first, occurredAt: '1999-01-01T00:00:00Z' })).statusCode).toBe(409);
  for (const event of events) expect((await publish(event)).statusCode).toBe(201);
  const attempt = events.find(e => e.kind === 'attempt')!;
  expect((await publish({ ...attempt, eventId: randomUUID() })).statusCode).toBe(201);
  expect((await publish({ ...events.find(e => e.kind === 'result'), eventId: randomUUID(), operationId: randomUUID() })).statusCode).toBe(409);
  const result = await read();
  expect(result.windows[0]).toMatchObject({ coverage: 'complete', verified: 1,
    rates: { adoption: { numerator: 1, denominator: 4, value: .25 }, reliability: { numerator: 1, denominator: 1, value: 1 } } });
  expect(result.signals.map((s: { category: string }) => s.category)).toEqual(expect.arrayContaining(['low-adoption', 'permission']));
  expect(result.receipts.map((r: { status: string }) => r.status)).toEqual(expect.arrayContaining(['duplicate', 'conflict']));
});

test('intervention sequencing persists a reproducible non-causal follow-up and rejects conflicting transitions', async () => {
  const diagnosis = randomUUID(), intervention = randomUUID(), followUp = randomUUID();
  expect((await save({ kind: 'diagnose', requestId: diagnosis, periodId: 'period-001', category: 'low-adoption',
    reason, hypothesis: 'Opening instructions may be unclear.', unresolved: 'Inspect the synthetic permission profile.',
    nextAction: 'Document how to start the workflow.', responsible: 'Delivery engineer' })).statusCode).toBe(200);
  expect((await save({ kind: 'plan', requestId: intervention, reason, diagnosisId: diagnosis, followUpPeriodId: 'period-002',
    improvement: 'Clarify the first qualifying action.', responsible: 'Delivery engineer' })).statusCode).toBe(200);
  expect((await save({ kind: 'follow-up', requestId: followUp, interventionId: intervention, reason })).statusCode).toBe(409);
  expect((await save({ kind: 'implement', requestId: randomUUID(), interventionId: intervention,
    implementedAt: fixtures.implementationDate, reason })).statusCode).toBe(200);
  for (const event of fixtures.events('improvement')) expect((await publish(event)).statusCode).toBe(201);
  const body = { kind: 'follow-up', requestId: followUp, interventionId: intervention, reason };
  expect((await Promise.all([save(body), save(body)])).map(r => r.statusCode)).toEqual([200, 200]);
  expect((await save({ ...body, reason: 'A different explanation.' })).statusCode).toBe(409);
  const evidence = (await app.inject({ url: caseUrl() + '/export', headers: headers('viewer') })).json();
  expect(evidence.windows[1]).toMatchObject({ reportedSuccess: 3, verified: 0 });
  expect(evidence.audit[3].evidence.comparison).toMatchObject({ comparable: true, limitations: [expect.stringMatching(/cannot establish/), expect.any(String)],
    rates: expect.arrayContaining([expect.objectContaining({ metric: 'adoption', percentagePoints: 50 })]) });
});

test('unknown denominator, incomplete coverage, no improvement and changed cohort retain explicit semantics', () => {
  const baseline = measureWindow('period-001', fixtures.events('baseline'), null);
  const unchanged = measureWindow('period-003', fixtures.events('unchanged'), null);
  const incomplete = measureWindow('period-004', fixtures.events('incomplete'), null);
  const changed = measureWindow('period-005', fixtures.events('changed-cohort'), null);
  expect(measureWindow('period-999', [], null).rates.adoption.value).toBeNull();
  expect(compareWindows(baseline, unchanged).rates[0]?.percentagePoints).toBe(0);
  expect(compareWindows(baseline, incomplete)).toMatchObject({ comparable: false, reasons: expect.arrayContaining([expect.stringMatching(/coverage/)]) });
  expect(compareWindows(baseline, changed).changedCohort).toBe(true);
});
