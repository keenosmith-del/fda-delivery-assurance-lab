import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { adoptionDetail } from '../../../../shared/contracts/measurement.ts';
import { dateLabel } from '../../lib/dates.ts';
import { jsonRequest, useResource } from '../../lib/resource.ts';
import { AutomationPicker, percent } from '../measurement/shared.tsx';

const entityResponse = z.object({ id: z.uuid() });
const labels: Record<string, string> = {
  'low-adoption': 'Low adoption', 'inconsistent-usage': 'Inconsistent usage', integration: 'Missing integrations',
  permission: 'Permission limitations', workflow: 'Workflow mismatch', training: 'Training and onboarding',
  exceptions: 'Frequent exceptions', reliability: 'Execution reliability',
};

function AdoptionWorkspace({ id }: { id: string }) {
  const base = `/api/adoption/${id}`;
  const resource = useResource(base, adoptionDetail);
  const data = resource.data;
  const [periodId, setPeriodId] = useState('');
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; failure?: boolean }>();
  const [saving, setSaving] = useState(false);

  async function mutate(path: string, message: string, data: FormData) {
    setSaving(true);
    setFeedback(undefined);
    try {
      await jsonRequest(base + path, entityResponse, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      setFeedback({ text: message });
      resource.refresh();
      return true;
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Could not save the change.', failure: true });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, path: string, message: string, extra?: [string, string]) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (extra) fields.set(...extra);
    void mutate(path, message, fields).then(saved => { if (saved) form.reset(); });
  }

  if (resource.error) return <p role="alert">{resource.error} <button className="secondary" onClick={resource.retry}>Retry</button></p>;
  if (!data) return <p role="status">Loading adoption diagnostics…</p>;
  const selected = data.periods.find(item => item.id === periodId) ?? data.periods[0];
  if (!selected) return <p>No observed periods.</p>;
  const signals = data.diagnostics.filter(item => item.periodId === selected.id);

  return <>
    <div className="panel coverage-summary">
      <h2>Usage and execution trends</h2>
      <a className="secondary export-link" href={`${base}/export`} download>Download adoption evidence JSON</a>
      <p>Follow-up measurements were seeded independently of intervention records. Compare coverage, reliability and workload before interpreting changes in adoption.</p>
      <div className="table-scroll"><table className="measurement-table">
        <thead><tr><th>Period</th><th>User adoption</th><th>Opportunity usage</th><th>Attempts</th><th>Successes</th><th>Failures</th><th>Exceptions</th></tr></thead>
        <tbody>{data.periods.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{percent(item.adoption)}</td>
          <td>{percent(item.opportunityUsage)}</td><td>{item.attempted}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{item.exceptions}</td></tr>)}</tbody>
      </table></div>
    </div>
    <div className="panels measurement-panels">
      <section className="panel">
        <h2>Evidence</h2>
        <label htmlFor="adoption-period">Observation period</label>
        <select id="adoption-period" value={selected.id} onChange={event => setPeriodId(event.target.value)}>
          {data.periods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <dl>
          <dt>Eligible operators</dt><dd>{selected.eligibleUsers} of {selected.population}</dd>
          <dt>Operators who attempted execution</dt><dd>{selected.adoptedUsers}</dd>
          <dt>Observed opportunities</dt><dd>{selected.observed} of {selected.expected} expected</dd>
          <dt>Eligible opportunities</dt><dd>{selected.eligibleOpportunities}</dd>
          <dt>Execution reliability</dt><dd>{percent(selected.reliability)}</dd>
          <dt>Source</dt><dd>{selected.source}</dd>
        </dl>
        <details><summary>Operator population</summary>
          <ul>{data.population.filter(item => item.periodId === selected.id).map(item => (
            <li key={item.operatorId}>{item.operatorId} · {item.eligible ? 'Eligible' : 'Ineligible'} · {item.attempted} attempts</li>
          ))}</ul>
        </details>
        <details><summary>Exception reasons</summary>
          {selected.exceptionReasons.length ? <ul>{selected.exceptionReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            : <p>No recorded exceptions.</p>}
        </details>
        <h3>Diagnostic signals</h3>
        {signals.length ? <ul className="history">{signals.map(item => <li key={item.category}>
          <strong>{labels[item.category]}</strong><div>{item.observation}</div><small>Hypothesis to investigate · {item.possibleExplanation}</small>
        </li>)}</ul> : <p>No signals in this period.</p>}
      </section>
      <section className="panel">
        <h2>Decisions and interventions</h2>
        <details><summary>Operator access</summary>
          <label htmlFor="adoption-token">Write token, if configured</label>
          <input id="adoption-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} />
        </details>
        {feedback && <p role={feedback.failure ? 'alert' : 'status'}>{feedback.text}</p>}
        <fieldset disabled={saving} className="workflow-fields">
          {signals.length > 0 && <form key={selected.id} onSubmit={event => submit(event, '/diagnoses', 'Diagnosis recorded.', ['periodId', selected.id])}>
            <h3>Record a diagnosis</h3>
            <label htmlFor="diagnosis-category">Evidence signal</label>
            <select id="diagnosis-category" name="category" required defaultValue="">
              <option value="" disabled>Select a signal</option>
              {signals.map(item => <option key={item.category} value={item.category}>{labels[item.category]}</option>)}
            </select>
            <label htmlFor="hypothesis">Diagnostic hypothesis</label><textarea id="hypothesis" name="hypothesis" required minLength={10} maxLength={500} rows={3} />
            <button className="primary">Save diagnosis</button>
          </form>}
          {data.findings.length > 0 && <form onSubmit={event => submit(event, '/interventions', 'Intervention planned.')}>
            <h3>Plan an intervention</h3>
            <label htmlFor="finding">Diagnosis</label><select id="finding" name="findingId" required>
              {data.findings.map(item => <option key={item.id} value={item.id}>{labels[item.category]} · {item.hypothesis}</option>)}
            </select>
            <label htmlFor="action">Proposed action</label><textarea id="action" name="action" required minLength={10} maxLength={500} rows={2} />
            <label htmlFor="owner">Intervention owner</label><input id="owner" name="owner" required minLength={2} maxLength={80} />
            <label htmlFor="due">Follow-up date</label><input id="due" name="followUpOn" type="date" required />
            <button className="primary">Plan intervention</button>
          </form>}
          {data.interventions.map(item => {
            const finding = data.findings.find(entry => entry.id === item.findingId);
            const before = data.periods.find(window => window.id === finding?.periodId);
            const recorded = data.followUps.filter(entry => entry.interventionId === item.id);
            const remaining = data.periods.filter(window => item.implementedOn && window.startsOn >= item.implementedOn && window.observed &&
              !recorded.some(entry => entry.periodId === window.id));
            return <article className="observation intervention" key={item.id}>
              <h3>{item.action}</h3><p>{item.owner} · Follow-up {item.followUpOn}</p>
              {item.implementedOn ? <p>Implemented on {item.implementedOn}</p> :
                <form onSubmit={event => submit(event, `/interventions/${item.id}/implement`, 'Implementation recorded.')}>
                  <label>Implementation date<input type="date" name="implementedOn" min={before?.endsOn} required /></label>
                  <button className="secondary">Record implementation</button>
                </form>}
              {item.implementedAt && remaining.length > 0 && <form onSubmit={event => submit(event, `/interventions/${item.id}/follow-ups`, 'Follow-up recorded.')}>
                <label>Follow-up measurement period<select name="periodId" required>
                  {remaining.map(window => <option key={window.id} value={window.id}>{window.label}</option>)}
                </select></label>
                <label>Follow-up notes<textarea name="notes" placeholder="Record trade-offs and possible alternative explanations." required minLength={10} maxLength={500} rows={2} /></label>
                <button className="primary">Record follow-up</button>
              </form>}
              {recorded.map(entry => {
                const after = data.periods.find(window => window.id === entry.periodId);
                return <div key={entry.id}><strong>{after?.label} recorded</strong>
                  <p>Adoption {percent(before?.adoption ?? null)} → {percent(after?.adoption ?? null)}
                    {' · '}Reliability {percent(before?.reliability ?? null)} → {percent(after?.reliability ?? null)}
                    {' · '}Coverage {percent(before?.coverage ?? null)} → {percent(after?.coverage ?? null)}</p>
                  <p>This synthetic comparison does not establish a causal effect.</p>
                  <p>{entry.notes}</p></div>;
              })}
            </article>;
          })}
        </fieldset>
        <h3>Recorded diagnoses</h3>
        {data.findings.length ? <ul className="history">{data.findings.map(item => <li key={item.id}>
          <strong>{labels[item.category]}</strong><div>{item.evidence}</div><small>Recorded hypothesis · {item.hypothesis}</small>
        </li>)}</ul> : <p>No diagnoses recorded.</p>}
        <details><summary>Decision audit ({data.audit.length})</summary>
          <ol className="history">{data.audit.map((item) => <li key={item.id}>{item.event.replaceAll('-', ' ')}
            <small>{dateLabel(item.occurredAt)} · {item.subjectId} · {item.actorRole ?? 'Role unavailable'}</small></li>)}</ol>
        </details>
      </section>
    </div>
  </>;
}

export function Adoption() {
  return <>
    <section className="heading"><h1>Adoption Diagnostics</h1><p>Investigate automation usage, record an intervention and compare follow-up measurements.</p><a href="#adoption?dataset=fda">FDA-linked Adoption Assurance</a></section>
    <AutomationPicker>{id => <AdoptionWorkspace key={id} id={id} />}</AutomationPicker>
  </>;
}
