import { Metrics, Metric } from '../../components/Workspace.tsx';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { z } from 'zod';
import { assuranceAssessment, incidentDetail, incidentSummary, workflowAssurance } from '../../../../shared/contracts/agent-assurance.ts';
import type { AssuranceDevice, IncidentCommand } from '../../../../shared/contracts/agent-assurance.ts';
import { FDA_GATEWAY } from '../../../../shared/contracts/fda-ingestion.ts';
import { dateLabel } from '../../lib/dates.ts';
import { useResource } from '../../lib/resource.ts';

const base = `${FDA_GATEWAY}/assurance`;
const summaries = z.array(incidentSummary);
const evidenceList = assuranceAssessment.shape.devices.element.shape.timeline;
const checks = z.array(z.object({ description: z.string(), satisfied: z.boolean() }));
const human = (value: string) => value.replaceAll(/[-_]/g, ' ');
const path = (id: string, windowId = '') =>
  `#agent-health?dataset=fda&incident=${id}${windowId ? `&window=${windowId}` : ''}`;
const time = (value: string | null) => value ? dateLabel(value) : 'Unknown';
const delay = (value: number | null) => value === null ? 'Unknown' : `${value.toLocaleString()} seconds`;

const errors: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in with the operator account to record decisions.',
  AGENT_OPERATOR_REQUIRED: 'This action requires operator access or the configured local operator token.',
  INSUFFICIENT_ACCESS: 'This account can inspect the workspace. Incident decisions require operator access.',
  INVALID_AGENT_ACTION: 'Check the required fields, owner role, dates and note lengths.',
  INVALID_AGENT_INCIDENT: 'Choose a valid endpoint and incident condition.',
  INVALID_INCIDENT_TRANSITION: 'The incident has moved to a different stage. Refresh its current state.',
  NO_QUALIFYING_CONDITION: 'The selected assessment no longer contains this operational condition.',
  UNRELATED_SOURCE_EVIDENCE: 'Select source evidence from this incident or its endpoint.',
  INVALID_VERIFICATION_ASSESSMENT: 'Choose a window that includes or follows the detected condition.',
};

function Sources({ records }: { records: AssuranceDevice['timeline'] }) {
  return <ul>{records.map(record => <li key={record.id}>
    <a href={`#fda-integration?receipt=${record.id}`}>{record.sourceRecordId}</a> · {record.recordType}
    <small> Occurred {time(record.occurredAt)} · Received {time(record.receivedAt)}</small>
  </li>)}</ul>;
}

function DeviceAssessment({ device }: { device: AssuranceDevice }) {
  return <>
    <dl>
      <dt>Registration</dt><dd>{device.registration ? `${device.registration.os} · enrolled ${time(device.registration.enrolledAt)}` : 'Not reported'}</dd>
      <dt>Lifecycle</dt><dd>{human(device.lifecycle)}</dd><dt>Connectivity</dt><dd>{human(device.connectivity)}</dd>
      <dt>Last heartbeat</dt><dd>{time(device.lastHeartbeat)}</dd>
      <dt>Last observation</dt><dd>{time(device.lastObservation)} · {device.freshness}</dd>
      <dt>Capture</dt><dd>{device.capture}</dd>
      <dt>Reported queue</dt><dd>{device.queueCount === null ? 'Unknown' : `${device.queueCount} events`}</dd>
      <dt>Version</dt><dd>{device.versionHistory[0]?.version ?? 'Unknown'} · {human(device.updateState)} · {device.versionPolicy} by lab policy</dd>
      <dt>Readiness</dt><dd>{human(device.readiness)}</dd>
    </dl>
    <ul>{device.factors.map(factor => <li key={factor}>{factor}</li>)}</ul>
    <details><summary>Permission and version history</summary>
      {device.permissionHistory.length ? <ul>{device.permissionHistory.map(({ value, evidence }) => <li key={evidence.id}>
        {value.category} {value.status} · reported {time(value.reportedAt)} · consent reference {value.consentReference}{' '}
        <a href={`#fda-integration?receipt=${evidence.id}`}>{evidence.sourceRecordId}</a>
      </li>)}</ul> : <p>Permissions unknown.</p>}
      {device.versionHistory.length ? <ul>{device.versionHistory.map(({ version, evidence }) => <li key={evidence.id}>
        {version} · {time(evidence.occurredAt)} <a href={`#fda-integration?receipt=${evidence.id}`}>{evidence.sourceRecordId}</a>
      </li>)}</ul> : <p>Version unknown.</p>}
    </details>
    <details><summary>Coverage and delivery timing</summary>
      {device.missingIntervals.map(interval => <p key={interval.start}>Missing {time(interval.start)} to {time(interval.end)}</p>)}
      {device.observations.map(observation => <p key={observation.evidence.id}>
        Observed {time(observation.observedAt)} · source occurrence to receipt {delay(observation.occurrenceToReceiptSeconds)}
        {' '}· observation to receipt {delay(observation.observationToReceiptSeconds)}
        {observation.reportedAfterWindow && ' · Source reported after window'}
        {observation.arrivedAfterWindow && ' · Arrived after window'}
      </p>)}
    </details>
    <details><summary>Observed source timeline</summary><Sources records={device.timeline} /></details>
  </>;
}

function Note({ name, label }: { name: string; label: string }) {
  return <label>{label}<textarea name={name} required minLength={5} maxLength={500} rows={2} /></label>;
}

const interventions = ['review-permissions', 'restore-reporting', 'review-version', 'investigate-delivery',
  'request-observations', 'validate-configuration', 'investigate-missing-events'] as const;

function IncidentCase({ id, send, busy, windowId }: { id: string; send: (api: string, input: IncidentCommand) => Promise<boolean>;
  busy: boolean; windowId: string }) {
  const record = useResource(`${base}/incidents/${encodeURIComponent(id)}`, incidentDetail);
  const item = record.data;
  if (record.error) return <p role="alert">{record.error}</p>;
  if (!item) return <p role="status">Loading incident…</p>;
  const action = async (input: IncidentCommand) => {
    if (await send(`/incidents/${id}/actions`, input)) record.refresh();
  };
  const submit = (handler: (form: FormData) => IncidentCommand) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void action(handler(new FormData(event.currentTarget)));
  };
  const value = (form: FormData, name: string) => String(form.get(name) ?? '');
  const plan = item.audit.find(event => event.action === 'plan');
  const verification = item.audit.findLast(event => event.action === 'verify');
  return <section className="panel">
    <h3>Incident {item.id}</h3>
    <p>{item.endpointId} · {item.windowId} · {human(item.category)} · <strong>{human(item.state)}</strong></p>
    <p>Detected {time(item.detectedAt)}{item.resolvedAt && ` · Verified ${time(item.resolvedAt)}`}</p>
    <h4>Observed condition</h4><p>{item.initial.condition.reason}</p>
    <Sources records={item.initial.condition.evidence} />
    <p>Initial assessment {time(item.initial.assessment.asOf)} · {item.initial.ruleVersion}</p>
    <details><summary>Endpoint evidence at detection</summary><DeviceAssessment device={item.initial.endpoint} /></details>
    {item.current && <details><summary>Current endpoint evidence</summary><DeviceAssessment device={item.current} /></details>}
    {item.workflows.length > 0 && <p>Potentially affected workflow evidence{' '}
      {item.workflows.map(workflow => <a key={workflow} href={`#discover?dataset=fda&workflow=${workflow}`}>{workflow} </a>)}
    </p>}
    {item.state === 'open' && <form onSubmit={submit(form => ({ action: 'diagnose', category: item.category,
      hypothesis: value(form, 'hypothesis'), evidence: form.getAll('receipt').map(String),
      certainty: value(form, 'certainty') as 'tentative' | 'supported' | 'inconclusive',
      unknowns: value(form, 'unknowns'), nextAction: value(form, 'nextAction') }))}>
      <h4>Record investigation</h4>
      <p>Use synthetic operational details. Treat the diagnosis as an engineering hypothesis.</p>
      <Note name="hypothesis" label="Engineering hypothesis" /><Note name="unknowns" label="Unresolved questions" />
      <Note name="nextAction" label="Proposed next action" />
      <label>Evidence sufficiency <select name="certainty"><option value="tentative">Tentative</option>
        <option value="supported">Supported</option><option value="inconclusive">Inconclusive</option></select></label>
      <fieldset><legend>Supporting source receipts</legend>{item.initial.condition.evidence.map(receipt => <label key={receipt.id}>
        <input name="receipt" type="checkbox" value={receipt.id} defaultChecked /> {receipt.sourceRecordId}
      </label>)}</fieldset>
      <button type="submit" disabled={busy}>Record diagnosis</button>
    </form>}
    {item.state === 'investigating' && <form onSubmit={submit(form => ({ action: 'plan',
      intervention: value(form, 'intervention') as typeof interventions[number], reason: value(form, 'reason'),
      owner: value(form, 'owner'), target: value(form, 'target') }))}>
      <h4>Plan intervention</h4>
      <label>Corrective action <select name="intervention">{interventions.map(option => <option key={option} value={option}>{human(option)}</option>)}</select></label>
      <Note name="reason" label="Intervention reason" />
      <label>Owner role <input name="owner" required pattern="[a-z][a-z0-9\-]{2,39}" placeholder="engineer" /></label>
      <label>Follow-up date <input name="target" type="date" required /></label>
      <button type="submit" disabled={busy}>Plan intervention</button>
    </form>}
    {plan && <p>Recovery criteria {String(plan.detail.criteria)}</p>}
    {item.state === 'intervention_planned' && <form onSubmit={submit(form => ({ action: 'implement', note: value(form, 'note') }))}>
      <Note name="note" label="Implementation note" /><button type="submit" disabled={busy}>Record implementation</button>
    </form>}
    {item.state === 'awaiting_verification' && <button type="button" disabled={busy}
      onClick={() => void action({ action: 'verify', ...(windowId ? { windowId } : {}) })}>Evaluate recovery</button>}
    {verification && <section>
      <h4>Latest verification</h4><p>{human(String(verification.detail.outcome))}</p>
      <ul>{(checks.safeParse(verification.detail.predicates).data ?? []).map(check => <li key={check.description}>
        {check.satisfied ? 'Met' : 'Unmet'} · {check.description}
      </li>)}</ul>
      <Sources records={evidenceList.safeParse(verification.detail.evidence).data ?? []} />
    </section>}
    <h4>Incident audit history</h4>
    <ol>{item.audit.map((event, index) => <li key={index}>
      <strong>{event.action}</strong> · {human(event.after)} · {event.actor} · {time(event.at)}
      {typeof event.detail.hypothesis === 'string' && <p>Hypothesis ({String(event.detail.certainty)}) {event.detail.hypothesis}.
        Unknowns {String(event.detail.unknowns)}. Next action {String(event.detail.nextAction)}.</p>}
      {typeof event.detail.intervention === 'string' && <p>{human(event.detail.intervention)} · {String(event.detail.owner)}
        {' '}· {String(event.detail.target)} · {String(event.detail.reason)}</p>}
      {typeof event.detail.note === 'string' && <p>{event.detail.note}</p>}
      {typeof event.detail.outcome === 'string' && <p>{human(event.detail.outcome)}</p>}
      {evidenceList.safeParse(event.detail.evidence).data && <Sources records={evidenceList.parse(event.detail.evidence)} />}
    </li>)}</ol>
    <a href={`${base}/incidents/${id}/export`} download>Download operational assurance JSON</a>
  </section>;
}

export function AgentAssurancePanel({ incidentId, selectedWindow }: { incidentId?: string; selectedWindow?: string }) {
  const [windowId, setWindowId] = useState(selectedWindow ?? '');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const assessment = useResource(`${base}/assessment${windowId ? `?windowId=${encodeURIComponent(windowId)}` : ''}`, assuranceAssessment);
  const incidents = useResource(`${base}/incidents`, summaries);
  const data = assessment.data;
  const cases = incidents.data ?? [];
  async function send(api: string, input: unknown) {
    setBusy(true);
    setError('');
    try {
      const result = await fetch(base + api, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
      const payload = await result.json();
      if (!result.ok) throw new Error(errors[payload.error] ?? `Incident request returned HTTP ${result.status}.`);
      const incident = incidentSummary.parse(payload);
      incidents.refresh();
      if (incident.id !== incidentId) window.location.hash = path(incident.id, windowId);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the incident action.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel agent-assurance">
    <h2>Agent operational assurance</h2>
    <p>Source-backed assessment and incident decisions for synthetic endpoints.</p>
    <details><summary>Local operator access</summary><label>Operator token <input type="password" autoComplete="off"
      value={token} onChange={event => setToken(event.target.value)} /></label></details>
    {(error || assessment.error || incidents.error) && <p role="alert">{error || assessment.error || incidents.error}</p>}
    {incidentId && <IncidentCase key={incidentId} id={incidentId} send={send} busy={busy} windowId={windowId} />}
    <label>Observation window <select value={windowId} onChange={event => setWindowId(event.target.value)}>
      <option value="">Latest</option>{data?.windows.map(window => <option key={window.windowId} value={window.windowId}>{window.windowId}</option>)}
    </select></label>
    <button type="button" onClick={() => { assessment.refresh(); incidents.refresh(); }}>Refresh assurance</button>
    {!data && !assessment.error && <p role="status">Loading operational assessment…</p>}
    {data && <><p>{data.window?.windowId ?? 'No observation window'} · as of {time(data.asOf)} · {data.ruleVersion}</p>
      <p>Last canonical receipt {time(data.lastReceipt)}</p>
      <Metrics><Metric label="Eligible" value={data.counts.eligible} /><Metric label="Registered" value={data.counts.registered} />
        <Metric label="Reporting" value={data.counts.reporting} /><Metric label="Observed" value={data.counts.observed} /></Metrics>
      <dl>
        <dt>Screen permission granted</dt><dd>{data.counts.permissionGranted}</dd>
        <dt>Complete evidence</dt><dd>{data.counts.complete}</dd><dt>Degraded or unavailable</dt><dd>{data.counts.degraded}</dd>
        <dt>Delayed observations</dt><dd>{data.counts.delayed}</dd>
        <dt>Source-declared completeness</dt><dd>{data.window?.completeness ?? 'Unknown'}</dd>
        <dt>Lab evidence completeness</dt><dd>{data.completeness}</dd>
        <dt>Open incidents</dt><dd>{cases.filter(item => item.state !== 'resolved').length}</dd>
        <dt>Awaiting verification</dt><dd>{cases.filter(item => item.state === 'awaiting_verification').length}</dd>
        <dt>Resolved incidents</dt><dd>{cases.filter(item => item.state === 'resolved').length}</dd>
      </dl>
      {data.disagreements.map(reason => <p key={reason}>{reason}</p>)}
      {data.devices.map(device => <details key={device.endpointId}>
        <summary>{device.endpointId} assurance · {human(device.readiness)}</summary>
        <DeviceAssessment device={device} />
        {device.conditions.map(condition => <p key={condition.category}>
          <button type="button" disabled={busy} onClick={() => void send('/incidents', {
            endpointId: device.endpointId, category: condition.category, windowId: data.window?.windowId,
          })}>Open {human(condition.category)} incident</button>
        </p>)}
      </details>)}
    </>}
    <h3>Incident history</h3>
    {incidents.data?.length === 0 ? <p>No incidents opened.</p> : <ul>{cases.map(item => <li key={item.id}>
      <a href={path(item.id, item.windowId)}>{item.endpointId} · {human(item.category)} · {human(item.state)}</a>
    </li>)}</ul>}
  </section>;
}

export function WorkflowReadiness({ item, loaded, error }: {
  item?: z.infer<typeof workflowAssurance>[number]; loaded: boolean; error?: string;
}) {
  if (error) return <p role="alert">{error}</p>;
  if (!item) return <p>Operational evidence status {loaded ? 'unknown' : 'loading'}</p>;
  const labels: Record<typeof item.readiness, ReactNode> = {
    'ready-for-review': 'Ready for engineering review', 'additional-evidence-required': 'Additional evidence required',
    'blocked-by-operations': 'Blocked by operational conditions', unknown: 'Evidence status unknown',
  };
  return <section>
    <h3>Operational evidence readiness</h3><p>{labels[item.readiness]}</p>
    <p>Review readiness is separate from automation suitability and approval.</p>
    {item.windows.map(window => <div key={window.windowId}>
      <h4><a href={`#agent-health?dataset=fda&window=${window.windowId}`}>{window.windowId}</a></h4>
      {window.affectedEndpoints.length > 0 && <p>Affected endpoints {window.affectedEndpoints.join(', ')}</p>}
      {window.gaps.map(gap => <p key={gap}>{gap}</p>)}
      {window.blockers.map(blocker => <p key={blocker.endpointId + blocker.category}>
        {blocker.endpointId} · {human(blocker.category)} · {blocker.reason}
      </p>)}
      {window.missingIntervals.map(interval => <p key={interval.endpointId + interval.start}>
        {interval.endpointId} missing {time(interval.start)} to {time(interval.end)}
      </p>)}
      {window.incidents.map(incident => <p key={incident.id}>
        <a href={path(incident.id, window.windowId)}>{incident.endpointId} · {human(incident.category)} · {human(incident.state)}</a>
      </p>)}
    </div>)}
  </section>;
}
