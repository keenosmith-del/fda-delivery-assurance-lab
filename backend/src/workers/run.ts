import { setTimeout } from 'node:timers/promises';
import { readConfig } from '../config/env.ts';
import { database } from '../db/pool.ts';
import { claimConfirmation, finishConfirmation } from './confirmation.ts';

const pool = database(readConfig().DATABASE_URL);
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

function log(level: 'info' | 'error', event: string, operationId?: string) {
  console[level](JSON.stringify({ level, event, operationId, time: new Date().toISOString() }));
}

pool.on('error', () => log('error', 'idle_database_connection_failed'));
try {
  log('info', 'confirmation_worker_started');
  while (!stop.signal.aborted) {
    try {
      const claim = await claimConfirmation(pool);
      if (claim) {
        const finished = await finishConfirmation(pool, claim);
        log('info', finished ? 'confirmation_completed' : 'confirmation_lease_lost', claim.id);
        continue;
      }
    } catch {
      log('error', 'confirmation_poll_failed');
    }
    await setTimeout(500, undefined, { signal: stop.signal }).catch(error => {
      if (!stop.signal.aborted) throw error;
    });
  }
} finally {
  await pool.end();
}
