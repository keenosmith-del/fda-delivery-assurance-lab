import { PageHeader, SegmentLinks, TableRegion } from '../../components/Workspace.tsx';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { OUTCOME_ASSURANCE, reviewOutcomes } from '../../../../shared/contracts/outcome-assurance.ts';
import { ADOPTION_ASSURANCE } from '../../../../shared/contracts/adoption-assurance.ts';
import { DOWNSTREAM_API } from '../../../../shared/contracts/downstream.ts';
import { jsonRequest, useResource } from '../../lib/resource.ts';

const maybeNumber = z.number().nullable();
const rate = z.object({ numerator: z.number(), denominator: maybeNumber });
const usageWindow = z.object({ periodId: z.string(), coverage: z.string(), cohort: z.array(z.string()),
  reportedSuccess: z.number(), verified: z.number(), sourceIds: z.array(z.string()),
  rates: z.object({ adoption: rate, opportunityUsage: rate }) });
const period = z.object({
  periodId: z.string(), definition: z.object({ stage: z.string(), start: z.string(), end: z.string(),
    asOf: z.string(), expectedItems: z.number(), method: z.string(), sourceRevision: z.string(), cohort: z.string() }).nullable(),
  items: z.array(z.object({ opportunity: z.string(), workload: z.string(), humanSeconds: z.number(), sourceEventIds: z.array(z.string()) })),
  missing: z.array(z.string()), sums: z.record(z.string(), maybeNumber), humanSeconds: z.number(),
});
const detail = z.object({
  adoption: z.object({ workflowId: z.string(), decisionId: z.string(), revision: z.number(), status: z.string(),
    operation: z.object({ id: z.string(), effectId: z.string().nullable() }).nullable(),
    audit: z.array(z.object({ id: z.string(), body: z.object({ kind: z.string(), improvement: z.string().optional() }) })) }),
  usage: z.object({ baseline: usageWindow.nullable(), comparison: usageWindow.nullable() }),
  context: z.object({ registered: z.boolean() }), version: z.string(),
  periods: z.array(period), verifiedEffects: z.number(), modeled: z.array(z.object({ grossSeconds: z.number(),
    netSeconds: maybeNumber, weeklyGrossSeconds: maybeNumber, weeklyNetSeconds: maybeNumber,
    input: z.object({ eventId: z.string(), periodId: z.string(), limitation: z.string(),
      volume: z.number(), manualSeconds: z.number(), recurrencesPerWeek: maybeNumber, eligibleBps: z.number(),
      suitableBps: z.number(), implementationBps: z.number(), reviewSeconds: maybeNumber, exceptionSeconds: maybeNumber,
      reworkSeconds: maybeNumber, provenance: z.string(), sourceRevision: z.string() }) })),
  comparison: z.object({ unit: z.string(), difference: maybeNumber, cohortChanged: z.boolean(),
    baselineRate: maybeNumber, comparisonRate: maybeNumber }).nullable(),
  selection: z.object({ baseline: z.string(), comparison: z.string(), method: z.string(),
    interventionId: z.string().optional() }).nullable(),
  status: z.string(), ready: z.boolean(), latestRevision: z.number(), fingerprint: z.string().nullable(),
  reviewedDifference: maybeNumber, reasons: z.array(z.string()), limitations: z.array(z.string()),
  formulas: z.record(z.string(), z.string()),
  reviewHistory: z.array(z.object({ revision: z.number(), stale: z.boolean(), fingerprint: z.string(),
    actorRole: z.string(), decision: z.object({ outcome: z.string(), justification: z.string(), limitations: z.string() }) })),
});
const casesSchema = z.array(z.object({ caseId: z.string(), workflowId: z.string() }));
const saved = z.object({ id: z.string(), revision: z.number().optional() });
const label = (value: string) => value.replaceAll('-', ' ');
const amount = (value: number | null, unit = 'seconds') =>
  value === null ? 'Unknown' : `${value.toLocaleString('en', { maximumFractionDigits: 3 })} ${unit}`;

function TimeStudy({ data }: { data: z.infer<typeof period> }) {
  return <details>
    <summary>{data.periodId} · {data.definition?.stage ?? 'undeclared'} · {data.items.length} observed items</summary>
    {data.definition && <p>{data.definition.start} to {data.definition.end} · as of {data.definition.asOf} ·
      {data.items.length}/{data.definition.expectedItems} items · {label(data.definition.method)} · {data.definition.cohort}</p>}
    <TableRegion label={`Handling effort for ${data.periodId}`}><table>
      <thead><tr><th scope="col">Effort</th><th scope="col">Observed time</th></tr></thead>
      <tbody>{Object.entries(data.sums).map(([category, seconds]) =>
        <tr key={category}><th scope="row">{label(category)}</th><td>{amount(seconds)}</td></tr>)}</tbody>
    </table></TableRegion>
    <p>Observed human handling · {amount(data.humanSeconds)}</p>
    <details><summary>Item measurements and source references</summary>
      {data.items.map(item => <p key={item.opportunity}>{item.opportunity} · {item.workload} · {amount(item.humanSeconds)} · {item.sourceEventIds.join(', ')}</p>)}
      {data.definition && <p>Source revision {data.definition.sourceRevision}</p>}
    </details>
    {data.missing.map((item, index) => <p key={index}>{item}</p>)}
  </details>;
}

function CaseOutcome({ caseId }: { caseId: string }) {
  const url = `${OUTCOME_ASSURANCE}/cases/${caseId}`;
  const [query, setQuery] = useState('');
  const state = useResource(url + query, detail);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const data = state.data;
  if (state.error) return <p role="alert">{state.error} <button onClick={state.retry}>Retry</button></p>;
  if (!data) return <p role="status">Loading outcome evidence…</p>;

  const { selection, comparison, adoption } = data;
  const baselinePeriods = data.periods.filter(p => p.definition?.stage === 'baseline');
  const comparisonPeriods = data.periods.filter(p => p.definition?.stage === 'comparison');
  const plans = adoption.audit.filter(action => action.body.kind === 'plan');

  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value) params.set(key, value);
    const next = '?' + params.toString();
    if (next === query) state.refresh();
    else setQuery(next);
    setNotice(undefined);
  }

  async function save(path: string, fields: object, confirmation: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await jsonRequest(path, saved, { method: 'POST', headers: {
        'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}),
      }, body: JSON.stringify(fields) });
      setNotice({ text: confirmation, error: false });
      state.refresh();
      return true;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not save the outcome record.', error: true });
      state.refresh();
    } finally { setBusy(false); }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || !data?.fingerprint) return;
    const form = event.currentTarget;
    void save(url + '/reviews', { ...Object.fromEntries(new FormData(form)), ...selection, requestId: crypto.randomUUID(),
      expectedRevision: data.latestRevision, fingerprint: data.fingerprint }, 'Saved outcome review.')
      .then(ok => { if (ok) form.reset(); });
  }

  return <section className="panel">
    <h2>FDA-linked Outcome Assurance</h2>
    <p>{adoption.workflowId} · delivery case {caseId} · approval revision {adoption.revision}</p>
    <SegmentLinks label="Outcome evidence links">
      <a href={`#discover?dataset=fda&workflow=${adoption.workflowId}`}>Workflow Evidence and delivery case</a>
      <a href={`#adoption?dataset=fda&case=${caseId}`}>Linked adoption and intervention evidence</a>
      <a href={'#investigations?' + new URLSearchParams({ category: 'outcome-verification', case: caseId, ...(selection && {
        baseline: selection.baseline, comparison: selection.comparison, method: selection.method,
        ...(selection.interventionId && { interventionId: selection.interventionId }),
      }) })}>Evidence Investigation</a>
    </SegmentLinks>
    <p role="status">Outcome state · {label(data.status)}</p>
    <p>Engineering decision {adoption.decisionId} · {adoption.operation?.effectId ? 'Implementation independently verified' : 'Implementation verification pending'}</p>
    <p>Adoption evidence · {label(adoption.status)}</p>
    {adoption.operation && <p><a href={DOWNSTREAM_API + '/operations/' + adoption.operation.id + '/export'}>Download downstream operation evidence</a></p>}
    <h3>Modeled opportunity</h3>
    {data.modeled.length ? data.modeled.map(model => <article className="domain-section" key={model.input.eventId}>
      <p>{model.input.periodId} · Gross {amount(model.grossSeconds)} · Net {amount(model.netSeconds)}</p>
      <p>Weekly gross {amount(model.weeklyGrossSeconds)} · Weekly net {amount(model.weeklyNetSeconds)}</p>
      <p>{model.input.limitation}</p>
      <details><summary>Model assumptions and source</summary>
        <p>{model.input.volume} items · {model.input.recurrencesPerWeek ?? 'Unknown'} periods per week · {amount(model.input.manualSeconds)} manual effort per item</p>
        <p>{model.input.eligibleBps / 100}% eligible · {model.input.suitableBps / 100}% suitable · {model.input.implementationBps / 100}% assumed implementation coverage</p>
        <p>Overhead per item · review {amount(model.input.reviewSeconds)} · exception {amount(model.input.exceptionSeconds)} · rework {amount(model.input.reworkSeconds)}</p>
        <p>{label(model.input.provenance)} · event {model.input.eventId} · revision {model.input.sourceRevision}</p>
      </details>
    </article>) : <p>No model inputs recorded.</p>}
    <h3>Observed operational effort</h3>
    {data.periods.length ? data.periods.map(p => <TimeStudy key={p.periodId} data={p} />) : <p>No time study recorded.</p>}
    {baselinePeriods.length > 0 && comparisonPeriods.length > 0 && <form onSubmit={compare} key={query}>
      <label>Baseline study <select name="baseline" defaultValue={selection?.baseline}>{baselinePeriods.map(p => <option key={p.periodId}>{p.periodId}</option>)}</select></label>
      <label>Comparison study <select name="comparison" defaultValue={selection?.comparison}>{comparisonPeriods.map(p => <option key={p.periodId}>{p.periodId}</option>)}</select></label>
      <label>Comparison method <select name="method" defaultValue={selection?.method}><option value="matched-items">Matched items</option>
        <option value="normalised-workload">Normalised workload</option></select></label>
      <label>Adoption intervention <select name="interventionId" defaultValue={selection?.interventionId}>
        <option value="">No intervention selected</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.body.improvement ?? plan.id}</option>)}</select></label>
      <button>Compare outcome periods</button>
    </form>}
    {comparison && <>
      <p className="comparison-reading">Observed difference · {amount(comparison.difference, comparison.unit)}</p>
      <p>Baseline {amount(comparison.baselineRate, 'seconds per item')} · Comparison {amount(comparison.comparisonRate, 'seconds per item')}</p>
      <p>{data.verifiedEffects} independently verified effects in the selected adoption period</p>
      {[data.usage.baseline, data.usage.comparison].map((usage, index) => usage && <details key={index}>
        <summary>{usage.periodId} adoption and eligible workload</summary>
        <p>{usage.coverage} coverage · {usage.cohort.length} observed eligible participants</p>
        <p>Eligible opportunities attempted · {usage.rates.opportunityUsage.numerator} / {usage.rates.opportunityUsage.denominator ?? 'unknown'}</p>
        <p>Eligible participants who attempted an opportunity · {usage.rates.adoption.numerator} / {usage.rates.adoption.denominator ?? 'unknown'}</p>
        <p>{usage.verified} verified effects · {usage.reportedSuccess} source-reported successes</p>
        <p>{usage.sourceIds.join(', ')}</p>
      </details>)}
      {comparison.cohortChanged && <p>The declared comparison cohort changed.</p>}
    </>}
    {data.reasons.length > 0 && <ul>{data.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    <h3>Reviewed synthetic outcome</h3>
    <p>Reviewed difference · {amount(data.reviewedDifference, comparison?.unit)}</p>
    {data.reviewHistory.length > 0 && <ol>{data.reviewHistory.map(entry => <li key={entry.revision}>
      <details><summary>Review {entry.revision} · {label(entry.decision.outcome)}{entry.stale ? ' · Stale' : ''}</summary>
        <p>{entry.actorRole} · {entry.decision.justification}</p><p>{entry.decision.limitations}</p><p>{entry.fingerprint}</p>
      </details>
    </li>)}</ol>}
    {data.fingerprint && <form onSubmit={review}>
      <label>Review decision <select name="outcome">{reviewOutcomes.filter(value => data.ready || !value.startsWith('reviewed-')).map(value =>
        <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Review justification <textarea name="justification" minLength={5} maxLength={1000} required /></label>
      <label>Review limitations <textarea name="limitations" minLength={5} maxLength={1000} required /></label>
      <button disabled={busy}>Record outcome review</button>
    </form>}
    <details><summary>Local credentials</summary><label>Operator token <input type="password" value={token} onChange={e => setToken(e.target.value)} /></label></details>
    {!data.context.registered && <button disabled={busy} onClick={() => void save(url, {}, 'Registered outcome assessment.')}>Register outcome assessment</button>}
    {notice && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <button className="secondary" onClick={state.refresh}>Refresh outcome evidence</button>{' '}
    <a href={url + '/export' + query} download>Download outcome evidence</a>
    <details><summary>Formulas and limitations</summary>
      <p>Calculation version {data.version}</p>
      {[...Object.values(data.formulas), ...data.limitations].map(value => <p key={value}>{value}</p>)}
    </details>
    <p><a href={ADOPTION_ASSURANCE + '/cases/' + caseId + '/export'} download>Download adoption evidence</a></p>
  </section>;
}

export function DeliveryOutcome({ caseId }: { caseId?: string }) {
  const cases = useResource(caseId ? null : OUTCOME_ASSURANCE + '/cases', casesSchema);
  return <>
    <PageHeader title="Outcome Verification" summary="Compare synthetic handling effort for an approved delivery case." actions={<SegmentLinks label="Outcome datasets"><a href="#outcomes">Legacy synthetic outcomes</a><a href="#outcomes?dataset=fda" aria-current="page">FDA-linked cases</a></SegmentLinks>} />
    {caseId ? <CaseOutcome key={caseId} caseId={caseId} /> : cases.error ? <p role="alert">{cases.error}</p> : cases.data ?
      cases.data.length > 0 ? <ul className="record-list case-picker">{cases.data.map(item => <li key={item.caseId}>
        <a href={`#outcomes?dataset=fda&case=${item.caseId}`}>{item.workflowId} · {item.caseId}</a>
      </li>)}</ul> : <p>No approved delivery cases have been recorded.</p> : <p role="status">Loading delivery cases…</p>}
  </>;
}
