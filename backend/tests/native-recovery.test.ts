import { fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { database } from '../src/db/pool.ts';
import { finishConfirmation } from '../src/workers/confirmation.ts';
import { openTestDatabase } from '../../tests/support/database.ts';

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))('native PostgreSQL failure recovery', () => {
  let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    fixture = await openTestDatabase();
    app = createApp({ pool: fixture.pool, enableFaults: true });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    await fixture?.close();
  });

  const post = (server: typeof app, id: string, candidateCode: string, lostAck = false) => server.inject({
    method: 'POST', url: '/api/submissions',
    headers: { 'idempotency-key': id, ...(lostAck ? { 'x-lab-fault': 'lost-ack' } : {}) },
    payload: { candidateCode, requisition: 'engineering' },
  });

  it('serialises simultaneous conflicting payloads with separate connections', async () => {
    const id = randomUUID();
    const responses = await Promise.all([post(app, id, 'CAND-5101'), post(app, id, 'CAND-5102')]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([202, 409]);
    const records = await fixture.pool.query("SELECT id FROM submissions WHERE candidate_code IN ('CAND-5101', 'CAND-5102')");
    expect(records.rows).toEqual([{ id: responses.find(response => response.statusCode === 202)!.json().recordId }]);
    expect((await app.inject(`/api/operations/${id}`)).json().events.map((event: {kind: string}) => event.kind))
      .toEqual(['accepted', 'payload_conflict']);
  });

  it('recovers the same job after killing a lease holder and starting the production worker', async () => {
    const id = randomUUID();
    await fixture.pool.query("UPDATE confirmation_jobs SET available_at = now() + interval '1 day' WHERE state = 'ready'");
    expect((await post(app, id, 'CAND-5103')).statusCode).toBe(202);
    const trapPath = fileURLToPath(new URL('../../tests/support/claim-and-hold.ts', import.meta.url));
    const workerPath = fileURLToPath(new URL('../src/workers/run.ts', import.meta.url));
    const child = fork(trapPath, [], { env: { ...process.env, TEST_WORKER_DATABASE_URL: fixture.connectionString! } });
    const terminated = once(child, 'exit');
    let claim;
    try {
      const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
      claim = message;
      expect(claim).toMatchObject({ id, attempt: 1 });
    } finally {
      child.kill('SIGKILL');
      await terminated;
    }

    const worker = spawn(process.execPath, [workerPath], {
      env: { ...process.env, DATABASE_URL: fixture.connectionString!, HOST: '127.0.0.1' },
      stdio: 'ignore',
    });
    const stopped = once(worker, 'exit');
    try {
      let confirmedRecordId: string;
      await expect.poll(async () => {
        const response = (await app.inject(`/api/operations/${id}`)).json();
        confirmedRecordId = response.recordId;
        return response.state;
      }, { timeout: 8500 }).toBe('confirmed');
      expect(await finishConfirmation(fixture.pool, claim)).toBe(false);
      const result = await fixture.pool.query(`
        SELECT s.id, j.attempts, j.state
        FROM submissions s JOIN submission_operations o ON o.submission_id = s.id
        JOIN confirmation_jobs j ON j.operation_id = o.id WHERE o.id = $1
      `, [id]);
      expect(result.rows).toEqual([{ id: confirmedRecordId!, attempts: 2, state: 'complete' }]);
      expect((await app.inject(`/api/operations/${id}`)).json().events.map((event: {kind: string}) => event.kind))
        .toEqual(['accepted', 'lease_expired', 'confirmed']);
    } finally {
      worker.kill('SIGTERM');
      await stopped;
    }
  }, 20_000);

  it('recovers across a real interruption of this API’s database connections', async () => {
    const upstream = new URL(fixture.connectionString!);
    const connections = new Set<Socket>();
    let available = true;
    const proxy = createServer(peer => {
      if (!available) { peer.destroy(); return; }
      const database = createConnection({ host: upstream.hostname, port: Number(upstream.port || 5432) });
      const drop = () => {
        connections.delete(peer);
        peer.destroy();
        database.destroy();
      };
      connections.add(peer);
      peer.on('close', drop).on('error', drop);
      database.on('close', drop).on('error', drop);
      peer.pipe(database).pipe(peer);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const address = proxy.address() as AddressInfo;
    upstream.hostname = '127.0.0.1';
    upstream.port = String(address.port);
    const pool = database(upstream.toString());
    pool.on('error', () => {});
    const interrupted = createApp({ pool, enableFaults: true });
    try {
      const id = randomUUID();
      expect((await post(interrupted, id, 'CAND-5104', true)).statusCode).toBe(504);
      available = false;
      for (const connection of connections) connection.destroy();
      expect((await interrupted.inject('/api/ready')).statusCode).toBe(503);
      expect((await post(interrupted, id, 'CAND-5104')).statusCode).toBe(500);
      available = true;
      expect((await post(interrupted, id, 'CAND-5104')).statusCode).toBe(202);
      const result = await fixture.pool.query(`
        SELECT s.id FROM submissions s JOIN submission_operations o ON s.id = o.submission_id
        WHERE s.candidate_code = 'CAND-5104' AND o.id = $1
      `, [id]);
      const operation = (await interrupted.inject(`/api/operations/${id}`)).json();
      expect(result.rows).toEqual([{ id: operation.recordId }]);
      expect(operation.events.map((event: {kind: string}) => event.kind)).toEqual(['accepted', 'replayed']);
      expect((await fixture.pool.query("SELECT id FROM submissions WHERE candidate_code = 'CAND-5104'")).rowCount).toBe(1);
    } finally {
      await interrupted.close();
      await pool.end();
      for (const connection of connections) connection.destroy();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
  }, 15_000);
});
