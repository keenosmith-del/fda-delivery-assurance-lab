import { PageHeader, SegmentLinks } from '../../components/Workspace.tsx';
import { useState } from 'react';
import { z } from 'zod';
import { opportunityModel, outcome, period } from '../../../../shared/contracts/measurement.ts';
import { useResource } from '../../lib/resource.ts';
import { AutomationPicker, minutes, percent } from '../measurement/shared.tsx';

const periodsSchema = z.array(period);

function OutcomeWorkspace({ id }: { id: string }) {
  const selection = useResource(`/api/automations/${id}/periods`, periodsSchema);
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const windows = selection.data ?? [];
  const before = windows.find(item => item.id === beforeId) ?? windows[0];
  const nextWindows = before ? windows.filter(item => item.startsOn >= before.endsOn) : [];
  const after = nextWindows.find(item => item.id === afterId) ?? nextWindows.at(-1);
  const query = before && after ? `?baseline=${before.id}&comparison=${after.id}` : '';
  const result = useResource(query ? `/api/outcomes/${id}${query}` : null, outcome);
  const evidence = result.data;
  if (selection.error) return <p role="alert">{selection.error} <button className="secondary" onClick={selection.retry}>Retry</button></p>;
  if (!selection.data) return <p role="status">Loading measurement periods…</p>;
  if (!before || !after) return <p>No comparable periods are available.</p>;

  return <>
    <section className="panel coverage-summary">
      <h2>Measurement periods</h2>
      <div className="score-grid">
        <div><label htmlFor="baseline-period">Baseline period</label>
          <select id="baseline-period" value={before.id} onChange={event => { setBeforeId(event.target.value); setAfterId(''); }}>
            {windows.filter(item => windows.some(candidate => candidate.startsOn >= item.endsOn)).map(item => (
              <option key={item.id} value={item.id}>{item.label} · {item.startsOn} to {item.endsOn}</option>
            ))}
          </select>
        </div>
        <div><label htmlFor="comparison-period">Comparison period</label>
          <select id="comparison-period" value={after.id} onChange={event => setAfterId(event.target.value)}>
            {nextWindows.map(item => <option key={item.id} value={item.id}>{item.label} · {item.startsOn} to {item.endsOn}</option>)}
          </select>
        </div>
      </div>
      {evidence && <a className="secondary export-link" href={`/api/outcomes/${id}/export${query}`} download>Download evidence JSON</a>}
    </section>
    {result.error ? <p role="alert">{result.error} <button className="secondary" onClick={result.retry}>Retry</button></p>
      : !evidence ? <p role="status">Calculating outcomes…</p> : <div className="panels measurement-panels">
        <section className="panel">
          <h2>Measured activity</h2>
          <div className="table-scroll"><table className="measurement-table">
            <thead><tr><th>Measure</th><th>Baseline</th><th>Comparison</th></tr></thead>
            <tbody>
              {([['Observed opportunities', 'observed'], ['Expected observations', 'expected'], ['Eligible opportunities', 'eligibleOpportunities'],
                ['Attempted executions', 'attempted'], ['Successful executions', 'succeeded'], ['Failed executions', 'failed'],
                ['Exceptions', 'exceptions']] as const).map(([label, key]) => (
                <tr key={key}><th scope="row">{label}</th><td>{evidence.baseline[key]}</td><td>{evidence.comparison[key]}</td></tr>
              ))}
              <tr><th scope="row">Measurement completeness</th><td>{percent(evidence.baseline.coverage)}</td><td>{percent(evidence.comparison.coverage)}</td></tr>
            </tbody>
          </table></div>
          <h3>Comparison exceptions</h3>
          {evidence.comparison.exceptionReasons.length ? <ul>{evidence.comparison.exceptionReasons.map(item => <li key={item}>{item}</li>)}</ul>
            : <p>No recorded exceptions.</p>}
          <h3>Input provenance</h3>
          <dl><dt>Baseline ledger</dt><dd>{evidence.baseline.source}</dd>
            <dt>Comparison ledger</dt><dd>{evidence.comparison.source}</dd></dl>
          {[['Baseline time study', evidence.baselineMeasurement], ['Comparison time study', evidence.comparisonMeasurement]].map(([label, entry]) => (
            <p key={String(label)}>{String(label)} · {entry && typeof entry !== 'string'
              ? `${entry.source}. ${entry.method}. ${entry.measuredItems} items, ${minutes(entry.humanHandlingSeconds)}.`
              : 'Missing.'}</p>
          ))}
        </section>
        <section className="panel">
          <h2>Modeled benefit</h2>
          <dl>
            <dt>Baseline eligibility assumption</dt><dd>{percent(evidence.baseline.modeledEligibilityBps / 10000)}</dd>
            <dt>Baseline observed eligibility</dt><dd>{percent(evidence.reconciliation.baselineObservedEligibility)}</dd>
            <dt>Estimated weekly opportunity</dt><dd>{evidence.modeledWeeklyOccurrences} occurrences</dd>
            <dt>Comparison user adoption</dt><dd>{percent(evidence.comparison.adoption)}</dd>
            <dt>Adoption-adjusted opportunity</dt><dd>{evidence.adoptionAdjustedOpportunity ?? 'Unavailable'}{evidence.adoptionAdjustedOpportunity !== null && ' occurrences'}</dd>
            <dt>Manual-time assumption</dt><dd>{minutes(evidence.baseline.baselineSecondsPerItem)} per item</dd>
            <dt>Gross estimated savings</dt><dd>{minutes(evidence.grossEstimatedSeconds)}</dd>
            <dt>Rework costs</dt><dd>{minutes(evidence.reworkSeconds)}</dd>
            <dt>Human review costs</dt><dd>{minutes(evidence.humanReviewSeconds)}</dd>
            <dt>Net estimated savings</dt><dd>{minutes(evidence.netEstimatedSeconds)}</dd>
          </dl>
          <h3>Verified synthetic outcome</h3>
          {evidence.verifiedSeconds !== null ? <p>Reviewed time studies recorded a difference of <strong>{minutes(evidence.verifiedSeconds)}</strong> in human handling across matched volumes.</p>
            : <><p>Verification incomplete.</p><ul>{evidence.verificationLimits.map(item => <li key={item}>{item}</li>)}</ul></>}
          {evidence.reconciliation.modeledMinusReviewedSeconds !== null &&
            <p>Modeled net minus reviewed difference · <strong>{minutes(evidence.reconciliation.modeledMinusReviewedSeconds)}</strong></p>}
          <p>{evidence.reconciliation.modeledScope} {evidence.reconciliation.reviewedScope} {evidence.reconciliation.limitation}</p>
        </section>
      </div>}
  </>;
}

export function Outcomes() {
  const model = useResource('/api/outcomes/model', opportunityModel);
  return <>
    <PageHeader title="Outcome Verification" summary="Compare observed work, modeled benefits and reviewed synthetic measurements." actions={<SegmentLinks label="Outcome datasets"><a href="#outcomes" aria-current="page">Legacy fixtures</a><a href="#outcomes?dataset=fda">FDA-linked Outcome Assurance</a></SegmentLinks>} />
    <section className="panel coverage-summary">
      <h2>Modeled weekly opportunity</h2>
      {model.error ? <p role="alert">{model.error} <button className="secondary" onClick={model.retry}>Retry</button></p>
        : model.data ? <p>{model.data.terms.map(term => `${term.baselineVolume} × ${term.modeledEligibilityBps / 10000}`).join(' + ')}
          {' = '}<strong>{model.data.totalModeledWeeklyOccurrences} modeled occurrences</strong></p> : <p role="status">Loading model…</p>}
    </section>
    <AutomationPicker>{id => <OutcomeWorkspace key={id} id={id} />}</AutomationPicker>
  </>;
}
