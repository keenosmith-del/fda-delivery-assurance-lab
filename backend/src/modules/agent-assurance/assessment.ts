import { ASSURANCE_RULES } from '../../../../shared/contracts/agent-assurance.ts';
import type { AssuranceAssessment, AssuranceDevice } from '../../../../shared/contracts/agent-assurance.ts';
import type { FdaEvent, FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { SqlClient } from '../../db/pool.ts';
import { measureDevice } from '../agent-health/service.ts';
import { listCanonical } from '../fda-ingestion/service.ts';
import type { ReceivedCanonical } from '../fda-ingestion/service.ts';

type Kind = FdaEvent['recordType'];
export type AssessmentSelection = { windowId?: string; asOf?: string };
export const DELIVERY_LIMIT_SECONDS = 300;
const FRESH_MS = 90 * 60_000;
const BACKLOG_LIMIT = 25;

export function ofKind<T extends Kind>(rows: ReceivedCanonical[], kind: T) {
  return rows.filter((row): row is ReceivedCanonical & { event: Extract<FdaEvent, { recordType: T }> } => row.event.recordType === kind);
}

export function sourceLink(row: ReceivedCanonical) {
  return { id: row.receiptId, sourceRecordId: row.event.sourceRecordId, recordType: row.event.recordType,
    occurredAt: row.event.occurredAt, receivedAt: row.receivedAt.toISOString() };
}

export function deliverySeconds(eventTime: string, receivedAt: Date) {
  const delta = receivedAt.getTime() - Date.parse(eventTime);
  return delta >= 0 ? delta / 1000 : null;
}

export function loadAssuranceRecords(db: SqlClient, scope: FdaScope) {
  return listCanonical(db, scope, ['endpoint.registration', 'endpoint.status', 'endpoint.permission',
    'observation.window', 'workflow.observation', 'workflow.candidate']);
}

const recent = (instant: string | null, asOf: string) => instant !== null && instant <= asOf &&
  Date.parse(asOf) - Date.parse(instant) <= FRESH_MS;

const distinct = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.toReversed().map(row => [key(row), row])).values()].reverse();

type WindowRow = ReturnType<typeof ofKind<'observation.window'>>[number];

function assessEndpoint(rows: ReceivedCanonical[], endpointId: string, windowRow: WindowRow, asOf: string): AssuranceDevice {
  const window = windowRow.event.payload;
  const history = rows.filter(row => row.event.occurredAt <= asOf && row.subjectId === endpointId);
  const registration = ofKind(history, 'endpoint.registration')[0];
  const statuses = ofKind(history, 'endpoint.status');
  const status = statuses[0];
  const permissionRows = ofKind(history, 'endpoint.permission')
    .sort((a, b) => b.event.payload.reportedAt.localeCompare(a.event.payload.reportedAt));
  const permissionHistory = permissionRows.map(row => ({ value: row.event.payload, evidence: sourceLink(row) }));
  const permissions = distinct(permissionRows, row => row.event.payload.category).map(row => row.event.payload);
  const screen = permissionRows.find(row => row.event.payload.category === 'screen');
  const observations = distinct(ofKind(rows, 'workflow.observation').filter(row => row.event.payload.observedAt <= asOf),
    row => row.subjectId).filter(({ event: { payload: p } }) =>
    p.endpointId === endpointId && p.windowId === window.windowId && p.observedAt >= window.start && p.observedAt < window.end);
  const observed = observations.map(row => {
    const observedAt = row.event.payload.observedAt;
    return { observedAt, observationToReceiptSeconds: deliverySeconds(observedAt, row.receivedAt),
      occurrenceToReceiptSeconds: deliverySeconds(row.event.occurredAt, row.receivedAt),
      arrivedAfterWindow: row.receivedAt > new Date(window.end), reportedAfterWindow: row.event.occurredAt > window.end,
      evidence: sourceLink(row) };
  });
  const payload = status?.event.payload;
  const lastHeartbeat = payload?.heartbeatAt ?? null;
  const verifiedObservation = observed.map(item => item.observedAt).sort().at(-1) ?? null;
  const lastObservation = [verifiedObservation, payload?.lastObservationAt ?? null].filter(x => x !== null).sort().at(-1) ?? null;
  const capture = payload?.capture ?? 'unknown';
  const isRetired = registration?.event.payload.enrollment === 'retired';
  const versionHistory = history.flatMap(row => {
    const event = row.event;
    const version = event.recordType === 'endpoint.registration' || event.recordType === 'endpoint.status'
      ? event.payload.agentVersion : undefined;
    return version ? [{ version, evidence: sourceLink(row) }] : [];
  });
  const reportedVersion = versionHistory[0]?.version;
  const versionPolicy = reportedVersion ? (/^1\.\d+\.\d+$/.test(reportedVersion) ? 'supported' : 'mismatch') : 'unknown';
  const updateState = versionHistory.some(item => item.version !== reportedVersion) ? 'version-transition' : 'unknown';
  const freshness = lastObservation === null ? 'unknown' : recent(lastObservation, asOf) ? 'fresh' : 'stale';
  const interrupted = payload?.diagnostics.includes('reporting-interrupted');
  const reporting = payload?.connection === 'online' && recent(lastHeartbeat, asOf);
  const priorInterruption = status && statuses.slice(1).some(row =>
    row.event.payload.connection === 'offline' || row.event.payload.diagnostics.includes('reporting-interrupted'));
  const connectivity = reporting ? (priorInterruption && payload?.diagnostics.includes('recovered') ? 'recovered' : 'reporting')
    : interrupted ? 'interrupted' : payload?.connection === 'offline' ? 'disconnected'
      : payload?.connection === 'online' ? 'not-reporting' : 'unknown';
  const queueCount = payload?.queueCount ?? null;
  const missingIntervals = measureDevice({ id: endpointId, label: endpointId, team: 'Synthetic FDA',
    enrolledAt: registration?.event.payload.enrolledAt ?? window.start }, { start: window.start, end: asOf },
    observed.map(item => ({ kind: 'observation', at: item.observedAt, permissionOk: null }))).missingIntervals;
  const granted = screen?.event.payload.status === 'granted';
  const evidenceComplete = Boolean(registration && !isRetired && asOf === window.end && reporting &&
    capture === 'available' && granted && !missingIntervals.length && observed.length);
  const conditions: AssuranceDevice['conditions'] = [];
  const add = (category: AssuranceDevice['conditions'][number]['category'], severity: 'blocking' | 'degraded',
    reason: string, refs: (ReceivedCanonical | undefined)[], since?: string) => {
    const evidence = distinct(refs.filter(row => row !== undefined), row => row.receiptId).map(sourceLink);
    conditions.push({ category, severity, reason, since: since ?? evidence.map(item => item.occurredAt).sort().at(-1) ?? asOf, evidence });
  };

  if (!isRetired && registration) {
    if (status && !reporting && payload?.connection !== 'unknown') {
      add('reporting-interruption', 'blocking', 'No fresh online heartbeat at assessment time.', [status]);
    }
    if (freshness === 'stale') add('stale-observations', 'degraded', 'Latest reported observation is older than 90 minutes.', [status, observations[0], windowRow]);
    if (missingIntervals.length) add('missing-coverage', 'degraded', 'Eligible elapsed intervals have no supporting observation.', [windowRow, registration], asOf);
    if (capture === 'limited' || capture === 'unavailable' || screen?.event.payload.status === 'limited' || screen?.event.payload.status === 'denied') {
      add('capture-permissions', 'blocking', 'Capture or the required screen permission is restricted.', [status, screen]);
    }
    if (versionPolicy === 'mismatch') add('version-readiness', 'degraded', 'Reported version falls outside the synthetic stable 1.x policy.',
      [history.find(row => row.receiptId === versionHistory[0]?.evidence.id)]);
    const delayed = observations.find(row => (deliverySeconds(row.event.occurredAt, row.receivedAt) ?? 0) > DELIVERY_LIMIT_SECONDS);
    if ((queueCount ?? 0) >= BACKLOG_LIMIT || delayed) add('delivery-backlog', 'degraded',
      'Reported queue reaches 25 events or an observation took over 300 seconds to reach the server.', [status, delayed]);
  }
  const factors = [
    ...conditions.map(item => item.reason),
    ...(!registration ? ['No endpoint registration was reported.'] : []),
    ...(!status ? ['No endpoint status was reported.'] : []),
    ...(!screen || screen.event.payload.status === 'unknown' ? ['Required screen permission is unknown.'] : []),
    ...(capture === 'unknown' ? ['Capture readiness is unknown.'] : []),
    ...(!observed.length ? ['No actual observations support this endpoint in this window.'] : []),
  ];
  const readiness = isRetired ? 'retired' : conditions.some(c => c.severity === 'blocking') ? 'not-ready'
    : !registration || !reporting || capture === 'unknown' || !screen || screen.event.payload.status === 'unknown' ? 'insufficient-evidence'
      : conditions.length ? 'degraded' : evidenceComplete ? 'ready' : 'insufficient-evidence';
  const lifecycle = isRetired ? 'retired' : !registration ? history.length ? 'registered' : 'not-reported'
    : !status ? 'enrolled' : readiness === 'ready' ? 'active' : 'awaiting-readiness';
  return {
    endpointId, lifecycle, readiness, connectivity, factors, registration: registration?.event.payload ?? null,
    lastHeartbeat, lastObservation, freshness, capture, permissions, permissionHistory, versionHistory, updateState, queueCount,
    versionPolicy, observations: observed, missingIntervals, evidenceComplete, conditions, timeline: [...history, ...observations, windowRow].map(sourceLink),
  };
}

export function assess(rows: ReceivedCanonical[], selection: AssessmentSelection = {}): AssuranceAssessment | null {
  const windowRows = distinct(ofKind(rows, 'observation.window'), row => row.subjectId)
    .sort((a, b) => b.event.payload.end.localeCompare(a.event.payload.end));
  const windowRow = selection.windowId ? windowRows.find(row => row.subjectId === selection.windowId)
    : selection.asOf ? windowRows.find(row => row.event.payload.start <= selection.asOf! && row.event.payload.end >= selection.asOf!)
      : windowRows[0];
  const window = windowRow?.event.payload ?? null;
  if (!window && (selection.windowId || selection.asOf)) return null;
  const asOf = selection.asOf ?? window?.end ?? null;
  if (window && asOf && (asOf < window.start || asOf > window.end)) return null;
  const devices = window && windowRow && asOf ? window.eligibleEndpoints.map(endpoint => assessEndpoint(rows, endpoint, windowRow, asOf)) : [];
  const observed = devices.filter(item => item.observations.length);
  const counts = {
    eligible: window?.eligibleEndpoints.length ?? 0, registered: devices.filter(d => d.registration).length,
    reporting: devices.filter(d => d.connectivity === 'reporting' || d.connectivity === 'recovered').length,
    observed: observed.length, permissionGranted: devices.filter(d => d.permissions.some(p => p.category === 'screen' && p.status === 'granted')).length,
    complete: devices.filter(d => d.evidenceComplete).length,
    degraded: devices.filter(d => d.readiness === 'degraded' || d.readiness === 'not-ready').length,
    delayed: devices.flatMap(d => d.observations).filter(o => (o.occurrenceToReceiptSeconds ?? 0) > DELIVERY_LIMIT_SECONDS).length,
  };
  const completeness = !window || asOf !== window.end || devices.some(d => !d.registration)
    ? 'unknown' : counts.complete === counts.eligible ? 'complete' : 'incomplete';
  const disagreements: string[] = [];
  if (window) {
    if (window.reportingCount !== counts.reporting) disagreements.push('Source reporting count differs from fresh online heartbeats.');
    if (window.observedEndpoints.length !== observed.length || observed.some(d => !window.observedEndpoints.includes(d.endpointId))) {
      disagreements.push('Source observed cohort differs from canonical workflow observations.');
    }
    if (window.completeness === 'complete' && completeness !== 'complete') disagreements.push('Source-declared completeness is unsupported by lab evidence.');
    if (window.completeness !== 'complete' && completeness === 'complete') disagreements.push('Lab-derived evidence is complete despite an incomplete or unknown source declaration.');
  }
  return { ruleVersion: ASSURANCE_RULES, window, asOf, windows: windowRows.map(row => row.event.payload), devices, counts,
    completeness, disagreements, lastReceipt: rows.map(row => row.receivedAt.toISOString()).sort().at(-1) ?? null };
}
