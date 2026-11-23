import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { assessmentDetail, decisionOutcome, WORKFLOW_ASSESSMENTS } from '../../../../shared/contracts/workflow-assessments.ts';
import type { AssessmentDetail } from '../../../../shared/contracts/workflow-assessments.ts';
import { dateLabel } from '../../lib/dates.ts';
import { FeasibilityForm, RiskForm, Note, lines, value, human } from './FeasibilityForm.tsx';

const decisionLabels = {
  'approve-implementation-planning': 'Approve implementation planning',
  'approve-supervised-pilot': 'Approve supervised pilot planning',
  reject: 'Reject',
  defer: 'Defer',
};

const errorLabels: Record<string, string> = {
  ASSESSMENT_REVISION_CONFLICT: 'Another request updated the assessment. Refresh and review the current revision.',
  WORKFLOW_EVIDENCE_CHANGED: 'Source evidence changed. Refresh and reassess before authorising new work.',
  WORKFLOW_OPERATOR_REQUIRED: 'An operator credential is required to update this assessment.',
  INSUFFICIENT_ACCESS: 'This account can inspect workflow assessments. Changes require an operator.',
  WORKFLOW_APPROVAL_REQUIRED: 'An approved assessment revision is required for a delivery case.',
  INVALID_WORKFLOW_ASSESSMENT_INPUT: 'Check the assessment fields and their lengths.',
};

export function WorkflowAssessment({ workflowId }: { workflowId: string }) {
  const path = `${WORKFLOW_ASSESSMENTS}/${encodeURIComponent(workflowId)}`;
  const [item, setItem] = useState<AssessmentDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, refreshWith] = useState(0);
  const [token, setToken] = useState('');
  const [choice, setChoice] = useState('defer');
  const decisionId = useId();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Assessment could not be loaded (HTTP ${response.status}).`);
      return assessmentDetail.parse(await response.json());
    }).then(result => {
      if (!controller.signal.aborted) { setItem(result); setLoaded(true); }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [path, refresh]);

  async function send(suffix: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path + suffix, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.blockers?.length ? result.blockers.join(' ') : errorLabels[result.error] ?? `Assessment request returned HTTP ${response.status}.`);
      }
      setItem(assessmentDetail.parse(result));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the assessment.');
    } finally { setBusy(false); }
  }

  function submit(work: (data: FormData) => void) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      work(new FormData(event.currentTarget));
    };
  }

  const current = item?.current;
  const decision = item?.decisions.find(d => d.revision === current?.revision);
  const hasDelivery = item?.deliveryCases.some(d => d.revision === current?.revision);
  const revise = (body: Record<string, unknown>) => current && void send('/revisions', { ...body, revision: current.revision });
  return <section>
    <h3>Engineering assessment</h3>
    <details><summary>Local operator access</summary>
      <label>Workflow operator token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
    </details>
    {error && <p role="alert">{error}</p>}
    {!loaded && !error && <p role="status">Loading assessment…</p>}
    {loaded && !item && <button type="button" disabled={busy} onClick={() => void send('', {})}>Open engineering assessment</button>}
    {item && current && <>
      <p>Revision {current.revision} · {human(current.stage)} · Responsible role {item.responsibleRole}</p>
      <p>Reviewed evidence {human(current.snapshot.readiness.readiness)} · {current.snapshot.readiness.ruleVersion}</p>
      {item.stale && <p role="alert">Source evidence has changed since this revision. Reassess before authorising a new delivery case.</p>}
      <button type="button" onClick={() => { setError(''); refreshWith(n => n + 1); }}>Refresh assessment</button>
      <details><summary>Reassess supporting evidence</summary>
        <form onSubmit={submit(data => revise({ action: 'reassess', reason: value(data, 'reason') }))}>
          <Note name="reason" label="Reason for reassessment" /><button disabled={busy}>Create reassessment revision</button>
        </form>
      </details>
      {item.approvalBlockers.length > 0 && <ul>{item.approvalBlockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {current.suitability && <details open><summary>Suitability assessment</summary>
        <p>{human(current.suitability.recommendation)} · {current.suitability.ruleVersion}</p>
        <ul>{current.suitability.factors.map(factor => <li key={factor.label}>
          {factor.label} · {human(factor.value)}{factor.reviewRequired && ' · Review required'}
        </li>)}</ul>
      </details>}
      {!item.stale && ['evidence-review', 'feasibility-review'].includes(current.stage) && <>
        <details><summary>Technical feasibility and assumptions</summary>
          <FeasibilityForm key={current.revision} initial={current.feasibility} busy={busy} save={feasibility => revise({ action: 'feasibility', feasibility })} />
        </details>
        {current.feasibility && <details open><summary>Risk register</summary>
          <RiskForm key={current.revision} initial={current.risks} rationale={current.riskRationale} busy={busy}
            save={(risks, rationale) => revise({ action: 'risks', risks, rationale })} />
        </details>}
        <form onSubmit={submit(data => revise({ action: 'submit', reason: value(data, 'submission') }))}>
          <Note name="submission" label="Reason for decision review" /><button disabled={busy}>Submit for decision</button>
        </form>
      </>}
      {!item.stale && current.stage === 'decision-pending' && <form onSubmit={submit(data => void send('/decisions', {
        revision: current.revision, outcome: choice, justification: value(data, 'justification'), conditions: lines(data, 'conditions'),
        ...(choice === 'approve-supervised-pilot' ? { pilot: { operatingLimits: value(data, 'operatingLimits'),
          humanReview: value(data, 'humanReview'), stopCriteria: value(data, 'stopCriteria') } } : {}),
      }))}>
        <label htmlFor={decisionId}>Engineering decision</label>
        <select id={decisionId} value={choice} onChange={event => setChoice(event.target.value)}>
          {decisionOutcome.options.map(outcome => <option key={outcome} value={outcome}>{decisionLabels[outcome]}</option>)}
        </select>
        <Note name="justification" label="Decision justification" />
        <Note name="conditions" label="Required conditions, one per line" required={false} />
        {choice === 'approve-supervised-pilot' && <>
          <Note name="operatingLimits" label="Pilot operating limits" /><Note name="humanReview" label="Pilot human review" />
          <Note name="stopCriteria" label="Pilot stop criteria" />
        </>}
        <button disabled={busy}>Record engineering decision</button>
      </form>}
      {!item.stale && !hasDelivery && decision?.outcome.startsWith('approve-') &&
        <button type="button" disabled={busy} onClick={() => void send('/delivery-cases', { revision: current.revision })}>Create delivery case</button>}
      <h4>Engineering decision history</h4>
      {item.decisions.length === 0 ? <p>No decision recorded.</p> : <ul>{item.decisions.map(d => <li key={d.id}>
        Revision {d.revision} · {decisionLabels[d.outcome]} · {d.actorRole} · {dateLabel(d.decidedAt)}<p>{d.justification}</p>
      </li>)}</ul>}
      {item.deliveryCases.map(d => <details key={d.id} open><summary>Delivery case · {human(d.readiness)}</summary>
        <p>Case {d.id} · Decision {d.decisionId} · Assessment revision {d.revision}</p>
        <dl>
          <dt>Scope</dt><dd>{d.plan.understanding.objective}</dd>
          <dt>Inputs and outputs</dt><dd>{d.plan.understanding.inputs} · {d.plan.understanding.outputs}</dd>
          <dt>Integration</dt><dd>{d.plan.integration.source} · {d.plan.integration.destination} · {d.plan.integration.mapping}</dd>
          <dt>Acceptance criteria</dt><dd>{d.plan.execution.successCriteria}</dd>
          <dt>Recovery and rollback</dt><dd>{d.plan.execution.recovery} · {d.plan.operations.rollback}</dd>
          <dt>Monitoring</dt><dd>{d.plan.operations.monitoring}</dd>
          <dt>Owner role</dt><dd>{d.plan.operations.recoveryOwner}</dd>
          {d.pilot && <><dt>Supervision and stop criteria</dt><dd>{d.pilot.operatingLimits} · {d.pilot.humanReview} · {d.pilot.stopCriteria}</dd></>}
        </dl>
        <ul>{d.prerequisites.map((p, i) => <li key={i}>{p.requirement} · {human(p.status)} · {p.basis}</li>)}</ul>
        {d.risks.length > 0 && <ul>{d.risks.map((risk, i) => <li key={i}>{risk.description} · {risk.residual} residual risk · {risk.mitigation}</li>)}</ul>}
        <ol>{d.plan.phases.map((phase, i) => <li key={i}>{phase}</li>)}</ol>
      </details>)}
      <details><summary>Revision and audit history</summary>
        {item.revisions.map(r => <details key={r.revision}><summary>Revision {r.revision} · {human(r.stage)}</summary>
          <p>{r.snapshot.readiness.ruleVersion} · {human(r.snapshot.readiness.readiness)}</p>
          <p>Source recommendation {human(r.snapshot.evidence.candidate.recommendation)}</p>
          <ul>{r.snapshot.records.map(record => <li key={record.receiptId}>
            <a href={`#fda-integration?receipt=${record.receiptId}`}>{record.event.sourceRecordId}</a> · {record.event.recordType}
          </li>)}</ul>
          {r.feasibility && <p>{r.feasibility.understanding.objective} · {r.feasibility.integration.method}</p>}
          {r.riskRationale && <p>{r.riskRationale}</p>}
        </details>)}
        <ol>{item.audit.map((a, i) => <li key={i}>{dateLabel(a.recordedAt)} · {a.actorRole} · {human(a.action)} · revision {a.revision} · {a.reason}</li>)}</ol>
      </details>
      <a href={path + '/export'} download>Download workflow assessment JSON</a>
    </>}
  </section>;
}
