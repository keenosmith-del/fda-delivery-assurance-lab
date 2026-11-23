import { randomUUID } from 'node:crypto';
import { OUTCOME_RULE } from '../../../../shared/contracts/outcome-assurance.ts';
import type { OutcomeObservation, OutcomeReview, OutcomeSelection } from '../../../../shared/contracts/outcome-assurance.ts';
import type { AdoptionScope } from '../../../../shared/contracts/adoption-assurance.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import { AssuranceError, lookupDelivery, readDeliveryAdoption } from '../adoption/assurance.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';
import { compareStudies, modelOpportunity, outcomeFormulas, study } from './assurance-calculations.ts';

const key = (scope: AdoptionScope, id: string) => [scope.tenantId, scope.sourceId, id];
type Delivery = Awaited<ReturnType<typeof lookupDelivery>>;
type PreviousReview = { revision: number; requestId: string; fingerprint: string; decision: OutcomeReview; snapshot: unknown;
  actorRole: string; applicationRevision: string | null; reviewedAt: string };

async function establish(client: SqlClient, scope: AdoptionScope, delivery: Delivery) {
  await client.query(`INSERT INTO fda_outcome_assessments(tenant_id,source_id,delivery_case_id,assessment_id,assessment_revision,decision_id)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [...key(scope, delivery.caseId), delivery.assessmentId, delivery.revision, delivery.decisionId]);
}

export function establishOutcome(db: Database, scope: AdoptionScope, id: string) {
  return transaction(db, async client => {
    await establish(client, scope, await lookupDelivery(client, scope, id, true));
    return { id };
  });
}

export function receiveOutcome(db: Database, scope: AdoptionScope, input: OutcomeObservation) {
  if (input.tenantId !== scope.tenantId || input.sourceId !== scope.sourceId) throw new AssuranceError('SOURCE_SCOPE_MISMATCH', 403);
  return transaction(db, async client => {
    const delivery = await lookupDelivery(client, scope, input.caseId, true);
    if (input.workflowId !== delivery.workflowId) throw new AssuranceError('WORKFLOW_CASE_MISMATCH', 409);
    await establish(client, scope, delivery);
    const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM fda_outcome_measurements
      WHERE (tenant_id,source_id,delivery_case_id)=($1,$2,$3)`, key(scope, input.caseId));
    const eventKey = key(scope, input.eventId);
    const { rows: [previous] } = await client.query<{ body: OutcomeObservation }>(
      'SELECT body FROM fda_outcome_measurements WHERE (tenant_id,source_id,event_id)=($1,$2,$3)', eventKey);
    if (!previous && count.rows[0]!.count >= 2500) throw new AssuranceError('OUTCOME_OBSERVATION_LIMIT', 409);
    const insert = await client.query(`INSERT INTO fda_outcome_measurements(tenant_id,source_id,event_id,delivery_case_id,body)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id`, [...eventKey, input.caseId, input]);
    let status = 'accepted';
    if (!insert.rows.length) {
      const { rows: [canonical] } = await client.query<{ body: OutcomeObservation }>(
        'SELECT body FROM fda_outcome_measurements WHERE (tenant_id,source_id,event_id)=($1,$2,$3)', eventKey);
      status = fingerprint(canonical!.body) === fingerprint(input) ? 'duplicate' : 'conflict';
    }
    const id = randomUUID();
    const { rows: [receipt] } = await client.query<{ received_at: Date }>(`INSERT INTO fda_outcome_receipts(id,tenant_id,source_id,event_id,status)
      VALUES ($1,$2,$3,$4,$5) RETURNING received_at`, [id, ...eventKey, status]);
    return { status, id, eventId: input.eventId, receivedAt: receipt!.received_at };
  });
}

function choose(input: OutcomeSelection) {
  const { baseline, comparison, method, interventionId } = input;
  return { baseline, comparison, method, ...(interventionId ? { interventionId } : {}) };
}

async function assemble(client: SqlClient, scope: AdoptionScope, id: string, selected?: OutcomeSelection) {
  const adoption = await readDeliveryAdoption(client, scope, id);
  const keys = key(scope, id);
  const { rows: [context] } = await client.query<{ approvedRevision: unknown; decision: unknown; delivery: unknown; registered: boolean }>(`
    SELECT r.body AS "approvedRevision", d.body AS decision, c.body AS delivery, (s.delivery_case_id IS NOT NULL) AS registered
    FROM fda_workflow_delivery_cases c
    JOIN fda_workflow_revisions r ON (r.tenant_id,r.source_id,r.assessment_id,r.revision)=(c.tenant_id,c.source_id,c.assessment_id,c.revision)
    JOIN fda_workflow_decisions d ON (d.tenant_id,d.source_id,d.id)=(c.tenant_id,c.source_id,c.decision_id)
    LEFT JOIN fda_outcome_assessments s ON (s.tenant_id,s.source_id,s.delivery_case_id)=(c.tenant_id,c.source_id,c.id)
    WHERE (c.tenant_id,c.source_id,c.id)=($1,$2,$3)`, keys);
  const observations = (await client.query<{ body: OutcomeObservation; receivedAt: string }>(`
    SELECT body,received_at AS "receivedAt" FROM fda_outcome_measurements
    WHERE (tenant_id,source_id,delivery_case_id)=($1,$2,$3) ORDER BY event_id`, keys)).rows;
  const receipts = (await client.query(`SELECT r.id,r.event_id AS "eventId",r.status,r.received_at AS "receivedAt"
    FROM fda_outcome_receipts r JOIN fda_outcome_measurements m USING (tenant_id,source_id,event_id)
    WHERE (m.tenant_id,m.source_id,m.delivery_case_id)=($1,$2,$3) ORDER BY r.received_at DESC,r.id LIMIT 2500`, keys)).rows;
  const reviews = (await client.query<PreviousReview>(`SELECT revision,request_id AS "requestId",evidence_fingerprint AS fingerprint,
    decision,snapshot,actor_role AS "actorRole",application_revision AS "applicationRevision",reviewed_at AS "reviewedAt"
    FROM fda_outcome_reviews WHERE (tenant_id,source_id,delivery_case_id)=($1,$2,$3) ORDER BY revision`, keys)).rows;
  const events = observations.map(o => o.body);
  const periods = [...new Set(events.filter(e => e.kind !== 'model').map(e => e.periodId))].sort().map(periodId => study(periodId, events));
  const latest = reviews.at(-1);
  const first = periods.find(p => p.definition?.stage === 'baseline');
  const last = periods.find(p => p.definition?.stage === 'comparison');
  const selection = selected ?? (latest ? choose(latest.decision) : first && last
    ? { baseline: first.periodId, comparison: last.periodId, method: 'matched-items' as const } : null);
  const windows = selection ? adoption.windows.find(w => w.periodId === selection.comparison) : undefined;
  const beforeUsage = selection ? adoption.windows.find(w => w.periodId === selection.baseline) : undefined;
  const modeled = events.filter(e => e.kind === 'model').map(modelOpportunity);
  const deliveryEvidence = { version: OUTCOME_RULE, caseId: id, approvedRevision: context!.approvedRevision,
    decision: context!.decision, delivery: context!.delivery, superseded: adoption.superseded, operation: adoption.operation };
  function hashFor(value: OutcomeSelection) {
    const selectedPeriods = new Set([value.baseline, value.comparison]);
    const intervention = value.interventionId ? adoption.audit.find(action => action.id === value.interventionId) : undefined;
    const diagnosisId = intervention?.body.kind === 'plan' ? intervention.body.diagnosisId : undefined;
    return fingerprint({ ...deliveryEvidence, selection: choose(value),
      events: events.filter(event => selectedPeriods.has(event.periodId)),
      usage: adoption.observations.filter(entry => selectedPeriods.has(entry.body.periodId)),
      interventionActions: value.interventionId ? adoption.audit.filter(action => action.id === value.interventionId ||
        action.id === diagnosisId || ('interventionId' in action.body && action.body.interventionId === value.interventionId)) : [],
    });
  }
  const measured = selection ? compareStudies(study(selection.baseline, events), study(selection.comparison, events), selection, windows) : null;
  const comparison = measured && { ...measured, cohortChanged: measured.cohortChanged ||
    Boolean(beforeUsage && windows && JSON.stringify(beforeUsage.cohort) !== JSON.stringify(windows.cohort)) };
  const plan = selection?.interventionId ? adoption.audit.find(a => a.id === selection.interventionId && a.body.kind === 'plan') : undefined;
  const interventionSteps = plan ? adoption.audit.filter(a => 'interventionId' in a.body && a.body.interventionId === plan.id) : [];
  const diagnosis = plan?.body.kind === 'plan' ? adoption.audit.find(a => plan.body.kind === 'plan' && a.id === plan.body.diagnosisId) : undefined;
  const alignedIntervention = !selection?.interventionId || plan?.body.kind === 'plan' && plan.body.followUpPeriodId === selection.comparison &&
    diagnosis?.body.kind === 'diagnose' && diagnosis.body.periodId === selection.baseline && interventionSteps.some(e => e.body.kind === 'follow-up');
  const reasons = [...(adoption.operation?.effectId ? [] : ['Awaiting implementation verification']),
    ...(adoption.windows.length ? [] : ['Awaiting adoption observations']),
    ...(adoption.superseded ? ['Delivery case is superseded'] : []),
    ...(windows?.declaration && adoption.operation?.verifiedAt && Date.parse(windows.declaration.start) < Date.parse(adoption.operation.verifiedAt)
      ? ['Comparison starts before implementation verification'] : []),
    ...(comparison?.reasons ?? ['Awaiting a baseline and comparison study']),
    ...(alignedIntervention ? [] : ['Intervention must link an implemented plan and recorded follow-up to the selected periods'])];
  const reviewHistory = reviews.map(r => ({ ...r, stale: r.fingerprint !== hashFor(r.decision) }));
  const matchingReview = [...reviewHistory].reverse().find(r => selection &&
    fingerprint(choose(r.decision)) === fingerprint(choose(selection)));
  const currentReview = matchingReview && !matchingReview.stale ? matchingReview : undefined;
  const ready = reasons.length === 0 && comparison !== null && comparison.difference !== null;
  const verifiedEffects = windows?.verified ?? 0;
  return { id, scope, adoption, context: context!, version: OUTCOME_RULE, formulas: outcomeFormulas, selection,
    periods, modeled, comparison, verifiedEffects, observations, receipts, reviewHistory, latestRevision: latest?.revision ?? 0,
    usage: { baseline: beforeUsage ?? null, comparison: windows ?? null },
    fingerprint: selection ? hashFor(selection) : null, ready, reasons,
    status: currentReview?.decision.outcome ?? (matchingReview?.stale ? 'stale-review' :
      ready ? 'ready-for-engineering-review' : reasons[0]),
    reviewedDifference: currentReview && ['reviewed-synthetic-comparison','reviewed-with-limitations'].includes(currentReview.decision.outcome)
      ? comparison?.difference ?? null : null,
    intervention: plan ? { plan, diagnosis, steps: interventionSteps } : null,
    limitations: ['All observations are synthetic.', 'Observed change cannot establish intervention causality.',
      'Verified operation counts, modeled opportunity and reviewed handling differences are separate evidence classes.'] };
}

export function readOutcomeAssurance(db: Database, scope: AdoptionScope, id: string, selected?: OutcomeSelection) {
  return transaction(db, client => assemble(client, scope, id, selected), true);
}

export function recordOutcomeReview(db: Database, scope: AdoptionScope, id: string, input: OutcomeReview, actor: EvidenceActor) {
  return transaction(db, async client => {
    const delivery = await lookupDelivery(client, scope, id, true);
    await establish(client, scope, delivery);
    const keys = key(scope, id);
    const { rows: [prior] } = await client.query<{ revision: number; decision: OutcomeReview }>(`
      SELECT revision,decision FROM fda_outcome_reviews WHERE (tenant_id,source_id,delivery_case_id,request_id)=($1,$2,$3,$4)`,
    [...keys,input.requestId]);
    if (prior) {
      if (fingerprint(prior.decision) !== fingerprint(input)) throw new AssuranceError('OUTCOME_REVIEW_REPLAY_CONFLICT', 409);
      return { id, revision: prior.revision };
    }
    const detail = await assemble(client, scope, id, choose(input));
    if (input.expectedRevision !== detail.latestRevision || input.fingerprint !== detail.fingerprint) {
      throw new AssuranceError('OUTCOME_EVIDENCE_OR_REVIEW_CHANGED', 409);
    }
    if (input.outcome.startsWith('reviewed-') && !detail.ready) throw new AssuranceError('OUTCOME_EVIDENCE_INSUFFICIENT', 409);
    const revision = detail.latestRevision + 1;
    if (revision > 50) throw new AssuranceError('OUTCOME_REVIEW_LIMIT', 409);
    const { reviewHistory: _, ...snapshot } = detail;
    await client.query(`INSERT INTO fda_outcome_reviews(tenant_id,source_id,delivery_case_id,revision,request_id,
      evidence_fingerprint,decision,snapshot,actor_role,application_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [...keys, revision, input.requestId, input.fingerprint, input, snapshot, actor.role, actor.sourceRevision]);
    return { id, revision };
  });
}
