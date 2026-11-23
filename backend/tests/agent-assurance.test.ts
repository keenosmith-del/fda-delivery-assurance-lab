import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ASSURANCE_RULES, assuranceAssessment, incidentDetail, incidentSummary, workflowAssurance } from '../../shared/contracts/agent-assurance.ts';
import { FDA_EVENTS, FDA_GATEWAY } from '../../shared/contracts/fda-ingestion.ts';
import { fixtureScope } from '../../scripts/fda-fixture.ts';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { createApp } from '../src/api/app.ts';
import { loadMigrations, migrate, migrationsReady } from '../src/db/migrations.ts';
import { deliverySeconds } from '../src/modules/agent-assurance/assessment.ts';

const route = `${FDA_GATEWAY}/assurance`;
const sourceAuth = 'Bearer assurance_fixture_source_token_001';
const access = { origin: 'https://lab.example.test', operator: 'synthetic-assurance-operator', viewer: 'synthetic-assurance-viewer',
  demo: 'synthetic-assurance-demo' };
const basic = (role: 'operator' | 'viewer' | 'demo') => `Basic ${Buffer.from(`${role}:${access[role]}`).toString('base64')}`;
const ops = basic('operator');
const source = { ...fixtureScope, token: sourceAuth.slice(7) };
const revision = 'a'.repeat(40);

function makeApp(pool: Awaited<ReturnType<typeof openTestDatabase>>['pool'], scope: Parameters<typeof createApp>[0]['fdaSource'] = source) {
  return createApp({ pool, access, revision, fdaSource: scope });
}

function publish(app: ReturnType<typeof createApp>, scenario: string) {
  return publishScenario(async payload => {
    const result = await app.inject({ method: 'POST', url: FDA_EVENTS, headers: { authorization: sourceAuth }, payload: payload as object });
    return { status: result.statusCode, body: result.json() };
  }, scenario);
}

const planning = { action: 'plan', intervention: 'restore-reporting',
  reason: 'Restore the synthetic reporting path.', owner: 'engineer', target: '2026-11-17' };
const implement = { action: 'implement', note: 'Recorded corrective configuration in the synthetic exercise.' };

describe('agent assurance across independent publisher, workspace and database', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let reportingId: string;
  let permissionId: string;
  let permissionReceipt: string;

  beforeAll(async () => {
    db = await openTestDatabase();
    app = makeApp(db.pool);
    await publish(app, 'normal');
  }, 20_000);
  afterAll(async () => { await app?.close(); await db?.close(); });

  const get = (path: string, authorization = ops) => app.inject({ url: route + path, headers: { authorization } });
  const post = (path: string, payload: object, authorization = ops, origin = access.origin) =>
    app.inject({ method: 'POST', url: route + path, payload, headers: { authorization, origin } });
  const action = (id: string, payload: object) => post(`/incidents/${id}/actions`, payload);
  const incident = async (id: string) => incidentDetail.parse((await get(`/incidents/${id}`)).json());
  const assessment = async (windowId = 'window-001') =>
    assuranceAssessment.parse((await get(`/assessment?windowId=${windowId}`)).json());
  const workflow = async (id: string) => workflowAssurance.parse((await get('/workflow-readiness')).json()).find(x => x.workflowId === id);
  const diagnose = (category: string, evidence: string[]) => ({ action: 'diagnose', category, evidence,
    hypothesis: 'A synthetic configuration may explain the reported condition.',
    certainty: 'tentative', unknowns: 'The underlying cause remains unknown.', nextAction: 'Compare additional source receipts.' });

  test('derives historical readiness, coverage and receipt timing independently from source declarations', async () => {
    const baseline = await assessment();
    expect(baseline).toMatchObject({ ruleVersion: ASSURANCE_RULES, counts: { eligible: 9, registered: 9, reporting: 7, observed: 2 },
      completeness: 'incomplete' });
    expect(baseline.disagreements).toContain('Source observed cohort differs from canonical workflow observations.');
    const d = baseline.devices.find(x => x.endpointId === 'endpoint-007')!;
    expect(d).toMatchObject({ connectivity: 'reporting', capture: 'limited', readiness: 'not-ready', queueCount: null, evidenceComplete: false });
    permissionReceipt = d.conditions.find(x => x.category === 'capture-permissions')!.evidence[0].id;
    const elapsed = baseline.devices[0].observations[0];
    expect(elapsed.arrivedAfterWindow).toBe(true);
    expect(elapsed.occurrenceToReceiptSeconds).toBe((Date.parse(elapsed.evidence.receivedAt) - Date.parse(elapsed.evidence.occurredAt)) / 1000);
    expect(baseline.devices[0].versionHistory.map(v => v.version)).toEqual(['1.1.0', '1.0.0']);
    const historical = (await get('/assessment?windowId=window-001&asOf=2026-11-16T10:00:00Z')).json();
    expect(historical).toMatchObject({ asOf: '2026-11-16T10:00:00.000Z', completeness: 'unknown' });
    expect((await get('/assessment?windowId=window-001&asOf=2027-01-01T00:00:00Z')).statusCode).toBe(404);
    expect((await get('/assessment?tenantId=tenant-999')).statusCode).toBe(400);
  });

  test('detects interruption, deduplicates simultaneous creation and blocks workflow readiness', async () => {
    await publish(app, 'reporting-interruption');
    expect((await assessment()).counts.reporting).toBe(6);
    const input = { endpointId: 'endpoint-006', windowId: 'window-001', category: 'reporting-interruption' };
    const [a, b] = await Promise.all([post('/incidents', input), post('/incidents', input)]);
    expect(a.statusCode).toBe(200);
    reportingId = incidentSummary.parse(a.json()).id;
    expect(b.json().id).toBe(reportingId);
    expect((await incident(reportingId)).audit.map(x => x.action)).toEqual(['detect']);
    expect(await workflow('workflow-002')).toMatchObject({ readiness: 'blocked-by-operations',
      windows: [{ windowId: 'window-001', incidents: [{ id: reportingId }] }] });
    const p = await post('/incidents', { endpointId: 'endpoint-007', windowId: 'window-001', category: 'capture-permissions' });
    permissionId = incidentSummary.parse(p.json()).id;
    expect(await incident(permissionId)).toMatchObject({ initial: { condition: { severity: 'blocking' } } });
  });

  test('enforces write roles, transitions and source associations', async () => {
    expect((await get(`/incidents/${reportingId}`, basic('viewer'))).statusCode).toBe(200);
    for (const auth of [basic('viewer'), basic('demo'), sourceAuth]) {
      expect((await post(`/incidents/${reportingId}/actions`, planning, auth)).statusCode).toBe(auth === sourceAuth ? 401 : 403);
    }
    expect((await post(`/incidents/${reportingId}/actions`, planning, ops, 'https://external.example')).statusCode).toBe(403);
    expect((await action(reportingId, planning)).json()).toEqual({ error: 'INVALID_INCIDENT_TRANSITION' });
    expect((await action(reportingId, diagnose('reporting-interruption', [permissionReceipt]))).json())
      .toEqual({ error: 'UNRELATED_SOURCE_EVIDENCE' });
    for (const nextScope of [{ ...source, tenantId: 'tenant-002' }, { ...source, sourceId: 'source-002' }]) {
      const other = makeApp(db.pool, nextScope);
      try {
        expect((await other.inject({ url: `${route}/incidents/${reportingId}/export`, headers: { authorization: ops } })).statusCode).toBe(404);
        expect((await other.inject({ url: `${route}/incidents`, headers: { authorization: ops } })).json()).toEqual([]);
      } finally { await other.close(); }
    }
  });

  test('persists diagnosis, planning and one implementation, and survives API restart', async () => {
    for (const id of [reportingId, permissionId]) {
      const c = await incident(id);
      expect((await action(id, diagnose(c.category, c.initial.condition.evidence.map(x => x.id)))).json().state).toBe('investigating');
      expect((await action(id, { ...planning, intervention: id === permissionId ? 'review-permissions' : 'restore-reporting' })).json()
        .state).toBe('intervention_planned');
      const results = await Promise.all([action(id, implement), action(id, implement)]);
      expect(results.map(response => response.json().state)).toEqual(['awaiting_verification', 'awaiting_verification']);
    }
    await app.close();
    app = makeApp(db.pool);
    expect((await incident(reportingId)).audit.map(x => x.action)).toEqual(['detect', 'diagnose', 'plan', 'implement']);
    const insufficient = await action(reportingId, { action: 'verify' });
    expect(insufficient.json().state).toBe('awaiting_verification');
    expect((await incident(reportingId)).audit.at(-1)?.detail.outcome).toBe('insufficient-evidence');
  });

  test('partial permission recovery remains unresolved until newer observations arrive', async () => {
    await publish(app, 'assurance-partial-recovery');
    expect((await action(permissionId, { action: 'verify' })).json().state).toBe('awaiting_verification');
    const partial = await incident(permissionId);
    expect(partial.audit.at(-1)?.detail).toMatchObject({ outcome: 'partially-verified' });
    expect(partial.resolvedAt).toBeNull();
    await publish(app, 'assurance-permission-recovery');
    expect((await action(permissionId, { action: 'verify' })).json().state).toBe('resolved');
    const verified = await incident(permissionId);
    expect(verified.audit.at(-1)?.detail).toMatchObject({ outcome: 'verified-recovered' });
    expect(verified.initial.endpoint.missingIntervals.length).toBeGreaterThan(0);
  });

  test('only new timely heartbeats resolve, concurrent verification is idempotent and regression opens a new case', async () => {
    await publish(app, 'recovery');
    await publish(app, 'assurance-out-of-order');
    const outcomes = await Promise.all([action(reportingId, { action: 'verify' }), action(reportingId, { action: 'verify' })]);
    expect(outcomes.map(response => response.json().state)).toEqual(['resolved', 'resolved']);
    const resolved = await incident(reportingId);
    expect(resolved.audit.filter(entry => entry.action === 'verify').map(entry => entry.detail.outcome))
      .toEqual(['insufficient-evidence', 'verified-recovered']);
    expect(resolved.audit.at(-1)?.detail.evidence).toEqual([expect.objectContaining({ sourceRecordId: 'record-074' })]);
    expect(await workflow('workflow-002')).toMatchObject({ readiness: 'blocked-by-operations',
      windows: [{ blockers: expect.arrayContaining([expect.objectContaining({ endpointId: 'endpoint-008' })]) }] });
    await publish(app, 'assurance-regression');
    const reopened = await post('/incidents', { endpointId: 'endpoint-006', windowId: 'window-001', category: 'reporting-interruption' });
    expect(reopened.json()).toMatchObject({ state: 'open' });
    expect(reopened.json().id).not.toBe(reportingId);
    expect((await incident(reportingId)).state).toBe('resolved');
    const exported = await get(`/incidents/${reportingId}/export`, basic('viewer'));
    expect(exported.headers['content-disposition']).toContain('.json');
    expect(exported.json()).toMatchObject({ evidenceType: 'operational-assurance', sourceRevision: revision,
      incident: { id: reportingId, state: 'resolved' }, scope: fixtureScope });
    expect(exported.body).not.toContain(source.token);
  });

  test('supports version evidence and a new independently evaluated window', async () => {
    await publish(app, 'assurance-version-transition');
    expect((await assessment()).devices.find(d => d.endpointId === 'endpoint-004')).toMatchObject({ versionPolicy: 'mismatch' });
    await publish(app, 'assurance-version-recovery');
    expect((await assessment()).devices.find(d => d.endpointId === 'endpoint-004')).toMatchObject({ versionPolicy: 'supported' });
    await publish(app, 'assurance-complete-window');
    expect(await assessment('window-003')).toMatchObject({ completeness: 'complete', counts: { complete: 1 } });
    expect(await workflow('workflow-003')).toMatchObject({ readiness: 'ready-for-review' });
    expect(await workflow('workflow-002')).toMatchObject({ readiness: 'blocked-by-operations' });
  });

  test('assessment retains older registration evidence after the 500-row records feed limit', async () => {
    await db.pool.query(`WITH batch AS (
      SELECT 'record-' || (10000 + i)::text AS key, gen_random_uuid() AS canonical, gen_random_uuid() AS receipt
      FROM generate_series(1, 510) AS sample(i)
    ), original AS (
      SELECT * FROM fda_source_events WHERE tenant_id=$1 AND source_id=$2 AND source_record_id='record-016'
    ), accepted AS (
      INSERT INTO fda_source_events (tenant_id, source_id, source_record_id, envelope, payload_fingerprint, status)
      SELECT $1, $2, batch.key, jsonb_set(original.envelope, '{sourceRecordId}', to_jsonb(batch.key)), original.payload_fingerprint, 'processed'
      FROM batch CROSS JOIN original RETURNING source_record_id, envelope, payload_fingerprint
    ), canonical AS (
      INSERT INTO fda_canonical_records (id, tenant_id, source_id, source_record_id, record_type, subject_id, occurred_at, payload)
      SELECT batch.canonical, $1, $2, batch.key, 'endpoint.status', 'endpoint-006', '2026-11-16T11:45Z', accepted.envelope->'payload'
      FROM batch JOIN accepted ON accepted.source_record_id=batch.key RETURNING id, source_record_id
    )
    INSERT INTO fda_ingestion_receipts (id, tenant_id, source_id, source_record_id, record_type, schema_version, received_at, validation, status, payload_fingerprint, canonical_id)
    SELECT batch.receipt,$1,$2,batch.key,'endpoint.status','fda-lab.ingestion/v1',clock_timestamp(),'valid','processed',accepted.payload_fingerprint,canonical.id
    FROM batch JOIN accepted ON accepted.source_record_id=batch.key JOIN canonical ON canonical.source_record_id=batch.key`, [source.tenantId, source.sourceId]);
    const result = await assessment();
    expect(result.counts.registered).toBe(9);
    expect(result.devices.find(d => d.endpointId === 'endpoint-006')?.timeline.length).toBeGreaterThan(500);
    expect((await app.inject({ url: `${FDA_GATEWAY}/records`, headers: { authorization: ops } })).json()).toHaveLength(500);
  }, 20_000);
});

test('unknown delay is distinct from zero delay and a known lag', () => {
  expect(deliverySeconds('2026-11-16T08:00:00Z', new Date('2026-11-16T07:59:00Z'))).toBeNull();
  expect(deliverySeconds('2026-11-16T08:00:00Z', new Date('2026-11-16T08:00:00Z'))).toBe(0);
  expect(deliverySeconds('2026-11-16T08:00:00Z', new Date('2026-11-16T08:01:00Z'))).toBe(60);
});

test('migration 007 upgrades a populated Milestone 07 schema without altering receipts', async () => {
  const directory = 'database/migrations';
  const previous = await mkdtemp(join(tmpdir(), 'agent-assurance-migration-'));
  const migrations = await loadMigrations(directory);
  try {
    for (const item of migrations.filter(file => file.name < '007_')) await copyFile(join(directory, item.name), join(previous, item.name));
    const db = await openTestDatabase(previous);
    const app = makeApp(db.pool);
    try {
      const receipts = await publish(app, 'normal');
      expect(await migrationsReady(db.pool, migrations)).toBe(false);
      await migrate(db.pool, directory);
      await migrate(db.pool, directory);
      expect(await migrationsReady(db.pool, migrations)).toBe(true);
      const result = await app.inject({ url: `${FDA_GATEWAY}/receipts/${receipts[0].id}`, headers: { authorization: ops } });
      expect(result.json()).toEqual(receipts[0]);
      expect((await app.inject({ url: `${route}/incidents`, headers: { authorization: ops } })).json()).toEqual([]);
    } finally { await app.close(); await db.close(); }
  } finally { await rm(previous, { recursive: true, force: true }); }
}, 20_000);
