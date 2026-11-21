import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { openTestDatabase } from '../../tests/support/database.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../database/seeds/measurement.ts';

it.runIf(Boolean(process.env.TEST_DATABASE_URL))('restarts real API and worker processes without losing committed evidence', async () => {
  const fixture = await openTestDatabase();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, LAB_MODE: 'test', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_URL: fixture.connectionString!, LAB_ENABLE_FAULTS: 'false' };
  const shutdowns = new Set<() => Promise<void>>();
  function service(entry: string) {
    const processHandle = spawn(process.execPath, [entry], { env, stdio: 'ignore' });
    const done = once(processHandle, 'exit');
    const stop = async () => {
      processHandle.kill('SIGTERM');
      const [code] = await done;
      shutdowns.delete(stop);
      expect(code).toBe(0);
    };
    shutdowns.add(stop);
    return stop;
  }
  const request = async (route: string, options?: RequestInit) => fetch(origin + route,
    { ...options, signal: AbortSignal.timeout(2000) });
  const ready = () => expect.poll(async () => (await request('/api/ready').catch(() => null))?.status).toBe(200);
  const post = (route: string, payload: object, headers = {}) => request(route, { method: 'POST',
    body: JSON.stringify(payload), headers: { 'content-type': 'application/json', ...headers } });

  try {
    await seedIntelligence(fixture.pool);
    await seedMeasurement(fixture.pool);
    const stopApi = service('backend/src/server.ts');
    const stopWorker = service('backend/src/workers/run.ts');
    await ready();
    const id = randomUUID();
    expect((await post('/api/submissions', { candidateCode: 'CAND-100511', requisition: 'engineering' },
      { 'idempotency-key': id })).ok).toBe(true);
    const review = await post('/api/workflow/tasks/offer-review/reviews', { classification: 'approve', suitability: 'reject',
      reason: 'Persist this validation fixture.' });
    expect(review.status).toBe(201);
    const diagnosis = await post('/api/adoption/pipeline-digest/diagnoses', { periodId: 'pipeline-digest-baseline',
      category: 'low-adoption', hypothesis: 'The fixture may benefit from onboarding.' });
    expect(diagnosis.status).toBe(201);
    const intervention = await post('/api/adoption/pipeline-digest/interventions', { findingId: (await diagnosis.json()).id,
      owner: 'Operations', action: 'Repeat synthetic onboarding.', followUpOn: '2026-11-16' });
    expect(intervention.status).toBe(201);
    const initialRecord = (await (await request('/api/operations/' + id)).json()).recordId;
    const initialOutcome = await (await request('/api/outcomes/intake-assist')).json();
    expect(initialOutcome.verifiedSeconds).toBe(22000);
    await stopWorker();
    expect((await (await request('/api/ops/status')).json()).worker.state).toBe('stopped');
    await stopApi();

    service('backend/src/server.ts');
    service('backend/src/workers/run.ts');
    await ready();
    await expect.poll(async () => (await (await request('/api/ops/status')).json()).worker.state).toBe('running');
    await expect.poll(async () => (await (await request('/api/operations/' + id)).json()).state).toBe('confirmed');
    expect((await (await request('/api/operations/' + id)).json()).recordId).toBe(initialRecord);
    expect((await (await request('/api/workflow/tasks/offer-review')).json()).reviews[0].reason).toBe('Persist this validation fixture.');
    expect((await (await request('/api/adoption/pipeline-digest')).json()).interventions[0].id).toBe((await intervention.json()).id);
    expect(await (await request('/api/outcomes/intake-assist')).json()).toEqual(initialOutcome);
    expect((await fixture.pool.query("SELECT id FROM submissions WHERE candidate_code = 'CAND-100511'")).rowCount).toBe(1);
  } finally {
    try {
      await Promise.all([...shutdowns].map(stop => stop()));
    } finally {
      await fixture.close();
    }
  }
}, 25_000);
