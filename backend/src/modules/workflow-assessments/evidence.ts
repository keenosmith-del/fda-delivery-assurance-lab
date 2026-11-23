import { createHash } from 'node:crypto';
import { evidenceSnapshot, SUITABILITY_RULES } from '../../../../shared/contracts/workflow-assessments.ts';
import type { AssessmentRevision, EvidenceSnapshot, FeasibilityInput } from '../../../../shared/contracts/workflow-assessments.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { SqlClient } from '../../db/pool.ts';
import { workflowEvidenceState } from '../agent-assurance/workflow.ts';

export function fingerprint(data: unknown): string {
  const serialized = JSON.stringify(data, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : value);
  return createHash('sha256').update(serialized).digest('hex');
}

export async function snapshotWorkflow(db: SqlClient, scope: FdaScope, id: string): Promise<EvidenceSnapshot | null> {
  const { candidates, readiness, records, assessments } = await workflowEvidenceState(db, scope);
  const evidence = candidates.find(item => item.candidate.workflowId === id);
  const gate = readiness.find(item => item.workflowId === id);
  if (!evidence || !gate) return null;

  const receipts = new Set(evidence.receipts.map(item => item.id));
  for (const observation of evidence.observations) receipts.add(observation.receipt.id);
  for (const window of evidence.windows) {
    for (const device of assessments.get(window.windowId)?.devices ?? []) {
      for (const entry of device.timeline) receipts.add(entry.id);
    }
  }
  const linked = records.filter(row => receipts.has(row.receiptId)).map(row =>
    ({ canonicalId: row.id, receiptId: row.receiptId, event: row.event }))
    .sort((a, b) => a.event.sourceRecordId.localeCompare(b.event.sourceRecordId));

  return evidenceSnapshot.parse({ evidence, readiness: gate, records: linked, fingerprint: fingerprint({
    rules: gate.ruleVersion,
    canonicalRecords: linked.map(record => record.event),
    candidate: evidence.candidate,
    gaps: evidence.gaps,
    readiness: gate.readiness,
    windows: gate.windows.map(window => ({
      ...window,
      incidents: window.incidents.filter(incident => incident.state !== 'resolved')
        .map(({ id, category, endpointId }) => ({ id, category, endpointId })).sort((a, b) => a.id.localeCompare(b.id)),
    })),
    timing: evidence.observations.map(o => ({
      id: o.observationId, known: o.deliverySeconds !== null, delayed: o.deliveredLate, afterWindow: o.arrivedAfterWindow,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  }) });
}

export function suitability(snapshot: EvidenceSnapshot, input: FeasibilityInput): NonNullable<AssessmentRevision['suitability']> {
  const factors = [
    ['Determinism', input.suitability.determinism, input.suitability.determinism === 'low'],
    ['Human judgement', input.suitability.humanJudgement, input.suitability.humanJudgement !== 'low'],
    ['Integration complexity', input.suitability.integrationComplexity, input.suitability.integrationComplexity === 'high'],
    ['Data sensitivity', input.suitability.dataSensitivity, input.suitability.dataSensitivity === 'high'],
    ['Failure impact', input.suitability.failureImpact, input.suitability.failureImpact === 'high'],
    ['Recoverability', input.suitability.recoverability, input.suitability.recoverability === 'low'],
    ['Expected value', input.suitability.expectedValue, false],
    ['Implementation complexity', input.suitability.implementationComplexity, input.suitability.implementationComplexity === 'high'],
    ['Maintenance', input.suitability.maintenance, input.suitability.maintenance === 'high'],
    ['Permission readiness', input.integration.authorization, input.integration.authorization === 'unresolved'],
    ['Evidence fitness', snapshot.readiness.readiness, snapshot.readiness.readiness !== 'ready-for-review'],
  ] as const;
  const observations = snapshot.evidence.observations.length;
  const exceptions = snapshot.evidence.observations.filter(item => item.exception).length;
  const exceptionReview = observations > 0 && exceptions * 4 >= observations;
  const recommendation = snapshot.readiness.readiness !== 'ready-for-review' || input.integration.authorization === 'unresolved'
    ? 'further-review' : exceptionReview || factors.some(([, , flag]) => flag) ? 'supervised-pilot' : 'planning';
  return { ruleVersion: SUITABILITY_RULES, recommendation, observations, exceptions,
    factors: [...factors.map(([label, value, reviewRequired]) => ({ label, value, reviewRequired })),
      { label: 'Observed exceptions', value: `${exceptions}/${observations} observations`, reviewRequired: exceptionReview }] };
}

export function approvalBlockers(revision: AssessmentRevision): string[] {
  const { snapshot, feasibility, riskRationale, risks } = revision;
  const reasons: string[] = [];
  if (snapshot.readiness.readiness !== 'ready-for-review' || snapshot.evidence.observations.length === 0) reasons.push('Source evidence is not ready for engineering review.');
  if (!feasibility) reasons.push('Complete the technical feasibility review.');
  if (!riskRationale) reasons.push('Review the risk register and record the basis.');
  if (feasibility) {
    if (feasibility.dependencies.some(d => d.mandatory && d.status !== 'verified-in-lab')) reasons.push('Resolve mandatory dependencies.');
    if (feasibility.integration.authorization !== 'acknowledged') reasons.push('Acknowledge permission and authorisation requirements.');
    if (!['verified-in-lab', 'not-applicable'].includes(feasibility.integration.availability)) reasons.push('Verify the proposed integration in the lab or mark it not applicable.');
  }
  if (risks.some(risk => risk.residual === 'high' || (risk.review !== 'reviewed' &&
    (risk.impact !== 'low' || risk.likelihood !== 'low' || risk.residual !== 'low')))) {
    reasons.push('Review elevated risks and mitigate high residual risks.');
  }
  return reasons;
}
