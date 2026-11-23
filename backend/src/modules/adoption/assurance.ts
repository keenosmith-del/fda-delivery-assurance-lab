import { randomUUID } from 'node:crypto';
import { ADOPTION_CALCULATION } from '../../../../shared/contracts/adoption-assurance.ts';
import type { AdoptionAction, AdoptionScope, Observation } from '../../../../shared/contracts/adoption-assurance.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { transaction } from '../../db/pool.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';
import { adoptionSignals, compareWindows, groupBy, interpretationLimits, measureWindow } from './assurance-metrics.ts';
import type { VerifiedEffect } from './assurance-metrics.ts';

export class AssuranceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function lookupDelivery(client: SqlClient, scope: AdoptionScope, caseId: string, lock = false) {
  const { rows } = await client.query<{ caseId: string; workflowId: string; assessmentId: string; revision: number;
    decisionId: string; operation: VerifiedEffect | null; superseded: boolean; available: boolean }>(`
    SELECT c.id AS "caseId", a.workflow_id AS "workflowId", c.assessment_id AS "assessmentId", c.revision,
           c.decision_id AS "decisionId", (s.delivery_case_id IS NOT NULL) AS available,
           EXISTS (SELECT 1 FROM fda_workflow_revisions r WHERE r.tenant_id=c.tenant_id AND r.source_id=c.source_id
             AND r.assessment_id=c.assessment_id AND r.revision>c.revision) AS superseded,
           CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id', o.id, 'state', o.state, 'effectId', o.verified_effect_id,
             'verifiedAt', CASE WHEN o.verified_effect_id IS NOT NULL THEN o.updated_at END, 'dispatches', o.dispatches) END AS operation
    FROM fda_workflow_delivery_cases c
    JOIN fda_workflow_assessments a ON (a.tenant_id,a.source_id,a.id)=(c.tenant_id,c.source_id,c.assessment_id)
    LEFT JOIN fda_adoption_assessments s ON s.delivery_case_id=c.id
    LEFT JOIN fda_downstream_operations o ON (o.tenant_id,o.source_id,o.delivery_case_id)=(c.tenant_id,c.source_id,c.id)
    WHERE c.tenant_id=$1 AND c.source_id=$2 AND c.id=$3 ${lock ? 'FOR UPDATE OF c' : ''}`, [scope.tenantId, scope.sourceId, caseId]);
  if (!rows[0]) throw new AssuranceError('DELIVERY_CASE_NOT_FOUND', 404);
  return rows[0];
}

async function establish(client: SqlClient, scope: AdoptionScope, delivery: Awaited<ReturnType<typeof lookupDelivery>>) {
  await client.query(`INSERT INTO fda_adoption_assessments
    (tenant_id,source_id,delivery_case_id,assessment_id,revision,decision_id) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (delivery_case_id) DO NOTHING`, [scope.tenantId, scope.sourceId, delivery.caseId,
    delivery.assessmentId, delivery.revision, delivery.decisionId]);
}

export function establishAssurance(db: Database, scope: AdoptionScope, caseId: string) {
  return transaction(db, async client => {
    const delivery = await lookupDelivery(client, scope, caseId, true);
    await establish(client, scope, delivery);
    return { id: caseId };
  });
}

export function receiveObservation(db: Database, scope: AdoptionScope, input: Observation) {
  if (input.tenantId !== scope.tenantId || input.sourceId !== scope.sourceId) throw new AssuranceError('SOURCE_SCOPE_MISMATCH', 403);
  return transaction(db, async client => {
    const delivery = await lookupDelivery(client, scope, input.caseId, true);
    if (delivery.workflowId !== input.workflowId) throw new AssuranceError('WORKFLOW_CASE_MISMATCH', 409);
    if (input.kind === 'result' && input.operationId && input.operationId !== delivery.operation?.id) {
      throw new AssuranceError('CROSS_CASE_OPERATION', 409);
    }
    await establish(client, scope, delivery);
    const keys = [scope.tenantId, scope.sourceId, input.eventId];
    let status = 'accepted';
    const count = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM fda_adoption_observations WHERE delivery_case_id=$1', [input.caseId]);
    const existing = await client.query<{ body: Observation }>(`SELECT body FROM fda_adoption_observations
      WHERE tenant_id=$1 AND source_id=$2 AND source_event_id=$3`, keys);
    if (!existing.rows[0] && count.rows[0]!.total >= 2000) throw new AssuranceError('OBSERVATION_LIMIT', 409);
    if (!existing.rows[0] && input.kind === 'result' && input.operationId) {
      const reuse = await client.query(`SELECT 1 FROM fda_adoption_observations WHERE delivery_case_id=$1 AND body->>'operationId'=$2
        AND (period_id<>$3 OR body->>'opportunity'<>$4) LIMIT 1`, [input.caseId, input.operationId, input.periodId, input.opportunity]);
      if (reuse.rows.length) throw new AssuranceError('EFFECT_ALREADY_LINKED', 409);
    }
    const inserted = await client.query(`INSERT INTO fda_adoption_observations
      (tenant_id,source_id,source_event_id,delivery_case_id,period_id,body) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT DO NOTHING RETURNING source_event_id`, [...keys, input.caseId, input.periodId, input]);
    if (!inserted.rows.length) {
      const { rows: [current] } = await client.query<{ body: Observation }>(`SELECT body FROM fda_adoption_observations
        WHERE tenant_id=$1 AND source_id=$2 AND source_event_id=$3`, keys);
      status = fingerprint(current!.body) === fingerprint(input) ? 'duplicate' : 'conflict';
    }
    const id = randomUUID();
    const { rows: [receipt] } = await client.query<{ received_at: Date }>(`INSERT INTO fda_adoption_receipts
      (id,tenant_id,source_id,source_event_id,status) VALUES ($1,$2,$3,$4,$5) RETURNING received_at`, [id, ...keys, status]);
    return { id, status, receivedAt: receipt!.received_at, eventId: input.eventId };
  });
}

type SavedAction = { id: string; body: AdoptionAction; evidence: unknown; actorRole: string;
  applicationRevision: string | null; recordedAt: string };

async function assemble(client: SqlClient, scope: AdoptionScope, delivery: Awaited<ReturnType<typeof lookupDelivery>>) {
  const observations = (await client.query<{ body: Observation; receivedAt: string }>(
    'SELECT body, received_at AS "receivedAt" FROM fda_adoption_observations WHERE delivery_case_id=$1 ORDER BY period_id, source_event_id',
    [delivery.caseId])).rows;
  const audit = (await client.query<SavedAction>(`SELECT request_id AS id, body, evidence, actor_role AS "actorRole",
    application_revision AS "applicationRevision", recorded_at AS "recordedAt" FROM fda_adoption_actions
    WHERE delivery_case_id=$1 ORDER BY sequence`, [delivery.caseId])).rows;
  const receipts = (await client.query(`SELECT r.id,r.source_event_id AS "eventId",r.status,r.received_at AS "receivedAt"
    FROM fda_adoption_receipts r JOIN fda_adoption_observations o USING (tenant_id,source_id,source_event_id)
    WHERE o.delivery_case_id=$1 ORDER BY r.received_at,r.id LIMIT 2000`, [delivery.caseId])).rows;
  const windows = [...groupBy(observations.map(r => r.body), event => event.periodId)]
    .map(([id, events]) => measureWindow(id, events, delivery.operation))
    .sort((a, b) => (a.declaration?.start ?? '').localeCompare(b.declaration?.start ?? '') || a.periodId.localeCompare(b.periodId));
  const signals = adoptionSignals(windows, delivery.operation?.id ?? null);
  const status = !delivery.operation?.effectId ? 'implementation-not-verified'
    : !windows.length ? 'awaiting-adoption-evidence' : windows.every(w => w.coverage === 'insufficient') ? 'insufficient-evidence'
    : audit.some(a => a.body.kind === 'follow-up') ? 'follow-up-assessed'
    : audit.some(a => a.body.kind === 'plan') ? 'intervention-under-review'
    : signals.length ? 'adoption-concerns-detected' : 'adoption-observed';
  return { ...scope, ...delivery, id: delivery.caseId, status, windows, signals, observations, receipts, audit,
    calculationVersion: ADOPTION_CALCULATION, limitations: interpretationLimits,
    discrepancies: [...(delivery.superseded ? ['This historical delivery case was superseded.'] : []),
      ...(delivery.operation?.effectId && !windows.some(w => w.verified) ? ['Verified delivery has no independently linked usage success.'] : []),
      ...(receipts.some(r => r.status === 'conflict') ? ['Conflicting source-event replay was rejected.'] : []),
      ...(receipts.length === 2000 ? ['Receipt display is capped at 2000.'] : [])] };
}

export type AssuranceDetail = Awaited<ReturnType<typeof assemble>>;

export async function readDeliveryAdoption(client: SqlClient, scope: AdoptionScope, id: string, lock = false) {
  return assemble(client, scope, await lookupDelivery(client, scope, id, lock));
}

export function readAssurance(db: Database, scope: AdoptionScope, id: string) {
  return transaction(db, client => readDeliveryAdoption(client, scope, id), true);
}
export function listAssurance(db: Database, scope: AdoptionScope) {
  return db.query<{ caseId: string; workflowId: string }>(`SELECT c.id AS "caseId",a.workflow_id AS "workflowId"
    FROM fda_workflow_delivery_cases c JOIN fda_workflow_assessments a
    ON (a.tenant_id,a.source_id,a.id)=(c.tenant_id,c.source_id,c.assessment_id)
    WHERE c.tenant_id=$1 AND c.source_id=$2 ORDER BY c.created_at DESC,c.id LIMIT 100`, [scope.tenantId, scope.sourceId])
    .then(r => r.rows);
}

function validateAction(input: AdoptionAction, detail: AssuranceDetail) {
  const check = (valid: unknown, code: string) => { if (!valid) throw new AssuranceError(code, 409); };
  if (input.kind === 'diagnose') {
    const period = detail.windows.find(w => w.periodId === input.periodId);
    check(period, 'MEASUREMENT_PERIOD_REQUIRED');
    return { calculationVersion: ADOPTION_CALCULATION, period, operation: detail.operation,
      signals: detail.signals.filter(s => s.periodId === input.periodId) };
  }
  if (input.kind === 'plan') {
    const diagnosis = detail.audit.find(d => d.id === input.diagnosisId)?.body;
    if (diagnosis?.kind !== 'diagnose') throw new AssuranceError('DIAGNOSIS_NOT_FOUND', 409);
    check(input.followUpPeriodId !== diagnosis.periodId, 'FOLLOW_UP_PERIOD_MUST_DIFFER');
    return { diagnosisId: input.diagnosisId, baseline: diagnosis.periodId };
  }
  const plan = detail.audit.find(a => a.id === input.interventionId)?.body;
  if (plan?.kind !== 'plan') throw new AssuranceError('INTERVENTION_NOT_FOUND', 409);
  const previous = detail.audit.filter(a => 'interventionId' in a.body && a.body.interventionId === input.interventionId);
  const required = { implement: 'plan', 'follow-up': 'implement', review: 'follow-up', close: 'review' } as const;
  check((previous.at(-1)?.body.kind ?? 'plan') === required[input.kind], 'INVALID_INTERVENTION_TRANSITION');
  const diagnosis = detail.audit.find(a => a.id === plan.diagnosisId);
  const baseline = diagnosis?.body.kind === 'diagnose' ? detail.windows.find(w => w.periodId === (diagnosis.body as { periodId: string }).periodId) : undefined;
  const later = detail.windows.find(w => w.periodId === plan.followUpPeriodId);
  if (input.kind === 'implement') {
    check(baseline?.declaration && Date.parse(input.implementedAt) >= Date.parse(baseline.declaration.end), 'INVALID_IMPLEMENTATION_DATE');
    check(!later?.declaration || Date.parse(input.implementedAt) <= Date.parse(later.declaration.start), 'IMPLEMENTATION_AFTER_FOLLOW_UP_START');
  }
  if (input.kind === 'follow-up') {
    const applied = previous.at(-1)?.body;
    check(applied?.kind === 'implement' && later?.declaration &&
      Date.parse(later.declaration.start) >= Date.parse(applied.implementedAt), 'FOLLOW_UP_PERIOD_NOT_READY');
    check(baseline?.declaration, 'BASELINE_EVIDENCE_REQUIRED');
    return { comparison: compareWindows(baseline!, later!), baseline, followUp: later, operation: detail.operation };
  }
  return { previous: previous.at(-1)?.id ?? input.interventionId, revision: detail.revision };
}

export function recordAssuranceAction(db: Database, scope: AdoptionScope, id: string, input: AdoptionAction, actor: EvidenceActor) {
  return transaction(db, async client => {
    const delivery = await lookupDelivery(client, scope, id, true);
    await establish(client, scope, delivery);
    const existing = await client.query<{ body: AdoptionAction }>('SELECT body FROM fda_adoption_actions WHERE delivery_case_id=$1 AND request_id=$2',
      [id, input.requestId]);
    if (existing.rows[0]) {
      if (fingerprint(existing.rows[0].body) !== fingerprint(input)) throw new AssuranceError('ACTION_REPLAY_CONFLICT', 409);
      return { id: input.requestId };
    }
    if (!delivery.operation?.effectId) throw new AssuranceError('VERIFIED_DELIVERY_REQUIRED', 409);
    const evidence = validateAction(input, await assemble(client, scope, delivery));
    await client.query(`INSERT INTO fda_adoption_actions
      (delivery_case_id,request_id,body,evidence,actor_role,application_revision) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.requestId, input, { assessmentRevision: delivery.revision, ...evidence }, actor.role, actor.sourceRevision]);
    return { id: input.requestId };
  });
}
