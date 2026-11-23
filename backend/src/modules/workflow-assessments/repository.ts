import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assessmentRevision } from '../../../../shared/contracts/workflow-assessments.ts';
import type { AssessmentDetail, AssessmentRevision, decisionInput } from '../../../../shared/contracts/workflow-assessments.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { SqlClient } from '../../db/pool.ts';
import type { EvidenceActor } from '../../api/evidence.ts';

type ScopeKey = [string, string];
export const scopeKey = (scope: FdaScope): ScopeKey => [scope.tenantId, scope.sourceId];
export type AssessmentRoot = { id: string; workflowId: string; responsibleRole: string };
type DecisionInput = z.infer<typeof decisionInput>;
type Decision = AssessmentDetail['decisions'][number];
type Delivery = AssessmentDetail['deliveryCases'][number];
type Audit = AssessmentDetail['audit'][number];
export const isApproval = (outcome: string) => outcome === 'approve-implementation-planning' || outcome === 'approve-supervised-pilot';

export async function rootForWorkflow(db: SqlClient, scope: FdaScope, workflowId: string) {
  return (await db.query<AssessmentRoot>(`SELECT id, workflow_id AS "workflowId", responsible_role AS "responsibleRole"
    FROM fda_workflow_assessments WHERE tenant_id=$1 AND source_id=$2 AND workflow_id=$3`, [...scopeKey(scope), workflowId])).rows[0];
}

export async function listRoots(db: SqlClient, scope: FdaScope) {
  return (await db.query<AssessmentRoot>(`SELECT id, workflow_id AS "workflowId", responsible_role AS "responsibleRole"
    FROM fda_workflow_assessments WHERE tenant_id=$1 AND source_id=$2 ORDER BY workflow_id`, scopeKey(scope))).rows;
}

export async function revisionHistory(db: SqlClient, scope: FdaScope, id: string) {
  const { rows } = await db.query<{ body: AssessmentRevision }>(`SELECT body FROM fda_workflow_revisions
    WHERE tenant_id=$1 AND source_id=$2 AND assessment_id=$3 ORDER BY revision`, [...scopeKey(scope), id]);
  return rows.map(({ body }) => assessmentRevision.parse(body));
}

export async function decisionHistory(db: SqlClient, scope: FdaScope, id: string) {
  const { rows } = await db.query<Omit<Decision, 'decidedAt'> & { decidedAt: Date; body: DecisionInput }>(`SELECT id, body,
    actor_role AS "actorRole", application_revision AS "applicationRevision", decided_at AS "decidedAt"
    FROM fda_workflow_decisions WHERE tenant_id=$1 AND source_id=$2 AND assessment_id=$3 ORDER BY revision`,
  [...scopeKey(scope), id]);
  return rows.map(({ body, id, actorRole, applicationRevision, decidedAt }) =>
    ({ ...body, id, actorRole, applicationRevision, decidedAt: decidedAt.toISOString() }));
}

export async function deliveryHistory(db: SqlClient, scope: FdaScope, id: string) {
  const { rows } = await db.query<{ body: Omit<Delivery, 'id' | 'createdAt' | 'decisionId' | 'revision'>; id: string; decisionId: string; revision: number; createdAt: Date }>(
    `SELECT id, decision_id AS "decisionId", revision, body, created_at AS "createdAt"
    FROM fda_workflow_delivery_cases WHERE tenant_id=$1 AND source_id=$2 AND assessment_id=$3 ORDER BY revision`,
    [...scopeKey(scope), id]);
  return rows.map(({ body, id, decisionId, revision, createdAt }) => ({ ...body, id, decisionId, revision, createdAt: createdAt.toISOString() }));
}

export async function auditHistory(db: SqlClient, scope: FdaScope, id: string) {
  const { rows } = await db.query<Omit<Audit, 'recordedAt'> & { recordedAt: Date }>(`SELECT action, revision, reason,
    actor_role AS "actorRole", application_revision AS "applicationRevision", recorded_at AS "recordedAt"
    FROM fda_workflow_audit WHERE tenant_id=$1 AND source_id=$2 AND assessment_id=$3 ORDER BY sequence`, [...scopeKey(scope), id]);
  return rows.map(row => ({ ...row, recordedAt: row.recordedAt.toISOString() }));
}

export async function writeAudit(db: SqlClient, scope: FdaScope, id: string, revision: number,
  action: string, reason: string, actor: EvidenceActor) {
  await db.query(`INSERT INTO fda_workflow_audit (tenant_id, source_id, assessment_id, revision, action, reason, actor_role, application_revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [...scopeKey(scope), id, revision, action, reason, actor.role, actor.sourceRevision]);
}

export async function writeRevision(db: SqlClient, scope: FdaScope, id: string, revision: AssessmentRevision) {
  const identity = [...scopeKey(scope), id, revision.revision];
  await db.query(`INSERT INTO fda_workflow_revisions (tenant_id, source_id, assessment_id, revision, body)
    VALUES ($1,$2,$3,$4,$5)`, [...identity, revision]);
  await db.query(`INSERT INTO fda_workflow_revision_receipts (tenant_id, source_id, assessment_id, revision, receipt_id)
    SELECT $1,$2,$3,$4,unnest($5::uuid[])`, [...identity, revision.snapshot.records.map(record => record.receiptId)]);
}

export async function writeDecision(db: SqlClient, scope: FdaScope, id: string, input: DecisionInput, actor: EvidenceActor) {
  await db.query(`INSERT INTO fda_workflow_decisions
    (id, tenant_id, source_id, assessment_id, revision, outcome, body, actor_role, application_revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [randomUUID(), ...scopeKey(scope), id, input.revision, input.outcome, input, actor.role, actor.sourceRevision]);
}

export async function writeDelivery(db: SqlClient, scope: FdaScope, id: string, decision: Decision,
  body: Omit<Delivery, 'id' | 'createdAt' | 'decisionId' | 'revision'>) {
  await db.query(`INSERT INTO fda_workflow_delivery_cases (id, tenant_id, source_id, assessment_id, revision, decision_id, body)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), ...scopeKey(scope), id, decision.revision, decision.id, body]);
}
