import { createHash, randomUUID } from 'node:crypto';
import type { Database, SqlClient } from '../../db/pool.ts';
import { operation } from '../../../../shared/contracts/submissions.ts';
import type { Operation, Submission } from '../../../../shared/contracts/submissions.ts';
import { transaction } from '../../db/pool.ts';

import type { EvidenceActor } from '../../api/evidence.ts';

type FaultReceipt = { requestId: string; fault: 'before-commit' | 'lost-ack'; actor: EvidenceActor };

export async function recordFaultReceipt(client: SqlClient, id: string, receipt: FaultReceipt) {
  await client.query(`
    INSERT INTO lab_submission_fault_receipts (operation_id, request_id, fault, actor_role, source_revision)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, receipt.requestId, receipt.fault, receipt.actor.role, receipt.actor.sourceRevision]);
}

type EventKind = Operation['events'][number]['kind'];
export class BeforeCommitError extends Error {}

export async function audit(client: SqlClient, id: string, kind: EventKind) {
  await client.query('INSERT INTO submission_events (operation_id, kind) VALUES ($1, $2)', [id, kind]);
}

export async function submit(pool: Database, id: string, input: Submission, failBeforeCommit = false, receipt?: FaultReceipt) {
  const fingerprint = createHash('sha256').update(JSON.stringify([input.candidateCode, input.requisition])).digest('hex');

  return transaction(pool, async client => {
    // Serialise requests for this operation, including requests arriving before it exists.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
    const existing = await client.query<{ payload_hash: string }>(
      'SELECT payload_hash FROM submission_operations WHERE id = $1', [id],
    );
    if (existing.rowCount) {
      const matches = existing.rows[0].payload_hash === fingerprint;
      await audit(client, id, matches ? 'replayed' : 'payload_conflict');
      return matches ? 'replayed' : 'conflict';
    }

    const proposedId = randomUUID();
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO submissions (id, candidate_code, requisition) VALUES ($1, $2, $3)
      ON CONFLICT (candidate_code, requisition) DO NOTHING RETURNING id
    `, [proposedId, input.candidateCode, input.requisition]);
    const duplicate = inserted.rowCount === 0;
    // An independent statement sees the winning transaction after ON CONFLICT waits.
    const record = duplicate ? await client.query<{ id: string }>(
      'SELECT id FROM submissions WHERE candidate_code = $1 AND requisition = $2',
      [input.candidateCode, input.requisition],
    ) : inserted;
    await client.query(`
      INSERT INTO submission_operations (id, payload_hash, submission_id, duplicate)
      VALUES ($1, $2, $3, $4)
    `, [id, fingerprint, record.rows[0].id, duplicate]);
    await client.query('INSERT INTO confirmation_jobs (operation_id) VALUES ($1)', [id]);
    await audit(client, id, duplicate ? 'duplicate_linked' : 'accepted');
    if (failBeforeCommit) throw new BeforeCommitError('Synthetic interruption before commit');
    if (receipt?.fault === 'lost-ack') await recordFaultReceipt(client, id, receipt);
    return 'created';
  });
}

export async function getOperation(pool: Database, id: string): Promise<Operation | null> {
  const result = await pool.query(`
    SELECT o.id, o.state, s.id AS "recordId", o.duplicate, j.attempts AS "confirmationAttempts",
           COALESCE(events.items, '[]'::jsonb) AS events
    FROM submission_operations o
    JOIN submissions s ON s.id = o.submission_id
    JOIN confirmation_jobs j ON j.operation_id = o.id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', kind, 'at', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) ORDER BY id) AS items
      FROM (SELECT id, kind, occurred_at FROM submission_events
            WHERE operation_id = o.id ORDER BY id DESC LIMIT 50) recent
    ) events ON true
    WHERE o.id = $1
  `, [id]);
  return result.rowCount ? operation.parse(result.rows[0]) : null;
}

export async function getOperationEvidence(pool: Database, id: string) {
  return transaction(pool, async client => {
    const operations = await client.query(`
      SELECT o.state, o.duplicate, o.created_at AS "createdAt", s.id AS "recordId", s.requisition,
        s.created_at AS "recordCreatedAt", j.state AS "confirmationJobState", j.attempts AS "confirmationAttempts"
      FROM submission_operations o JOIN submissions s ON s.id = o.submission_id
      JOIN confirmation_jobs j ON j.operation_id = o.id WHERE o.id = $1
    `, [id]);
    const faults = await client.query(`
      SELECT id::text, operation_id AS "operationId", request_id AS "requestId", fault,
        actor_role AS "actorRole", source_revision AS "sourceRevision",
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt", 504 AS "plannedHttpStatus"
      FROM lab_submission_fault_receipts WHERE operation_id = $1 ORDER BY id
    `, [id]);
    const operation = operations.rows[0] ?? null;
    if (!operation && !faults.rowCount) return null;
    const events = await client.query(`
      SELECT id::text, operation_id AS "operationId", kind,
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"
      FROM submission_events WHERE operation_id = $1 ORDER BY id
    `, [id]);
    return {
      operationId: id, operation, events: events.rows, faultDecisions: faults.rows,
      units: { timestamp: 'ISO 8601 UTC', attempts: 'count', plannedHttpStatus: 'HTTP status code' },
      provenance: {
        sources: ['submission_operations', 'submissions', 'confirmation_jobs', 'submission_events', 'lab_submission_fault_receipts'],
        ordering: 'Events and fault decisions are ordered by their own database event IDs.',
        limitations: [
          'Fault decisions record the API’s selected synthetic 504 response, not client receipt or polling.',
          'A pre-commit fault decision can exist before retry creates a durable operation.',
          'Legacy or fault-free operations may have no fault decisions. Confirmation is from the lab worker.',
        ],
      },
    };
  }, true);
}
