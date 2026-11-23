import { z } from 'zod';
import { workflowAssurance } from './agent-assurance.ts';
import { FDA_GATEWAY, fdaEvent, fdaWorkflowProjection, sourceTimestamp } from './fda-ingestion.ts';

export const WORKFLOW_ASSESSMENTS = `${FDA_GATEWAY}/workflow-assessments`;
export const SUITABILITY_RULES = 'fda-lab.workflow-suitability/v1';
export const workflowKey = z.string().regex(/^workflow-\d{3,8}$/);
const revision = z.number().int().min(1).max(2_147_483_647);
const note = z.string().trim().min(5).max(600);
const role = z.string().trim().regex(/^[a-z][a-z0-9-]{2,39}$/);
const level = z.enum(['low', 'medium', 'high']);
const nonempty = z.array(note).min(1).max(8);
const assumptions = z.array(note).max(8);
export const feasibilityInput = z.strictObject({
  understanding: z.strictObject({
    objective: note, observedSequence: note, trigger: note, inputs: note, outputs: note,
    businessRules: note, humanJudgement: note, exceptions: note, systems: note, assumptions,
  }),
  integration: z.strictObject({
    source: note, destination: note, method: note,
    availability: z.enum(['verified-in-lab', 'assumed', 'requires-discovery', 'unavailable', 'not-applicable']),
    identityRequirement: note, permissions: note, authorization: z.enum(['acknowledged', 'unresolved']),
    contract: note, mapping: note, throughput: note, failureHandling: note, reconciliation: note,
  }),
  execution: z.strictObject({
    model: z.enum(['human-supervised', 'automated']), checkpoints: note, idempotency: note,
    retry: note, successCriteria: note, deduplication: note, exceptions: note, recovery: note, escalation: note, monitoring: note,
  }),
  operations: z.strictObject({
    environment: note, deploymentAssumptions: note, monitoring: note, recoveryOwner: role, support: note,
    retention: note, securityBoundary: note, rollback: note,
    clientApproval: z.enum(['required', 'not-required']), credentialAvailability: z.enum(['verified-in-lab', 'unverified', 'not-applicable']),
  }),
  alternatives: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('considered'), option: note, tradeoff: note }),
    z.strictObject({ kind: z.literal('none-viable'), explanation: note }),
  ]),
  dependencies: z.array(z.strictObject({
    requirement: note, owner: role, mandatory: z.boolean(), status: z.enum(['verified-in-lab', 'unresolved']), basis: note,
  })).max(12),
  suitability: z.strictObject({
    determinism: level, humanJudgement: level, integrationComplexity: level, dataSensitivity: level, failureImpact: level,
    recoverability: level, expectedValue: level, implementationComplexity: level, maintenance: level,
    basis: note,
  }),
  phases: nonempty,
});
export const riskInput = z.strictObject({
  category: z.enum(['security', 'privacy', 'reliability', 'compliance', 'operational', 'data-integrity']),
  description: note, likelihood: level, impact: level, basis: note, mitigation: note, owner: role,
  residual: level, review: z.enum(['reviewed', 'unresolved']),
});
export const decisionOutcome = z.enum(['approve-implementation-planning', 'approve-supervised-pilot', 'reject', 'defer']);
const pilot = z.strictObject({ operatingLimits: note, humanReview: note, stopCriteria: note });
export const decisionInput = z.strictObject({
  revision, outcome: decisionOutcome, justification: note, conditions: assumptions, pilot: pilot.optional(),
}).refine(d => (d.outcome === 'approve-supervised-pilot') === Boolean(d.pilot), { path: ['pilot'] });
export const revisionInput = z.strictObject({ revision });
export const assessmentAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('reassess'), revision, reason: note }),
  z.strictObject({ action: z.literal('feasibility'), revision, feasibility: feasibilityInput }),
  z.strictObject({ action: z.literal('risks'), revision, risks: z.array(riskInput).max(12), rationale: note }),
  z.strictObject({ action: z.literal('submit'), revision, reason: note }),
]);

export const evidenceSnapshot = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), evidence: fdaWorkflowProjection.element,
  readiness: workflowAssurance.element, records: z.array(z.object({
    canonicalId: z.uuid(), receiptId: z.uuid(), event: fdaEvent,
  })),
});
export const suitabilityResult = z.object({
  ruleVersion: z.literal(SUITABILITY_RULES), recommendation: z.enum(['further-review', 'supervised-pilot', 'planning']),
  factors: z.array(z.object({ label: z.string(), value: z.string(), reviewRequired: z.boolean() })),
  observations: z.number().int().nonnegative(), exceptions: z.number().int().nonnegative(),
});
const stages = z.enum(['evidence-review', 'feasibility-review', 'decision-pending', 'decided']);
export const assessmentRevision = z.object({
  revision, stage: stages, snapshot: evidenceSnapshot, feasibility: feasibilityInput.nullable(),
  risks: z.array(riskInput), riskRationale: note.nullable(), suitability: suitabilityResult.nullable(),
});
const decision = z.object({
  id: z.uuid(), revision, outcome: decisionOutcome, justification: note, conditions: assumptions, pilot: pilot.optional(),
  actorRole: z.string(), decidedAt: sourceTimestamp, applicationRevision: z.string().nullable(),
});
const delivery = z.object({
  id: z.uuid(), revision, decisionId: z.uuid(), createdAt: sourceTimestamp,
  readiness: z.enum(['draft', 'ready-for-technical-implementation', 'blocked-by-prerequisites', 'superseded', 'cancelled']),
  recordedReadiness: z.string().optional(),
  prerequisites: z.array(z.object({ requirement: z.string(), status: z.enum(['verified-in-lab', 'unverified']), basis: z.string() })),
  plan: feasibilityInput, risks: z.array(riskInput), conditions: assumptions, pilot: pilot.optional(),
});
export const assessmentDetail = z.object({
  id: z.uuid(), workflowId: workflowKey, tenantId: z.string(), sourceId: z.string(), responsibleRole: z.string(),
  currentEvidence: evidenceSnapshot.nullable(), stale: z.boolean(), current: assessmentRevision,
  revisions: z.array(assessmentRevision), decisions: z.array(decision), deliveryCases: z.array(delivery),
  audit: z.array(z.object({
    action: z.string(), revision, reason: z.string(), recordedAt: sourceTimestamp, actorRole: z.string(),
    applicationRevision: z.string().nullable(),
  })),
  approvalBlockers: z.array(z.string()),
});
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshot>;
export type AssessmentRevision = z.infer<typeof assessmentRevision>;
export type FeasibilityInput = z.infer<typeof feasibilityInput>;
export type AssessmentDetail = z.infer<typeof assessmentDetail>;
