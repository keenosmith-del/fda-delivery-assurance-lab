import { randomUUID } from 'node:crypto';
import { recordWorker } from './telemetry.ts';
import { setTimeout } from 'node:timers/promises';
import { readConfig } from '../config/env.ts';
import { database } from '../db/pool.ts';
import { claimConfirmation, finishConfirmation } from './confirmation.ts';

const config = readConfig('worker');
const pool = database(config.DATABASE_URL, config.databaseOptions);
const instanceId = randomUUID();
let lastHeartbeat = -Infinity;
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

function log(level: 'info' | 'error', event: string, operationId?: string, errorCode?: string) {
  console[level](JSON.stringify({ level, event, instanceId, operationId, errorCode, time: new Date().toISOString() }));
}

pool.on('error', () => log('error', 'idle_database_connection_failed'));
try {
  log('info', 'confirmation_worker_started');
  while (!stop.signal.aborted) {
    try {
      if (performance.now() - lastHeartbeat >= 5000) {
        await recordWorker(pool, instanceId, 'running');
        lastHeartbeat = performance.now();
      }
      const claim = await claimConfirmation(pool);
      if (claim) {
        const finished = await finishConfirmation(pool, claim);
        log('info', finished ? 'confirmation_completed' : 'confirmation_lease_lost', claim.id);
        continue;
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      log('error', 'confirmation_poll_failed', undefined, typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'UNKNOWN');
    }
    await setTimeout(500, undefined, { signal: stop.signal }).catch(error => {
      if (!stop.signal.aborted) throw error;
    });
  }
} finally {
  await recordWorker(pool, instanceId, 'stopped').catch(() => log('error', 'heartbeat_shutdown_failed'));
  await pool.end();
}
