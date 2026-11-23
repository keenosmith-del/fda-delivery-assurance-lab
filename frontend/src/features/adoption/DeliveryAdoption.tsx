import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { ADOPTION_ASSURANCE, adoptionCategories } from '../../../../shared/contracts/adoption-assurance.ts';
import { DOWNSTREAM_API } from '../../../../shared/contracts/downstream.ts';
import { jsonRequest, useResource } from '../../lib/resource.ts';
import { percent } from '../measurement/shared.tsx';

const measurement = z.object({ numerator: z.number(), denominator: z.number().nullable(), value: z.number().nullable() });
const window = z.object({ periodId: z.string(), missing: z.array(z.string()), coverage: z.string(), cohort: z.array(z.string()),
  adopters: z.array(z.string()), observedOpportunities: z.number(), verified: z.number(), reportedSuccess: z.number(),
  failed: z.number(), inconclusive: z.number(), handoffs: z.number(), exceptionCount: z.number(),
  rates: z.record(z.string(), measurement), sourceIds: z.array(z.string()) });
const action = z.object({ id: z.string(), actorRole: z.string(), body: z.record(z.string(), z.unknown()),
  evidence: z.object({ comparison: z.object({ changedCohort: z.boolean(), comparable: z.boolean(), reasons: z.array(z.string()),
    limitations: z.array(z.string()), rates: z.array(z.object({ metric: z.string(), countChange: z.number(), percentagePoints: z.number().nullable() })) }).optional() }).nullable() });
const detail = z.object({ workflowId: z.string(), revision: z.number(), decisionId: z.string(), status: z.string(), available: z.boolean(),
  operation: z.object({ id: z.string(), state: z.string(), effectId: z.string().nullable() }).nullable(),
  windows: z.array(window), audit: z.array(action), discrepancies: z.array(z.string()),
  signals: z.array(z.object({ category: z.string(), periodId: z.string(), rule: z.string(), explanation: z.string(),
    numerator: z.number(), denominator: z.number().nullable(), sourceIds: z.array(z.string()) })) });
const choices = z.array(z.object({ caseId: z.string(), workflowId: z.string() }));
const saved = z.object({ id: z.string() });
const human = (value: string) => value.replaceAll('-', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const labelFor = (metric: string) => ({ adoption: 'User adoption', opportunityUsage: 'Opportunity usage', reliability: 'Execution reliability',
  coverage: 'Observation coverage', exceptions: 'Exception rate' })[metric] ?? human(metric);

function DeliveryWorkspace({ caseId }: { caseId: string }) {
  const url = `${ADOPTION_ASSURANCE}/cases/${caseId}`;
  const state = useResource(url, detail);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const data = state.data;

  async function send(payload?: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await jsonRequest(payload ? url + '/actions' : url, saved, { method: 'POST', headers: {
        'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
      }, body: JSON.stringify(payload ?? {}) });
      setFailure(false);
      setMessage('Saved adoption record.');
      state.refresh();
      return true;
    } catch (error) {
      setFailure(true);
      setMessage(error instanceof Error ? error.message : 'Could not save the adoption record.');
      return false;
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, context: Record<string, string>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    if (typeof fields.implementedAt === 'string') fields.implementedAt = new Date(fields.implementedAt + 'T00:00:00Z').toISOString();
    void send({ ...fields, ...context, requestId: crypto.randomUUID() }).then(ok => { if (ok) form.reset(); });
  }

  if (state.error) return <p role="alert">{state.error} <button onClick={state.retry}>Retry</button></p>;
  if (!data) return <p role="status">Loading FDA-linked adoption evidence…</p>;
  const diagnoses = data.audit.filter(a => a.body.kind === 'diagnose');
  const plans = data.audit.filter(a => a.body.kind === 'plan');
  return <section className="panel">
    <h2>FDA-linked Adoption Assurance</h2>
    <p>{data.workflowId} · delivery case {caseId} · approval revision {data.revision}</p>
    <nav aria-label="Delivery evidence">
      <a href="#fda-integration">FDA Integration</a>{' · '}
      <a href="#agent-health?dataset=fda">Agent Health</a>{' · '}
      <a href={`#discover?dataset=fda&workflow=${data.workflowId}`}>Workflow Evidence and delivery case</a>
    </nav>
    <p role="status">Adoption state · {human(data.status)}</p>
    <p>Engineering decision {data.decisionId} · {data.operation?.effectId ? 'Downstream effect independently verified' : 'Implementation verification pending'}</p>
    {data.operation && <a href={DOWNSTREAM_API + '/operations/' + data.operation.id + '/export'}>Downstream operation evidence</a>}
    {data.discrepancies.map(item => <p key={item}>{item}</p>)}
    {!data.windows.length && <p>Adoption unknown. A declared cohort and usage observations are required.</p>}
    {data.windows.map(w => <article key={w.periodId}>
      <h3>{w.periodId} · {w.coverage}</h3>
      <table><thead><tr><th scope="col">Measure</th><th scope="col">Count</th><th scope="col">Rate</th></tr></thead>
        <tbody>{Object.entries(w.rates).map(([name, metric]) => <tr key={name}><th scope="row">{labelFor(name)}</th>
          <td>{metric.numerator} / {metric.denominator ?? 'unknown'}</td><td>{percent(metric.value)}</td></tr>)}</tbody></table>
      <p>{w.cohort.length} observed eligible participants · {w.adopters.length} distinct adopters · {w.observedOpportunities} observed opportunities</p>
      <p>{w.verified} verified successes · {w.reportedSuccess} source-reported successes · {w.failed} reported failures · {w.inconclusive} inconclusive · {w.exceptionCount} observed exceptions · {w.handoffs} human handoffs</p>
      {w.missing.map(item => <p key={item}>{item}</p>)}
      <details><summary>Observation references</summary><p>{w.sourceIds.join(', ') || 'No qualifying sources'}</p></details>
    </article>)}
    <h3>Diagnostic signals</h3>
    {data.signals.length ? <ul>{data.signals.map(s => <li key={s.periodId + s.category}>
      {s.periodId} · {human(s.category)} · {s.numerator}/{s.denominator ?? 'unknown'} · {s.rule}. {s.explanation}
    </li>)}</ul> : <p>No diagnostic signals calculated.</p>}
    <button className="secondary" onClick={state.refresh}>Refresh adoption evidence</button>{' '}
    <a href={url + '/export'} download>Download adoption evidence</a>
    <details><summary>Local credentials</summary><label>Operator token <input type="password" value={token} onChange={event => setToken(event.target.value)} /></label></details>
    {message && <p role={failure ? 'alert' : 'status'}>{message}</p>}
    {!data.available && <button disabled={busy} onClick={() => void send()}>Register adoption assessment</button>}
    {data.operation?.effectId && data.windows.length > 0 && <form onSubmit={e => submit(e, { kind: 'diagnose' })}>
      <h3>Record a diagnosis</h3>
      <label>Baseline window <select name="periodId">{data.windows.map(w => <option key={w.periodId}>{w.periodId}</option>)}</select></label>
      <label>Diagnostic category <select name="category">{adoptionCategories.map(c => <option key={c} value={c}>{human(c)}</option>)}</select></label>
      <Field label="Engineering hypothesis" name="hypothesis" /><Field label="Unresolved questions" name="unresolved" />
      <Field label="Proposed action" name="nextAction" /><Field label="Responsible role" name="responsible" />
      <Field label="Diagnosis reason" name="reason" /><button disabled={busy}>Record diagnosis</button>
    </form>}
    {diagnoses.map(d => <details key={d.id}><summary>Diagnosis · {human(String(d.body.category))}</summary>
      <p>{String(d.body.hypothesis)}</p>
      <form onSubmit={e => submit(e, { kind: 'plan', diagnosisId: d.id })}>
        <Field label="Intended improvement" name="improvement" /><Field label="Responsible role" name="responsible" />
        <label>Follow-up period <input name="followUpPeriodId" placeholder="period-002" pattern="period-[0-9]{3,8}" required /></label>
        <Field label="Planning reason" name="reason" /><button disabled={busy}>Plan intervention</button>
      </form>
    </details>)}
    {plans.map(plan => {
      const steps = data.audit.filter(a => a.body.interventionId === plan.id);
      const current = String(steps.at(-1)?.body.kind ?? 'plan');
      const next = ({ plan: 'implement', implement: 'follow-up', 'follow-up': 'review', review: 'close' } as Record<string, string>)[current];
      return <article key={plan.id}>
        <h3>Intervention · {human(current)}</h3><p>{String(plan.body.improvement)} · {String(plan.body.responsible)}</p>
        {steps.map(step => step.evidence?.comparison && <details open key={step.id}><summary>Follow-up comparison</summary>
          <p>{step.evidence.comparison.comparable ? 'Observed period change' : 'Insufficient evidence for a definitive comparison'}</p>
          {step.evidence.comparison.rates.map(r => <p key={r.metric}>{labelFor(r.metric)} · {r.percentagePoints === null ? 'rate change unknown' : `${r.percentagePoints.toFixed(1)} percentage points`} · count change {r.countChange}</p>)}
          {[...step.evidence.comparison.reasons, ...step.evidence.comparison.limitations].map((reason, i) => <p key={i}>{reason}</p>)}
        </details>)}
        {next && <form key={next} onSubmit={e => submit(e, { kind: next, interventionId: plan.id })}>
          {next === 'implement' && <label>Implemented on <input name="implementedAt" type="date" required /></label>}
          {next === 'review' && <Field label="Engineering interpretation" name="interpretation" />}
          <Field label="Transition reason" name="reason" />
          <button disabled={busy}>{({ implement: 'Record implementation', 'follow-up': 'Record follow-up', review: 'Review comparison', close: 'Close intervention' })[next]}</button>
        </form>}
      </article>;
    })}
    <details><summary>Adoption audit</summary><ol>{data.audit.map(entry => <li key={entry.id}>
      {human(String(entry.body.kind))} · {entry.actorRole} · {String(entry.body.reason)}
      {entry.body.interpretation ? <p>{String(entry.body.interpretation)}</p> : null}
    </li>)}</ol></details>
  </section>;
}

function Field({ name, label }: { name: string; label: string }) {
  return <label>{label}<input name={name} minLength={5} maxLength={1000} required /></label>;
}

export function DeliveryAdoption({ caseId }: { caseId?: string }) {
  const cases = useResource(ADOPTION_ASSURANCE + '/cases', choices);
  return <>
    <section className="heading"><h1>Adoption Diagnostics</h1><p>FDA-linked synthetic usage and intervention evidence.</p>
      <a href="#adoption">Legacy synthetic measurements</a>
    </section>
    {cases.error && <p role="alert">{cases.error}</p>}
    {!caseId && (cases.data ? cases.data.length ? <ul>{cases.data.map(item => <li key={item.caseId}>
      <a href={`#adoption?dataset=fda&case=${item.caseId}`}>{item.workflowId} · {item.caseId}</a>
    </li>)}</ul> : <p>No approved delivery cases have been recorded.</p> : <p role="status">Loading delivery cases…</p>)}
    {caseId && <DeliveryWorkspace key={caseId} caseId={caseId} />}
  </>;
}
