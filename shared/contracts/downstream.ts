import { z } from 'zod';
import { FDA_GATEWAY, sourceId, tenantId } from './fda-ingestion.ts';
import { workflowKey } from './workflow-assessments.ts';

export const DOWNSTREAM_API = `${FDA_GATEWAY}/downstream`;
export const SIMULATOR_API = '/synthetic-downstream/v1/effects';
export const EFFECT_VERSION = 'fda-lab.synthetic-effect/v1';
export const effectKey = z.string().regex(/^[0-9a-f]{64}$/);
export const syntheticEffect = z.strictObject({
  version: z.literal(EFFECT_VERSION),
  tenantId, sourceId, workflowId: workflowKey, deliveryCaseId: z.uuid(),
  category: z.enum(['support-escalation', 'record-sync', 'document-approval', 'periodic-reporting', 'task-assignment']),
});
export const simulatorWrite = z.strictObject({ key: effectKey, operationId: z.uuid(), effect: syntheticEffect });
export const simulatorRecord = simulatorWrite.extend({
  effectId: z.uuid(), fingerprint: effectKey, committedAt: z.iso.datetime(),
});
export const startExecution = z.strictObject({
  requestKey: z.uuid(),
  reason: z.string().trim().min(12).max(500),
  syntheticOnly: z.literal(true),
  supervisionConfirmed: z.boolean().default(false),
});
export const operationAction = z.strictObject({
  action: z.enum(['reconcile', 'redrive', 'cancel']),
  reason: z.string().trim().min(12).max(500),
});
export type SyntheticEffect = z.infer<typeof syntheticEffect>;
export type SimulatorWrite = z.infer<typeof simulatorWrite>;
export type SimulatorRecord = z.infer<typeof simulatorRecord>;
export type StartExecution = z.infer<typeof startExecution>;
export type OperationAction = z.infer<typeof operationAction>;
