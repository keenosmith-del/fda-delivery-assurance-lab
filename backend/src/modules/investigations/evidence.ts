import { FDA_GATEWAY } from '../../../../shared/contracts/fda-ingestion.ts';
import type { FdaEvent, FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import { ASSURANCE_RULES } from '../../../../shared/contracts/agent-assurance.ts';
import { DOWNSTREAM_API, EFFECT_VERSION } from '../../../../shared/contracts/downstream.ts';
import { ADOPTION_ASSURANCE, ADOPTION_CALCULATION } from '../../../../shared/contracts/adoption-assurance.ts';
import { OUTCOME_ASSURANCE, OUTCOME_RULE } from '../../../../shared/contracts/outcome-assurance.ts';
import type { OutcomeSelection } from '../../../../shared/contracts/outcome-assurance.ts';
import { WORKFLOW_ASSESSMENTS } from '../../../../shared/contracts/workflow-assessments.ts';
import { RETRIEVAL_VERSION } from '../../../../shared/contracts/investigations.ts';
import type { Citation, EvidencePacket, InvestigationScope } from '../../../../shared/contracts/investigations.ts';
import type { SqlClient } from '../../db/pool.ts';
import { workflowEvidenceState } from '../agent-assurance/workflow.ts';
import { collectOperationEvidence } from '../downstream/operations.ts';
import { collectOutcomeAssurance } from '../outcomes/assurance.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';

type Domain = Citation['category'];
const categories: Record<InvestigationScope['category'], Domain[]> = {
  'evidence-readiness': ['source','agent','engineering'], 'agent-health': ['source','agent','engineering'],
  'workflow-feasibility': ['source','agent','engineering'], 'decision-review': ['source','agent','engineering'],
  'downstream-failure': ['engineering','downstream'], 'retry-reconciliation': ['engineering','downstream'],
  'adoption-usage': ['engineering','downstream','adoption'], 'intervention-follow-up': ['engineering','adoption','outcome'],
  'outcome-verification': ['engineering','downstream','adoption','outcome'],
  'end-to-end': ['source','agent','engineering','downstream','adoption','outcome'],
};
type Entry = Omit<Citation,'id'|'tenantId'|'sourceId'|'caseId'|'period'|'timestamp'|'links'> &
  Partial<Pick<Citation,'period'|'timestamp'|'links'>>;
const scalar = (value: unknown) => typeof value === 'boolean' || typeof value === 'number' || value === null ? value : null;
const code = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,64}$/.test(value) ? value : null;
const asTime = (value: Date | string) => new Date(value).toISOString();
const maximum = 160;
const sourceFacts = (event: FdaEvent): Citation['facts'] => {
  switch(event.recordType) {
    case 'workflow.candidate': return { frequency: event.payload.frequency, unit: event.payload.unit, recommendation: event.payload.recommendation };
    case 'workflow.observation': return { durationSeconds: event.payload.durationSeconds, exception: event.payload.exception };
    case 'observation.window': return { coverage: event.payload.completeness, expectedEndpoints: event.payload.eligibleEndpoints.length,
      observedEndpoints: event.payload.observedEndpoints.length, reportingEndpoints: event.payload.reportingCount };
    case 'endpoint.status': return { connection: event.payload.connection, capture: event.payload.capture, queueCount: event.payload.queueCount ?? null };
    case 'endpoint.permission': return { permission: event.payload.category, status: event.payload.status };
    case 'endpoint.registration': return { enrollment: event.payload.enrollment };
    case 'automation.measurement': return { eligible: event.payload.eligible, attempted: event.payload.attempted, reportedSuccesses: event.payload.successes };
  }
};

export async function collectPacket(client: SqlClient, scope: FdaScope, caseId: string, selection: InvestigationScope): Promise<EvidencePacket> {
  const selected: OutcomeSelection | undefined = selection.baseline && selection.comparison ? {
    baseline: selection.baseline, comparison: selection.comparison, method: selection.method ?? 'matched-items',
    ...(selection.interventionId && { interventionId: selection.interventionId }),
  } : undefined;
  const detail = await collectOutcomeAssurance(client, scope, caseId, selected);
  const { adoption, context: { approvedRevision, decision, delivery, decisionAt, deliveryAt } } = detail;
  const workflowPath = WORKFLOW_ASSESSMENTS + '/' + adoption.workflowId + '/export';
  const adoptionPath = ADOPTION_ASSURANCE + '/cases/' + caseId + '/export';
  const outcomePath = OUTCOME_ASSURANCE + '/cases/' + caseId + '/export' + (selected
    ? '?' + new URLSearchParams(Object.entries(selected)) : '');
  const enabled = new Set(categories[selection.category]);
  const entries = new Map<string, Citation>();
  function add(entry: Entry) {
    if (!enabled.has(entry.category)) return;
    const id = entry.category + '-' + fingerprint({ ...scope, caseId, record: entry.record, id: entry.recordId, period: entry.period }).slice(0,24);
    entries.set(id, { timestamp: null, period: null, links: [], ...entry, ...scope, caseId, id });
  }

  add({ category: 'engineering', record: 'assessment-revision', recordId: adoption.assessmentId + ':' + adoption.revision,
    version: approvedRevision.suitability?.ruleVersion ?? approvedRevision.snapshot.readiness.ruleVersion,
    provenance: 'calculated', summary: 'Approved engineering assessment revision', links: [workflowPath], facts: {
      revision: adoption.revision, readiness: approvedRevision.snapshot.readiness.readiness,
      observations: approvedRevision.snapshot.evidence.observations.length, riskCount: approvedRevision.risks.length,
      suitability: approvedRevision.suitability?.recommendation ?? null, authorization: approvedRevision.feasibility?.integration.authorization ?? null,
      integrationAvailability: approvedRevision.feasibility?.integration.availability ?? null,
      customerApprovalRequired: approvedRevision.feasibility?.operations.clientApproval === 'required',
    } });
  add({ category: 'engineering', record: 'engineering-decision', recordId: adoption.decisionId, version: 'engineering-decision/v1',
    timestamp: asTime(decisionAt), provenance: 'human-decision', summary: 'Human decision for the synthetic lab workflow',
    links: [workflowPath], facts: { outcome: decision.outcome, revision: decision.revision, conditions: decision.conditions.length,
      labScopeOnly: true, customerApprovalEstablished: false } });
  add({ category: 'engineering', record: 'delivery-case', recordId: caseId, version: 'delivery-case/v1', timestamp: asTime(deliveryAt),
    provenance: 'human-decision', summary: 'Persisted delivery case and prerequisites', links: [workflowPath],
    facts: { superseded: adoption.superseded, readiness: delivery.readiness, prerequisites: delivery.prerequisites.length,
      verifiedPrerequisites: delivery.prerequisites.filter(x => x.status === 'verified-in-lab').length } });

  let overflow = 0;
  if (enabled.has('source') || enabled.has('agent')) {
    const state = await workflowEvidenceState(client, scope);
    const candidate = state.candidates.find(x => x.candidate.workflowId === adoption.workflowId);
    const readiness = state.readiness.find(x => x.workflowId === adoption.workflowId);
    add({ category: 'agent', record: 'workflow-readiness', recordId: adoption.assessmentId + ':' + adoption.revision,
      version: readiness?.ruleVersion ?? ASSURANCE_RULES, provenance: readiness?.readiness === 'ready-for-review' ? 'calculated' : 'evidence-gap',
      summary: 'Current workflow readiness across its explicitly linked observation windows', links: [workflowPath],
      facts: { readiness: readiness?.readiness ?? 'unknown', windows: readiness?.windows.length ?? 0,
        blockers: readiness?.windows.reduce((sum, window) => sum + window.blockers.length, 0) ?? 0 } });
    const windowIds = new Set([...approvedRevision.snapshot.evidence.candidate.windowIds, ...candidate?.candidate.windowIds ?? []]);
    const scopedReceipts = new Set([...candidate?.receipts.map(x => x.id) ?? [], ...candidate?.observations.map(x => x.receipt.id) ?? []]);
    for (const windowId of windowIds) {
      const result = state.assessments.get(windowId);
      const record = state.records.find(row => row.event.recordType === 'observation.window' && row.event.payload.windowId === windowId);
      if (record) scopedReceipts.add(record.receiptId);
      if (!result || !record) {
        add({ category: 'agent', record: 'missing-window', recordId: adoption.assessmentId + ':' + windowId,
          version: ASSURANCE_RULES, period: windowId, provenance: 'evidence-gap',
          summary: 'Workflow references an unavailable observation window', facts: { windowAvailable: false }, links: [workflowPath] });
        continue;
      }
      add({ category: 'agent', record: 'agent-window', recordId: record.id, version: result.ruleVersion, period: windowId,
        timestamp: result.asOf, provenance: result.completeness === 'complete' ? 'calculated' : 'evidence-gap',
        summary: 'Observation window operational readiness and reporting counts', links: [FDA_GATEWAY + '/assurance/assessment?windowId=' + windowId],
        facts: { ...result.counts, completeness: result.completeness, drift: result.disagreements.length } });
      for (const device of result.devices) {
        for (const row of device.timeline) scopedReceipts.add(row.id);
        const screen = device.permissions.find(p => p.category === 'screen');
        add({ category: 'agent', record: 'agent-endpoint', recordId: record.id + ':' + device.endpointId, version: result.ruleVersion,
          period: windowId, timestamp: result.asOf, provenance: device.evidenceComplete ? 'calculated' : 'evidence-gap',
          summary: 'Endpoint readiness, permission and missing reporting intervals',
          links: [FDA_GATEWAY + '/assurance/assessment?windowId=' + windowId], facts: { readiness: device.readiness,
            connection: device.connectivity, capture: device.capture, screenPermission: screen?.status ?? null,
            missingIntervals: device.missingIntervals.length, firstMissingStart: device.missingIntervals[0]?.start ?? null,
            firstMissingEnd: device.missingIntervals[0]?.end ?? null, lastObservation: device.lastObservation } });
      }
      const current = readiness?.windows.find(x => x.windowId === windowId);
      for (const incident of current?.incidents ?? []) {
        const { rows: [audit] } = await client.query<{ attempts: number; revision: number }>(`SELECT count(*)::int AS attempts,
          coalesce(max(sequence),0)::int AS revision FROM fda_agent_incident_audit WHERE tenant_id=$1 AND source_id=$2 AND incident_id=$3`,
          [scope.tenantId,scope.sourceId,incident.id]);
        add({ category: 'agent', record: 'agent-incident', recordId: incident.id, version: ASSURANCE_RULES, period: windowId,
          timestamp: incident.resolvedAt ?? incident.detectedAt, provenance: incident.state === 'resolved' ? 'calculated' : 'evidence-gap',
          summary: 'Scoped operational incident and recovery audit', links: [FDA_GATEWAY + '/assurance/incidents/' + incident.id + '/export'],
          facts: { incident: incident.category, state: incident.state, resolved: incident.state === 'resolved',
            auditEvents: audit?.attempts ?? 0, auditRevision: audit?.revision ?? 0 } });
      }
    }
    const records = new Map(approvedRevision.snapshot.records.map(r => [r.canonicalId, r]));
    for (const row of state.records) if (scopedReceipts.has(row.receiptId)) {
      records.set(row.id, { canonicalId: row.id, receiptId: row.receiptId, event: row.event });
    }
    for (const row of records.values()) {
      const event = row.event;
      add({ category: 'source', record: event.recordType, recordId: row.canonicalId, version: event.schemaVersion, timestamp: event.occurredAt,
        period: 'windowId' in event.payload ? event.payload.windowId : null, provenance: event.recordType === 'automation.measurement' ? 'source-reported' : 'source-record',
        summary: 'Canonical synthetic source record and processed receipt', links: [FDA_GATEWAY + '/receipts/' + row.receiptId],
        facts: { ...sourceFacts(event), sourceRecord: event.sourceRecordId, sourceRevision: event.sourceRevision ?? null } });
    }
    const names = [...records.values()].map(x => x.event.sourceRecordId);
    const { rows: conflicts } = await client.query<{ id: string; source_record_id: string; received_at: Date; error_code: string | null }>(`
      SELECT id,source_record_id,received_at,error_code FROM fda_ingestion_receipts
      WHERE tenant_id=$1 AND source_id=$2 AND source_record_id=ANY($3::text[]) AND status='conflict'
      ORDER BY received_at DESC,id LIMIT 41`, [scope.tenantId,scope.sourceId,names]);
    overflow += Math.max(0, conflicts.length - 40);
    for (const row of conflicts.slice(0,40)) add({ category: 'source', record: 'conflicting-receipt', recordId: row.id, version: RETRIEVAL_VERSION,
      timestamp: asTime(row.received_at), provenance: 'contradiction', summary: 'Conflicting replay was rejected against a linked source record',
      facts: { sourceRecord: row.source_record_id, error: code(row.error_code) }, links: [FDA_GATEWAY + '/receipts/' + row.id] });
  }

  if (enabled.has('downstream')) {
    if (adoption.operation) {
      const downstream = await collectOperationEvidence(client, scope, adoption.operation.id);
      const { operation: op } = downstream;
      const path = DOWNSTREAM_API + '/operations/' + op.id + '/export';
      add({ category: 'downstream', record: 'downstream-operation', recordId: op.id, version: EFFECT_VERSION,
        timestamp: asTime(op.updated_at), provenance: op.verified_effect_id ? 'independently-verified' : 'source-record',
        summary: 'Synthetic downstream operation and authoritative effect count', links: [path],
        facts: { state: op.state, dispatches: op.dispatches, lookups: op.reconciliations, redriven: op.redriven,
          accepted: op.accepted, verifiedEffects: op.verified_effect_id ? 1 : 0, effectId: op.verified_effect_id, lastError: code(op.last_error) } });
      for (const attempt of downstream.attempts) {
        const metadata = attempt.metadata ?? {};
        add({ category: 'downstream', record: 'downstream-attempt', recordId: op.id + ':' + attempt.id, version: EFFECT_VERSION,
          timestamp: asTime(attempt.finished_at ?? attempt.started_at), links: [path],
          provenance: attempt.phase === 'reconcile' && metadata.effectId === op.verified_effect_id && op.verified_effect_id
            ? 'independently-verified' : 'source-record', summary: 'Dispatch or authoritative reconciliation attempt',
          facts: { phase: code(attempt.phase), attempt: scalar(attempt.attempt_number), leaseRecovered: scalar(attempt.recovered_lease),
            result: code(metadata.kind), error: code(metadata.errorCode ?? metadata.code), method: code(metadata.method),
            effectMatch: Boolean(op.verified_effect_id && metadata.effectId === op.verified_effect_id), resultingState: code(metadata.resultingState) } });
      }
      for (const audit of downstream.history.filter(entry => ['authorised','redriven','redrive','cancelled','failed-terminal'].includes(entry.action))) {
        add({ category: 'downstream', record: 'downstream-action', recordId: op.id + ':' + audit.id, version: EFFECT_VERSION,
          timestamp: asTime(audit.recorded_at), links: [path], provenance: audit.role === 'worker' ? 'source-record' : 'human-decision',
          summary: 'Downstream execution audit event', facts: { action: code(audit.action), role: code(audit.role) } });
      }
    } else add({ category: 'downstream', record: 'missing-operation', recordId: caseId, version: EFFECT_VERSION,
      provenance: 'evidence-gap', summary: 'No synthetic operation is linked to this delivery case', facts: { operationRecorded: false }, links: [workflowPath] });
  }

  if (enabled.has('adoption')) {
    add({ category: 'adoption', record: 'adoption-assessment', recordId: caseId, version: ADOPTION_CALCULATION,
      provenance: adoption.windows.length ? 'calculated' : 'evidence-gap', summary: 'Delivery-linked adoption evidence status', links: [adoptionPath],
      facts: { status: adoption.status, windows: adoption.windows.length } });
    for (const window of adoption.windows) {
      const rates = window.rates;
      add({ category: 'adoption', record: 'adoption-period', recordId: window.declaration?.eventId ?? caseId, version: ADOPTION_CALCULATION,
        period: window.periodId, timestamp: window.declaration?.asOf ?? null, links: [adoptionPath],
        provenance: window.coverage === 'complete' ? 'calculated' : 'evidence-gap', summary: 'Eligible usage and independently verified execution metrics',
        facts: { eligibleParticipants: rates.adoption.denominator, adopters: rates.adoption.numerator, adoptionRate: rates.adoption.value,
          eligibleOpportunities: rates.opportunityUsage.denominator, attemptedOpportunities: rates.opportunityUsage.numerator,
          opportunityUsage: rates.opportunityUsage.value, executionReliability: rates.reliability.value, coverage: rates.coverage.value,
          verifiedSuccesses: window.verified, reportedSuccesses: window.reportedSuccess, exceptions: window.exceptionCount, gaps: window.missing.length } });
      if (window.reportedSuccess) add({ category: 'adoption', record: 'reported-success', recordId: window.declaration?.eventId ?? caseId,
        version: ADOPTION_CALCULATION, period: window.periodId, provenance: 'source-reported', summary: 'Source-reported successes without an authoritative effect match',
        facts: { reportedSuccesses: window.reportedSuccess }, links: [adoptionPath] });
      for (const signal of adoption.signals.filter(s => s.periodId === window.periodId)) add({ category: 'adoption',
        record: 'diagnostic-' + signal.category, recordId: window.declaration?.eventId ?? caseId, version: signal.rule, period: window.periodId,
        provenance: 'calculated', summary: 'Diagnostic signal from observed usage', links: [adoptionPath],
        facts: { category: signal.category, numerator: signal.numerator, denominator: signal.denominator } });
    }
    for (const action of adoption.audit) add({ category: 'adoption', record: 'adoption-action', recordId: action.id, version: ADOPTION_CALCULATION,
      provenance: 'human-decision', timestamp: asTime(action.recordedAt), summary: 'Operator diagnosis, intervention or follow-up audit', links: [adoptionPath],
      facts: { action: action.body.kind, ...(action.body.kind === 'diagnose' && { category: action.body.category, period: action.body.periodId }),
        ...(action.body.kind === 'plan' && { followUpPeriod: action.body.followUpPeriodId }),
        ...(action.body.kind === 'implement' && { implementedAt: action.body.implementedAt }) } });
  }

  if (enabled.has('outcome')) {
    const comparison = detail.comparison;
    add({ category: 'outcome', record: 'outcome-assessment', recordId: caseId, version: OUTCOME_RULE,
      provenance: detail.ready ? 'calculated' : 'evidence-gap', summary: 'Current synthetic outcome comparison and review readiness', links: [outcomePath],
      period: detail.selection?.comparison ?? null, facts: { status: code(detail.status) ?? 'insufficient-evidence', ready: detail.ready,
        difference: comparison?.difference ?? null, reviewedDifference: detail.reviewedDifference, unit: comparison?.unit ?? null,
        baselineRate: comparison?.baselineRate ?? null, comparisonRate: comparison?.comparisonRate ?? null, gaps: detail.reasons.length } });
    const periodIds = new Set([detail.selection?.baseline, detail.selection?.comparison]);
    for (const period of detail.periods.filter(p => !selected || periodIds.has(p.periodId))) {
      add({ category: 'outcome', record: 'time-study-period', recordId: period.definition?.eventId ?? caseId, version: OUTCOME_RULE,
        period: period.periodId, timestamp: period.definition?.asOf ?? null, provenance: period.missing.length ? 'evidence-gap' : 'calculated',
        summary: 'Time-study coverage and human effort in seconds', links: [outcomePath],
        facts: { stage: period.definition?.stage ?? null, method: period.definition?.method ?? null, expectedItems: period.definition?.expectedItems ?? null,
          observedItems: period.items.length, humanSeconds: period.humanSeconds, reviewSeconds: period.sums.review ?? null,
          reworkSeconds: period.sums.rework ?? null, exceptionSeconds: period.sums.exception ?? null,
          missingRework: period.missing.some(reason => reason.startsWith('Missing rework')), missing: period.missing.length } });
    }
    for (const model of detail.modeled) add({ category: 'outcome', record: 'modeled-opportunity', recordId: model.input.eventId, version: OUTCOME_RULE,
      period: model.input.periodId, timestamp: model.input.occurredAt, provenance: 'calculated', summary: 'Modeled assumptions and projections in seconds',
      links: [outcomePath], facts: { grossSeconds: model.grossSeconds, netSeconds: model.netSeconds, weeklyNetSeconds: model.weeklyNetSeconds,
        volume: model.input.volume, manualSeconds: model.input.manualSeconds, frequency: model.input.recurrencesPerWeek } });
    for (const review of detail.reviewHistory) {
      const snapshot = review.snapshot as { comparison?: { difference?: number | null; unit?: string } };
      add({ category: 'outcome', record: 'outcome-review', recordId: caseId + ':' + review.revision,
        version: OUTCOME_RULE, period: review.decision.comparison, timestamp: asTime(review.reviewedAt), provenance: review.stale ? 'contradiction' : 'human-decision',
        summary: 'Outcome review decision and status of its historical evidence', links: [outcomePath],
        facts: { revision: review.revision, decision: review.decision.outcome, stale: review.stale, fingerprint: review.fingerprint,
          historicalDifference: snapshot.comparison?.difference ?? null, unit: snapshot.comparison?.unit ?? null } });
    }
  }

  const ordered = [...entries.values()].sort((a,b) => {
    const priority = (x: Citation) => ['contradiction','evidence-gap'].includes(x.provenance) ? 0 : 1;
    return priority(a)-priority(b) || a.id.localeCompare(b.id);
  });
  const omitted = overflow + Math.max(0, ordered.length - maximum);
  const material = { version: RETRIEVAL_VERSION, ...scope, caseId, workflowId: adoption.workflowId, assessmentId: adoption.assessmentId,
    assessmentRevision: adoption.revision, scope: selection, citations: ordered.slice(0,maximum), truncated: omitted > 0, omitted,
    limitations: ['Synthetic delivery evidence only.', 'Advisory interpretation requires human review.', 'Observed changes do not establish causality.',
      ...(omitted ? ['Evidence exceeded the record budget. Further scoping is required before inference.'] : [])] } as const;
  const dependencies = {
    ...(enabled.has('adoption') && { adoption: adoption.observations.map(row => row.body), actions: adoption.audit.map(row => row.body) }),
    ...(enabled.has('outcome') && { outcome: detail.fingerprint, observations: detail.observations
      .filter(row => !selected || row.body.periodId === selected.baseline || row.body.periodId === selected.comparison)
      .map(row => row.body) }),
  };
  return { ...material, limitations: [...material.limitations], fingerprint: fingerprint({ ...material, citations: ordered, dependencies }) };
}
