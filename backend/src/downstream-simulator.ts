import { z } from 'zod';
import { database } from './db/pool.ts';
import { labToken } from './modules/downstream/adapter.ts';
import { createSimulator, initialiseSimulator } from './modules/downstream/simulator.ts';

if (!['local', 'test'].includes(process.env.LAB_MODE ?? 'local') || process.env.NODE_ENV === 'production') {
  throw new Error('Run the synthetic simulator in a disposable local or test lab.');
}
const token = labToken.parse(process.env.LAB_DOWNSTREAM_TOKEN);
if ([process.env.LAB_FDA_SOURCE_TOKEN, process.env.LAB_WRITE_TOKEN].includes(token)) throw new Error('Use a dedicated downstream service credential.');
const url = z.url({ protocol: /^postgres(ql)?$/ }).parse(process.env.LAB_DOWNSTREAM_DATABASE_URL);
const port = z.coerce.number().int().min(1024).max(65535).parse(process.env.LAB_DOWNSTREAM_PORT ?? 3099);
const fault = z.enum(['pre-commit', 'lost-acknowledgment', 'rate-limit', 'reject', 'delay-lookup', 'mismatch'])
  .optional().parse(process.env.LAB_DOWNSTREAM_TEST_FAULT);
if (fault && process.env.LAB_MODE !== 'test') throw new Error('Simulator fault injection requires LAB_MODE=test.');
const pool = database(url);
await initialiseSimulator(pool);
const app = createSimulator(pool, token, fault ? () => fault : undefined);
const stop = async () => { await app.close(); await pool.end(); };
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
try {
  const address = await app.listen({ port, host: '127.0.0.1' });
  console.info(JSON.stringify({ event: 'synthetic_simulator_started', address }));
} catch (error) {
  await stop();
  throw error;
}
