import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { review, reviewInput, taskDetail, taskSummary } from '../../../../shared/contracts/intelligence.ts';
import type { TaskDetail } from '../../../../shared/contracts/intelligence.ts';
import { jsonRequest, useResource } from '../../lib/resource.ts';
import { dateLabel } from '../../lib/dates.ts';

const taskList = z.array(taskSummary);


function ReviewForm({ task, onSaved }: { task: TaskDetail; onSaved: () => void }) {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = reviewInput.safeParse(Object.fromEntries(new FormData(form)));
    if (!input.success) {
      setStatus('Enter both decisions and a reason of 5 to 500 characters.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      await jsonRequest(`/api/workflow/tasks/${task.id}/reviews`, review, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(input.data),
      });
      form.reset();
      setStatus('Review saved.');
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save the review.');
    } finally {
      setSaving(false);
    }
  }
  return <>
    <h3>Record a review</h3>
    <form onSubmit={event => void save(event)}>
      <label htmlFor="classification">Classification decision</label>
      <select id="classification" name="classification" defaultValue="" required>
        <option value="" disabled>Select a decision</option><option value="approve">Approve</option><option value="reject">Reject</option>
      </select>
      <label htmlFor="suitability">Automation suitability decision</label>
      <select id="suitability" name="suitability" defaultValue="" required>
        <option value="" disabled>Select a decision</option><option value="approve">Approve</option><option value="reject">Reject</option>
      </select>
      <label htmlFor="review-reason">Reason for this synthetic task</label>
      <textarea id="review-reason" name="reason" required minLength={5} maxLength={500} rows={3} />
      <details><summary>Operator access</summary>
        <label htmlFor="review-token">Write token, if configured</label>
        <input id="review-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} />
      </details>
      <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save review'}</button>
      <p role="status">{status}</p>
    </form>
  </>;
}

export function Discover() {
  const tasks = useResource('/api/workflow/tasks', taskList);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const active = selected || tasks.data?.[0]?.id;
  const detail = useResource(active ? `/api/workflow/tasks/${active}` : null, taskDetail);
  const task = detail.data;
  const visible = (tasks.data ?? []).filter(item => `${item.label} ${item.category}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return <>
    <section className="heading"><h1>Discover</h1><p>Inspect the synthetic events behind task classifications and automation recommendations.</p></section>
    <div className="panels">
      <section className="panel"><h2>Task candidates</h2>
        <label htmlFor="task-filter">Filter tasks</label>
        <input id="task-filter" value={filter} onChange={event => setFilter(event.target.value)} />
        {tasks.error ? <p role="alert">{tasks.error} <button className="secondary" onClick={tasks.retry}>Retry</button></p>
          : !tasks.data ? <p role="status">Loading tasks…</p> : visible.length === 0 ? <p>No matching tasks.</p> : (
            <ul className="entity-list">{visible.map(item => <li key={item.id}>
              <button type="button" aria-pressed={active === item.id} onClick={() => setSelected(item.id)}>
                <strong>{item.label}</strong><small>{item.category} · {item.evidenceCount} events</small>
              </button>
            </li>)}</ul>
          )}
      </section>
      <section className="panel">
        <h2>{task?.label ?? 'Task evidence'}</h2>
        {detail.error && <p role="alert">{detail.error} <button className="secondary" onClick={detail.retry}>Retry</button></p>}
        {!task && !detail.error && <p role="status">{active ? 'Loading task…' : 'Select a task to inspect it.'}</p>}
        {task && <>
          <p>{task.recommendation}</p>
          <div className="score-grid">
            {([['Classification confidence', task.classification], ['Automation suitability', task.suitability]] as const).map(([name, result]) => (
              <section key={name} className="metric"><h3>{name}</h3><strong>{result.score}<small> / 100</small></strong>
                <details><summary>Scoring factors</summary><ul className="factor-list">{result.factors.map(factor => (
                  <li key={factor.name}><span>{factor.name}</span><small>{factor.score}/100 · {factor.weight}% weight</small></li>
                ))}</ul></details>
              </section>
            ))}
          </div>
          <h3>Expected sequence</h3>
          <ol>{task.expectedSequence.map(step => <li key={step}>{step}</li>)}</ol>
          <h3>Evidence gaps</h3>
          {task.evidenceGaps.length ? <ul>{task.evidenceGaps.map(gap => <li key={gap}>{gap}</li>)}</ul> : <p>No gaps flagged in the sample.</p>}
          <details><summary>Supporting observations ({task.evidenceCount})</summary>
            <div className="observations">{task.evidence.map(item => <section className="observation" key={item.id}>
              <strong>{dateLabel(item.observedAt)}</strong>
              <p>{item.deviceId} · {item.durationSeconds}s{item.exception ? ' · Exception' : ''}</p>
              <ol>{item.sequence.map((step, index) => <li key={index}>{step}</li>)}</ol>
            </section>)}</div>
          </details>
          <ReviewForm key={task.id} task={task} onSaved={detail.refresh} />
          <h3>Review history</h3>
          {task.reviews.length ? <ol className="history">{task.reviews.map(item => <li key={item.id}>
            <strong>Classification: {item.classification} · Suitability: {item.suitability}</strong>
            <div>{item.reason}</div><small>{dateLabel(item.reviewedAt)}</small>
          </li>)}</ol> : <p>No reviews recorded.</p>}
        </>}
      </section>
    </div>
  </>;
}
