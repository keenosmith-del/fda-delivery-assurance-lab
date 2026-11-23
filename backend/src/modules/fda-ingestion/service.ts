import { createHash, randomUUID } from 'node:crypto';
import { FDA_CONTRACT, fdaEvent, fdaRecordType, fdaReceipt, receiptStatus, sourceRecordId, sourceTimestamp } from '../../../../shared/contracts/fda-ingestion.ts';
import type { FdaCanonicalRecord, FdaEvent, FdaReceipt, FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import { transaction } from '../../db/pool.ts';
import type { Database, SqlClient } from '../../db/pool.ts';

const receiptFields = `id, tenant_id AS "tenantId", source_id AS "sourceId", source_record_id AS "sourceRecordId",
  record_type AS "recordType", schema_version AS "schemaVersion", occurred_at AS "occurredAt",
  received_at AS "receivedAt", processed_at AS "processedAt", actor_role AS "actorRole", validation, status,
  error_code AS "errorCode", payload_fingerprint AS "payloadFingerprint", application_revision AS "applicationRevision",
  source_revision AS "sourceRevision", correlation_id AS "correlationId",
  processing_revision AS "processingRevision", canonical_id AS "canonicalId"`;

type ReceiptRow = Omit<FdaReceipt, 'occurredAt' | 'receivedAt' | 'processedAt'> & {
  occurredAt: Date | null; receivedAt: Date; processedAt: Date | null;
};

const scopeValues = (scope: FdaScope) => [scope.tenantId, scope.sourceId];
const receipt = (row: ReceiptRow) => fdaReceipt.parse({
  ...row, occurredAt: row.occurredAt?.toISOString() ?? null, receivedAt: row.receivedAt.toISOString(),
  processedAt: row.processedAt?.toISOString() ?? null,
});

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function fingerprint(event: FdaEvent) {
  return sha(JSON.stringify(event, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a === b ? 0 : 1))
      : value));
}

function subject(event: FdaEvent) {
  switch (event.recordType) {
    case 'endpoint.registration':
    case 'endpoint.status':
    case 'endpoint.permission': return event.payload.endpointId;
    case 'observation.window': return event.payload.windowId;
    case 'workflow.observation': return event.payload.observationId;
    case 'workflow.candidate': return event.payload.workflowId;
    case 'automation.measurement': return event.payload.automationId;
  }
}

function temporalError(event: FdaEvent, receivedAt: Date) {
  const at = event.occurredAt;
  if (Date.parse(at) > receivedAt.getTime() + 5 * 60_000 || at < '2000-01-01T00:00:00.000Z') return true;
  switch (event.recordType) {
    case 'endpoint.registration': return event.payload.enrolledAt > at || (event.payload.retiredAt ?? at) > at;
    case 'endpoint.status': return (event.payload.heartbeatAt ?? at) > at || (event.payload.lastObservationAt ?? at) > at;
    case 'endpoint.permission': return event.payload.reportedAt > at;
    case 'observation.window': return event.payload.end > at;
    case 'workflow.observation': return event.payload.observedAt > at;
    default: return false;
  }
}

export async function getReceipt(db: SqlClient, scope: FdaScope, id: string) {
  const rows = await db.query<ReceiptRow>(`SELECT ${receiptFields} FROM fda_ingestion_receipts
    WHERE tenant_id = $1 AND source_id = $2 AND id = $3`, [...scopeValues(scope), id]);
  return rows.rows[0] ? receipt(rows.rows[0]) : null;
}

async function completeReceipt(db: SqlClient, id: string, status: FdaReceipt['status'], canonicalId: string | null, errorCode: string | null) {
  await db.query(`UPDATE fda_ingestion_receipts SET status = $2, processed_at = clock_timestamp(), canonical_id = $3, error_code = $4
    WHERE id = $1`, [id, status, canonicalId, errorCode]);
}

export async function receiveEvent(db: Database, scope: FdaScope, input: unknown, receivedAt: Date, revision: string | null) {
  const id = randomUUID();
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const parsed = fdaEvent.safeParse(input);
  const scopeMatches = raw.tenantId === scope.tenantId && raw.sourceId === scope.sourceId;
  const event = parsed.success && scopeMatches ? parsed.data : null;
  const wrongScope = (raw.tenantId !== undefined && raw.tenantId !== scope.tenantId) ||
    (raw.sourceId !== undefined && raw.sourceId !== scope.sourceId);
  const responseError = wrongScope
    ? 'SOURCE_SCOPE_MISMATCH'
    : raw.schemaVersion !== undefined && raw.schemaVersion !== FDA_CONTRACT ? 'UNSUPPORTED_CONTRACT'
    : raw.recordType !== undefined && !fdaRecordType.safeParse(raw.recordType).success ? 'UNSUPPORTED_RECORD_TYPE'
    : !event ? 'INVALID_RECORD'
    : temporalError(event, receivedAt) ? 'INVALID_EVENT_TIME' : null;
  const recordId = scopeMatches ? sourceRecordId.safeParse(raw.sourceRecordId).data : null;
  const kind = scopeMatches ? fdaRecordType.safeParse(raw.recordType).data : null;
  const occurredAt = scopeMatches ? sourceTimestamp.safeParse(raw.occurredAt).data : null;
  const contract = typeof raw.schemaVersion === 'string' && /^fda-lab\.ingestion\/v\d{1,4}$/.test(raw.schemaVersion) ? raw.schemaVersion : null;
  const hash = event ? fingerprint(event) : sha(JSON.stringify(input ?? null));
  const values = scopeValues(scope);

  await transaction(db, async client => {
    await client.query('INSERT INTO fda_tenants (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [scope.tenantId]);
    await client.query(`INSERT INTO fda_sources (tenant_id, source_id, credential_ref)
      VALUES ($1, $2, 'LAB_FDA_SOURCE_TOKEN') ON CONFLICT DO NOTHING`, values);

    if (event && !responseError) {
      await client.query(`INSERT INTO fda_source_events (tenant_id, source_id, source_record_id, envelope, payload_fingerprint)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [...values, event.sourceRecordId, event, hash]);
    }
    await client.query(`INSERT INTO fda_ingestion_receipts
      (id, tenant_id, source_id, source_record_id, record_type, schema_version, occurred_at, received_at,
       processed_at, validation, status, error_code, payload_fingerprint, application_revision, source_revision, correlation_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 = 'invalid' THEN clock_timestamp() END, $9, $10, $11, $12, $13, $14, $15)`,
    [id, ...values, recordId ?? null, kind ?? null, scopeMatches ? contract : null,
      occurredAt ?? null, receivedAt, responseError ? 'invalid' : 'valid', responseError ? 'rejected' : 'received',
      responseError, hash, revision, event?.sourceRevision ?? null, event?.correlationId ?? null]);
  });

  return { id, event: responseError ? null : event, hash };
}

export async function processEvent(db: Database, accepted: { id: string; event: FdaEvent; hash: string }, revision: string | null) {
  const { id, event, hash } = accepted;
  const key = [...scopeValues(event), event.sourceRecordId];
  await transaction(db, async client => {
    const result = await client.query<{ status: string; attempts: number; payload_fingerprint: string }>(
      `SELECT status, attempts, payload_fingerprint FROM fda_source_events
       WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3 FOR UPDATE`, key);
    const stored = result.rows[0];
    const current = await getReceipt(client, event, id);
    if (current?.status !== 'received') return;
    if (stored.payload_fingerprint !== hash) return completeReceipt(client, id, 'conflict', null, 'SOURCE_RECORD_CONFLICT');
    if (stored.status === 'processed') {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM fda_canonical_records WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3', key);
      return completeReceipt(client, id, 'duplicate', existing.rows[0].id, null);
    }
    if (stored.attempts >= 3) return completeReceipt(client, id, 'processing_failed', null, 'RETRY_LIMIT_REACHED');

    const pending = await client.query<{ id: string }>(`SELECT id FROM fda_ingestion_receipts
      WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3 AND payload_fingerprint = $4 AND status = 'received'
      ORDER BY received_at, id LIMIT 1`, [...key, hash]);
    const processingId = pending.rows[0].id;
    await client.query(`UPDATE fda_source_events SET status = 'processing', attempts = attempts + 1
      WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3`, key);
    await client.query("UPDATE fda_ingestion_receipts SET status = 'processing', processing_revision = $2 WHERE id = $1", [processingId, revision]);
    await client.query('SAVEPOINT fda_projection');
    const canonicalId = randomUUID();
    try {
      await client.query(`INSERT INTO fda_canonical_records
        (id, tenant_id, source_id, source_record_id, record_type, subject_id, occurred_at, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [canonicalId, ...key, event.recordType, subject(event), event.occurredAt, event.payload]);
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT fda_projection');
      await client.query(`UPDATE fda_source_events SET status = 'processing_failed'
        WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3`, key);
      await completeReceipt(client, processingId, 'processing_failed', null, 'PROJECTION_FAILED');
      if (id !== processingId) await completeReceipt(client, id, 'processing_failed', null, 'PROJECTION_FAILED');
      return;
    }
    await client.query(`UPDATE fda_source_events SET status = 'processed'
      WHERE tenant_id = $1 AND source_id = $2 AND source_record_id = $3`, key);
    await completeReceipt(client, processingId, 'processed', canonicalId, null);
    if (id !== processingId) await completeReceipt(client, id, 'duplicate', canonicalId, null);
  });
}

export async function getStatus(db: Database, scope: FdaScope, enabled: boolean) {
  return transaction(db, async client => {
    const { rows: grouped } = await client.query<{ status: FdaReceipt['status']; count: number; latest: Date | null }>(
      `SELECT status, count(*)::int AS count, max(processed_at) AS latest
       FROM fda_ingestion_receipts WHERE tenant_id = $1 AND source_id = $2 GROUP BY status`, scopeValues(scope));
    const { rows } = await client.query<ReceiptRow>(`SELECT ${receiptFields} FROM fda_ingestion_receipts
      WHERE tenant_id = $1 AND source_id = $2 ORDER BY received_at DESC, id LIMIT 40`, scopeValues(scope));
    const { rows: [total] } = await client.query<{ accepted: number }>(
      'SELECT count(*)::int AS accepted FROM fda_source_events WHERE tenant_id = $1 AND source_id = $2', scopeValues(scope));
    const counts = Object.fromEntries(receiptStatus.options.map(status => [status, 0])) as Record<FdaReceipt['status'], number>;
    for (const row of grouped) counts[row.status] = row.count;
    return {
      ...scope, schemaVersion: FDA_CONTRACT, connection: 'simulated HTTP publisher',
      sourceStatus: !enabled ? 'disabled' : counts.processed ? 'active' : 'awaiting-import',
      lastSuccessful: grouped.find(row => row.status === 'processed')?.latest?.toISOString() ?? null,
      acceptedRecords: total.accepted, counts, categories: fdaRecordType.options, receipts: rows.map(receipt),
    };
  }, true);
}

export type ReceivedCanonical = FdaCanonicalRecord & { receivedAt: Date };

export async function listCanonical(db: SqlClient, scope: FdaScope, kinds?: readonly FdaEvent['recordType'][]) {
  const { rows } = await db.query<ReceivedCanonical>(`SELECT c.id, c.subject_id AS "subjectId",
    r.id AS "receiptId", r.received_at AS "receivedAt", e.envelope || jsonb_build_object('payload', c.payload) AS event
    FROM fda_canonical_records c
    JOIN fda_source_events e USING (tenant_id, source_id, source_record_id)
    JOIN fda_ingestion_receipts r ON r.canonical_id = c.id AND r.status = 'processed'
    WHERE c.tenant_id = $1 AND c.source_id = $2 AND ($3::text[] IS NULL OR c.record_type = ANY($3))
    ORDER BY c.occurred_at DESC, c.source_record_id DESC LIMIT $4`, [...scopeValues(scope), kinds ?? null, kinds ? null : 500]);
  return rows;
}
