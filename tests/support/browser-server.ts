import { claimOperation, processClaim } from '../../backend/src/modules/downstream/worker.ts';
import { immediatePolicy, simulatorToken } from './downstream-harness.ts';
import { openBrowserDownstream } from './browser-downstream.ts';
import { setTimeout } from 'node:timers/promises';
import { createApp } from '../../backend/src/api/app.ts';
import { claimConfirmation, finishConfirmation } from '../../backend/src/workers/confirmation.ts';
import { openTestDatabase } from './database.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../database/seeds/measurement.ts';

import { fixtureProvider } from './investigation-model.ts';
import { browserSource } from './fda-fixture.ts';

const database = await openTestDatabase();
const app = createApp({ pool: database.pool, environment: 'test', investigationProvider: fixtureProvider, enableFaults: true, fdaSource: browserSource, downstream: { enabled: true, token: simulatorToken } });
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

let downstream: Awaited<ReturnType<typeof openBrowserDownstream>> | undefined;
try {
  downstream = await openBrowserDownstream();
  await seedIntelligence(database.pool);
  await seedMeasurement(database.pool);
  await app.listen({ port: 3300, host: '127.0.0.1' });
  while (!stop.signal.aborted) {
    const claim = await claimConfirmation(database.pool);
    if (claim) await finishConfirmation(database.pool, claim);
    const operation = await claimOperation(database.pool, immediatePolicy);
    if (operation) await processClaim(database.pool, operation, downstream.adapter, immediatePolicy);
    if (!claim && !operation) await setTimeout(100, undefined, { signal: stop.signal }).catch(error => {
      if (!stop.signal.aborted) throw error;
    });
  }
} finally {
  await app.close();
  await downstream?.close();
  await database.close();
}
