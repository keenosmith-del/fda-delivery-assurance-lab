import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { claimConfirmation, finishConfirmation } from '../src/workers/confirmation.ts';
import { openTestDatabase } from '../../tests/support/database.ts';

const writeToken = 'integration-token-for-synthetic-requests';
let database: Awaited<ReturnType<typeof openTestDatabase>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await openTestDatabase();
  app = createApp({ pool: database.pool, enableFaults: true, writeToken });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

function post(id: string, code: string, fault?: string, token = writeToken) {
  return app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: {
      'idempotency-key': id,
      authorization: `Bearer ${token}`,
      ...(fault ? { 'x-lab-fault': fault } : {}),
    },
    payload: { candidateCode: code, requisition: 'engineering' },
  });
}

function lookup(id: string) {
  return app.inject({ method: 'GET', url: `/api/operations/${id}` });
}

async function countRecords(code: string) {
  const result = await database.pool.query('SELECT id FROM submissions WHERE candidate_code = $1', [code]);
  return result.rowCount;
}

async function clearQueue() {
  await database.pool.query('TRUNCATE submission_events, confirmation_jobs, submission_operations, submissions');
}

describe('ATS submission API', () => {
  it('checks liveness and database readiness', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/api/ready')).json()).toEqual({ status: 'ready' });
  });

  it('enforces operator access and a synthetic candidate format', async () => {
    const id = randomUUID();
    expect((await post(id, 'CAND-1020', undefined, 'wrong')).statusCode).toBe(401);
    expect((await post(id, 'someone@example.com')).statusCode).toBe(400);
    expect((await post(id, 'CAND-1020', 'unsupported')).statusCode).toBe(400);
    expect((await lookup(id)).statusCode).toBe(404);
  });

  it('replays identical payloads and rejects changed payloads under the same identity', async () => {
    const id = randomUUID();
    const accepted = await post(id, 'CAND-1001');
    expect(accepted.statusCode).toBe(202);
    const replayed = await post(id, ' cand-1001 ');
    expect(replayed.json().recordId).toBe(accepted.json().recordId);
    expect((await post(id, 'CAND-1002')).statusCode).toBe(409);
    expect(await countRecords('CAND-1001')).toBe(1);
    expect(await countRecords('CAND-1002')).toBe(0);
    expect((await lookup(id)).json().events.map(({ kind }: { kind: string }) => kind))
      .toEqual(['accepted', 'replayed', 'payload_conflict']);
  });

  it('links independent operation IDs to the same business record', async () => {
    const first = await post(randomUUID(), 'CAND-1003');
    const second = await post(randomUUID(), 'CAND-1003');
    expect(second.json()).toMatchObject({ recordId: first.json().recordId, duplicate: true });
    expect(await countRecords('CAND-1003')).toBe(1);
  });

  it('rolls back all writes on pre-commit interruption and accepts safe replay', async () => {
    const id = randomUUID();
    const failed = await post(id, 'CAND-1004', 'before-commit');
    expect(failed.statusCode).toBe(504);
    expect(failed.json().error).toBe('SIMULATED_PRE_COMMIT_TIMEOUT');
    expect(await countRecords('CAND-1004')).toBe(0);
    expect((await lookup(id)).statusCode).toBe(404);
    expect((await post(id, 'CAND-1004')).statusCode).toBe(202);
    expect(await countRecords('CAND-1004')).toBe(1);
  });

  it('recovers an acknowledgment lost after commit without a duplicate', async () => {
    const id = randomUUID();
    const failed = await post(id, 'CAND-1005', 'lost-ack');
    expect(failed.statusCode).toBe(504);
    const committed = await lookup(id);
    const replayed = await post(id, 'CAND-1005');
    expect(replayed.json().recordId).toBe(committed.json().recordId);
    expect(await countRecords('CAND-1005')).toBe(1);
  });

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('preserves uniqueness across concurrent connections', async () => {
    const id = randomUUID();
    const submissions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      post(index % 2 ? id : randomUUID(), 'CAND-1006')));
    expect(submissions.every(response => response.statusCode === 202)).toBe(true);
    expect(new Set(submissions.map(response => response.json().recordId)).size).toBe(1);
    expect(await countRecords('CAND-1006')).toBe(1);
  });
});

describe('durable confirmation', () => {
  it('reclaims an expired lease and rejects a stale worker completion', async () => {
    await clearQueue();
    const id = randomUUID();
    await post(id, 'CAND-1007');
    const interrupted = await claimConfirmation(database.pool);
    expect(interrupted).toMatchObject({ id, attempt: 1 });
    await database.pool.query("UPDATE confirmation_jobs SET lease_until = now() - interval '1 second' WHERE operation_id = $1", [id]);
    const resumed = await claimConfirmation(database.pool);
    expect(resumed).toMatchObject({ id, attempt: 2 });
    expect(await finishConfirmation(database.pool, interrupted!)).toBe(false);
    expect(await finishConfirmation(database.pool, resumed!)).toBe(true);
    expect((await lookup(id)).json()).toMatchObject({
      state: 'confirmed', confirmationAttempts: 2,
      events: [{ kind: 'accepted' }, { kind: 'lease_expired' }, { kind: 'confirmed' }],
    });
  });

  it('backs off on confirmation failure and exposes terminal exhaustion', async () => {
    await clearQueue();
    const id = randomUUID();
    await post(id, 'CAND-1008');
    for (let attempt = 1; attempt <= 4; attempt++) {
      const claim = await claimConfirmation(database.pool);
      expect(claim).toMatchObject({ id, attempt });
      expect(await finishConfirmation(database.pool, claim!, false)).toBe(true);
      expect(await claimConfirmation(database.pool)).toBeNull();
      await database.pool.query('UPDATE confirmation_jobs SET available_at = now() WHERE operation_id = $1', [id]);
    }
    expect((await lookup(id)).json()).toMatchObject({ state: 'confirmation_failed', confirmationAttempts: 4 });
    expect(await countRecords('CAND-1008')).toBe(1);
    expect(await claimConfirmation(database.pool)).toBeNull();
  });
});
