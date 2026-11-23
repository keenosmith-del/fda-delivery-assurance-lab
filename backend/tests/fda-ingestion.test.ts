import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FDA_EVENTS, FDA_GATEWAY, FDA_MAX_BODY, fdaEvent, fdaReceipt } from '../../shared/contracts/fda-ingestion.ts';
import { buildFixture, fixtureScope } from '../../scripts/fda-fixture.ts';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { loadMigrations, migrate, migrationsReady } from '../src/db/migrations.ts';
import { createApp } from '../src/api/app.ts';
import { receiveEvent } from '../src/modules/fda-ingestion/service.ts';

const token = 'test_fda_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const viewer = 'test_viewer_bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const operator = 'test_operator_cccccccccccccccccccccccccc';
const revision = 'abcd'.repeat(10);
const fixture = buildFixture();
const access = { origin: 'https://lab.example.test', viewer, operator };
const basic = `Basic ${Buffer.from(`viewer:${viewer}`).toString('base64')}`;

describe('FDA synthetic gateway', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openTestDatabase();
    app = createApp({ pool: db.pool, access, revision, fdaSource: { ...fixtureScope, token } });
  }, 20_000);
  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const post = (event: unknown, authorization = `Bearer ${token}`) =>
    app.inject({ method: 'POST', url: FDA_EVENTS, headers: { authorization, 'content-type': 'application/json' }, payload: JSON.stringify(event) });
  const read = (path: string, authorization = basic) =>
    app.inject({ url: `${FDA_GATEWAY}/${path}`, headers: { authorization } });
  const scenario = (name: string) => publishScenario(async event => {
    const response = await post(event);
    return { status: response.statusCode, body: response.json() };
  }, name);

  test('validates all fixture categories and strictly rejects invalid contracts', () => {
    expect(new Set(fixture.normal.map(event => fdaEvent.parse(event).recordType)).size).toBe(7);
    for (const event of [
      fixture.invalid,
      { ...fixture.replay, recordType: 'invalid' },
      { ...fixture.replay, occurredAt: 'yesterday' },
      { ...fixture.replay, sourceRecordId: undefined },
      { ...fixture.replay, payload: { ...fixture.replay.payload, message: 'unexpected' } },
      { ...fixture.replay, payload: { enrollment: 'enrolled' } },
    ]) expect(fdaEvent.safeParse(event).success).toBe(false);
  });

  test('denies anonymous, workspace and invalid source credentials and prevents source browser reads', async () => {
    for (const authentication of ['', basic, 'Bearer invalid_source_token_aaaaaaaaaaaaaaaaaaaaa']) {
      expect((await post(fixture.replay, authentication)).statusCode).toBe(401);
    }
    expect((await app.inject({ url: FDA_EVENTS, method: 'POST', headers: {
      authorization: `Bearer ${token}`, origin: access.origin, 'content-type': 'application/json',
    }, payload: fixture.replay })).statusCode).toBe(403);
    expect((await read('status', '')).statusCode).toBe(401);
    expect((await read('records', `Bearer ${token}`)).statusCode).toBe(401);
    expect((await read('receipts/19bbbbbb-7db5-438b-beeb-6b9fa52c7e61', '')).statusCode).toBe(401);
    expect((await post({ extra: 'a'.repeat(FDA_MAX_BODY) })).statusCode).toBe(413);
  });

  test('projects persisted imported records, traces provenance and distinguishes capture from reporting', async () => {
    const imported = await scenario('normal');
    expect(imported).toHaveLength(fixture.normal.length);
    expect(imported.every(item => item.status === 'processed')).toBe(true);
    expect(imported[0]).toMatchObject({ tenantId: fixtureScope.tenantId, actorRole: 'synthetic-source', applicationRevision: revision });
    const raw = await read(`receipts/${imported[0].id}`);
    expect(fdaReceipt.parse(raw.json()).canonicalId).toBe(imported[0].canonicalId);
    expect(raw.body).not.toContain(token);
    const records = (await read('records')).json();
    expect(records).toHaveLength(imported.length);
    const health = (await read('agent-health')).json();
    expect(health.devices).toHaveLength(9);
    expect(health.reporting).toBe(7);
    expect(health.devices[1]).toMatchObject({ reporting: true, evidenceFreshness: 'fresh', missingIntervals: [
      { start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T11:00:00.000Z' },
    ] });
    expect(health.devices[2]).toMatchObject({ reporting: true, evidenceFreshness: 'stale' });
    expect(health.devices[6]).toMatchObject({ reporting: true, capture: 'limited', evidenceComplete: false, evidenceFreshness: 'unobserved' });
    expect(health.devices[0]).toMatchObject({ agentVersion: '1.1.0', diagnostics: ['version-updated'] });
    const workflows = (await read('workflow-evidence')).json();
    const partial = workflows.find((row: { candidate: { workflowId: string } }) => row.candidate.workflowId === 'workflow-002');
    expect(partial.gaps.join(' ')).toContain('coverage is incomplete');
    expect(partial.observations.find((o: { observationId: string }) => o.observationId === 'observation-003')).toMatchObject({
      deliveredLate: true, receipt: { id: imported.at(-1)?.id },
    });
    expect(workflows.find((row: { candidate: { workflowId: string } }) => row.candidate.workflowId === 'workflow-001').gaps).toEqual([]);
  });

  test('records duplicate, conflict, malformed data and tenant isolation', async () => {
    expect((await scenario('duplicate-replay'))[0].status).toBe('duplicate');
    expect((await scenario('conflicting-replay'))[0].status).toBe('conflict');
    expect((await scenario('invalid-contract'))[0].errorCode).toBe('UNSUPPORTED_CONTRACT');
    expect((await scenario('tenant-violation'))[0].errorCode).toBe('SOURCE_SCOPE_MISMATCH');
    expect((await post({ ...fixture.replay, sourceId: 'source-999' })).statusCode).toBe(403);
    expect((await post({ ...fixture.replay, sourceRecordId: undefined })).json().errorCode).toBe('INVALID_RECORD');
    expect((await post({ ...fixture.replay, recordType: 'unknown' })).json().errorCode).toBe('UNSUPPORTED_RECORD_TYPE');
    expect((await post({ ...fixture.replay, occurredAt: '2099-01-01T00:00:00.000Z' })).json().errorCode).toBe('INVALID_EVENT_TIME');
    const other = createApp({ pool: db.pool, access, fdaSource: { tenantId: 'tenant-999', sourceId: 'source-001', token: `${token}x` } });
    try {
      const ownReceipt = (await read('status')).json().receipts[0];
      expect((await other.inject({ url: `${FDA_GATEWAY}/receipts/${ownReceipt.id}`, headers: { authorization: basic } })).statusCode).toBe(404);
      expect((await other.inject({ url: `${FDA_GATEWAY}/records`, headers: { authorization: basic } })).json()).toEqual([]);
      expect((await other.inject({ method: 'POST', url: FDA_EVENTS, headers: { authorization: `Bearer ${token}` }, payload: fixture.replay })).statusCode).toBe(401);
    } finally {
      await other.close();
    }
  });

  test('handles simultaneous duplicates and conflicting deliveries with a single projection', async () => {
    const event = { ...fixture.replay, sourceRecordId: 'record-800' };
    const same = await Promise.all([post(event), post(event), post(event)]);
    expect(same.map(item => item.statusCode).sort()).toEqual([200, 200, 201]);
    expect(new Set(same.map(item => item.json().canonicalId)).size).toBe(1);
    const conflicted = await Promise.all([
      post({ ...event, sourceRecordId: 'record-801' }),
      post({ ...fixture.conflict, sourceRecordId: 'record-801' }),
    ]);
    expect(conflicted.map(item => item.statusCode).sort()).toEqual([201, 409]);
  });

  test('retains degradation and interruption receipts after recovery and ignores late older state', async () => {
    await scenario('permission-degradation');
    const interruption = (await scenario('reporting-interruption'))[0];
    expect((await read('agent-health')).json().reporting).toBe(6);
    const delayed = (await scenario('delayed-delivery'))[0];
    expect(delayed.status).toBe('processed');
    expect((await read('agent-health')).json().devices[2].missingIntervals).toHaveLength(2);
    await scenario('recovery');
    const older = { ...fixture.interruption, sourceRecordId: 'record-890' };
    expect((await post(older)).statusCode).toBe(201);
    const health = (await read('agent-health')).json();
    expect(health.reporting).toBe(7);
    expect(health.devices[5]).toMatchObject({ capture: 'available', diagnostics: ['recovered'] });
    expect((await read(`receipts/${interruption.id}`)).json().status).toBe('processed');
  });

  test('retains the failed receipt and recovers across a new API instance and an interrupted request', async () => {
    const event = { ...fixture.replay, sourceRecordId: 'record-901' };
    await db.pool.query("ALTER TABLE fda_canonical_records ADD CONSTRAINT test_fda_failure CHECK (source_record_id <> 'record-901')");
    const failed = (await post(event)).json();
    expect(failed).toMatchObject({ status: 'processing_failed', errorCode: 'PROJECTION_FAILED' });
    await db.pool.query('ALTER TABLE fda_canonical_records DROP CONSTRAINT test_fda_failure');
    const pendingEvent = { ...fixture.replay, sourceRecordId: 'record-902' };
    const pending = await receiveEvent(db.pool, fixtureScope, pendingEvent, new Date(), revision);
    await app.close();
    app = createApp({ pool: db.pool, access, revision, fdaSource: { ...fixtureScope, token } });
    expect((await post(event)).statusCode).toBe(201);
    expect((await post(pendingEvent)).statusCode).toBe(200);
    expect((await read(`receipts/${pending.id}`)).json().status).toBe('processed');
    expect((await read(`receipts/${failed.id}`)).json().status).toBe('processing_failed');
    expect((await post(event)).statusCode).toBe(200);
  });

  test('bounds repeated projection failures while preserving the accepted event and audit receipts', async () => {
    const previous = (await read('status')).json();
    const event = { ...fixture.replay, sourceRecordId: 'record-903' };
    await db.pool.query("ALTER TABLE fda_canonical_records ADD CONSTRAINT test_fda_retry_cap CHECK (source_record_id <> 'record-903')");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        expect((await post(event)).json()).toMatchObject({ status: 'processing_failed', errorCode: 'PROJECTION_FAILED' });
      }
    } finally {
      await db.pool.query('ALTER TABLE fda_canonical_records DROP CONSTRAINT test_fda_retry_cap');
    }
    expect((await post(event)).json()).toMatchObject({ status: 'processing_failed', errorCode: 'RETRY_LIMIT_REACHED' });
    const stored = await db.pool.query("SELECT attempts, status FROM fda_source_events WHERE source_record_id = 'record-903'");
    expect(stored.rows).toEqual([{ attempts: 3, status: 'processing_failed' }]);
    const status = (await read('status')).json();
    expect(status.acceptedRecords).toBe(previous.acceptedRecords + 1);
    expect(status.counts.processing_failed).toBe(previous.counts.processing_failed + 4);
  });
});

test('upgrades a previously migrated fixture schema without changing its records', async () => {
  const migrationDir = 'database/migrations';
  const temp = await mkdtemp(join(tmpdir(), 'fda-gateway-migrations-'));
  const expected = await loadMigrations(migrationDir);
  let db: Awaited<ReturnType<typeof openTestDatabase>> | undefined;
  try {
    for (const migration of expected.filter(item => item.name !== '006_fda_ingestion.sql')) {
      await copyFile(join(migrationDir, migration.name), join(temp, migration.name));
    }
    db = await openTestDatabase(temp);
    await seedIntelligence(db.pool);
    const taskIds = 'SELECT id FROM lab_tasks ORDER BY id';
    const before = (await db.pool.query(taskIds)).rows;
    expect(before).toHaveLength(6);
    expect(await migrationsReady(db.pool, expected)).toBe(false);
    await migrate(db.pool, migrationDir);
    await migrate(db.pool, migrationDir);
    expect(await migrationsReady(db.pool, expected)).toBe(true);
    expect((await db.pool.query(taskIds)).rows).toEqual(before);
    expect((await db.pool.query('SELECT * FROM fda_source_events')).rows).toEqual([]);
  } finally {
    try {
      await db?.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}, 20_000);
