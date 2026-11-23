import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { assessmentDetail } from '../../../../shared/contracts/workflow-assessments.ts';
import type { assessmentAction, AssessmentRevision, decisionInput, EvidenceSnapshot } from '../../../../shared/contracts/workflow-assessments.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { transaction } from '../../db/pool.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { lockFdaEvidence } from '../fda-ingestion/scope-lock.ts';
import { approvalBlockers, fingerprint, snapshotWorkflow, suitability } from './evidence.ts';
import { auditHistory, decisionHistory, deliveryHistory, isApproval, revisionHistory, rootForWorkflow, scopeKey,
  writeAudit, writeDecision, writeDelivery, writeRevision } from './repository.ts';
import type { AssessmentRoot } from './repository.ts';

export class WorkflowAssessmentError extends Error {
  readonly status: number;
  readonly blockers: string[];
  constructor(message: string, status: number, blockers: string[] = []) {
    super(message);
    this.status = status;
    this.blockers = blockers;
  }
}

type WorkflowAction = z.infer<typeof assessmentAction>;
type DecisionInput = z.infer<typeof decisionInput>;

function evidenceReview(snapshot: EvidenceSnapshot, revision: number): AssessmentRevision {
  return { revision, stage: 'evidence-review', snapshot, feasibility: null, risks: [], riskRationale: null, suitability: null };
}

function requireEvidence(snapshot: EvidenceSnapshot | null) {
  if (!snapshot) throw new WorkflowAssessmentError('WORKFLOW_CANDIDATE_NOT_FOUND', 404);
  if (snapshot.records.every(row => row.event.recordType !== 'workflow.candidate')) {
    throw new WorkflowAssessmentError('CANONICAL_CANDIDATE_UNAVAILABLE', 422);
  }
  return snapshot;
}

async function assemble(client: SqlClient, scope: FdaScope, root: AssessmentRoot, currentEvidence: EvidenceSnapshot | null) {
  const revisions = await revisionHistory(client, scope, root.id);
  const decisions = await decisionHistory(client, scope, root.id);
  const deliveryCases = await deliveryHistory(client, scope, root.id);
  const audit = await auditHistory(client, scope, root.id);
  const last = revisions.at(-1)!;
  const current = { ...last, stage: decisions.some(d => d.revision === last.revision) ? 'decided' : last.stage };
  const stale = currentEvidence?.fingerprint !== current.snapshot.fingerprint;
  return assessmentDetail.parse({ ...root, ...scope, current, stale, currentEvidence, revisions, decisions, audit,
    deliveryCases: deliveryCases.map(item => ({
      ...item, recordedReadiness: item.readiness,
      readiness: item.revision < current.revision ? 'superseded' : stale ? 'blocked-by-prerequisites' : item.readiness,
    })),
    approvalBlockers: [...(stale ? ['The supporting source evidence has changed. Reassess the candidate.'] : []), ...approvalBlockers(current)],
  });
}

export function getAssessment(db: Database, scope: FdaScope, workflowId: string) {
  return transaction(db, async client => {
    const root = await rootForWorkflow(client, scope, workflowId);
    return root ? assemble(client, scope, root, await snapshotWorkflow(client, scope, workflowId)) : null;
  }, true);
}

export function openAssessment(db: Database, scope: FdaScope, workflowId: string, actor: EvidenceActor) {
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const snapshot = requireEvidence(await snapshotWorkflow(client, scope, workflowId));
    const existing = await rootForWorkflow(client, scope, workflowId);
    if (existing) return assemble(client, scope, existing, snapshot);
    const root = { id: randomUUID(), workflowId, responsibleRole: 'operator' };
    await client.query(`INSERT INTO fda_workflow_assessments (id, tenant_id, source_id, workflow_id, responsible_role)
      VALUES ($1,$2,$3,$4,$5)`, [root.id, ...scopeKey(scope), workflowId, root.responsibleRole]);
    await writeRevision(client, scope, root.id, evidenceReview(snapshot, 1));
    await writeAudit(client, scope, root.id, 1, 'opened', 'Opened engineering assessment of imported source evidence.', actor);
    return assemble(client, scope, root, snapshot);
  });
}

async function mutate(db: Database, scope: FdaScope, workflowId: string, expected: number,
  action: (client: SqlClient, root: AssessmentRoot, current: Awaited<ReturnType<typeof assemble>>, snapshot: EvidenceSnapshot) => Promise<void>) {
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const root = await rootForWorkflow(client, scope, workflowId);
    if (!root) throw new WorkflowAssessmentError('WORKFLOW_ASSESSMENT_NOT_FOUND', 404);
    const snapshot = requireEvidence(await snapshotWorkflow(client, scope, workflowId));
    const current = await assemble(client, scope, root, snapshot);
    if (current.current.revision !== expected) throw new WorkflowAssessmentError('ASSESSMENT_REVISION_CONFLICT', 409);
    await action(client, root, current, snapshot);
    return assemble(client, scope, root, snapshot);
  });
}

function requireCurrent(stale: boolean) {
  if (stale) throw new WorkflowAssessmentError('WORKFLOW_EVIDENCE_CHANGED', 409);
}

export function reviewAssessment(db: Database, scope: FdaScope, id: string, input: WorkflowAction, actor: EvidenceActor) {
  return mutate(db, scope, id, input.revision, async (client, root, detail, snapshot) => {
    const current = detail.current;
    const revision = current.revision + 1;
    let next: AssessmentRevision;
    let reason: string;
    if (input.action === 'reassess') {
      next = evidenceReview(snapshot, revision);
      reason = input.reason;
    } else {
      requireCurrent(detail.stale);
      const editable = ['evidence-review', 'feasibility-review'].includes(current.stage);
      if (!editable || (input.action === 'risks' && !current.feasibility)) {
        throw new WorkflowAssessmentError('INVALID_ASSESSMENT_STAGE', 409);
      }
      switch (input.action) {
        case 'feasibility':
          next = { ...current, revision, stage: 'feasibility-review', feasibility: input.feasibility,
            suitability: suitability(current.snapshot, input.feasibility), risks: [], riskRationale: null };
          reason = 'Recorded technical feasibility and recalculated suitability.';
          break;
        case 'risks':
          next = { ...current, revision, risks: input.risks, riskRationale: input.rationale };
          reason = input.rationale;
          break;
        case 'submit':
          next = { ...current, revision, stage: 'decision-pending' };
          reason = input.reason;
          break;
      }
    }
    await writeRevision(client, scope, root.id, next);
    await writeAudit(client, scope, root.id, next.revision, input.action === 'reassess' ? 'superseded' : input.action, reason, actor);
  });
}

export function makeDecision(db: Database, scope: FdaScope, id: string, input: DecisionInput, actor: EvidenceActor) {
  return mutate(db, scope, id, input.revision, async (client, root, detail) => {
    const existing = detail.decisions.find(item => item.revision === input.revision);
    if (existing) {
      const { revision, outcome, justification, conditions, pilot } = existing;
      if (fingerprint({ revision, outcome, justification, conditions, pilot }) === fingerprint(input)) return;
      throw new WorkflowAssessmentError('DECISION_ALREADY_RECORDED', 409);
    }
    requireCurrent(detail.stale);
    if (detail.current.stage !== 'decision-pending') throw new WorkflowAssessmentError('INVALID_ASSESSMENT_STAGE', 409);
    if (isApproval(input.outcome)) {
      const reasons = approvalBlockers(detail.current);
      const model = detail.current.feasibility?.execution.model;
      if (input.outcome === 'approve-supervised-pilot' && model !== 'human-supervised') {
        reasons.push('Select a human-supervised execution model for the pilot.');
      }
      if (input.outcome === 'approve-implementation-planning' && detail.current.suitability?.recommendation === 'supervised-pilot') {
        reasons.push('The suitability review requires a supervised pilot.');
      }
      if (reasons.length) throw new WorkflowAssessmentError('WORKFLOW_APPROVAL_BLOCKED', 422, reasons);
    }
    await writeDecision(client, scope, root.id, input, actor);
    await writeAudit(client, scope, root.id, input.revision, input.outcome, input.justification, actor);
  });
}

export function createDeliveryCase(db: Database, scope: FdaScope, id: string, revision: number, actor: EvidenceActor) {
  return mutate(db, scope, id, revision, async (client, root, detail) => {
    requireCurrent(detail.stale);
    if (detail.deliveryCases.some(item => item.revision === revision)) return;
    const decision = detail.decisions.find(item => item.revision === revision && isApproval(item.outcome));
    const plan = detail.current.feasibility;
    if (!decision || !plan) throw new WorkflowAssessmentError('WORKFLOW_APPROVAL_REQUIRED', 422);
    const prerequisites = [
      ...plan.dependencies.map(item => ({ requirement: item.requirement, basis: item.basis,
        status: item.status === 'verified-in-lab' ? 'verified-in-lab' as const : 'unverified' as const })),
      ...(plan.operations.clientApproval === 'required' ? [{
        requirement: 'External client authorisation', status: 'unverified' as const, basis: 'Engineering approval does not establish external authorisation.',
      }] : []),
      ...(plan.operations.credentialAvailability === 'unverified' ? [{
        requirement: 'Required access or service identity', status: 'unverified' as const, basis: 'Access was not independently verified in the lab.',
      }] : []),
      ...decision.conditions.map(requirement => ({ requirement, status: 'unverified' as const, basis: 'Required condition of the engineering decision.' })),
    ];
    await writeDelivery(client, scope, root.id, decision, {
      plan, risks: detail.current.risks, conditions: decision.conditions, pilot: decision.pilot,
      readiness: prerequisites.some(item => item.status === 'unverified') ? 'blocked-by-prerequisites' : 'ready-for-technical-implementation',
      prerequisites,
    });
    await writeAudit(client, scope, root.id, revision, 'delivery-case-created', 'Created a planning case linked to the approved assessment revision.', actor);
  });
}
