import { z } from 'zod';

export const operationId = z.uuid({ version: 'v4' });
export const submission = z.strictObject({
  candidateCode: z.string().trim().toUpperCase().regex(/^CAND-\d{4,10}$/),
  requisition: z.enum(['engineering', 'operations', 'client-success']),
});
export const scenarios = z.enum(['normal', 'repeat-click', 'replay', 'conflict', 'concurrent', 'before-commit', 'lost-ack']);
export const fault = z.enum(['before-commit', 'lost-ack']);

export const operation = z.strictObject({
  id: operationId,
  state: z.enum(['pending_confirmation', 'confirmed', 'confirmation_failed']),
  recordId: operationId,
  duplicate: z.boolean(),
  confirmationAttempts: z.number().int().nonnegative(),
  events: z.array(z.strictObject({
    kind: z.enum(['accepted', 'duplicate_linked', 'replayed', 'payload_conflict', 'confirmed', 'confirmation_retry', 'confirmation_failed', 'lease_expired']),
    at: z.iso.datetime(),
  })),
});

export type Submission = z.infer<typeof submission>;
export type Operation = z.infer<typeof operation>;
export type Scenario = z.infer<typeof scenarios>;
