import { PageHeader } from '../../components/Workspace.tsx';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { evidencePacket, INVESTIGATIONS, investigationCategories, modelAnalysis, reviewKinds } from '../../../../shared/contracts/investigations.ts';
import type { Citation, ModelAnalysis } from '../../../../shared/contracts/investigations.ts';
import { jsonRequest, useResource } from '../../lib/resource.ts';

const configurations = z.object({ inferenceAvailable: z.boolean(), operator: z.boolean(), local: z.boolean() });
const casesSchema = z.array(z.object({ caseId: z.string(), workflowId: z.string() }));
const row = z.object({ id: z.uuid(), caseId: z.uuid(), question: z.string(), status: z.string(),
  reviewRevision: z.number(), fingerprint: z.string() });
const rows = z.array(row);
const recordSchema = row.extend({ packet: evidencePacket, stale: z.boolean(),
  attempt: z.object({ provider: z.string(), model: z.string(), analysis: modelAnalysis.nullable(), errorCode: z.string().nullable(),
    validation: z.object({ status: z.string(), issues: z.array(z.string()), referenced: z.number(), numericChecks: z.number() }).nullable(),
  }).nullable(),
  reviews: z.array(z.object({ revision: z.number(), actorRole: z.string(), decision: z.object({ decision: z.string(), reason: z.string() }) })),
});
const resultSchema = z.object({ id: z.uuid() });
const label = (x: string) => x.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ');
const statuses: Record<string,string> = {
  'evidence-only': 'Deterministic evidence saved', disabled: 'AI inference unavailable', 'insufficient-evidence': 'Insufficient evidence for inference',
  running: 'Model inference in progress', ready: 'Human review required', 'validation-failed': 'Model validation failed',
  failed: 'Inference failed', 'needs-evidence': 'Further evidence requested',
};
const format = (value: unknown) => value === null ? 'Unknown' : String(value);
const investigationHref = (id: string, record?: string) =>
  '#investigations?' + new URLSearchParams({ case: id, ...(record && { investigation: record }) });
const localLink = (url: string) => /^\/api\/[A-Za-z0-9_/?.=&%-]+$/.test(url);

function EvidenceList({ records, expanded, idPrefix = 'citation-' }: { records: Citation[]; expanded?: string; idPrefix?: string }) {
  return <ol className="citation-list">{records.map(item => <li key={item.id} id={idPrefix + item.id}>
    <details open={expanded === item.id || undefined}>
      <summary>{item.summary} · {label(item.provenance)}{item.period && ' · ' + item.period}</summary>
      <p>{item.recordId} · {item.version}{item.timestamp && ' · ' + item.timestamp}</p>
      <dl>{Object.entries(item.facts).map(([key,value]) => <div key={key}><dt>{label(key)}</dt><dd>{format(value)}</dd></div>)}</dl>
      {item.links.filter(localLink).map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">Inspect application source record</a></p>)}
      <code>{item.id}</code>
    </details>
  </li>)}</ol>;
}

const hypothesisText: Record<string,string> = {
  'transport-after-commit': 'Investigate whether transport failed after the synthetic commit.',
  'pre-commit-interruption': 'Investigate whether the first request stopped before an effect was committed.',
  'reporting-gap': 'Check for interruptions in the expected source reporting.',
  permissions: 'Check whether permission restrictions explain the observed gap.',
  'workload-mix': 'Compare workload classes and cohort composition.',
  'review-overhead': 'Investigate whether review effort offsets changes in manual handling.',
  'onboarding-barrier': 'Test whether operators encountered an onboarding barrier.',
  'measurement-coverage': 'Inspect instrumentation and missing source measurements.',
};

function Analysis({ output, openCitation }: { output: ModelAnalysis; openCitation: (id: string) => void }) {
  const source = (id: string) => <button className="secondary" onClick={() => openCitation(id)}>{id}</button>;
  const claims = (items: ModelAnalysis['summary']) => <ul>{items.map((claim,index) =>
    <li key={index}>{label(claim.fact)} · {format(claim.value)} {source(claim.citation)}</li>)}</ul>;
  return <section className="domain-section" aria-label="Model-generated analysis">
    <h3>Investigation summary</h3>{claims(output.summary)}
    <h3>Established facts</h3>{output.establishedFacts.length ? claims(output.establishedFacts) : <p>No facts selected.</p>}
    <h3>Findings</h3>{output.findings.map((item,i) => <article key={i}><h4>{label(item.classification)}</h4>{claims(item.claims)}</article>)}
    {([['Contradictions',output.contradictions],['Missing evidence',output.missingEvidence],['Engineering risks',output.risks]] as const).map(([title,items]) =>
      <article key={title}><h3>{title}</h3>{items.length ? <ul>{items.map(id => <li key={id}>{source(id)}</li>)}</ul> : <p>None selected.</p>}</article>)}
    <h3>Possible explanations</h3>
    {output.hypotheses.length ? <ul>{output.hypotheses.map((item,i) => <li key={i}>{hypothesisText[item.kind]}{' '}
      {item.citations.map(id => <span key={id}>{source(id)}</span>)}</li>)}</ul> : <p>No hypothesis selected.</p>}
    <h3>Advisory recommendations</h3>
    <ul>{output.recommendations.map((item,i) => <li key={i}>{label(item.kind)}{' '}
      {item.citations.map(id => <span key={id}>{source(id)}</span>)}</li>)}</ul>
    <p>Confidence · {label(output.confidence)}</p>
  </section>;
}

function CaseInvestigation({ caseId, investigationId, search }: { caseId: string; investigationId?: string; search: string }) {
  const initial = new URLSearchParams(search);
  const casePath = INVESTIGATIONS + '/cases/' + caseId;
  const history = useResource(casePath,rows);
  const config = useResource(INVESTIGATIONS + '/configuration',configurations);
  const [category,setCategory] = useState(initial.get('category') ?? 'end-to-end');
  const [baseline,setBaseline] = useState(initial.get('baseline') ?? '');
  const [comparison,setComparison] = useState(initial.get('comparison') ?? '');
  const [method,setMethod] = useState(initial.get('method') ?? 'matched-items');
  const interventionId = initial.get('interventionId') ?? undefined;
  const choice = { category, ...(baseline && comparison && { baseline,comparison,method,...(interventionId && { interventionId }) }) };
  const signature = new URLSearchParams(Object.entries(choice)).toString();
  const [previewQuery,setPreviewQuery] = useState(signature);
  const preview = useResource(casePath + '/evidence?' + previewQuery,evidencePacket);
  const [token,setToken] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<{ text: string; error: boolean }>();
  const [expanded,setExpanded] = useState<string>();
  const recordPath = investigationId ? INVESTIGATIONS + '/' + investigationId : null;
  const record = useResource(recordPath,recordSchema);
  const state = record.data;
  const pending = state?.status === 'running';
  const [poll,setPoll] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPoll(value => value+1),1200);
    return () => window.clearTimeout(timer);
  },[pending,poll]);
  useEffect(() => { if (poll) record.refresh(); },[poll]);

  async function send(path: string, data: object) {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await jsonRequest(path,resultSchema,{ method:'POST',headers: { 'content-type':'application/json',
        ...(token ? { authorization:'Bearer ' + token } : {}) },body:JSON.stringify(data) });
      return result;
    } catch (error) {
      setMessage({ error:true,text:error instanceof Error ? error.message : 'Investigation request failed.' });
      return undefined;
    } finally { setBusy(false); }
  }
  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const question = new FormData(event.currentTarget).get('question');
    void send(casePath, { ...choice,question,requestId:crypto.randomUUID(),runInference:submitter?.getAttribute('value') === 'infer' }).then(result => {
      if (!result) return;
      window.location.hash = investigationHref(caseId,result.id);
      history.refresh();
    });
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !recordPath) return;
    const form = event.currentTarget;
    void send(recordPath + '/reviews',{...Object.fromEntries(new FormData(form)), requestId:crypto.randomUUID(),
      expectedRevision:state.reviewRevision,fingerprint:state.fingerprint}).then(result => {
      if (!result) return;
      form.reset();
      setMessage({ error:false,text:'Investigation review saved.' });
      record.refresh();
      history.refresh();
    });
  }
  function openCitation(id: string) {
    setExpanded(id);
    window.requestAnimationFrame(() => document.getElementById('citation-' + id)?.scrollIntoView({ block:'center' }));
  }
  const allowed = config.data?.operator || config.data?.local;
  const packet = preview.data;
  return <div className="investigation-layout">
    <section className="panel investigation-scope">
      <h2>Evidence scope</h2>
      <p>Delivery case {caseId}</p>
      {packet && <>
        <p>{packet.workflowId} · revision {packet.assessmentRevision} · {packet.tenantId} · {packet.sourceId}</p>
        <p><a href={`#discover?dataset=fda&workflow=${packet.workflowId}`}>Workflow Evidence and engineering decision</a>{' · '}
          <a href={`#adoption?dataset=fda&case=${caseId}`}>Adoption Diagnostics</a>{' · '}
          <a href={`#outcomes?dataset=fda&case=${caseId}`}>Outcome Verification</a></p>
        <p>{packet.citations.length} scoped references · {Array.from(new Set(packet.citations.map(c => c.category))).join(', ')}</p>
        {packet.truncated && <p role="alert">Evidence exceeds the record budget. Choose a narrower scope.</p>}
        {['engineering-decision','downstream-operation','missing-operation','adoption-assessment','outcome-assessment'].map(name => {
          const item = packet.citations.find(c => c.record === name);
          return item && <p key={item.id}>{item.summary} · {format(item.facts.outcome ?? item.facts.status ?? item.facts.state ?? item.facts.operationRecorded)}</p>;
        })}
        <details><summary>Preview evidence records and provenance</summary><EvidenceList records={packet.citations} idPrefix="preview-citation-" /></details>
      </>}
      {preview.error && <p role="alert">{preview.error}</p>}
      <p role="status">{config.data?.inferenceAvailable ? 'Configured provider available' : 'AI inference unavailable. Deterministic evidence is available.'}</p>
      {config.data?.local && <details><summary>Local credentials</summary><label>Operator token <input type="password" value={token} onChange={e => setToken(e.target.value)} /></label></details>}
      <form onSubmit={request}>
        <label>Investigation category <select value={category} onChange={e => setCategory(e.target.value)}>
          {investigationCategories.map(item => <option value={item} key={item}>{label(item)}</option>)}</select></label>
        <details><summary>Compare specific outcome periods</summary>
          <label>Baseline period <input value={baseline} pattern="period-[0-9]{3,8}" onChange={e => setBaseline(e.target.value)} /></label>
          <label>Comparison period <input value={comparison} pattern="period-[0-9]{3,8}" onChange={e => setComparison(e.target.value)} /></label>
          <label>Measurement method <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="matched-items">Matched items</option><option value="normalised-workload">Normalised workload</option></select></label>
        </details>
        <button type="button" className="secondary" disabled={Boolean(baseline) !== Boolean(comparison)} onClick={() =>
          signature === previewQuery ? preview.refresh() : setPreviewQuery(signature)}>Preview selected evidence</button>
        {allowed && <>
          <label>Engineering question <textarea name="question" minLength={12} maxLength={500} required /></label>
          <p>Requesting AI analysis sends this question and bounded synthetic facts to the configured provider.</p>
          <button value="evidence" disabled={busy || !packet || previewQuery !== signature}>Save evidence only</button>{' '}
          <button value="infer" disabled={busy || !packet || packet.truncated || previewQuery !== signature || !config.data?.inferenceAvailable}>Request AI analysis</button>
        </>}
      </form>
    </section>
    <section className="panel investigation-history"><h2>Investigation history</h2>
      {history.error && <p role="alert">{history.error}</p>}
      {history.data?.length ? <ul className="record-list">{history.data.map(entry => <li key={entry.id}><a href={investigationHref(caseId,entry.id)}>{entry.question}</a>{' · '}
        {statuses[entry.status] ?? label(entry.status)}</li>)}</ul> : <p>No investigations recorded for this case.</p>}
    </section>
    {record.error && <p role="alert">{record.error}</p>}
    {state && state.caseId === caseId && <section className="panel investigation-result">
      <h2>Investigation result</h2>
      <p>{state.question}</p>
      <p>Recorded scope · {label(state.packet.scope.category)}{state.packet.scope.baseline && ' · ' + state.packet.scope.baseline + ' to ' + state.packet.scope.comparison}</p>
      <p role="status">Investigation status · {statuses[state.status] ?? label(state.status)}</p>
      {state.stale && <p role="alert">Evidence changed. Start a new investigation to review current evidence.</p>}
      {state.attempt?.errorCode && <p role="alert">{label(state.attempt.errorCode)}</p>}
      {state.attempt?.validation && <p>Validation · {state.attempt.validation.status} · {state.attempt.validation.referenced} cited records · {state.attempt.validation.numericChecks} numeric checks
        {state.attempt.validation.issues.length > 0 && ' · ' + state.attempt.validation.issues.map(label).join(', ')}</p>}
      {state.attempt?.analysis && <Analysis output={state.attempt.analysis} openCitation={openCitation} />}
      <h3>Recorded citation registry</h3>
      <EvidenceList records={state.packet.citations} expanded={expanded} />
      <h3>Evidence limitations</h3><ul>{state.packet.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      <h3>Human review</h3>
      {state.reviews.map(entry => <p key={entry.revision}>Revision {entry.revision} · {label(entry.decision.decision)} · {entry.actorRole} · {entry.decision.reason}</p>)}
      {allowed && !['running','closed','superseded'].includes(state.status) && <form onSubmit={review}>
        <label>Investigation review decision <select name="decision">{reviewKinds.filter(kind => kind !== 'consider-recommendation' ||
          (!state.stale && ['ready','reviewed'].includes(state.status))).map(kind =>
          <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
        <label>Investigation review reason <textarea name="reason" minLength={5} maxLength={500} required /></label>
        <button disabled={busy}>Record investigation review</button>
      </form>}
      <button className="secondary" onClick={() => { record.refresh(); history.refresh(); }}>Refresh investigation</button>{' '}
      <a href={recordPath + '/export'} download>Download investigation evidence</a>
    </section>}
    {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </div>;
}

export function Investigation({ caseId, investigationId, workflowId, search = '' }:
  { caseId?: string; investigationId?: string; workflowId?: string; search?: string }) {
  const cases = useResource(caseId ? null : INVESTIGATIONS + '/cases' + (workflowId ? '?workflowId=' + encodeURIComponent(workflowId) : ''),casesSchema);
  return <>
    <PageHeader title="Evidence Investigation" summary="Inspect synthetic case evidence and review advisory model analysis." />
    {caseId ? <CaseInvestigation key={caseId} caseId={caseId} investigationId={investigationId} search={search} />
      : cases.error ? <p role="alert">{cases.error}</p> : cases.data ? cases.data.length ?
        <ul className="record-list case-picker">{cases.data.map(item => <li key={item.caseId}><a href={investigationHref(item.caseId)}>{item.workflowId} · {item.caseId}</a></li>)}</ul>
        : <p>No approved delivery cases are available.</p> : <p role="status">Loading delivery cases…</p>}
  </>;
}
