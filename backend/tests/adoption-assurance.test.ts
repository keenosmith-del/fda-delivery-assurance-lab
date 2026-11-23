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
import { OUTCOME_ASSURANCE, OUTCOME_MEASUREMENTS, outcomeObservation } from '../../shared/contracts/outcome-assurance.ts';
import { outcomeFixture } from '../../scripts/outcome-fixture.ts';
import { compareStudies, modelOpportunity, study } from '../src/modules/outcomes/assurance-calculations.ts';
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
let outcomes: ReturnType<typeof outcomeFixture>;
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
  const intermediate = await mkdtemp(join(tmpdir(), 'fda-before-outcomes-'));
  try {
    for (const file of await readdir('database/migrations')) {
      if (file < '011') await copyFile(join('database/migrations', file), join(intermediate, file));
    }
    await migrate(db.pool, intermediate);
  } finally { await rm(intermediate, { recursive: true, force: true }); }
  const verifiedAt = execution.operation.updated_at.toISOString();
  outcomes = outcomeFixture({ caseId, workflowId: 'workflow-003', verifiedAt });
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

type StudyVariant = Parameters<ReturnType<typeof outcomeFixture>['events']>[0];
const outcomeUrl = () => OUTCOME_ASSURANCE + '/cases/' + caseId;
const selection = { baseline: 'period-001', comparison: 'period-002', method: 'matched-items' } as const;
const readOutcome = async (query?: Record<string, string>, exportFile = false) => {
  const url = outcomeUrl() + (exportFile ? '/export' : '') + (query ? '?' + new URLSearchParams(query) : '');
  const response = await app.inject({ url, headers: headers('viewer') });
  expect(response.statusCode).toBe(200);
  return response.json();
};
const publishOutcome = (payload: object, auth: Record<string, string> = source) =>
  app.inject({ method: 'POST', url: OUTCOME_MEASUREMENTS, payload, headers: auth });
const saveOutcome = (payload: object, auth: Record<string, string> = headers('operator')) =>
  app.inject({ method: 'POST', url: outcomeUrl() + '/reviews', payload, headers: auth });

test('migration 011 preserves a populated adoption chain and starts with unknown outcome', async () => {
  const before = await read();
  await migrate(db.pool, 'database/migrations');
  expect(await read()).toEqual(before);
  expect(await readOutcome()).toMatchObject({ status: 'Awaiting a baseline and comparison study', ready: false,
    reviewedDifference: null, adoption: { operation: { id: operationId }, windows: [{ verified: 1 }, { verified: 0, reportedSuccess: 3 }] } });
  const declaration = outcomes.events('baseline')[0]!;
  expect((await publishOutcome(declaration, { authorization: '' })).statusCode).toBe(401);
  expect((await publishOutcome(declaration, headers('viewer'))).statusCode).toBe(401);
  expect((await publishOutcome(declaration, { ...source, origin: access.origin })).statusCode).toBe(403);
  expect((await publishOutcome({ ...declaration, tenantId: 'tenant-999' })).statusCode).toBe(403);
  expect((await publishOutcome({ ...declaration, sourceId: 'source-999' })).statusCode).toBe(403);
  expect((await publishOutcome({ ...declaration, workflowId: 'workflow-007' })).statusCode).toBe(409);
  expect((await publishOutcome({ ...declaration, caseId: randomUUID() })).statusCode).toBe(404);
  expect((await publishOutcome({ ...declaration, notes: 'x'.repeat(5000) })).statusCode).toBe(413);
  expect((await saveOutcome({}, headers('viewer'))).statusCode).toBe(403);
  expect((await saveOutcome({}, source)).statusCode).toBe(401);
  expect((await saveOutcome({}, { authorization: 'Bearer ' + serviceToken })).statusCode).toBe(401);
  expect((await app.inject(outcomeUrl() + '/export')).statusCode).toBe(401);
  expect((await publishOutcome({ ...declaration, method: 'unsupported' })).statusCode).toBe(400);
  expect((await publishOutcome({ ...declaration, version: 'outcome/v2' })).statusCode).toBe(400);
});

test('model inputs remain conditional and time studies enforce duration, chronology and comparability', () => {
  const models = outcomes.events('model');
  for (const model of models) expect(model.kind).toBe('model');
  if (models[0]?.kind !== 'model' || models[1]?.kind !== 'model') throw new Error('Missing model fixtures');
  expect(modelOpportunity(models[0])).toMatchObject({ grossSeconds: 360, netSeconds: 255, weeklyGrossSeconds: 720, weeklyNetSeconds: 510 });
  expect(modelOpportunity(models[1])).toMatchObject({ grossSeconds: 360, netSeconds: null, weeklyGrossSeconds: null, weeklyNetSeconds: null });
  const base = outcomes.events('baseline');
  expect(outcomeObservation.safeParse({ ...base[0], end: '1900-01-01T00:00:00Z' }).success).toBe(false);
  expect(outcomeObservation.safeParse({ ...base[0], eventId: undefined }).success).toBe(false);
  for (const change of [{ unit: 'h' }, { duration: -1 }, { duration: 86_401 }, { duration: 0.1 }]) {
    expect(outcomeObservation.safeParse({ ...base[1], ...change }).success).toBe(false);
  }
  const after = outcomes.events('comparison');
  const first = study(selection.baseline, base);
  const second = study(selection.comparison, after);
  expect(first.humanSeconds).toBe(480);
  expect(second).toMatchObject({ humanSeconds: 340, sums: { processing: 120, review: 80, exception: 20, rework: 40,
    recovery: 0, 'remaining-manual': 200, instrumentation: 0 } });
  const usage = measureWindow(selection.comparison, fixtures.events('improvement'), null);
  const fewer = study(selection.baseline, base.filter(e => !('opportunity' in e) || ['opportunity-001','opportunity-003'].includes(e.opportunity))
    .map(e => e.kind === 'period' ? { ...e, expectedItems: 2 } : e));
  expect(compareStudies(fewer, second, selection, usage)).toMatchObject({ comparable: false, difference: null });
  expect(compareStudies(fewer, second, { ...selection, method: 'normalised-workload' }, usage))
    .toMatchObject({ comparable: true, difference: 35, unit: 'seconds per item' });
  const unbalanced = { ...fewer, items: fewer.items.map(item => ({ ...item, workload: 'routine' as const })) };
  expect(compareStudies(unbalanced, second, { ...selection, method: 'normalised-workload' }, usage)).toMatchObject({ comparable: false });
  expect(compareStudies(first, second, selection, { ...usage, rates: { ...usage.rates,
    adoption: { numerator: 3, denominator: null, value: null } } }).comparable).toBe(false);
  const sourceEffort = after.find(e => e.kind === 'effort' && e.category === 'review')!;
  const duplicate = outcomeObservation.parse({ ...sourceEffort, eventId: randomUUID() });
  expect(study(selection.comparison, [...after, duplicate]).humanSeconds).toBe(340);
  const millisecond = outcomeObservation.parse({ ...base[1], unit: 'ms', duration: 120001 });
  expect(study(selection.baseline, [base[0]!, millisecond, ...base.slice(2)]).humanSeconds).toBe(480.001);
});

test('operator review records the full linked evidence once and remains historically reproducible after restart and late evidence', async () => {
  const initial = outcomes.events('model');
  for (const item of initial) expect((await publishOutcome(item)).statusCode).toBe(201);
  expect(await readOutcome()).toMatchObject({ modeled: expect.arrayContaining([expect.objectContaining({ grossSeconds: 360 })]), reviewedDifference: null });
  const observations = [...outcomes.events('baseline'), ...outcomes.events('comparison')].reverse();
  const first = observations.shift()!;
  expect((await Promise.all([publishOutcome(first), publishOutcome(first)])).map(r => r.statusCode).sort()).toEqual([200, 201]);
  expect((await publishOutcome({ ...first, sourceRevision: 'b'.repeat(40) })).statusCode).toBe(409);
  for (const event of observations) expect((await publishOutcome(event)).statusCode).toBe(201);
  const priorAdoption = await read();
  const interventionId = priorAdoption.audit.find((item: { body: { kind: string } }) => item.body.kind === 'plan').id;
  const selected = { ...selection, interventionId };
  const before = await readOutcome(selected);
  expect(before).toMatchObject({ ready: true, verifiedEffects: 0, reviewedDifference: null, comparison: { difference: 140 },
    usage: { baseline: { verified: 1 }, comparison: { reportedSuccess: 3 } },
    intervention: { plan: { id: interventionId }, steps: [expect.anything(), expect.anything()] } });
  const review = { ...selected, requestId: randomUUID(), fingerprint: before.fingerprint, expectedRevision: 0,
    justification: 'Matched four synthetic opportunities and accounted for human effort.', limitations: 'The study cannot establish causality.',
    outcome: 'reviewed-synthetic-comparison' };
  expect((await saveOutcome({ ...review, outcome: 'verified-business-savings' })).statusCode).toBe(400);
  expect((await saveOutcome({ ...review, fingerprint: '0'.repeat(64) })).statusCode).toBe(409);
  expect((await Promise.all([saveOutcome(review), saveOutcome(review)])).map(r => r.json().revision)).toEqual([1, 1]);
  expect((await saveOutcome({ ...review, requestId: randomUUID() })).statusCode).toBe(409);
  expect((await saveOutcome({ ...review, justification: 'Changed justification.' })).statusCode).toBe(409);
  const exportData = await readOutcome(selected, true);
  expect(exportData).toMatchObject({ reviewedDifference: 140, version: 'fda-lab.outcome-assurance/v1',
    context: { approvedRevision: expect.anything(), decision: expect.anything(), delivery: expect.anything() },
    reviewHistory: [{ revision: 1, stale: false, snapshot: { comparison: { difference: 140 } } }] });
  expect(exportData.receipts.map((receipt: { status: string }) => receipt.status)).toEqual(expect.arrayContaining(['accepted','duplicate','conflict']));
  const late = { ...first, eventId: randomUUID(), sourceRevision: 'c'.repeat(40), duration: 1 };
  expect((await publishOutcome(late)).statusCode).toBe(201);
  await app.close();
  app = createApp({ pool: db.pool, access, fdaSource: { ...fixtureScope, token }, downstream: { enabled: true, token: serviceToken } });
  const stale = await readOutcome(selected);
  expect(stale).toMatchObject({ status: 'stale-review', ready: false, reviewedDifference: null, comparison: { difference: null },
    reviewHistory: [{ revision: 1, stale: true, snapshot: { comparison: { difference: 140 } } }] });
  expect(stale.fingerprint).not.toBe(before.fingerprint);
  expect((await saveOutcome({ ...review, expectedRevision: 1, requestId: randomUUID(), fingerprint: stale.fingerprint })).statusCode).toBe(409);
  expect((await saveOutcome({ ...review, expectedRevision: 1, requestId: randomUUID(), fingerprint: stale.fingerprint,
    outcome: 'insufficient-evidence' })).json()).toMatchObject({ revision: 2 });
});

test('overhead, missing observations, changes in method and cohort stay visible', async () => {
  const checks: [StudyVariant, string, number | null][] = [
    ['negative', 'period-003', -100], ['unchanged', 'period-004', 0], ['incomplete', 'period-005', null],
    ['changed-cohort', 'period-006', 140], ['different-method', 'period-007', null],
  ];
  for (const [variant, comparison, expected] of checks) {
    for (const event of fixtures.events('improvement')) {
      expect((await publish({ ...event, periodId: comparison, eventId: randomUUID() })).statusCode).toBe(201);
    }
    for (const event of outcomes.events(variant)) expect((await publishOutcome(event)).statusCode).toBe(201);
    const result = await readOutcome({ ...selection, comparison });
    expect(result.comparison.difference).toBe(expected);
    expect(result.usage.comparison.rates.adoption.value).toBe(.75);
    if (variant === 'changed-cohort') expect(result.comparison.cohortChanged).toBe(true);
    if (expected === null) expect(result.ready).toBe(false);
  }
});
