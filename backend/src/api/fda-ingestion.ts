import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FDA_EVENTS, FDA_GATEWAY, FDA_MAX_BODY } from '../../../shared/contracts/fda-ingestion.ts';
import type { FdaScope } from '../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../db/pool.ts';
import { agentProjection, workflowProjection } from '../modules/fda-ingestion/projections.ts';
import { getReceipt, getStatus, listCanonical, processEvent, receiveEvent } from '../modules/fda-ingestion/service.ts';

export type FdaSourceConfig = FdaScope & { token?: string };
const defaultSource = { tenantId: 'tenant-001', sourceId: 'source-001' } as const;
const hash = (token: string) => createHash('sha256').update(token).digest();
const receiptId = z.uuid();

export function registerFdaIngestion(app: FastifyInstance, db: Database, config: FdaSourceConfig = defaultSource, revision: string | null) {
  const { token, tenantId, sourceId } = config;
  const scope = { tenantId, sourceId };
  const expected = hash(token ?? 'disabled');
  const received = new WeakMap<FastifyRequest, Date>();
  let epoch = performance.now();
  const requests = { source: 0, anonymous: 0 };
  const budget = (bucket: keyof typeof requests, limit: number) => {
    if (performance.now() - epoch >= 60_000) {
      requests.source = 0;
      requests.anonymous = 0;
      epoch = performance.now();
    }
    if (requests[bucket] >= limit) return false;
    requests[bucket]++;
    return true;
  };

  app.post(FDA_EVENTS, {
    bodyLimit: FDA_MAX_BODY,
    onRequest: async (request, reply) => {
      const supplied = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/i)?.[1];
      const authenticated = timingSafeEqual(hash(supplied ?? ''), expected) && Boolean(token && supplied);
      if (!budget(authenticated ? 'source' : 'anonymous', authenticated ? 240 : 30)) {
        return reply.header('retry-after', '60').code(429).send({ error: 'RATE_LIMITED' });
      }
      if (!authenticated) return reply.code(401).send({ error: 'SOURCE_AUTHENTICATION_REQUIRED' });
      if (request.headers.origin !== undefined) return reply.code(403).send({ error: 'BROWSER_SOURCE_WRITE_DENIED' });
      received.set(request, new Date());
    },
  }, async (request, reply) => {
    const accepted = await receiveEvent(db, scope, request.body, received.get(request)!, revision);
    if (accepted.event) await processEvent(db, { ...accepted, event: accepted.event }, revision);
    const result = await getReceipt(db, scope, accepted.id);
    if (!result) throw new Error('Committed FDA receipt is missing');
    const status = result.status === 'processed' ? 201
      : result.status === 'duplicate' ? 200
      : result.status === 'conflict' ? 409
      : result.status === 'processing_failed' ? 503
      : result.errorCode === 'SOURCE_SCOPE_MISMATCH' ? 403 : 400;
    return reply.code(status).send(result);
  });

  app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      if (/^Bearer\s/i.test(request.headers.authorization ?? '')) {
        return reply.code(403).send({ error: 'WORKSPACE_ACCESS_REQUIRED' });
      }
    });
    routes.get('/status', async () => getStatus(db, scope, Boolean(token)));
    routes.get<{ Params: { id: string } }>('/receipts/:id', async (request, reply) => {
      const id = receiptId.safeParse(request.params.id);
      const result = id.success ? await getReceipt(db, scope, id.data) : null;
      return result ?? reply.code(404).send({ error: 'FDA_RECEIPT_NOT_FOUND' });
    });
    routes.get('/records', async () => listCanonical(db, scope));
    routes.get('/agent-health', async () => agentProjection(db, scope));
    routes.get('/workflow-evidence', async () => workflowProjection(db, scope));
  }, { prefix: FDA_GATEWAY });
}
