import { fdaAgentProjection, fdaWorkflowProjection } from '../../../../shared/contracts/fda-ingestion.ts';
import type { FdaCanonicalRecord, FdaEvent, FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../../db/pool.ts';
import { measureDevice } from '../agent-health/service.ts';
import { listCanonical } from './service.ts';

type Kind = FdaEvent['recordType'];
type TypedRecord<T extends Kind> = FdaCanonicalRecord & { event: Extract<FdaEvent, { recordType: T }> };

function recordsOf<T extends Kind>(rows: FdaCanonicalRecord[], type: T): TypedRecord<T>[] {
  return rows.filter((row): row is TypedRecord<T> => row.event.recordType === type);
}

function byKey<T>(rows: T[], key: (row: T) => string) {
  const first = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (!first.has(id)) first.set(id, row);
  }
  return first;
}

function link(row: FdaCanonicalRecord) {
  const { sourceRecordId, recordType, occurredAt } = row.event;
  return { id: row.receiptId, sourceRecordId, recordType, occurredAt };
}

export async function agentProjection(db: Database, scope: FdaScope) {
  const rows = await listCanonical(db, scope, [
    'observation.window', 'endpoint.registration', 'endpoint.status', 'endpoint.permission', 'workflow.observation',
  ]);
  const windowRecord = recordsOf(rows, 'observation.window').sort((a, b) => b.event.payload.end.localeCompare(a.event.payload.end))[0];
  if (!windowRecord) return { window: null, reporting: 0, devices: [] };
  const window = windowRecord.event.payload;
  const atAssessment = rows.filter(row => row.event.occurredAt <= window.end);
  const registrations = byKey(recordsOf(atAssessment, 'endpoint.registration'), row => row.subjectId);
  const statuses = recordsOf(atAssessment, 'endpoint.status');
  const permissions = recordsOf(atAssessment, 'endpoint.permission')
    .sort((a, b) => b.event.payload.reportedAt.localeCompare(a.event.payload.reportedAt));
  const observations = [...byKey(recordsOf(rows, 'workflow.observation'), row => row.subjectId).values()]
    .filter(row => row.event.payload.windowId === window.windowId && row.event.payload.observedAt >= window.start && row.event.payload.observedAt < window.end);

  const devices = window.eligibleEndpoints.flatMap(endpointId => {
    const registration = registrations.get(endpointId);
    if (!registration || registration.event.payload.enrollment !== 'enrolled') return [];
    const endpointStatuses = statuses.filter(row => row.subjectId === endpointId);
    const endpointPermissions = permissions.filter(row => row.subjectId === endpointId);
    const status = endpointStatuses[0];
    const permissionRows = [...byKey(endpointPermissions, row => row.event.payload.category).values()];
    const observed = observations.filter(row => row.event.payload.endpointId === endpointId);
    const current = status?.event.payload;
    const { enrolledAt, os, agentVersion } = registration.event.payload;
    const health = measureDevice({ id: endpointId, label: endpointId, team: 'Synthetic FDA', enrolledAt }, window, [
      ...(current?.heartbeatAt ? [{ kind: 'heartbeat' as const, at: current.heartbeatAt, permissionOk: null }] : []),
      ...observed.map(row => ({ kind: 'observation' as const, at: row.event.payload.observedAt, permissionOk: null })),
    ]);
    const capture = current?.capture ?? 'unknown';
    const latestObservation = [health.lastObservation, current?.lastObservationAt ?? null]
      .filter(value => value !== null).sort().at(-1) ?? null;
    const evidenceFreshness = latestObservation === null ? 'unobserved'
      : Date.parse(window.end) - Date.parse(latestObservation) <= 90 * 60_000 ? 'fresh' : 'stale';
    return [{
      endpointId, os, agentVersion: current?.agentVersion ?? agentVersion, reporting: health.reporting && current?.connection === 'online',
      lastHeartbeat: health.lastHeartbeat, lastObservation: latestObservation, capture,
      permissions: permissionRows.map(row => row.event.payload), missingIntervals: health.missingIntervals, evidenceFreshness,
      diagnostics: current?.diagnostics ?? [],
      evidenceComplete: capture === 'available' && health.missingIntervals.length === 0 &&
        permissionRows.length > 0 && permissionRows.every(row => row.event.payload.status === 'granted'),
      receipts: [registration, ...endpointStatuses, ...endpointPermissions, ...observed, windowRecord].map(link),
    }];
  });
  return fdaAgentProjection.parse({ window, devices, reporting: devices.filter(device => device.reporting).length });
}

export async function workflowProjection(db: Database, scope: FdaScope) {
  const rows = await listCanonical(db, scope, ['workflow.candidate', 'observation.window', 'workflow.observation']);
  const candidates = byKey(recordsOf(rows, 'workflow.candidate'), row => row.subjectId);
  const windows = byKey(recordsOf(rows, 'observation.window'), row => row.subjectId);
  const observations = byKey(recordsOf(rows, 'workflow.observation'), row => row.subjectId);
  return fdaWorkflowProjection.parse([...candidates.values()].map(candidateRecord => {
    const candidate = candidateRecord.event.payload;
    const gaps: string[] = [];
    const linkedWindows = candidate.windowIds.flatMap(id => {
      const record = windows.get(id);
      if (!record) gaps.push(`Observation window ${id} has not been received.`);
      else if (record.event.payload.completeness !== 'complete') gaps.push(`Observation coverage is incomplete or unknown for ${id}.`);
      return record ? [record] : [];
    });
    const linkedObservations = candidate.observationIds.flatMap(id => {
      const record = observations.get(id);
      const p = record?.event.payload;
      const window = p && linkedWindows.find(item => item.subjectId === p.windowId)?.event.payload;
      if (!p || !window || p.workflowId !== candidate.workflowId || !window.eligibleEndpoints.includes(p.endpointId) ||
        p.observedAt < window.start || p.observedAt >= window.end) {
        gaps.push(`Supporting observation ${id} is missing or outside its declared workflow or window.`);
        return [];
      }
      return [{ ...p, deliveredLate: record.event.occurredAt > window.end, receipt: link(record) }];
    });
    if (!linkedObservations.length) gaps.push('No verified supporting observations are linked.');
    return {
      candidate, windows: linkedWindows.map(row => row.event.payload), observations: linkedObservations, gaps,
      receipts: [candidateRecord, ...linkedWindows].map(link),
    };
  }));
}
