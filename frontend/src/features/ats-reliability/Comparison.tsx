import { useState } from 'react';
import { comparison } from '../../../../shared/contracts/intelligence.ts';
import { jsonRequest } from '../../lib/resource.ts';

export function Comparison({ token }: { token: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof comparison.parse>>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      setResult(await jsonRequest('/api/lab/submission-comparison', comparison, {
        method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Comparison failed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel comparison">
    <h2>Compare lost-acknowledgment recovery</h2>
    <p>Both paths lose the first receipt. The reference runs in isolation. The transaction-safe path uses the submission service and PostgreSQL.</p>
    <button type="button" className="secondary" disabled={busy} onClick={() => void run()}>{busy ? 'Running comparison…' : 'Run comparison'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <div className="score-grid" aria-live="polite">{([
      ['Unreliable reference', result.unsafe], ['Transaction-safe submission', result.safe],
    ] as const).map(([title, path]) => <section className="metric" key={title}>
      <h3>{title}</h3><strong>{path.records} {path.records === 1 ? 'record' : 'records'}</strong>
      <ol>{path.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {'operationId' in path && <dl><dt>Operation ID</dt><dd><code>{path.operationId}</code></dd>
        <dt>Record ID</dt><dd><code>{path.recordId}</code></dd>
        <dt>Audit events</dt><dd>{path.events.join(', ')}</dd></dl>}
    </section>)}</div>}
  </section>;
}
