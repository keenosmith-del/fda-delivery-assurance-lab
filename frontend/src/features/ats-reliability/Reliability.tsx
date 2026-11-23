import { PageHeader } from '../../components/Workspace.tsx';
import { useRef, useState } from 'react';
import { Comparison } from './Comparison.tsx';
import type { FormEvent } from 'react';
import { scenarios, submission } from '../../../../shared/contracts/submissions.ts';
import type { Operation, Scenario } from '../../../../shared/contracts/submissions.ts';
import { executeScenario, readSavedAttempt, saveAttempt, scenarioLabels, syntheticCandidate } from './scenario-runner.ts';
import type { Attempt, Step } from './scenario-runner.ts';

const stateLabels: Record<Operation['state'], string> = {
  pending_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  confirmation_failed: 'Confirmation failed',
};

export function Reliability() {
  const [attempt, setAttempt] = useState<Attempt | null>(readSavedAttempt);
  const [scenario, setScenario] = useState<Scenario>(attempt?.scenario ?? 'normal');
  const [candidateCode, setCandidateCode] = useState(() => attempt?.input.candidateCode ?? syntheticCandidate());
  const [requisition, setRequisition] = useState<string>(attempt?.input.requisition ?? 'engineering');
  const [token, setToken] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [record, setRecord] = useState<Operation | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function run(current: Attempt, recover = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem('');
    if (!recover) {
      setSteps([]);
      setRecord(null);
    }
    saveAttempt(current);
    setAttempt(current);
    try {
      const result = await executeScenario(current, step => setSteps(previous => [...previous, step]), recover);
      setRecord(result);
      if (!result) setProblem('The operation is absent. Recover the same operation to try again.');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The operation could not be checked.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = submission.safeParse({ candidateCode, requisition });
    if (!input.success) {
      setProblem('Enter a synthetic candidate code such as CAND-0001 and select a requisition.');
      return;
    }
    void run({ id: crypto.randomUUID(), input: input.data, token, scenario });
  }

  return (
    <>
      <PageHeader title="ATS Reliability" summary="Run a synthetic candidate submission and trace its recovery from request to database confirmation." />
      <div className="panels reliability-panels">
        <section className="panel" aria-labelledby="scenario-title">
          <h2 id="scenario-title">Scenario runner</h2>
          <form onSubmit={start}>
            <label htmlFor="scenario">Scenario</label>
            <select id="scenario" value={scenario} onChange={event => setScenario(scenarios.parse(event.target.value))} disabled={busy}>
              {scenarios.options.map(option => <option key={option} value={option}>{scenarioLabels[option]}</option>)}
            </select>
            <label htmlFor="candidate">Candidate code</label>
            <div className="candidate-field">
              <input id="candidate" required value={candidateCode}
                onChange={event => setCandidateCode(event.target.value)} disabled={busy} maxLength={15} />
              <button type="button" className="secondary" onClick={() => setCandidateCode(syntheticCandidate())} disabled={busy}>Generate</button>
            </div>
            <label htmlFor="requisition">Requisition</label>
            <select id="requisition" value={requisition} onChange={event => setRequisition(event.target.value)} disabled={busy}>
              <option value="engineering">Engineering</option>
              <option value="operations">Operations</option>
              <option value="client-success">Client success</option>
            </select>
            <details>
              <summary>Operator access</summary>
              <label htmlFor="write-token">Write token, if configured</label>
              <input id="write-token" type="password" autoComplete="off" value={token}
                onChange={event => setToken(event.target.value)} disabled={busy} />
            </details>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking operation…' : 'Run scenario'}</button>
          </form>
        </section>
        <section className="panel result" aria-labelledby="result-title" aria-busy={busy}>
          <div className="result-heading">
            <h2 id="result-title">Operation trace</h2>
            {record && <span className={`status ${record.state}`}>{stateLabels[record.state]}</span>}
          </div>
          {!attempt && !problem && <p className="muted empty">Run a scenario to inspect the request, recovery steps and database record.</p>}
          {attempt && (
            <>
              <dl>
                <dt>Operation ID</dt>
                <dd><code>{attempt.id}</code></dd>
                <dt>Scenario</dt>
                <dd>{scenarioLabels[attempt.scenario]}</dd>
              </dl>
              <h3>Request and recovery</h3>
              <ol className="trace operation-timeline">
                {steps.map((step, index) => <li key={index}><span>{step.action}</span><small>{step.result}</small></li>)}
              </ol>
            </>
          )}
          <div role="status" className="sr-only">{record ? stateLabels[record.state] : busy ? 'Checking operation' : ''}</div>
          {problem && <p role="alert" className="error">{problem}</p>}
          {attempt && !busy && (problem || !record || record.state === 'pending_confirmation') && (
            <button type="button" className="secondary" onClick={() => void run({ ...attempt, token }, true)}>Recover this operation</button>
          )}
          {attempt && record && !busy &&
            <a className="secondary export-link" href={`/api/operations/${attempt.id}/export`} download>Download ATS evidence JSON</a>}
          {record && (
            <>
              <h3>Database result</h3>
              <dl>
                <dt>Record ID</dt>
                <dd><code>{record.recordId}</code></dd>
                <dt>Record resolution</dt>
                <dd>{record.duplicate ? 'Linked to an existing submission' : 'Created one submission'}</dd>
                <dt>Confirmation attempts</dt>
                <dd>{record.confirmationAttempts}</dd>
              </dl>
              <h3>Audit events</h3>
              <ol className="trace">
                {record.events.map((item, index) => (
                  <li key={index}><span>{item.kind.replaceAll('_', ' ')}</span><time dateTime={item.at}>{new Date(item.at).toLocaleTimeString()}</time></li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
      <Comparison token={token} />
    </>
  );
}
