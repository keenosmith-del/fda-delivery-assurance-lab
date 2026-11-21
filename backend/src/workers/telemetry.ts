import type { SqlClient } from '../db/pool.ts';

export async function recordWorker(pool: SqlClient, instanceId: string, state: 'running' | 'stopped') {
  if (state === 'stopped') {
    await pool.query("UPDATE lab_worker_health SET state = 'stopped', seen_at = clock_timestamp() WHERE worker_name = $1 AND instance_id = $2",
      ['confirmation', instanceId]);
    return;
  }
  await pool.query(`
    INSERT INTO lab_worker_health (worker_name, instance_id, state) VALUES ($1, $2, 'running')
    ON CONFLICT (worker_name) DO UPDATE SET instance_id = excluded.instance_id, state = 'running', seen_at = clock_timestamp()
  `, ['confirmation', instanceId]);
}

export async function queueStatus(pool: SqlClient) {
  const [jobs, worker] = await Promise.all([
    pool.query<{ state: string; jobs: number; retries: number; age_seconds: number }>(`
      SELECT state, count(*)::int AS jobs, count(*) FILTER (WHERE attempts > 0 AND state = 'ready')::int AS retries,
        COALESCE(max(GREATEST(0, extract(epoch FROM (clock_timestamp() - available_at))))::int, 0) AS age_seconds
      FROM confirmation_jobs GROUP BY state
    `),
    pool.query<{ state: string; age_seconds: number }>(`
      SELECT state, GREATEST(0, extract(epoch FROM (clock_timestamp() - seen_at)))::int AS age_seconds
      FROM lab_worker_health WHERE worker_name = 'confirmation'
    `),
  ]);
  const counts = Object.fromEntries(jobs.rows.map(({ state, jobs }) => [state, jobs]));
  const ready = jobs.rows.find(row => row.state === 'ready');
  const last = worker.rows[0];
  return {
    worker: { state: !last ? 'unobserved' : last.state === 'stopped' ? 'stopped' : last.age_seconds > 20 ? 'stale' : 'running',
      ageSeconds: last?.age_seconds ?? null },
    queue: { ready: counts.ready ?? 0, leased: counts.leased ?? 0, complete: counts.complete ?? 0, dead: counts.dead ?? 0,
      readyRetries: ready?.retries ?? 0, oldestReadySeconds: ready?.age_seconds ?? 0 },
  };
}
