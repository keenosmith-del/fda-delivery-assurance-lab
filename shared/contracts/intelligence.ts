import { z } from 'zod';

const score = z.number().int().min(0).max(100);
const labels = z.array(z.string());
const instant = z.iso.datetime();
export const entityId = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
export const reviewInput = z.strictObject({
  classification: z.enum(['approve', 'reject']),
  suitability: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(5).max(500),
});
export const actorRole = z.enum(['operator', 'demo', 'local-token', 'local-open']);
export const revisionId = z.string().regex(/^[0-9a-f]{40}$/);
export const review = reviewInput.extend({ id: z.string(), reviewedAt: instant,
  actorRole: actorRole.nullable(), sourceRevision: revisionId.nullable(),
});
export const assessment = z.object({
  score, factors: z.array(z.object({ name: z.string(), score, weight: z.number() })),
});
export const suitabilityInputs = z.strictObject({
  determinism: score, judgment: score, permissions: score, integration: score,
  sensitivity: score, risk: score, complexity: score, value: score,
});
export const taskSummary = z.object({
  id: entityId, label: z.string(), category: z.string(), evidenceCount: z.number().int().nonnegative(),
  classification: assessment, suitability: assessment, recommendation: z.string(),
});
export const taskDetail = taskSummary.extend({
  expectedSequence: labels,
  scoring: z.object({
    version: z.string(), method: z.string(), limitations: labels,
    suitabilityInputs,
    observationWindow: z.object({ id: entityId, start: instant, end: instant }).nullable(),
  }),
  evidence: z.array(z.object({
    id: entityId, deviceId: entityId, observedAt: instant, sequence: labels,
    durationSeconds: z.number(), exception: z.boolean(),
  })),
  evidenceGaps: labels,
  reviews: z.array(review),
});
const interval = z.object({ start: instant, end: instant });
export const deviceHealth = z.object({
  id: entityId, label: z.string(), team: z.string(), enrolledAt: instant,
  reporting: z.boolean(), permission: z.enum(['granted', 'limited', 'unknown']),
  freshness: z.enum(['fresh', 'stale', 'unobserved']),
  lastHeartbeat: instant.nullable(), lastObservation: instant.nullable(),
  missingIntervals: z.array(interval),
});
export const coverage = z.object({ window: interval.nullable(), reporting: z.number(), devices: z.array(deviceHealth) });
export const deviceDetail = deviceHealth.extend({
  history: z.array(z.object({
    kind: z.enum(['heartbeat', 'observation', 'permission']), at: instant, permissionOk: z.boolean().nullable(),
  })),
});
export const comparison = z.object({
  unsafe: z.object({ records: z.number(), steps: labels }),
  safe: z.object({ records: z.number(), operationId: z.uuid(), recordId: z.uuid(), events: labels, steps: labels }),
});
export type ReviewInput = z.infer<typeof reviewInput>;
export type SuitabilityInputs = z.infer<typeof suitabilityInputs>;
export type TaskSummary = z.infer<typeof taskSummary>;
export type TaskDetail = z.infer<typeof taskDetail>;
export type DeviceHealth = z.infer<typeof deviceHealth>;
export type DeviceDetail = z.infer<typeof deviceDetail>;
