import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createSimulator, initialiseSimulator } from '../../backend/src/modules/downstream/simulator.ts';
import { httpSimulatorAdapter } from '../../backend/src/modules/downstream/adapter.ts';
import { openTestDatabase } from './database.ts';
import { simulatorToken } from './downstream-harness.ts';

export async function openBrowserDownstream() {
  const store = await openTestDatabase();
  const origin = 'http://127.0.0.1:3399';
  const adapter = httpSimulatorAdapter(origin, simulatorToken);
  if (!store.connectionString) {
    await initialiseSimulator(store.pool);
    const server = createSimulator(store.pool, simulatorToken, () => 'lost-acknowledgment');
    await server.listen({ port: 3399, host: '127.0.0.1' });
    return { adapter, async close() { await server.close(); await store.close(); } };
  }

  const child = spawn(process.execPath, ['backend/src/downstream-simulator.ts'], { env: {
    ...process.env, LAB_MODE: 'test', LAB_DOWNSTREAM_PORT: '3399', LAB_DOWNSTREAM_TOKEN: simulatorToken,
    LAB_DOWNSTREAM_DATABASE_URL: store.connectionString, LAB_DOWNSTREAM_TEST_FAULT: 'lost-acknowledgment',
  }, stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  const close = async () => { child.kill(); await closed.catch(() => {}); await store.close(); };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic simulator did not start.')), 10_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('synthetic_simulator_started')) { clearTimeout(timeout); resolve(); }
      });
      void closed.then(([code]) => { clearTimeout(timeout); reject(new Error(`Synthetic simulator exited with code ${code}.`)); },
        error => { clearTimeout(timeout); reject(error); });
    });
    return { adapter, close };
  } catch (error) { await close(); throw error; }
}
