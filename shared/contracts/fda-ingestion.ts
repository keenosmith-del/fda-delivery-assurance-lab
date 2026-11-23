import { z } from 'zod';

export const FDA_CONTRACT = 'fda-lab.ingestion/v1';
export const FDA_MAX_BODY = 8_192;
export const FDA_GATEWAY = '/api/integrations/fda/v1';
export const FDA_EVENTS = `${FDA_GATEWAY}/events`;

export const tenantId = z.string().regex(/^tenant-\d{3,8}$/);
export const sourceId = z.string().regex(/^source-\d{3,8}$/);
const endpointId = z.string().regex(/^endpoint-\d{3,8}$/);
const windowId = z.string().regex(/^window-\d{3,8}$/);
const workflowId = z.string().regex(/^workflow-\d{3,8}$/);
const observationId = z.string().regex(/^observation-\d{3,8}$/);
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const count = z.number().int().min(0).max(1_000_000);
const version = z.string().max(32).regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}([+-][a-z0-9.-]{1,12})?$/i);
const distinct = <T extends z.ZodType<string>>(identifier: T, max: number) =>
  z.array(identifier).max(max).refine(ids => ids.length === new Set(ids).size);

const activity = z.enum(['receive', 'validate', 'classify', 'assign', 'review', 'approve', 'transfer', 'confirm', 'report']);
export const fdaPayloads = {
  'endpoint.registration': z.strictObject({
    endpointId, enrollment: z.enum(['enrolled', 'retired']), os: z.enum(['macos', 'windows', 'linux', 'unknown']),
    agentVersion: version, enrolledAt: timestamp, retiredAt: timestamp.optional(),
  }).refine(p => p.enrollment === 'enrolled' ? p.retiredAt === undefined : !!p.retiredAt && p.retiredAt >= p.enrolledAt),
  'endpoint.status': z.strictObject({
    endpointId, heartbeatAt: timestamp.nullable(), connection: z.enum(['online', 'offline', 'unknown']),
    lastObservationAt: timestamp.nullable(), queueCount: count.optional(),
    capture: z.enum(['available', 'limited', 'unavailable', 'unknown']),
    diagnostics: distinct(z.enum(['permission-limited', 'reporting-interrupted', 'version-updated', 'recovered']), 4),
    agentVersion: version.optional(),
  }),
  'endpoint.permission': z.strictObject({
    endpointId, category: z.enum(['screen', 'accessibility', 'activity']),
    status: z.enum(['granted', 'limited', 'denied', 'unknown']), reportedAt: timestamp,
    consentReference: z.enum(['reported', 'absent', 'unknown']),
  }),
  'observation.window': z.strictObject({
    windowId, start: timestamp, end: timestamp, eligibleEndpoints: distinct(endpointId, 100).refine(ids => ids.length > 0),
    observedEndpoints: distinct(endpointId, 100), reportingCount: count, completeness: z.enum(['complete', 'partial', 'unknown']),
  }).refine(p => p.start < p.end && Date.parse(p.end) - Date.parse(p.start) <= 31 * 86_400_000 &&
    p.reportingCount <= p.eligibleEndpoints.length && p.observedEndpoints.every(id => p.eligibleEndpoints.includes(id)) &&
    (p.completeness !== 'complete' || p.observedEndpoints.length === p.eligibleEndpoints.length)),
  'workflow.observation': z.strictObject({
    observationId, workflowId, endpointId, windowId, observedAt: timestamp, sequence: z.array(activity).min(1).max(16),
    durationSeconds: z.number().int().min(1).max(86_400), exception: z.boolean(),
  }),
  'workflow.candidate': z.strictObject({
    workflowId, windowIds: distinct(windowId, 8).refine(ids => ids.length > 0), observationIds: distinct(observationId, 100),
    category: z.enum(['support-escalation', 'record-sync', 'document-approval', 'periodic-reporting', 'task-assignment']),
    frequency: count, unit: z.enum(['per-day', 'per-week', 'per-window']),
    recommendation: z.enum(['investigate', 'consider-supervised-pilot', 'collect-evidence']),
  }),
  'automation.measurement': z.strictObject({
    automationId: z.string().regex(/^automation-\d{3,8}$/), workflowId, windowId,
    state: z.enum(['proposed', 'implemented', 'deployed', 'paused']),
    eligible: count, attempted: count, successes: count, failures: count, exceptions: count,
  }).refine(p => p.successes + p.failures <= p.attempted && p.attempted <= p.eligible && p.exceptions <= p.attempted),
} as const;

const envelope = {
  schemaVersion: z.literal(FDA_CONTRACT), tenantId, sourceId,
  sourceRecordId: z.string().regex(/^record-\d{3,12}$/),
  occurredAt: timestamp, sourceRevision: z.string().regex(/^rev-\d{1,12}$/).optional(),
  correlationId: z.string().regex(/^batch-\d{3,8}$/).optional(),
};

export const fdaEvent = z.discriminatedUnion('recordType', [
  z.strictObject({ ...envelope, recordType: z.literal('endpoint.registration'), payload: fdaPayloads['endpoint.registration'] }),
  z.strictObject({ ...envelope, recordType: z.literal('endpoint.status'), payload: fdaPayloads['endpoint.status'] }),
  z.strictObject({ ...envelope, recordType: z.literal('endpoint.permission'), payload: fdaPayloads['endpoint.permission'] }),
  z.strictObject({ ...envelope, recordType: z.literal('observation.window'), payload: fdaPayloads['observation.window'] }),
  z.strictObject({ ...envelope, recordType: z.literal('workflow.observation'), payload: fdaPayloads['workflow.observation'] }),
  z.strictObject({ ...envelope, recordType: z.literal('workflow.candidate'), payload: fdaPayloads['workflow.candidate'] }),
  z.strictObject({ ...envelope, recordType: z.literal('automation.measurement'), payload: fdaPayloads['automation.measurement'] }),
]);

export type FdaEvent = z.infer<typeof fdaEvent>;
export type FdaScope = Pick<FdaEvent, 'tenantId' | 'sourceId'>;
export const fdaRecordType = z.enum(Object.keys(fdaPayloads) as FdaEvent['recordType'][]);

export const receiptStatus = z.enum(['received', 'processing', 'processed', 'duplicate', 'rejected', 'conflict', 'processing_failed']);
export const fdaReceipt = z.object({
  id: z.uuid(), tenantId, sourceId, sourceRecordId: envelope.sourceRecordId.nullable(),
  recordType: fdaRecordType.nullable(), schemaVersion: z.string().nullable(), occurredAt: timestamp.nullable(),
  receivedAt: timestamp, processedAt: timestamp.nullable(), actorRole: z.literal('synthetic-source'),
  validation: z.enum(['valid', 'invalid']), status: receiptStatus, errorCode: z.string().nullable(),
  payloadFingerprint: z.string().regex(/^[a-f0-9]{64}$/), applicationRevision: z.string().nullable(),
  sourceRevision: envelope.sourceRevision.unwrap().nullable(), correlationId: envelope.correlationId.unwrap().nullable(),
  processingRevision: z.string().nullable(), canonicalId: z.uuid().nullable(),
});
export type FdaReceipt = z.infer<typeof fdaReceipt>;

export const fdaStatus = z.object({
  tenantId, sourceId, schemaVersion: z.literal(FDA_CONTRACT), connection: z.literal('simulated HTTP publisher'),
  sourceStatus: z.enum(['disabled', 'awaiting-import', 'active']), lastSuccessful: timestamp.nullable(),
  acceptedRecords: z.number().int().nonnegative(), counts: z.record(receiptStatus, z.number().int().nonnegative()), categories: z.array(fdaRecordType),
  receipts: z.array(fdaReceipt),
});

export const fdaCanonicalRecord = z.object({
  id: z.uuid(), subjectId: z.string(), receiptId: z.uuid(),
  event: fdaEvent,
});
export type FdaCanonicalRecord = z.infer<typeof fdaCanonicalRecord>;

export const sourceRecordId = envelope.sourceRecordId;
export const sourceTimestamp = timestamp;

export const fdaRecordLink = z.object({
  id: z.uuid(), sourceRecordId: envelope.sourceRecordId, recordType: fdaRecordType, occurredAt: timestamp,
});
const assessmentWindow = fdaPayloads['observation.window'];
const interval = z.object({ start: timestamp, end: timestamp });

export const fdaAgentProjection = z.object({
  window: assessmentWindow.nullable(), reporting: count,
  devices: z.array(z.object({
    endpointId, agentVersion: version, os: fdaPayloads['endpoint.registration'].shape.os,
    reporting: z.boolean(), lastHeartbeat: timestamp.nullable(), lastObservation: timestamp.nullable(),
    capture: fdaPayloads['endpoint.status'].shape.capture,
    permissions: z.array(fdaPayloads['endpoint.permission']),
    missingIntervals: z.array(interval), evidenceFreshness: z.enum(['fresh', 'stale', 'unobserved']),
    diagnostics: fdaPayloads['endpoint.status'].shape.diagnostics,
    evidenceComplete: z.boolean(), receipts: z.array(fdaRecordLink),
  })),
});

export const fdaWorkflowProjection = z.array(z.object({
  candidate: fdaPayloads['workflow.candidate'], windows: z.array(assessmentWindow),
  observations: z.array(z.object({
    ...fdaPayloads['workflow.observation'].shape, deliveredLate: z.boolean(), receipt: fdaRecordLink,
  })),
  gaps: z.array(z.string()), receipts: z.array(fdaRecordLink),
}));
