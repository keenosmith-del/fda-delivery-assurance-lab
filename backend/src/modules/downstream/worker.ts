import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';
import { audit } from './operations.ts';
import type { Operation, State } from './operations.ts';
import type { DownstreamAdapter } from './adapter.ts';

type Phase = 'dispatch' | 'reconcile';
type Job = { operation_id: string; phase: Phase; manual_action: 'redrive' | 'reconcile' | null; lease_token: string | null };
export type Claim = { operation: Operation; phase: Phase; token: string; number: number; manual: Job['manual_action'] };
export type WorkerPolicy = { maxDispatches: number; maxLookups: number; baseDelayMs: number; leaseMs: number; revision: string | null };
type Result = { metadata: Record<string, unknown>; state: State; code?: string; next?: Phase; delay?: number; verified?: string; accepted?: boolean };

export async function claimOperation(db: Database, policy: WorkerPolicy): Promise<Claim | null> {
  return transaction(db, async client => {
    const { rows: [job] } = await client.query<Job>(`SELECT operation_id, phase, manual_action, lease_token FROM fda_downstream_jobs
      WHERE due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp())
      ORDER BY due_at, operation_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!job) return null;
    const recovered = Boolean(job.lease_token);
    const phase = recovered ? 'reconcile' : job.phase;
    if (recovered) {
      await client.query(`UPDATE fda_downstream_attempts SET finished_at=clock_timestamp(),
        metadata='{"kind":"lease-expired","dispatchOutcome":"unknown"}'::jsonb WHERE operation_id=$1 AND finished_at IS NULL`, [job.operation_id]);
      await audit(client, job.operation_id, 'lease-recovered', 'Expired worker lease recovered by authoritative lookup.',
        { role: 'worker', sourceRevision: policy.revision });
    }
    const token = randomUUID();
    await client.query(`UPDATE fda_downstream_jobs SET phase=$2, lease_token=$3,
      lease_until=clock_timestamp()+$4::int * interval '1 millisecond' WHERE operation_id=$1`, [job.operation_id, phase, token, policy.leaseMs]);
    const { rows: [operation] } = await client.query<Operation>(`UPDATE fda_downstream_operations SET state=$2,
      dispatches=dispatches+$3, reconciliations=reconciliations+$4, updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
    [job.operation_id, phase === 'dispatch' ? 'dispatching' : 'awaiting-reconciliation', phase === 'dispatch' ? 1 : 0, phase === 'reconcile' ? 1 : 0]);
    const number = phase === 'dispatch' ? operation!.dispatches : operation!.reconciliations;
    await client.query(`INSERT INTO fda_downstream_attempts (operation_id,phase,attempt_number,recovered_lease) VALUES ($1,$2,$3,$4)`,
      [job.operation_id, phase, number, recovered]);
    return { operation: operation!, phase, token, number, manual: job.manual_action };
  });
}

function backoff(policy: WorkerPolicy, count: number) {
  return Math.min(60_000, policy.baseDelayMs * 2 ** Math.min(10, Math.max(0, count - 1)));
}

async function assess(claim: Claim, adapter: DownstreamAdapter, policy: WorkerPolicy): Promise<Result> {
  const op = claim.operation;
  if (claim.phase === 'dispatch') {
    const response = await adapter.dispatch({ key: op.effect_key, operationId: op.id, effect: op.effect });
    if (response.kind === 'rejected') return { metadata: response, state: 'failed-terminal', code: response.code };
    if (response.kind === 'acknowledged') return { metadata: response, state: 'awaiting-reconciliation', accepted: true, next: 'reconcile' };
    return { metadata: response, state: 'awaiting-reconciliation', code: response.code, next: 'reconcile', delay: response.retryAfter };
  }

  const response = await adapter.lookup(op.effect_key);
  const identity = { method: 'authoritative-effect-lookup', idempotencyKey: op.effect_key, expectedFingerprint: op.fingerprint };
  if (response.kind === 'found') {
    const { record } = response;
    const metadata = { ...identity, kind: 'found', effectId: record.effectId, observedFingerprint: record.fingerprint,
      observedContentFingerprint: fingerprint(record.effect), committedAt: record.committedAt };
    if (record.operationId !== op.id || record.key !== op.effect_key || record.fingerprint !== op.fingerprint ||
      metadata.observedContentFingerprint !== op.fingerprint) {
      return { metadata, state: 'failed-terminal', code: 'EFFECT_MISMATCH' };
    }
    return { metadata, state: 'succeeded', verified: record.effectId };
  }

  const metadata = { ...identity, ...response };
  const firstRedriveLookup = claim.manual === 'redrive' && op.last_error === 'REDRIVE_REQUESTED' && !op.accepted;
  const delay = backoff(policy, response.kind === 'absent' ? op.dispatches : op.reconciliations);
  if (response.kind === 'absent' && !op.accepted && (firstRedriveLookup ||
    (!claim.manual && !op.authorisation.pilot && op.dispatches < policy.maxDispatches && op.reconciliations < policy.maxLookups))) {
    return { metadata, state: 'retry-scheduled', next: 'dispatch', code: 'NO_EFFECT_FOUND', delay };
  }
  if (!claim.manual && op.reconciliations < policy.maxLookups && (response.kind !== 'absent' || op.accepted)) {
    return { metadata, state: 'awaiting-reconciliation', next: 'reconcile', delay, code: 'VERIFICATION_PENDING' };
  }
  return { metadata, state: 'failed-terminal', code: response.kind === 'absent' && !op.accepted ? 'DISPATCH_EXHAUSTED' : 'VERIFICATION_EXHAUSTED' };
}

export async function processClaim(db: Database, claim: Claim, adapter: DownstreamAdapter, policy: WorkerPolicy) {
  const id = claim.operation.id;
  const active = await db.query('SELECT 1 FROM fda_downstream_jobs WHERE operation_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()', [id, claim.token]);
  if (!active.rowCount) return false;
  const result = await assess(claim, adapter, policy);
  return transaction(db, async client => {
    const locked = await client.query(`SELECT 1 FROM fda_downstream_jobs WHERE operation_id=$1 AND lease_token=$2
      AND lease_until>clock_timestamp() FOR UPDATE`, [id, claim.token]);
    if (!locked.rowCount) return false;
    await client.query(`UPDATE fda_downstream_attempts SET finished_at=clock_timestamp(), metadata=$4
      WHERE operation_id=$1 AND phase=$2 AND attempt_number=$3`, [id, claim.phase, claim.number,
      { ...result.metadata, resultingState: result.state, errorCode: result.code ?? null, retryDelayMs: result.delay ?? 0,
        revision: policy.revision }]);
    await client.query(`UPDATE fda_downstream_operations SET state=$2, accepted=accepted OR $3, last_error=$4,
      verified_effect_id=$5, updated_at=clock_timestamp() WHERE id=$1`,
    [id, result.state, result.accepted ?? false, result.code ?? null, result.verified ?? null]);
    if (result.next) {
      await client.query(`UPDATE fda_downstream_jobs SET phase=$2,due_at=clock_timestamp()+$3::int * interval '1 millisecond',
        lease_token=NULL,lease_until=NULL WHERE operation_id=$1`, [id, result.next, result.delay ?? 0]);
    } else {
      await client.query('DELETE FROM fda_downstream_jobs WHERE operation_id=$1', [id]);
    }
    await audit(client, id, result.state, result.code ?? String(result.metadata.kind), { role: 'worker', sourceRevision: policy.revision });
    return true;
  });
}
