import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { readConfig } from '../config/env.ts';
import { database } from '../db/pool.ts';
import { sourceRevision } from '../api/evidence.ts';
import { httpSimulatorAdapter, labToken } from '../modules/downstream/adapter.ts';
import { claimOperation, processClaim } from '../modules/downstream/worker.ts';

const config = readConfig('worker');
if (config.hosted) throw new Error('The downstream worker only runs in a disposable local or test lab.');
const token = labToken.parse(process.env.LAB_DOWNSTREAM_TOKEN);
if ([config.LAB_FDA_SOURCE_TOKEN, config.LAB_WRITE_TOKEN].includes(token)) throw new Error('Use a dedicated downstream service credential.');
const adapter = httpSimulatorAdapter(process.env.LAB_DOWNSTREAM_ORIGIN ?? 'http://127.0.0.1:3099', token);
const maxDispatches = z.coerce.number().int().min(1).max(10).parse(process.env.LAB_DOWNSTREAM_MAX_ATTEMPTS ?? 3);
const pool = database(config.DATABASE_URL, config.databaseOptions);
const policy = { maxDispatches, maxLookups: maxDispatches + 5, baseDelayMs: 1_000, leaseMs: 30_000,
  revision: sourceRevision(process.env.LAB_SOURCE_REVISION) };
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
const log = (event: string, operationId?: string) => console.info(JSON.stringify({ event, operationId, time: new Date().toISOString() }));
pool.on('error', () => log('downstream_database_connection_failed'));

try {
  log('downstream_worker_started');
  while (!stop.signal.aborted) {
    try {
      const claim = await claimOperation(pool, policy);
      if (claim) {
        const completed = await processClaim(pool, claim, adapter, policy);
        log(completed ? 'downstream_attempt_recorded' : 'downstream_lease_lost', claim.operation.id);
        continue;
      }
    } catch {
      log('downstream_worker_poll_failed');
    }
    await setTimeout(500, undefined, { signal: stop.signal }).catch(error => {
      if (!stop.signal.aborted) throw error;
    });
  }
} finally {
  await pool.end();
  log('downstream_worker_stopped');
}
