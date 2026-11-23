import { randomUUID } from 'node:crypto';
import { EFFECT_VERSION } from '../../../../shared/contracts/downstream.ts';
import type { OperationAction, StartExecution, SyntheticEffect } from '../../../../shared/contracts/downstream.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { lockFdaEvidence } from '../fda-ingestion/scope-lock.ts';
import { fingerprint, snapshotWorkflow } from '../workflow-assessments/evidence.ts';

export class DownstreamError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

export function effectIdentity(effect: SyntheticEffect) {
  return fingerprint({ tenantId: effect.tenantId, sourceId: effect.sourceId, caseId: effect.deliveryCaseId, adapter: EFFECT_VERSION });
}

export type State = 'queued' | 'dispatching' | 'awaiting-reconciliation' | 'retry-scheduled' | 'succeeded' | 'failed-terminal' | 'cancelled';
export interface Operation {
  id: string; tenant_id: string; source_id: string; delivery_case_id: string; assessment_id: string;
  revision: number; decision_id: string; workflow_id: string; evidence_fingerprint: string; request_key: string;
  effect_key: string; fingerprint: string; effect: SyntheticEffect; authorisation: Record<string, unknown>;
  state: State; dispatches: number; reconciliations: number; redriven: boolean; accepted: boolean;
  last_error: string | null; verified_effect_id: string | null; created_at: Date; updated_at: Date;
}

const scopeValues = (scope: FdaScope) => [scope.tenantId, scope.sourceId];
type Actor = Pick<EvidenceActor, 'sourceRevision'> & { role: string };

export async function audit(db: SqlClient, id: string, action: string, reason: string, actor: Actor) {
  await db.query(`INSERT INTO fda_downstream_audit (operation_id, action, reason, role, application_revision)
    VALUES ($1,$2,$3,$4,$5)`, [id, action, reason, actor.role, actor.sourceRevision]);
}

interface Case {
  id: string; assessment_id: string; revision: number; decision_id: string; outcome: string; workflow_id: string;
  current: number; evidence_fingerprint: string;
  body: { readiness: string; prerequisites: { status: string }[]; pilot?: Record<string, string> };
}

async function caseRecord(client: SqlClient, scope: FdaScope, caseId: string) {
  return (await client.query<Case>(`SELECT c.id, c.assessment_id, c.revision, c.decision_id, c.body, d.outcome, a.workflow_id,
    r.body -> 'snapshot' ->> 'fingerprint' AS evidence_fingerprint,
    (SELECT max(revision) FROM fda_workflow_revisions WHERE tenant_id=c.tenant_id AND source_id=c.source_id
      AND assessment_id=c.assessment_id) AS current
    FROM fda_workflow_delivery_cases c
    JOIN fda_workflow_assessments a ON (a.tenant_id,a.source_id,a.id)=(c.tenant_id,c.source_id,c.assessment_id)
    JOIN fda_workflow_decisions d ON (d.tenant_id,d.source_id,d.id)=(c.tenant_id,c.source_id,c.decision_id)
    JOIN fda_workflow_revisions r ON (r.tenant_id,r.source_id,r.assessment_id,r.revision)=(c.tenant_id,c.source_id,c.assessment_id,c.revision)
    WHERE c.tenant_id=$1 AND c.source_id=$2 AND c.id=$3`, [...scopeValues(scope), caseId])).rows[0];
}

async function eligibility(client: SqlClient, scope: FdaScope, item: Case) {
  if (item.revision !== item.current) throw new DownstreamError('SUPERSEDED_DELIVERY_CASE');
  if (!['approve-implementation-planning', 'approve-supervised-pilot'].includes(item.outcome)
    || item.body.readiness !== 'ready-for-technical-implementation'
    || item.body.prerequisites.some(p => p.status !== 'verified-in-lab')) {
    throw new DownstreamError('DELIVERY_PREREQUISITES_UNMET', 422);
  }
  const snapshot = await snapshotWorkflow(client, scope, item.workflow_id);
  if (!snapshot || snapshot.fingerprint !== item.evidence_fingerprint) throw new DownstreamError('STALE_DELIVERY_EVIDENCE');
  return snapshot.evidence.candidate.category;
}

export function startOperation(db: Database, scope: FdaScope, caseId: string, input: StartExecution, actor: EvidenceActor) {
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const attestation = fingerprint({ caseId, ...input });
    const replay = (await client.query<Operation>(`SELECT * FROM fda_downstream_operations
      WHERE tenant_id=$1 AND source_id=$2 AND request_key=$3`, [...scopeValues(scope), input.requestKey])).rows[0];
    if (replay) {
      if (replay.authorisation.attestation !== attestation) throw new DownstreamError('EXECUTION_REQUEST_CONFLICT');
      return replay;
    }
    const item = await caseRecord(client, scope, caseId);
    if (!item) throw new DownstreamError('DELIVERY_CASE_NOT_FOUND', 404);
    const category = await eligibility(client, scope, item);
    if (item.body.pilot && !input.supervisionConfirmed) throw new DownstreamError('PILOT_REVIEW_REQUIRED', 422);
    const effect = { ...scope, version: EFFECT_VERSION, workflowId: item.workflow_id, deliveryCaseId: caseId, category } as const;
    const id = randomUUID();
    const key = effectIdentity(effect);
    const { rows } = await client.query<Operation>(`INSERT INTO fda_downstream_operations
      (id,tenant_id,source_id,delivery_case_id,assessment_id,revision,decision_id,workflow_id,evidence_fingerprint,
       request_key,effect_key,fingerprint,effect,authorisation,state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'queued')
      ON CONFLICT (delivery_case_id) DO NOTHING RETURNING *`,
    [id, ...scopeValues(scope), caseId, item.assessment_id, item.revision, item.decision_id, item.workflow_id,
      item.evidence_fingerprint, input.requestKey, key, fingerprint(effect), effect,
      { attestation, syntheticOnly: true, reason: input.reason, role: actor.role, applicationRevision: actor.sourceRevision,
        maximumEffects: 1, pilot: item.body.pilot ?? null, supervisionConfirmed: input.supervisionConfirmed }]);
    if (!rows[0]) throw new DownstreamError('DELIVERY_CASE_ALREADY_EXECUTED');
    await client.query("INSERT INTO fda_downstream_jobs (operation_id,phase) VALUES ($1,'dispatch')", [id]);
    await audit(client, id, 'execution-authorised-and-queued', input.reason, actor);
    return rows[0];
  });
}

export function readCase(db: Database, scope: FdaScope, id: string) {
  return transaction(db, async client => {
    const item = await caseRecord(client, scope, id);
    if (!item) throw new DownstreamError('DELIVERY_CASE_NOT_FOUND', 404);
    let blocker: string | null = null;
    try { await eligibility(client, scope, item); }
    catch (error) {
      if (!(error instanceof DownstreamError)) throw error;
      blocker = error.message;
    }
    const operations = (await client.query<Operation>('SELECT * FROM fda_downstream_operations WHERE tenant_id=$1 AND source_id=$2 AND delivery_case_id=$3',
      [...scopeValues(scope), id])).rows;
    return { blocker, pilot: item.body.pilot, operations };
  }, true);
}

export async function collectOperationEvidence(client: SqlClient, scope: FdaScope, id: string) {
  const { rows: [operation] } = await client.query<Operation>(
    'SELECT * FROM fda_downstream_operations WHERE tenant_id=$1 AND source_id=$2 AND id=$3', [...scopeValues(scope), id]);
  if (!operation) throw new DownstreamError('OPERATION_NOT_FOUND', 404);
  const { rows: [job] } = await client.query('SELECT phase, due_at, lease_until FROM fda_downstream_jobs WHERE operation_id=$1', [id]);
  const { rows: attempts } = await client.query(`SELECT id, phase, attempt_number, recovered_lease, started_at, finished_at, metadata
    FROM fda_downstream_attempts WHERE operation_id=$1 ORDER BY id`, [id]);
  const { rows: history } = await client.query(`SELECT id, action, role, reason, application_revision, recorded_at
    FROM fda_downstream_audit WHERE operation_id=$1 ORDER BY id`, [id]);
  return { operation, job: job ?? null, attempts, history, units: { timestamps: 'UTC', retryDelay: 'milliseconds' },
    limitations: ['Synthetic downstream effects only.', 'Dispatch is at least once where retried. Effect identity is unique.',
      'An authenticated workspace role supplies the execution attestation.'] };
}

export function operationEvidence(db: Database, scope: FdaScope, id: string) {
  return transaction(db, client => collectOperationEvidence(client, scope, id), true);
}

const conflicts = ['EFFECT_MISMATCH', 'IDEMPOTENCY_CONFLICT', 'DOWNSTREAM_REJECTED'];

export function controlOperation(db: Database, scope: FdaScope, id: string, input: OperationAction, actor: EvidenceActor) {
  return transaction(db, async client => {
    if (input.action === 'redrive') await lockFdaEvidence(client, scope);
    // Match the worker lock order: job before operation.
    const { rows: [job] } = await client.query<{ lease_token: string | null }>(
      'SELECT lease_token FROM fda_downstream_jobs WHERE operation_id=$1 FOR UPDATE', [id]);
    const { rows: [op] } = await client.query<Operation>(`SELECT * FROM fda_downstream_operations
      WHERE tenant_id=$1 AND source_id=$2 AND id=$3 FOR UPDATE`, [...scopeValues(scope), id]);
    if (!op) throw new DownstreamError('OPERATION_NOT_FOUND', 404);
    if (job?.lease_token) throw new DownstreamError('OPERATION_LEASED');
    if (input.action === 'cancel') {
      if (op.state !== 'queued' || op.dispatches !== 0) throw new DownstreamError('CANCELLATION_NOT_PERMITTED');
      await client.query("UPDATE fda_downstream_operations SET state='cancelled', updated_at=clock_timestamp() WHERE id=$1", [id]);
      await client.query('DELETE FROM fda_downstream_jobs WHERE operation_id=$1', [id]);
    } else {
      if (job || op.state !== 'failed-terminal' || conflicts.includes(op.last_error ?? '') || op.redriven) {
        throw new DownstreamError('RECOVERY_NOT_PERMITTED');
      }
      if (input.action === 'redrive') {
        if (op.authorisation.pilot || op.accepted) throw new DownstreamError('REDRIVE_NOT_PERMITTED');
        const item = await caseRecord(client, scope, op.delivery_case_id);
        if (!item) throw new DownstreamError('DELIVERY_CASE_NOT_FOUND', 404);
        await eligibility(client, scope, item);
      }
      // Manual reconciliation performs lookup only. Redrive permits one further dispatch after an authoritative miss.
      await client.query(`UPDATE fda_downstream_operations SET state='awaiting-reconciliation', redriven=true,
        last_error=$2, updated_at=clock_timestamp() WHERE id=$1`, [id, input.action === 'redrive' ? 'REDRIVE_REQUESTED' : 'LOOKUP_REQUESTED']);
      await client.query("INSERT INTO fda_downstream_jobs (operation_id,phase,manual_action) VALUES ($1,'reconcile',$2)", [id, input.action]);
    }
    await audit(client, id, input.action, input.reason, actor);
  });
}
