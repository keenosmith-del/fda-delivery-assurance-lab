import { copyFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { migrate } from '../src/db/migrations.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { feasible, reviewedRisk } from '../../tests/support/workflow-review.ts';
import { assessmentDetail, WORKFLOW_ASSESSMENTS } from '../../shared/contracts/workflow-assessments.ts';
import { FDA_EVENTS, FDA_GATEWAY } from '../../shared/contracts/fda-ingestion.ts';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { fixtureScope } from '../../scripts/fda-fixture.ts';

const token = 'synthetic_assessment_source_token_0001';
const access = { origin: 'https://lab.example.test', operator: 'synthetic-review-operator', viewer: 'synthetic-review-viewer', demo: 'synthetic-review-demo' };
const basic = (role: 'operator' | 'viewer' | 'demo') => `Basic ${Buffer.from(`${role}:${access[role]}`).toString('base64')}`;
const justification = 'Reviewed the supporting synthetic records and the proposed lab approach.';

function publish(app: ReturnType<typeof createApp>, scenario: string) {
  return publishScenario(async event => {
    const r = await app.inject({ method: 'POST', url: FDA_EVENTS, headers: { authorization: `Bearer ${token}` }, payload: event as object });
    return { status: r.statusCode, body: r.json() };
  }, scenario);
}

describe('imported workflow engineering assessments', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  const ready = 'workflow-003';
  const blocked = 'workflow-002';
  const incomplete = 'workflow-001';
  const revision = 'a'.repeat(40);
  const makeApp = () => createApp({ pool: db.pool, access, revision, fdaSource: { ...fixtureScope, token } });
  beforeAll(async () => {
    db = await openTestDatabase();
    app = makeApp();
    await publish(app, 'normal');
    await publish(app, 'assurance-complete-window');
  }, 30_000);
  afterAll(async () => { await app?.close(); await db?.close(); });

  const get = (suffix: string) => app.inject({ url: WORKFLOW_ASSESSMENTS + suffix, headers: { authorization: basic('viewer') } });
  const write = (suffix: string, payload: object, auth = basic('operator'), origin = access.origin) =>
    app.inject({ method: 'POST', url: WORKFLOW_ASSESSMENTS + suffix, payload, headers: { authorization: auth, origin } });
  const read = async (id: string) => assessmentDetail.parse((await get('/' + id)).json());
  const revise = (id: string, body: object) => write('/' + id + '/revisions', body);
  const decide = (id: string, rev: number, outcome: string, extra = {}) =>
    write('/' + id + '/decisions', { revision: rev, outcome, justification, conditions: [], ...extra });
  const delivery = (id: string, rev: number) => write('/' + id + '/delivery-cases', { revision: rev });
  async function submit(id: string, from: number) {
    const response = await revise(id, { revision: from, action: 'submit', reason: 'Serve this reviewed revision to the operator for decision.' });
    expect(response.statusCode).toBe(200);
    return assessmentDetail.parse(response.json()).current.revision;
  }

  test('blocks from source conditions before an incident exists and keeps different evidence states traceable', async () => {
    const response = await app.inject({ url: FDA_GATEWAY + '/assurance/workflow-readiness', headers: { authorization: basic('viewer') } });
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ workflowId: blocked, readiness: 'blocked-by-operations',
        windows: [expect.objectContaining({ incidents: [], blockers: expect.arrayContaining([expect.objectContaining({ endpointId: 'endpoint-008' })]) })] }),
      expect.objectContaining({ workflowId: ready, readiness: 'ready-for-review' }),
    ]));
    expect((await write('/workflow-999', {})).statusCode).toBe(404);
    const [a, b] = await Promise.all([write('/' + ready, {}), write('/' + ready, {})]);
    expect(a.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    const snapshot = (await read(ready)).current.snapshot;
    expect(snapshot.records.some(record => record.event.sourceRecordId === 'record-091')).toBe(true);
    expect((await read(ready)).audit).toHaveLength(1);
  });

  test('enforces workspace and scope permissions and strict request contracts', async () => {
    const id = '/' + ready;
    for (const [auth, code] of [[basic('viewer'), 403], [basic('demo'), 403], [`Bearer ${token}`, 401], ['', 401],
      ['Basic ' + Buffer.from('operator:invalid-password').toString('base64'), 401]] as const) {
      expect((await write(id, {}, auth)).statusCode).toBe(code);
    }
    expect((await write(id, {}, basic('operator'), 'https://other.test')).statusCode).toBe(403);
    expect((await write(id, { tenantId: 'tenant-002' })).statusCode).toBe(400);
    expect((await revise(ready, { action: 'feasibility', revision: 0, feasibility: {} })).statusCode).toBe(400);
    expect((await revise(ready, { action: 'feasibility', revision: 1, feasibility: { ...feasible, score: 100 } })).statusCode).toBe(400);
    expect((await revise(ready, { action: 'reassess', revision: 1, reason: 'x'.repeat(33000) })).statusCode).toBe(413);
    expect((await app.inject({ url: WORKFLOW_ASSESSMENTS + id + '/export' })).statusCode).toBe(401);
    for (const scope of [{ tenantId: 'tenant-999', sourceId: 'source-001' }, { tenantId: 'tenant-001', sourceId: 'source-999' }]) {
      const other = createApp({ pool: db.pool, access, fdaSource: { ...scope, token } });
      try {
        expect((await other.inject({ url: WORKFLOW_ASSESSMENTS + id + '/export', headers: { authorization: basic('viewer') } })).statusCode).toBe(404);
        expect((await other.inject({ url: WORKFLOW_ASSESSMENTS + id, method: 'POST', payload: {},
          headers: { authorization: basic('operator'), origin: access.origin } })).statusCode).toBe(404);
      } finally { await other.close(); }
    }
  });

  test('validates transitions and serializes revision and approval races', async () => {
    expect((await decide(ready, 1, 'approve-implementation-planning')).statusCode).toBe(409);
    const updates = await Promise.all([
      revise(ready, { revision: 1, action: 'feasibility', feasibility: feasible }),
      revise(ready, { revision: 1, action: 'feasibility', feasibility: feasible }),
    ]);
    expect(updates.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await revise(ready, { revision: 2, action: 'risks', risks: [reviewedRisk], rationale: justification })).statusCode).toBe(200);
    const pending = await submit(ready, 3);
    const decisions = await Promise.all([decide(ready, pending, 'approve-implementation-planning'),
      decide(ready, pending, 'approve-implementation-planning')]);
    expect(decisions.map(r => r.statusCode)).toEqual([200, 200]);
    expect((await decide(ready, pending, 'reject')).statusCode).toBe(409);
    expect((await decide(ready, 2, 'reject')).statusCode).toBe(409);
    const saved = await read(ready);
    expect(saved.current.suitability).toMatchObject({ recommendation: 'planning', exceptions: 0 });
    expect(saved.decisions).toEqual([expect.objectContaining({ outcome: 'approve-implementation-planning', actorRole: 'operator' })]);
    const jobs = await Promise.all([delivery(ready, pending), delivery(ready, pending)]);
    expect(jobs.map(r => r.statusCode)).toEqual([200, 200]);
    expect(jobs[0].json().deliveryCases).toEqual([expect.objectContaining({ readiness: 'ready-for-technical-implementation' })]);
    expect(jobs[1].json().deliveryCases[0].id).toBe(jobs[0].json().deliveryCases[0].id);
  });

  test('defers under blocking or incomplete evidence and keeps unverified work out of delivery', async () => {
    for (const id of [blocked, incomplete]) {
      expect((await write('/' + id, {})).statusCode).toBe(200);
      const pending = await submit(id, 1);
      expect((await decide(id, pending, 'approve-implementation-planning')).statusCode).toBe(422);
      expect((await decide(id, pending, 'defer', { justification: '' })).statusCode).toBe(400);
      expect((await decide(id, pending, 'defer')).statusCode).toBe(200);
      expect((await delivery(id, pending)).statusCode).toBe(422);
    }
  });

  test('requires reassessment after material source change and retains earlier cases on restart', async () => {
    await publish(app, 'workflow-evidence-change');
    const stale = await read(ready);
    expect(stale.stale).toBe(true);
    expect(stale.deliveryCases[0].readiness).toBe('blocked-by-prerequisites');
    expect((await delivery(ready, stale.current.revision)).statusCode).toBe(409);
    expect((await revise(ready, { revision: stale.current.revision, action: 'reassess', reason: justification })).statusCode).toBe(200);
    await app.close();
    app = makeApp();
    const revised = await read(ready);
    expect(revised.current.snapshot.evidence.observations[0]?.durationSeconds).toBe(95);
    expect(revised.revisions[0].snapshot.evidence.observations[0]?.durationSeconds).toBe(60);
    expect(revised.deliveryCases[0]).toMatchObject({ readiness: 'superseded', recordedReadiness: 'ready-for-technical-implementation' });
    expect(revised.audit.filter(a => a.action === 'delivery-case-created')).toHaveLength(1);
  });

  test('blocks unresolved high risk, supports rejection and records a constrained pilot with an external prerequisite', async () => {
    let n = (await read(ready)).current.revision;
    const pilotPlan = { ...feasible, operations: { ...feasible.operations, clientApproval: 'required' },
      suitability: { ...feasible.suitability, humanJudgement: 'high' } };
    expect((await revise(ready, { revision: n++, action: 'feasibility', feasibility: pilotPlan })).statusCode).toBe(200);
    expect((await revise(ready, { revision: n++, action: 'risks', risks: [{ ...reviewedRisk, residual: 'high' }], rationale: justification })).statusCode).toBe(200);
    n = await submit(ready, n);
    const pilot = { operatingLimits: 'Run only against a disposable lab window.', humanReview: 'Operator validates every proposed report.',
      stopCriteria: 'Stop if a receipt or mandatory permission is missing.' };
    expect((await decide(ready, n, 'approve-supervised-pilot', { pilot })).statusCode).toBe(422);
    expect((await decide(ready, n, 'reject')).statusCode).toBe(200);
    expect((await delivery(ready, n)).statusCode).toBe(422);
    expect((await revise(ready, { revision: n++, action: 'reassess', reason: justification })).statusCode).toBe(200);
    expect((await revise(ready, { revision: n++, action: 'feasibility', feasibility: pilotPlan })).statusCode).toBe(200);
    expect((await revise(ready, { revision: n++, action: 'risks', risks: [reviewedRisk], rationale: justification })).statusCode).toBe(200);
    n = await submit(ready, n);
    expect((await decide(ready, n, 'approve-implementation-planning')).statusCode).toBe(422);
    expect((await decide(ready, n, 'approve-supervised-pilot', { pilot })).statusCode).toBe(200);
    const d = await delivery(ready, n);
    expect(d.json().deliveryCases.at(-1)).toMatchObject({ readiness: 'blocked-by-prerequisites', pilot,
      prerequisites: expect.arrayContaining([expect.objectContaining({ requirement: 'External client authorisation', status: 'unverified' })]) });
    const exported = await get('/' + ready + '/export');
    expect(exported.headers['content-disposition']).toContain('workflow-003-engineering-assessment');
    expect(exported.json().assessment.decisions).toHaveLength(3);
    expect(exported.body).not.toContain(token);
  });
});

test('migration 008 preserves previously accepted receipts in an upgraded schema', async () => {
  const migrations = 'database/migrations';
  const old = await mkdtemp(join(tmpdir(), 'fda-workflow-migration-'));
  try {
    for (const name of (await readdir(migrations)).filter(file => /^00[1-7]_/.test(file))) await copyFile(join(migrations, name), join(old, name));
    const db = await openTestDatabase(old);
    const app = createApp({ pool: db.pool, fdaSource: { ...fixtureScope, token } });
    try {
      const before = await publish(app, 'normal');
      await migrate(db.pool, migrations);
      const after = await app.inject({ url: FDA_GATEWAY + '/receipts/' + before[0].id });
      expect(after.json()).toEqual(before[0]);
      expect((await app.inject({ url: WORKFLOW_ASSESSMENTS })).json()).toEqual([]);
    } finally { await app.close(); await db.close(); }
  } finally { await rm(old, { recursive: true, force: true }); }
}, 25_000);
