import { z } from 'zod';
import { FDA_GATEWAY, tenantId, sourceId } from './fda-ingestion.ts';

export const OUTCOME_ASSURANCE = FDA_GATEWAY + '/outcome-assurance';
export const OUTCOME_MEASUREMENTS = OUTCOME_ASSURANCE + '/measurements';
export const OUTCOME_MEASUREMENT_VERSION = 'fda-lab.outcome-measurement/v1';
export const OUTCOME_RULE = 'fda-lab.outcome-assurance/v1';
export const effortCategories = ['manual', 'processing', 'review', 'exception', 'rework', 'recovery', 'remaining-manual', 'instrumentation'] as const;
const periodId = z.string().regex(/^period-[0-9]{3,8}$/);
const opportunity = z.string().regex(/^opportunity-[0-9]{3,8}$/);
const time = z.iso.datetime();
const note = z.string().trim().min(5).max(1000);
const units = z.enum(['ms', 's']);
const workload = z.enum(['routine', 'exception']);
const boundedCount = z.number().int().min(0).max(100_000);
const seconds = z.number().int().min(0).max(86_400);
const fraction = z.number().int().min(0).max(10_000);
const common = z.strictObject({
  version: z.literal(OUTCOME_MEASUREMENT_VERSION), eventId: z.uuid(), tenantId, sourceId, caseId: z.uuid(),
  workflowId: z.string().regex(/^workflow-[0-9]{3,8}$/), periodId, occurredAt: time,
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  provenance: z.enum(['independent-synthetic-time-study', 'source-reported-aggregate']),
});
export const outcomeObservation = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('period'), stage: z.enum(['baseline', 'comparison']), start: time, end: time, asOf: time,
    method: z.enum(['item-timing', 'structured-observation']), cohort: z.string().regex(/^cohort-[0-9]{3,8}$/),
    expectedItems: z.number().int().min(1).max(1000) }),
  common.extend({ kind: z.literal('effort'), opportunity, workload, participant: z.string().regex(/^operator-[0-9]{3,8}$/).optional(),
    category: z.enum(effortCategories), unit: units, duration: z.number().int().nonnegative().max(86_400_000) }),
  common.extend({ kind: z.literal('model'), volume: boundedCount, recurrencesPerWeek: boundedCount.nullable(),
    eligibleBps: fraction, suitableBps: fraction, manualSeconds: seconds, implementationBps: fraction,
    reviewSeconds: seconds.nullable(), exceptionSeconds: seconds.nullable(), reworkSeconds: seconds.nullable(), limitation: note }),
]).superRefine((value, ctx) => {
  if (value.kind === 'period' && (Date.parse(value.start) >= Date.parse(value.end) || Date.parse(value.asOf) < Date.parse(value.end))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid study interval' });
  }
  if (value.kind === 'effort' && value.unit === 's' && value.duration > 86_400) {
    ctx.addIssue({ code: 'custom', message: 'Duration exceeds the observation limit' });
  }
});
export const outcomeSelection = z.strictObject({
  baseline: periodId, comparison: periodId, method: z.enum(['matched-items', 'normalised-workload']), interventionId: z.uuid().optional(),
});
export const outcomeQuery = z.strictObject({ baseline: periodId.optional(), comparison: periodId.optional(),
  method: outcomeSelection.shape.method.optional(), interventionId: z.uuid().optional(),
}).refine(x => Boolean(x.baseline) === Boolean(x.comparison) && (!x.method && !x.interventionId || Boolean(x.baseline)));
export const reviewOutcomes = ['reviewed-synthetic-comparison', 'reviewed-with-limitations', 'insufficient-evidence',
  'rejected-measurement', 'deferred'] as const;
export const outcomeReview = outcomeSelection.extend({
  requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.enum(reviewOutcomes), justification: note, limitations: note,
});
export type OutcomeObservation = z.infer<typeof outcomeObservation>;
export type OutcomeSelection = z.infer<typeof outcomeSelection>;
export type OutcomeReview = z.infer<typeof outcomeReview>;
