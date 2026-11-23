import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { migrate } from '../src/db/migrations.ts';
import { DOWNSTREAM_API, startExecution } from '../../shared/contracts/downstream.ts';
import { FDA_EVENTS } from '../../shared/contracts/fda-ingestion.ts';
import { WORKFLOW_ASSESSMENTS } from '../../shared/contracts/workflow-assessments.ts';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { fixtureScope } from '../../scripts/fda-fixture.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { createFixtureDelivery } from '../../tests/support/workflow-review.ts';
import { immediatePolicy, injectedSimulator, simulatorToken } from '../../tests/support/downstream-harness.ts';
import { controlOperation, operationEvidence, startOperation } from '../src/modules/downstream/operations.ts';
import { claimOperation, processClaim } from '../src/modules/downstream/worker.ts';
import { httpSimulatorAdapter, simulatorOrigin } from '../src/modules/downstream/adapter.ts';

const sourceToken = 'synthetic_downstream_source_token_0001';
const actor = { role: 'operator', sourceRevision: 'a'.repeat(40) } as const;
const assessment = WORKFLOW_ASSESSMENTS + '/workflow-003';
const access = { origin: 'https://lab.example.test', operator: 'synthetic-delivery-operator', viewer: 'synthetic-delivery-viewer' };
const auth = (role: keyof Pick<typeof access, 'operator' | 'viewer'>) => `Basic ${Buffer.from(`${role}:${access[role]}`).toString('base64')}`;
const reason = 'Reviewed and authorised the isolated synthetic execution.';
const input = () => startExecution.parse({ requestKey: randomUUID(), reason, syntheticOnly: true });

async function prepare(db: Awaited<ReturnType<typeof openTestDatabase>>, variant?: 'external' | 'pilot') {
  const app = createApp({ pool: db.pool, access, downstream: { enabled: true, token: simulatorToken }, fdaSource: { ...fixtureScope, token: sourceToken } });
  const publish = (scenario: string) => publishScenario(async event => {
    const response = await app.inject({ method: 'POST', url: FDA_EVENTS, headers: { authorization: 'Bearer ' + sourceToken }, payload: event as object });
    return { status: response.statusCode, body: response.json() };
  }, scenario);
  await publish('normal');
  await publish('assurance-complete-window');
  const write = (path: string, payload: object, authorization = auth('operator')) => app.inject({
    method: 'POST', url: path, payload, headers: { authorization, origin: access.origin },
  });
  await createFixtureDelivery(async (path, payload) => {
    const body = payload as { action?: string; feasibility?: { operations: { clientApproval: string } } };
    const data = variant === 'external' && body.action === 'feasibility' && body.feasibility
      ? { ...body, feasibility: { ...body.feasibility, operations: { ...body.feasibility.operations, clientApproval: 'required' } } } : variant === 'pilot' && path.endsWith('/decisions') ? { ...body, outcome: 'approve-supervised-pilot',
        pilot: { operatingLimits: 'Exactly one scoped synthetic report.', humanReview: 'Review the expected report and permissions.',
          stopCriteria: 'Stop on a dispatch failure or uncertain evidence.' } } : body;
    const response = await write(path, data);
    expect(response.statusCode).toBe(200);
    return response.json();
  }, assessment);
  const current = await app.inject({ url: assessment, headers: { authorization: auth('viewer') } });
  return { app, publish, write, caseId: current.json().deliveryCases[0].id as string };
}

async function setup() {
  const db = await openTestDatabase();
  const fixture = await prepare(db);
  return { ...fixture, db, async close() { await fixture.app.close(); await db.close(); } };
}

async function drain(db: Awaited<ReturnType<typeof openTestDatabase>>['pool'], adapter: ReturnType<typeof httpSimulatorAdapter>, policy = immediatePolicy) {
  for (let step = 0; step < 25; step++) {
    const claim = await claimOperation(db, policy);
    if (!claim) return;
    expect(await processClaim(db, claim, adapter, policy)).toBe(true);
  }
  throw new Error('The synthetic worker did not drain.');
}

describe('downstream execution', () => {
  let lab: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { lab = await setup(); }, 30_000);
  afterAll(async () => { await lab?.close(); });

  test('gates credentials, scope, payload size and concurrent idempotent creation', async () => {
    const route = DOWNSTREAM_API + '/cases/' + lab.caseId + '/start';
    const op = input();
    expect((await lab.write(route, op, auth('viewer'))).statusCode).toBe(403);
    expect((await lab.write(route, op, '')).statusCode).toBe(401);
    expect((await lab.write(route, op, 'Bearer ' + sourceToken)).statusCode).toBe(401);
    expect((await lab.write(route, op, 'Bearer ' + simulatorToken)).statusCode).toBe(401);
    expect((await lab.write(route, { ...op, url: 'http://other.invalid' })).statusCode).toBe(400);
    expect((await lab.write(route, { ...op, reason: 'x'.repeat(10_000) })).statusCode).toBe(413);
    const replies = await Promise.all([lab.write(route, op), lab.write(route, op)]);
    expect(replies.map(r => r.statusCode)).toEqual([202, 202]);
    expect((await lab.write(route, { ...op, reason: 'Conflicting body for an identical execution key.' })).statusCode).toBe(409);
    expect((await lab.write(route, input())).statusCode).toBe(409);
    const [stored] = (await lab.db.pool.query<{ id: string }>('SELECT id FROM fda_downstream_operations')).rows;
    expect((await lab.db.pool.query('SELECT * FROM fda_downstream_jobs')).rows).toHaveLength(1);
    expect((await lab.db.pool.query('SELECT * FROM fda_downstream_audit')).rows).toHaveLength(1);
    await expect(operationEvidence(lab.db.pool, { ...fixtureScope, sourceId: 'source-999' }, stored!.id)).rejects.toThrow('OPERATION_NOT_FOUND');
    await expect(operationEvidence(lab.db.pool, { ...fixtureScope, tenantId: 'tenant-999' }, stored!.id)).rejects.toThrow('OPERATION_NOT_FOUND');
    expect((await lab.app.inject(DOWNSTREAM_API + '/operations/' + stored!.id + '/export')).statusCode).toBe(401);
  });

  test('rejects unsafe simulator destinations and redirects', async () => {
    for (const target of ['https://127.0.0.1:3099', 'http://localhost:3099', 'http://10.0.0.1:3099',
      'http://127.0.0.1:3099/path', 'http://whatever@127.0.0.1:3099', 'http://127.0.0.1:3099?x=true']) {
      expect(() => simulatorOrigin(target)).toThrow();
    }
    const adapter = httpSimulatorAdapter('http://127.0.0.1:3099', simulatorToken, 100, async (_, options) => {
      expect(options?.redirect).toBe('error');
      throw new TypeError('Redirect disallowed');
    });
    expect(await adapter.lookup('a'.repeat(64))).toMatchObject({ kind: 'unavailable' });
  });
});

test('lost acknowledgment after durable commit is independently verified once, even after lease expiry and simulator restart', async () => {
  const lab = await setup();
  const simulator = await injectedSimulator('lost-acknowledgment');
  try {
    const op = await startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor);
    const claim = (await claimOperation(lab.db.pool, immediatePolicy))!;
    expect(await claimOperation(lab.db.pool, immediatePolicy)).toBeNull();
    await processClaim(lab.db.pool, claim, simulator.adapter, immediatePolicy);
    const ambiguous = await operationEvidence(lab.db.pool, fixtureScope, op.id);
    expect(ambiguous.operation.state).toBe('awaiting-reconciliation');
    expect(ambiguous.attempts[0]?.metadata).toMatchObject({ kind: 'uncertain', code: 'ACKNOWLEDGMENT_UNAVAILABLE' });
    expect((await simulator.storage.pool.query('SELECT * FROM synthetic_effects')).rows).toHaveLength(1);
    const interrupted = (await claimOperation(lab.db.pool, immediatePolicy))!;
    await lab.db.pool.query("UPDATE fda_downstream_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [op.id]);
    await simulator.restart();
    await drain(lab.db.pool, simulator.adapter);
    expect(await processClaim(lab.db.pool, interrupted, simulator.adapter, immediatePolicy)).toBe(false);
    const final = await operationEvidence(lab.db.pool, fixtureScope, op.id);
    expect(final.operation).toMatchObject({ state: 'succeeded', dispatches: 1 });
    expect(final.attempts.at(-1)).toMatchObject({ recovered_lease: true, metadata: { kind: 'found', effectId: final.operation.verified_effect_id } });
    const envelope = { key: op.effect_key, effect: op.effect, operationId: op.id };
    expect(await simulator.adapter.dispatch(envelope)).toMatchObject({ kind: 'acknowledged', outcome: 'replay' });
    expect(await simulator.adapter.dispatch({ ...envelope, effect: { ...op.effect, workflowId: 'workflow-999' } })).toMatchObject({
      kind: 'rejected', code: 'IDEMPOTENCY_CONFLICT',
    });
    expect((await simulator.storage.pool.query('SELECT * FROM synthetic_effects')).rows).toHaveLength(1);
    const exported = await lab.app.inject({ url: DOWNSTREAM_API + '/operations/' + op.id + '/export', headers: { authorization: auth('viewer') } });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().operation.verified_effect_id).toBe(final.operation.verified_effect_id);
    expect(exported.body).not.toContain(simulatorToken);
  } finally { await simulator.close(); await lab.close(); }
}, 30_000);

test.each([
  ['pre-commit', 'succeeded', 2],
  ['reject', 'failed-terminal', 1],
  ['delay-lookup', 'succeeded', 1],
  ['mismatch', 'failed-terminal', 1],
] as const)('handles the %s simulator scenario', async (fault, state, dispatches) => {
  const lab = await setup();
  const simulator = await injectedSimulator(fault);
  try {
    const operation = await startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor);
    await drain(lab.db.pool, simulator.adapter);
    expect((await operationEvidence(lab.db.pool, fixtureScope, operation.id)).operation).toMatchObject({ state, dispatches });
    if (fault === 'mismatch' || fault === 'reject') await expect(controlOperation(lab.db.pool, fixtureScope, operation.id,
      { action: 'redrive', reason }, actor)).rejects.toThrow('RECOVERY_NOT_PERMITTED');
  } finally { await simulator.close(); await lab.close(); }
}, 25_000);

test('records retry exhaustion and a bounded redrive after authoritative absence', async () => {
  const lab = await setup();
  const simulator = await injectedSimulator('pre-commit');
  try {
    const op = await startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor);
    await drain(lab.db.pool, simulator.adapter, { ...immediatePolicy, maxDispatches: 1 });
    expect((await operationEvidence(lab.db.pool, fixtureScope, op.id)).operation.last_error).toBe('DISPATCH_EXHAUSTED');
    const redrive = { action: 'redrive', reason } as const;
    const outcomes = await Promise.allSettled([controlOperation(lab.db.pool, fixtureScope, op.id, redrive, actor),
      controlOperation(lab.db.pool, fixtureScope, op.id, redrive, actor)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await drain(lab.db.pool, simulator.adapter);
    expect((await operationEvidence(lab.db.pool, fixtureScope, op.id)).operation).toMatchObject({ state: 'succeeded', dispatches: 2, redriven: true });
    expect((await simulator.storage.pool.query('SELECT * FROM synthetic_effects')).rows).toHaveLength(1);
  } finally { await simulator.close(); await lab.close(); }
}, 25_000);

test('blocks stale evidence and unverified external authorisation', async () => {
  const lab = await setup();
  const blockedDb = await openTestDatabase();
  try {
    await lab.publish('workflow-evidence-change');
    await expect(startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor)).rejects.toThrow('STALE_DELIVERY_EVIDENCE');
    const blocked = await prepare(blockedDb, 'external');
    try {
      await expect(startOperation(blockedDb.pool, fixtureScope, blocked.caseId, input(), actor)).rejects.toThrow('DELIVERY_PREREQUISITES_UNMET');
    } finally { await blocked.app.close(); }
  } finally { await lab.close(); await blockedDb.close(); }
}, 30_000);

test('upgrades a populated Milestone 09 database and preserves case and decision identity', async () => {
  const original = await mkdtemp(join(tmpdir(), 'fda-before-downstream-'));
  const directory = 'database/migrations';
  try {
    for (const file of (await readdir(directory)).filter(name => /^00[1-8]_/.test(name))) await copyFile(join(directory, file), join(original, file));
    const db = await openTestDatabase(original);
    const lab = await prepare(db);
    try {
      await migrate(db.pool, directory);
      const saved = await startOperation(db.pool, fixtureScope, lab.caseId, input(), actor);
      expect(saved).toMatchObject({ delivery_case_id: lab.caseId, workflow_id: 'workflow-003', state: 'queued' });
      await controlOperation(db.pool, fixtureScope, saved.id, { action: 'cancel', reason }, actor);
      expect((await operationEvidence(db.pool, fixtureScope, saved.id)).operation.state).toBe('cancelled');
      expect(await claimOperation(db.pool, immediatePolicy)).toBeNull();
    } finally { await lab.app.close(); await db.close(); }
  } finally { await rm(original, { recursive: true, force: true }); }
}, 30_000);

test('a failed dispatch-intent insert rolls back the operation and authorization', async () => {
  const lab = await setup();
  try {
    await lab.db.pool.query(`CREATE FUNCTION forbid_dispatch_job() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'dispatch intent rejected'; END; $$;
      CREATE TRIGGER reject_job BEFORE INSERT ON fda_downstream_jobs FOR EACH ROW EXECUTE FUNCTION forbid_dispatch_job()`);
    await expect(startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor)).rejects.toThrow('dispatch intent rejected');
    for (const table of ['fda_downstream_operations', 'fda_downstream_jobs', 'fda_downstream_audit']) {
      expect((await lab.db.pool.query('SELECT * FROM ' + table)).rows).toHaveLength(0);
    }
  } finally { await lab.close(); }
}, 30_000);

test('respects Retry-After and reconciles after temporary simulator unavailability', async () => {
  const lab = await setup();
  const simulator = await injectedSimulator('rate-limit');
  try {
    const op = await startOperation(lab.db.pool, fixtureScope, lab.caseId, input(), actor);
    const initial = (await claimOperation(lab.db.pool, immediatePolicy))!;
    await processClaim(lab.db.pool, initial, simulator.adapter, immediatePolicy);
    const rateLimited = await operationEvidence(lab.db.pool, fixtureScope, op.id);
    expect(rateLimited.attempts[0]?.metadata).toMatchObject({ status: 429, retryDelayMs: 1000 });
    await lab.db.pool.query("UPDATE fda_downstream_jobs SET due_at=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [op.id]);
    const temporarilyOffline = httpSimulatorAdapter('http://127.0.0.1:3099', simulatorToken, 100, async () => { throw new Error('ECONNREFUSED'); });
    const timedOut = (await claimOperation(lab.db.pool, immediatePolicy))!;
    await processClaim(lab.db.pool, timedOut, temporarilyOffline, immediatePolicy);
    expect((await operationEvidence(lab.db.pool, fixtureScope, op.id)).operation.state).toBe('awaiting-reconciliation');
    await drain(lab.db.pool, simulator.adapter);
    expect((await operationEvidence(lab.db.pool, fixtureScope, op.id)).operation).toMatchObject({ state: 'succeeded', dispatches: 2 });
  } finally { await simulator.close(); await lab.close(); }
}, 25_000);

test('requires pilot attestation and stops redispatch on an unverified pilot effect', async () => {
  const db = await openTestDatabase();
  const lab = await prepare(db, 'pilot');
  const simulator = await injectedSimulator('pre-commit');
  try {
    await expect(startOperation(db.pool, fixtureScope, lab.caseId, input(), actor)).rejects.toThrow('PILOT_REVIEW_REQUIRED');
    const op = await startOperation(db.pool, fixtureScope, lab.caseId, { ...input(), supervisionConfirmed: true }, actor);
    await drain(db.pool, simulator.adapter);
    const evidence = await operationEvidence(db.pool, fixtureScope, op.id);
    expect(evidence.operation).toMatchObject({ state: 'failed-terminal', dispatches: 1, authorisation: { supervisionConfirmed: true, maximumEffects: 1 } });
    await expect(controlOperation(db.pool, fixtureScope, op.id, { action: 'redrive', reason }, actor)).rejects.toThrow('REDRIVE_NOT_PERMITTED');
    expect((await simulator.storage.pool.query('SELECT * FROM synthetic_effects')).rows).toHaveLength(0);
  } finally { await simulator.close(); await lab.app.close(); await db.close(); }
}, 25_000);
