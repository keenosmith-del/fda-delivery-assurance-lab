import type { FastifyInstance } from 'fastify';
import { httpSimulatorAdapter } from '../../backend/src/modules/downstream/adapter.ts';
import { createSimulator, initialiseSimulator } from '../../backend/src/modules/downstream/simulator.ts';
import type { Fault } from '../../backend/src/modules/downstream/simulator.ts';
import { openTestDatabase } from './database.ts';

export const simulatorToken = 'isolated_synthetic_downstream_token_0001';
export const immediatePolicy = { maxDispatches: 3, maxLookups: 6, baseDelayMs: 0, leaseMs: 30_000, revision: 'a'.repeat(40) };

// Fastify injection keeps the HTTP contract and the simulator transaction executable inside restricted sandboxes.
// The Playwright harness uses the default socket-closing behaviour with the real HTTP adapter.
export function injectionTransport(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const method = init?.method === 'POST' ? 'POST' : 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers));
    const response = await app.inject({ method, url: new URL(String(input)).pathname, headers,
      payload: typeof init?.body === 'string' ? init.body : undefined });
    if (response.statusCode === 504) throw new Error('Synthetic HTTP acknowledgment was dropped');
    return new Response(response.body, { status: response.statusCode,
      headers: Object.fromEntries(Object.entries(response.headers).flatMap(([k, v]) => typeof v === 'string' ? [[k, v]] : [])) });
  };
}

export async function injectedSimulator(fault?: Fault) {
  const storage = await openTestDatabase();
  await initialiseSimulator(storage.pool);
  const makeServer = () => createSimulator(storage.pool, simulatorToken, () => fault, reply => { void reply.code(504).send(); });
  let server = makeServer();
  let adapter = httpSimulatorAdapter('http://127.0.0.1:3099', simulatorToken, 1500, injectionTransport(server));
  return {
    storage, get adapter() { return adapter; },
    async restart() {
      await server.close();
      server = makeServer();
      adapter = httpSimulatorAdapter('http://127.0.0.1:3099', simulatorToken, 1500, injectionTransport(server));
    },
    async close() { await server.close(); await storage.close(); },
  };
}
