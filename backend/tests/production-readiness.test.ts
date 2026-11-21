import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { readConfig } from '../src/config/env.ts';
import { loadMigrations, migrate, migrationsReady } from '../src/db/migrations.ts';
import { recordWorker } from '../src/workers/telemetry.ts';
import { openTestDatabase } from '../../tests/support/database.ts';

const origin = 'https://fda-test.example';
const viewer = 'viewer-credential-for-dedicated-fixture-only';
const operator = 'operator-credential-for-dedicated-fixture-only';
const demo = 'demo-credential-for-dedicated-fixture-only';
const authorization = (name: string, password: string) => 'Basic ' + Buffer.from(name + ':' + password).toString('base64');
const credential = (name: string, password: string) => ({ authorization: authorization(name, password) });
const auth = { viewer: credential('viewer', viewer), operator: credential('operator', operator), demo: credential('demo', demo) };
const hostedEnv = {
  LAB_MODE: 'staging', DATABASE_URL: 'postgres://test:test@postgres.railway.internal/lab',
  LAB_DATABASE_TLS: 'railway-private', LAB_PUBLIC_ORIGIN: origin,
  LAB_VIEWER_PASSWORD: viewer, LAB_OPERATOR_PASSWORD: operator, NODE_ENV: 'production', PORT: '5170',
};

describe('hosted configuration', () => {
  it('requires an explicit hosted environment, verified database policy and separate roles', () => {
    expect(readConfig('api', hostedEnv)).toMatchObject({ hosted: true, PORT: 5170, HOST: '0.0.0.0',
      access: { origin, viewer, operator }, databaseOptions: { max: 8, tls: 'railway-private' } });
    expect(readConfig('worker', { ...hostedEnv, LAB_VIEWER_PASSWORD: undefined, LAB_OPERATOR_PASSWORD: undefined }).databaseOptions.max).toBe(2);
    expect(() => readConfig('api', { ...hostedEnv, LAB_MODE: 'local' })).toThrow('Production runtime requires');
    expect(() => readConfig('api', { ...hostedEnv, DATABASE_URL: 'postgres://test:test@other.example/lab' })).toThrow('Hosted database');
    expect(() => readConfig('api', { ...hostedEnv, LAB_OPERATOR_PASSWORD: viewer })).toThrow('distinct');
    expect(() => readConfig('api', { ...hostedEnv, LAB_WRITE_TOKEN: operator })).toThrow('local-only');
    expect(() => readConfig('api', { ...hostedEnv, LAB_PUBLIC_ORIGIN: origin + '/app' })).toThrow('HTTPS origin');
  });

  it('keeps faults out of production and seed writes out of production restarts', () => {
    expect(() => readConfig('api', { ...hostedEnv, LAB_MODE: 'production', LAB_ENABLE_FAULTS: 'true' })).toThrow('forbidden in production');
    expect(() => readConfig('seed', { ...hostedEnv, LAB_MODE: 'production' })).toThrow('seeding is forbidden');
    expect(() => readConfig('api', { ...hostedEnv, LAB_ENABLE_FAULTS: 'true' })).toThrow('LAB_DEMO_PASSWORD');
    expect(readConfig('api', { ...hostedEnv, LAB_ENABLE_FAULTS: 'true', LAB_DEMO_PASSWORD: demo }).access?.demo).toBe(demo);
    expect(readConfig('api', { DATABASE_URL: 'postgres://local:local@localhost/lab' })).toMatchObject({ hosted: false, enableFaults: false });
  });
});

describe('private deployment and operational checks', () => {
  let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
  let assets: string;

  beforeAll(async () => {
    fixture = await openTestDatabase();
    assets = await mkdtemp(join(tmpdir(), 'fda-private-assets-'));
    await mkdir(join(assets, 'assets'));
    await writeFile(join(assets, 'index.html'), '<title>FDA Delivery Assurance Lab</title>');
    await writeFile(join(assets, 'assets', 'index-fixture.js'), "export const app = 'fixture';");
  }, 30_000);
  afterAll(async () => {
    await fixture?.close();
    if (assets) await rm(assets, { recursive: true, force: true });
  });

  const submit = (app: ReturnType<typeof createApp>, headers: Record<string, string> = {}, id = randomUUID()) =>
    app.inject({ method: 'POST', url: '/api/submissions', headers: { 'idempotency-key': id, ...headers },
      payload: { candidateCode: 'CAND-987531', requisition: 'engineering' } });

  it('rejects unauthenticated reads, viewer writes and cross-origin submissions', async () => {
    const app = createApp({ pool: fixture.pool, access: { origin, viewer, operator }, uiDir: assets });
    try {
      for (const url of ['/', '/assets/index-fixture.js', '/api/workflow/tasks', '/api/agent-health',
        '/api/adoption/pipeline-digest', '/api/outcomes/model', '/api/operations/' + randomUUID()]) {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(401);
        expect(response.headers['www-authenticate']).toContain('Basic');
      }
      expect((await app.inject('/api/health')).statusCode).toBe(200);
      const response = await app.inject({ url: '/', headers: { ...auth.viewer, 'x-request-id': 'untrusted' } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect((await app.inject({ url: '/assets/index-fixture.js', headers: auth.viewer })).statusCode).toBe(200);
      expect((await app.inject({ url: '/assets/%2e%2e%2findex.html', headers: auth.viewer })).statusCode).toBe(404);
      expect((await app.inject({ url: '/api/ops/status', headers: auth.viewer })).statusCode).toBe(403);
      expect((await submit(app, { origin })).statusCode).toBe(401);
      expect((await submit(app, { ...auth.viewer, origin })).statusCode).toBe(403);
      expect((await submit(app, auth.operator)).statusCode).toBe(403);
      expect((await submit(app, { ...auth.operator, origin: 'https://other.example' })).statusCode).toBe(403);
      expect((await submit(app, { ...auth.operator, origin, 'x-lab-fault': 'lost-ack' })).statusCode).toBe(400);
      expect((await fixture.pool.query("SELECT id FROM submissions WHERE candidate_code = 'CAND-987531'")).rowCount).toBe(0);
      expect((await submit(app, { ...auth.operator, origin })).statusCode).toBe(202);
    } finally {
      await app.close();
    }
  });

  it('bounds credential attempts and rate limits an authenticated viewer', async () => {
    const app = createApp({ pool: fixture.pool, access: { origin, viewer, operator, limits: {
      anonymous: 1, authenticated: 1, writes: 1,
    } } });
    try {
      expect((await app.inject('/api/automations')).statusCode).toBe(401);
      expect((await app.inject('/api/automations')).headers['retry-after']).toBe('60');
      expect((await app.inject({ url: '/api/automations', headers: auth.viewer })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/automations', headers: auth.viewer })).statusCode).toBe(429);
      expect((await submit(app, { ...auth.operator, origin })).statusCode).toBe(202);
      expect((await submit(app, { ...auth.operator, origin })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('restricts staging failure injection to the demo role', async () => {
    const app = createApp({ pool: fixture.pool, access: { origin, viewer, operator, demo }, enableFaults: true });
    try {
      const fault = { origin, 'x-lab-fault': 'before-commit' };
      expect((await submit(app, { ...auth.operator, ...fault })).statusCode).toBe(400);
      const work = await submit(app, { ...auth.demo, ...fault });
      expect(work.statusCode).toBe(504);
      expect(work.json().error).toBe('SIMULATED_PRE_COMMIT_TIMEOUT');
      const url = '/api/lab/submission-comparison';
      expect((await app.inject({ method: 'POST', url, headers: { ...auth.operator, origin } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url, headers: { ...auth.demo, origin } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('reports worker heartbeat separately from database readiness and rejects an older shutdown', async () => {
    const old = randomUUID();
    const current = randomUUID();
    await recordWorker(fixture.pool, old, 'running');
    await recordWorker(fixture.pool, current, 'running');
    await recordWorker(fixture.pool, old, 'stopped');
    const app = createApp({ pool: fixture.pool, access: { origin, viewer, operator }, checkSchema: async () => false });
    try {
      expect((await app.inject('/api/ready')).statusCode).toBe(503);
      const status = async () => (await app.inject({ url: '/api/ops/status', headers: auth.operator })).json();
      expect(await status()).toMatchObject({ worker: { state: 'running' }, queue: { ready: expect.any(Number) } });
      await fixture.pool.query("UPDATE lab_worker_health SET seen_at = now() - interval '1 minute'");
      expect(await status()).toMatchObject({ worker: { state: 'stale' } });
      await recordWorker(fixture.pool, current, 'stopped');
      expect(await status()).toMatchObject({ worker: { state: 'stopped' } });
    } finally {
      await app.close();
    }
  });

  it('replays a migration idempotently and rejects checksum drift and duplicate versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fda-migrations-'));
    try {
      const first = join(directory, '900_future.sql');
      await writeFile(first, 'CREATE TABLE future_fixture(id integer PRIMARY KEY);');
      const expected = await loadMigrations(directory);
      expect(await migrationsReady(fixture.pool, expected)).toBe(false);
      await migrate(fixture.pool, directory);
      await migrate(fixture.pool, directory);
      expect(await migrationsReady(fixture.pool, expected)).toBe(true);
      await writeFile(first, 'DROP TABLE future_fixture;');
      await expect(migrate(fixture.pool, directory)).rejects.toThrow('Migration checksum changed');
      expect(await migrationsReady(fixture.pool, await loadMigrations(directory))).toBe(false);
      expect((await fixture.pool.query('SELECT * FROM future_fixture')).rowCount).toBe(0);
      await writeFile(join(directory, '900_duplicate.sql'), 'SELECT 1;');
      await expect(loadMigrations(directory)).rejects.toThrow('unique version prefixes');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
