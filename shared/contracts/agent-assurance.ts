import { z } from 'zod';
import { fdaPayloads, fdaRecordLink, sourceTimestamp } from './fda-ingestion.ts';

export const ASSURANCE_RULES = 'fda-lab.agent-assurance/v1';
export const incidentCategory = z.enum([
  'reporting-interruption', 'stale-observations', 'missing-coverage', 'capture-permissions', 'version-readiness', 'delivery-backlog',
]);
export const incidentState = z.enum(['open', 'investigating', 'intervention_planned', 'awaiting_verification', 'resolved']);
export const recoveryOutcome = z.enum(['verified-recovered', 'partially-verified', 'not-recovered', 'insufficient-evidence']);
export const endpointKey = z.string().regex(/^endpoint-\d{3,8}$/);
const windowKey = z.string().regex(/^window-\d{3,8}$/);
export const assessmentQuery = z.strictObject({ windowId: windowKey.optional(), asOf: sourceTimestamp.optional() });
const refs = z.array(z.uuid()).min(1).max(20).refine(ids => ids.length === new Set(ids).size);
const note = z.string().trim().min(5).max(500);
export const openIncidentInput = z.strictObject({ ...assessmentQuery.shape, endpointId: endpointKey, category: incidentCategory });
export const incidentCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('diagnose'), category: incidentCategory, hypothesis: note, evidence: refs,
    certainty: z.enum(['tentative', 'supported', 'inconclusive']), unknowns: note, nextAction: note }),
  z.strictObject({ action: z.literal('plan'), intervention: z.enum(['review-permissions', 'restore-reporting', 'review-version',
    'investigate-delivery', 'request-observations', 'validate-configuration', 'investigate-missing-events']),
    reason: note, owner: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/), target: z.iso.date() }),
  z.strictObject({ action: z.literal('implement'), note }),
  z.strictObject({ action: z.literal('verify'), ...assessmentQuery.shape }),
]);
export type IncidentCommand = z.infer<typeof incidentCommand>;

export const assuranceEvidence = fdaRecordLink.extend({ receivedAt: sourceTimestamp });
export const incidentCondition = z.object({
  category: incidentCategory, severity: z.enum(['blocking', 'degraded']), reason: z.string(),
  since: sourceTimestamp, evidence: z.array(assuranceEvidence),
});

export const assuranceDevice = z.object({
  endpointId: endpointKey, lifecycle: z.enum(['registered', 'enrolled', 'awaiting-readiness', 'active', 'retired', 'not-reported']),
  connectivity: z.enum(['reporting', 'not-reporting', 'disconnected', 'interrupted', 'recovered', 'unknown']),
  readiness: z.enum(['ready', 'degraded', 'not-ready', 'insufficient-evidence', 'retired']),
  factors: z.array(z.string()), registration: fdaPayloads['endpoint.registration'].nullable(),
  lastHeartbeat: sourceTimestamp.nullable(), lastObservation: sourceTimestamp.nullable(),
  freshness: z.enum(['fresh', 'stale', 'unknown']), capture: fdaPayloads['endpoint.status'].shape.capture,
  permissions: z.array(fdaPayloads['endpoint.permission']),
  permissionHistory: z.array(z.object({ value: fdaPayloads['endpoint.permission'], evidence: assuranceEvidence })),
  versionHistory: z.array(z.object({ version: z.string(), evidence: assuranceEvidence })),
  updateState: z.enum(['version-transition', 'unknown']),
  queueCount: z.number().int().nonnegative().nullable(), versionPolicy: z.enum(['supported', 'mismatch', 'unknown']),
  observations: z.array(z.object({
    observedAt: sourceTimestamp, observationToReceiptSeconds: z.number().nonnegative().nullable(),
    occurrenceToReceiptSeconds: z.number().nonnegative().nullable(), arrivedAfterWindow: z.boolean(),
    reportedAfterWindow: z.boolean(), evidence: assuranceEvidence,
  })),
  missingIntervals: z.array(z.object({ start: sourceTimestamp, end: sourceTimestamp })),
  evidenceComplete: z.boolean(), conditions: z.array(incidentCondition), timeline: z.array(assuranceEvidence),
});

export const assuranceAssessment = z.object({
  ruleVersion: z.literal(ASSURANCE_RULES), asOf: sourceTimestamp.nullable(), window: fdaPayloads['observation.window'].nullable(),
  windows: z.array(fdaPayloads['observation.window']), devices: z.array(assuranceDevice), lastReceipt: sourceTimestamp.nullable(),
  counts: z.object({ eligible: z.number(), registered: z.number(), reporting: z.number(), observed: z.number(),
    permissionGranted: z.number(), complete: z.number(), degraded: z.number(), delayed: z.number() }),
  completeness: z.enum(['complete', 'incomplete', 'unknown']), disagreements: z.array(z.string()),
});
export type AssuranceDevice = z.infer<typeof assuranceDevice>;
export type AssuranceAssessment = z.infer<typeof assuranceAssessment>;

export const incidentSummary = z.object({
  id: z.uuid(), endpointId: endpointKey, windowId: windowKey, category: incidentCategory,
  state: incidentState, detectedAt: sourceTimestamp, resolvedAt: sourceTimestamp.nullable(),
});
export const decisionAudit = z.object({
  action: z.string(), before: incidentState.nullable(), after: incidentState,
  at: sourceTimestamp, actor: z.string(), revision: z.string().nullable(), detail: z.record(z.string(), z.unknown()),
});
export const incidentDetail = incidentSummary.extend({
  initial: z.object({ condition: incidentCondition, assessment: z.object({ start: sourceTimestamp, end: sourceTimestamp, asOf: sourceTimestamp }),
    endpoint: assuranceDevice, ruleVersion: z.literal(ASSURANCE_RULES) }),
  audit: z.array(decisionAudit),
  current: assuranceDevice.nullable(),
  workflows: z.array(z.string()),
});
export const WORKFLOW_READINESS_RULES = 'fda-lab.workflow-readiness/v2';

export const workflowAssurance = z.array(z.object({
  ruleVersion: z.literal(WORKFLOW_READINESS_RULES),
  workflowId: z.string(), readiness: z.enum(['ready-for-review', 'additional-evidence-required', 'blocked-by-operations', 'unknown']),
  windows: z.array(z.object({
    windowId: windowKey, affectedEndpoints: z.array(endpointKey), gaps: z.array(z.string()),
    blockers: z.array(z.object({ endpointId: endpointKey, category: incidentCategory, reason: z.string() })),
    incidents: z.array(incidentSummary), missingIntervals: z.array(z.object({ endpointId: endpointKey, start: sourceTimestamp, end: sourceTimestamp })),
  })),
}));
export type IncidentSummary = z.infer<typeof incidentSummary>;
