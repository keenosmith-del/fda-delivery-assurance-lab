import { z } from 'zod';
import { entityId } from './intelligence.ts';

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();
const note = z.string().trim().min(10).max(500);
const uuid = z.uuid({ version: 'v4' });

export const barrier = z.enum(['low-adoption', 'inconsistent-usage', 'integration', 'permission', 'workflow', 'training', 'exceptions', 'reliability']);
export const diagnosisInput = z.strictObject({ periodId: entityId, category: barrier, hypothesis: note });
export const interventionInput = z.strictObject({
  findingId: uuid, action: note, owner: z.string().trim().min(2).max(80), followUpOn: z.iso.date(),
});
export const implementationInput = z.strictObject({ implementedOn: z.iso.date() });
export const followUpInput = z.strictObject({ periodId: entityId, notes: note });

export const automation = z.object({ id: entityId, name: z.string(), workflow: z.string(), taskId: entityId });
export const automationList = z.array(automation);
export const period = z.object({
  id: entityId, label: z.string(), startsOn: z.iso.date(), endsOn: z.iso.date(), source: z.string(),
  expected: count, observed: count, eligibleOpportunities: count, eligibleUsers: count, population: count,
  adoptedUsers: count, attempted: count, succeeded: count, failed: count, exceptions: count, adoption: rate,
  opportunityUsage: rate, reliability: rate, coverage: rate,
  reworkSeconds: count, reviewSeconds: count, exceptionReasons: z.array(z.string()),
  baselineSecondsPerItem: count, modeledEligibilityBps: count,
});
export const diagnostic = z.object({
  periodId: entityId, category: barrier, observation: z.string(), possibleExplanation: z.string(),
});
export const finding = diagnosisInput.extend({ id: uuid, evidence: z.string() });
export const intervention = interventionInput.extend({ id: uuid, implementedOn: z.iso.date().nullable(), implementedAt: z.iso.datetime().nullable() });
export const followUp = followUpInput.extend({ id: uuid, interventionId: uuid });
export const adoptionDetail = automation.extend({
  periods: z.array(period),
  population: z.array(z.object({ periodId: entityId, operatorId: entityId, eligible: z.boolean(), attempted: count })),
  diagnostics: z.array(diagnostic),
  findings: z.array(finding),
  interventions: z.array(intervention),
  followUps: z.array(followUp),
  audit: z.array(z.object({ event: z.string(), subjectId: uuid, occurredAt: z.iso.datetime() })),
});

export const outcomeMeasurement = z.object({
  measuredItems: count, humanHandlingSeconds: count, method: z.string(), source: z.string(), reviewed: z.boolean(),
});
export const outcome = z.object({
  automation, baseline: period, comparison: period,
  modeledWeeklyOccurrences: z.number(), adoptionAdjustedOpportunity: z.number().nullable(),
  grossEstimatedSeconds: count, reworkSeconds: count, humanReviewSeconds: count, netEstimatedSeconds: z.number().int(),
  baselineMeasurement: outcomeMeasurement.nullable(), comparisonMeasurement: outcomeMeasurement.nullable(),
  verifiedSeconds: z.number().int().nullable(), verificationLimits: z.array(z.string()),
});
export const opportunityModel = z.object({
  terms: z.array(z.object({ automation: z.string(), baselineVolume: count, modeledEligibilityBps: count, modeledOccurrences: z.number() })),
  totalModeledWeeklyOccurrences: z.number(),
});

export type MeasurementPeriod = z.infer<typeof period>;
export type OutcomeMeasurement = z.infer<typeof outcomeMeasurement>;
export type DiagnosisInput = z.infer<typeof diagnosisInput>;
export type InterventionInput = z.infer<typeof interventionInput>;
export type FollowUpInput = z.infer<typeof followUpInput>;
export type Diagnostic = z.infer<typeof diagnostic>;
