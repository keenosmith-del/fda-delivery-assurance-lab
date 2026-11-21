import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { Database } from '../db/pool.ts';
import { fault, operationId, submission } from '../../../shared/contracts/submissions.ts';
import { BeforeCommitError, getOperation, submit } from '../modules/submissions/service.ts';

interface Options {
  pool: Database;
  writeToken?: string;
  enableFaults?: boolean;
  logger?: boolean;
}

export function createApp({ pool, writeToken, enableFaults, logger = false }: Options) {
  const app = Fastify({ logger, bodyLimit: 4096, logController: new LogController({ disableRequestLogging: true }) });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expectedToken = writeToken ? digest(writeToken) : null;

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'INVALID_REQUEST' });
    }
    request.log.error({ reqId: request.id, errorType: error instanceof Error ? error.name : 'UnknownError' }, 'API request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async (request, reply) => {
    try {
      await pool.query('SELECT 1 FROM confirmation_jobs LIMIT 1');
      return { status: 'ready' };
    } catch {
      request.log.warn({ reqId: request.id }, 'Database readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/operations/:id', async (request, reply) => {
    const id = operationId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_OPERATION_ID' });
    const result = await getOperation(pool, id.data.toLowerCase());
    if (!result) return reply.code(404).send({ error: 'OPERATION_NOT_FOUND' });
    return result;
  });

  app.post('/api/submissions', async (request, reply) => {
    const token = request.headers.authorization;
    if (expectedToken && (typeof token !== 'string' || !token.startsWith('Bearer ') ||
      !timingSafeEqual(expectedToken, digest(token.slice(7))))) {
      return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    }

    const key = operationId.safeParse(request.headers['idempotency-key']);
    const payload = submission.safeParse(request.body);
    if (!key.success || !payload.success) return reply.code(400).send({ error: 'INVALID_SUBMISSION' });

    const requestedFault = request.headers['x-lab-fault'];
    const mode = fault.safeParse(requestedFault);
    if (requestedFault !== undefined && (!enableFaults || !mode.success)) {
      return reply.code(400).send({ error: 'FAULT_NOT_AVAILABLE' });
    }

    const id = key.data.toLowerCase();
    try {
      const result = await submit(pool, id, payload.data, mode.data === 'before-commit');
      request.log.info({ reqId: request.id, operationId: id, result }, 'Submission processed');
      if (result === 'conflict') return reply.code(409).send({ error: 'PAYLOAD_CONFLICT' });
      if (result === 'created' && mode.data === 'lost-ack') {
        return reply.code(504).send({ error: 'SIMULATED_ACK_TIMEOUT' });
      }
      const state = await getOperation(pool, id);
      if (!state) throw new Error('Committed operation was not found');
      return reply.code(state.state === 'pending_confirmation' ? 202 : 200)
        .header('location', `/api/operations/${id}`).send(state);
    } catch (error) {
      if (error instanceof BeforeCommitError) {
        request.log.info({ reqId: request.id, operationId: id }, 'Synthetic interruption rolled back');
        return reply.code(504).send({ error: 'SIMULATED_PRE_COMMIT_TIMEOUT' });
      }
      throw error;
    }
  });

  return app;
}
