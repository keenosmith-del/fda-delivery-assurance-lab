import { z } from 'zod';
import { FDA_GATEWAY, sourceId, tenantId } from './fda-ingestion.ts';

export const ADOPTION_ASSURANCE = `${FDA_GATEWAY}/adoption-assurance`;
export const ADOPTION_OBSERVATIONS = `${ADOPTION_ASSURANCE}/observations`;
export const ADOPTION_VERSION = 'fda-lab.adoption-observation/v1';
export const ADOPTION_CALCULATION = 'delivery-adoption/v1';
export const adoptionCategories = ['low-adoption', 'inconsistent-usage', 'integration', 'permission',
  'workflow', 'training', 'exceptions', 'reliability', 'coverage', 'unverified-outcome'] as const;
const periodId = z.string().regex(/^period-[0-9]{3,8}$/);
const participant = z.string().regex(/^operator-[0-9]{3,8}$/);
const opportunity = z.string().regex(/^opportunity-[0-9]{3,8}$/);
const time = z.iso.datetime();
const note = z.string().trim().min(5).max(1000);
const input = z.strictObject({
  version: z.literal(ADOPTION_VERSION), eventId: z.uuid(), tenantId, sourceId,
  workflowId: z.string().regex(/^workflow-[0-9]{3,8}$/), caseId: z.uuid(), periodId, occurredAt: time,
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/), provenance: z.literal('independent-synthetic-usage'),
});

export const observation = z.discriminatedUnion('kind', [
  input.extend({ kind: z.literal('period'), start: time, end: time, asOf: time,
    expectedUsers: z.number().int().min(0).max(100000).nullable(),
    expectedUnits: z.number().int().min(0).max(100000).nullable() }),
  input.extend({ kind: z.literal('available') }),
  input.extend({ kind: z.literal('member'), participant, eligible: z.boolean() }),
  input.extend({ kind: z.literal('opportunity'), opportunity, participant, eligible: z.boolean() }),
  input.extend({ kind: z.literal('attempt'), opportunity, participant }),
  input.extend({ kind: z.literal('result'), opportunity, result: z.enum(['success', 'failure', 'inconclusive']), operationId: z.uuid().optional() }),
  input.extend({ kind: z.literal('exception'), opportunity, category: z.enum(['permission', 'workflow', 'integration', 'training', 'other']) }),
  input.extend({ kind: z.literal('handoff'), opportunity }),
  input.extend({ kind: z.literal('coverage'), unit: z.string().regex(/^unit-[0-9]{3,8}$/) }),
]).superRefine((event, ctx) => {
  if (event.kind === 'period' && (Date.parse(event.start) >= Date.parse(event.end) ||
      Date.parse(event.asOf) < Date.parse(event.end))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid observation window or assessment time' });
  }
});

const action = z.strictObject({ requestId: z.uuid(), reason: note });
export const adoptionAction = z.discriminatedUnion('kind', [
  action.extend({ kind: z.literal('diagnose'), periodId, category: z.enum(adoptionCategories), hypothesis: note,
    unresolved: note, nextAction: note, responsible: note }),
  action.extend({ kind: z.literal('plan'), diagnosisId: z.uuid(), responsible: note, improvement: note, followUpPeriodId: periodId }),
  action.extend({ kind: z.literal('implement'), interventionId: z.uuid(), implementedAt: time }),
  action.extend({ kind: z.literal('follow-up'), interventionId: z.uuid() }),
  action.extend({ kind: z.literal('review'), interventionId: z.uuid(), interpretation: note }),
  action.extend({ kind: z.literal('close'), interventionId: z.uuid() }),
]);
export type Observation = z.infer<typeof observation>;
export type AdoptionAction = z.infer<typeof adoptionAction>;
export type AdoptionScope = Pick<Observation, 'tenantId' | 'sourceId'>;
