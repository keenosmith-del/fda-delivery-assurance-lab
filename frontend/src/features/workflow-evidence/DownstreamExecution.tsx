import { Metrics, Metric, SegmentLinks } from '../../components/Workspace.tsx';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DOWNSTREAM_API } from '../../../../shared/contracts/downstream.ts';
import { dateLabel } from '../../lib/dates.ts';
import { human } from './FeasibilityForm.tsx';

type Operation = {
  id: string; state: string; effect_key: string; effect: { category: string }; dispatches: number;
  reconciliations: number; last_error: string | null; verified_effect_id: string | null;
  created_at: string; redriven: boolean; accepted: boolean; authorisation: { pilot: unknown };
};
type Case = { enabled: boolean; canExecute: boolean; blocker: string | null; pilot?: unknown; operations: Operation[] };
type Evidence = { operation: Operation; canControl: boolean; job: { due_at: string; phase: string; lease_until: string | null } | null;
  attempts: { phase: string; attempt_number: number; started_at: string; metadata: unknown }[];
  history: { action: string; role: string; reason: string; recorded_at: string }[] };

const terminal = new Set(['succeeded', 'failed-terminal', 'cancelled']);
const excluded = ['EFFECT_MISMATCH', 'IDEMPOTENCY_CONFLICT', 'DOWNSTREAM_REJECTED'];
const blockers: Record<string, string> = {
  STALE_DELIVERY_EVIDENCE: 'Source evidence changed. Reassess before starting execution.',
  SUPERSEDED_DELIVERY_CASE: 'Start execution from the current delivery case.',
  DELIVERY_PREREQUISITES_UNMET: 'Verify the delivery case prerequisites before execution.',
  PILOT_REVIEW_REQUIRED: 'Confirm the supervised pilot checkpoint and stop criteria.',
};

export function DownstreamExecution({ caseId, token }: { caseId: string; token: string }) {
  const path = DOWNSTREAM_API + '/cases/' + caseId;
  const [info, setInfo] = useState<Case | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [supervision, setSupervision] = useState(false);
  const headers: HeadersInit = token ? { authorization: 'Bearer ' + token } : {};

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read(url: string) {
      const response = await fetch(url, { signal: controller.signal, headers: token ? { authorization: 'Bearer ' + token } : {} });
      if (!response.ok) throw new Error(`Execution details could not be loaded (HTTP ${response.status}).`);
      return await response.json();
    }
    async function refresh() {
      try {
        const result: Case = await read(path);
        const latest = result.operations[0];
        const details: Evidence | null = latest ? await read(DOWNSTREAM_API + '/operations/' + latest.id) : null;
        if (controller.signal.aborted) return;
        setInfo(result);
        setEvidence(details);
        if (latest && !terminal.has(details?.operation.state ?? latest.state)) timer = setTimeout(() => void refresh(), 1000);
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, token, generation]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'start';
    const key = requestKey || crypto.randomUUID();
    if (action === 'start') setRequestKey(key);
    const endpoint = action === 'start' ? path + '/start' : DOWNSTREAM_API + '/operations/' + evidence?.operation.id + '/actions';
    const payload = action === 'start' ? { requestKey: key, reason, syntheticOnly: confirmed, supervisionConfirmed: supervision } : { action, reason };
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(blockers[data.error] ?? `Execution request failed (${data.error ?? response.status}).`);
      }
      setReason('');
      setGeneration(value => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally { setBusy(false); }
  }

  const operation = evidence?.operation;
  const canRecover = evidence?.canControl && operation?.state === 'failed-terminal' && !operation.redriven
    && !excluded.includes(operation.last_error ?? '');
  const canCancel = evidence?.canControl && operation?.state === 'queued';
  return <section className="domain-section downstream-section" aria-label="Synthetic downstream execution">
    <h4>Synthetic downstream execution</h4>
    <SegmentLinks label="Execution evidence">
      <a href={`#adoption?dataset=fda&case=${caseId}`}>Open FDA-linked Adoption Diagnostics</a>
      <a href={`#outcomes?dataset=fda&case=${caseId}`}>FDA-linked Outcome Assurance</a>
      <a href={`#investigations?category=retry-reconciliation&case=${caseId}`}>Investigate downstream evidence</a>
    </SegmentLinks>
    {error && <p role="alert">{error}</p>}
    {!info && !error && <p>Loading execution eligibility…</p>}
    {info && <>
      {!info.enabled && <p>Synthetic execution is disabled in this workspace.</p>}
      {info.blocker && <p>{blockers[info.blocker] ?? human(info.blocker)}</p>}
      {!info.operations.length && info.canExecute && !info.blocker && <form onSubmit={submit}>
        <label>Execution reason <input value={reason} onChange={e => { setReason(e.target.value); setRequestKey(''); }} required minLength={12} maxLength={500} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); setRequestKey(''); }} required /> Authorise one operation against the lab simulator</label>
        {Boolean(info.pilot) && <label><input type="checkbox" checked={supervision} onChange={e => { setSupervision(e.target.checked); setRequestKey(''); }} required /> Confirm pilot review, operating limits and stop criteria</label>}
        <button disabled={busy} value="start">Start synthetic execution</button>
      </form>}
      {operation && evidence && <>
        <p className="status-pill" role="status">Execution state · {human(operation.state)}</p>
        <Metrics><Metric label="Dispatch attempts" value={operation.dispatches} /><Metric label="Authoritative lookups" value={operation.reconciliations} />
          <Metric label="Verified effect" value={operation.verified_effect_id ? 'Recorded' : 'Pending'} /></Metrics>
        <dl>
          <dt>Operation</dt><dd>{operation.id}</dd><dt>Intended effect</dt><dd>{human(operation.effect.category)}</dd>
          <dt>Adapter</dt><dd>Synthetic HTTP v1</dd><dt>Effect identity</dt><dd>{operation.effect_key}</dd>
          <dt>Created</dt><dd>{dateLabel(operation.created_at)}</dd>
          <dt>Dispatches and lookups</dt><dd>{operation.dispatches} dispatches · {operation.reconciliations} lookups</dd>
          {operation.verified_effect_id && <><dt>Verified effect</dt><dd>{operation.verified_effect_id}</dd></>}
          {operation.last_error && <><dt>Last error</dt><dd>{human(operation.last_error)}</dd></>}
          {evidence.job && <><dt>Next job</dt><dd>{evidence.job.phase} · {dateLabel(evidence.job.due_at)}</dd></>}
        </dl>
        <details><summary>Dispatch and reconciliation evidence</summary><ol>{evidence.attempts.map(a =>
          <li key={a.phase + a.attempt_number}>{a.phase} {a.attempt_number} · {dateLabel(a.started_at)}<pre>{JSON.stringify(a.metadata, null, 2)}</pre></li>)}</ol></details>
        <details><summary>Execution audit history</summary><ol>{evidence.history.map((a, i) =>
          <li key={i}>{dateLabel(a.recorded_at)} · {a.role} · {human(a.action)} · {a.reason}</li>)}</ol></details>
        {(canCancel || canRecover) && <form onSubmit={submit}>
          <label>Operator action reason <input value={reason} onChange={e => setReason(e.target.value)} required minLength={12} maxLength={500} /></label>
          {canCancel && <button disabled={busy} value="cancel">Cancel queued execution</button>}
          {canRecover && <button disabled={busy} value="reconcile">Request authoritative lookup</button>}
          {canRecover && !operation.accepted && !operation.authorisation.pilot && <button disabled={busy} value="redrive">Request safe redrive</button>}
        </form>}
        <a className="export-link" href={DOWNSTREAM_API + '/operations/' + operation.id + '/export'} download>Download downstream execution evidence</a>
      </>}
    </>}
    {info && <button type="button" onClick={() => { setError(''); setGeneration(value => value + 1); }}>Refresh execution details</button>}
  </section>;
}
