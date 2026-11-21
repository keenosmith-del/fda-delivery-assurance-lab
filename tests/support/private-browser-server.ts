import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createApp } from '../../backend/src/api/app.ts';
import { loadMigrations, migrationsReady } from '../../backend/src/db/migrations.ts';
import { claimConfirmation, finishConfirmation } from '../../backend/src/workers/confirmation.ts';
import { recordWorker } from '../../backend/src/workers/telemetry.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../database/seeds/measurement.ts';
import { openTestDatabase } from './database.ts';
import { privateFixture } from './private-fixture.ts';

const database = await openTestDatabase();
const expected = await loadMigrations('database/migrations');
const app = createApp({ pool: database.pool, access: privateFixture, uiDir: 'frontend/dist',
  checkSchema: () => migrationsReady(database.pool, expected) });
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

try {
  await seedIntelligence(database.pool);
  await seedMeasurement(database.pool);
  await recordWorker(database.pool, randomUUID(), 'running');
  await app.listen({ port: 3310, host: '127.0.0.1' });
  while (!stop.signal.aborted) {
    const claim = await claimConfirmation(database.pool);
    if (claim) await finishConfirmation(database.pool, claim);
    else await setTimeout(100, undefined, { signal: stop.signal }).catch(error => {
      if (!stop.signal.aborted) throw error;
    });
  }
} finally {
  await app.close();
  await database.close();
}
