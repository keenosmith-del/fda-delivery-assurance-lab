import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DOWNSTREAM_API, EFFECT_VERSION, operationAction, startExecution } from '../../../shared/contracts/downstream.ts';
import type { FdaScope } from '../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../db/pool.ts';
import { controlOperation, DownstreamError, operationEvidence, readCase, startOperation } from '../modules/downstream/operations.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';

const byId = z.object({ id: z.uuid() });

async function respond(reply: FastifyReply, work: (id: string) => Promise<unknown>, params: unknown) {
  const id = byId.safeParse(params);
  if (!id.success) return reply.code(400).send({ error: 'INVALID_DOWNSTREAM_ID' });
  try { return await work(id.data.id); }
  catch (error) {
    if (error instanceof DownstreamError) return reply.code(error.status).send({ error: error.message });
    throw error;
  }
}

export function registerDownstream(app: FastifyInstance, db: Database, scope: FdaScope, enabled: boolean,
  isOperator: (request: FastifyRequest) => boolean, actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext,
  serviceTokens: readonly (string | undefined)[]) {
  app.register(async routes => {
    routes.addHook('preHandler', async (request, reply) => {
      if (serviceTokens.some(token => token && request.headers.authorization === `Bearer ${token}`)) {
        return reply.code(403).send({ error: 'WORKSPACE_ROLE_REQUIRED' });
      }
    });
    routes.get('/cases/:id', (request, reply) => respond(reply, async id => {
      const state = await readCase(db, scope, id);
      return { ...state, canExecute: enabled && isOperator(request), enabled };
    }, request.params));
    routes.get('/operations/:id', (request, reply) => respond(reply, async id => ({
      ...await operationEvidence(db, scope, id), canControl: enabled && isOperator(request),
    }), request.params));
    routes.get('/operations/:id/export', (request, reply) => respond(reply, async id =>
      evidenceDownload(reply, `${id}-downstream-assurance`, context, 'synthetic downstream execution', EFFECT_VERSION,
        await operationEvidence(db, scope, id)), request.params));

    function write<T>(path: string, schema: z.ZodType<T>, work: (id: string, value: T, by: EvidenceActor) => Promise<unknown>) {
      routes.post(path, (request, reply) => {
        if (!isOperator(request)) return reply.code(403).send({ error: 'DOWNSTREAM_OPERATOR_REQUIRED' });
        if (!enabled) return reply.code(422).send({ error: 'SYNTHETIC_EXECUTION_DISABLED' });
        const body = schema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'INVALID_DOWNSTREAM_INPUT' });
        return respond(reply, async id => {
          await work(id, body.data, actor(request));
          return reply.code(202).send({ accepted: true });
        }, request.params);
      });
    }
    write('/cases/:id/start', startExecution, (id, input, by) => startOperation(db, scope, id, input, by));
    write('/operations/:id/actions', operationAction, (id, input, by) => controlOperation(db, scope, id, input, by));
  }, { prefix: DOWNSTREAM_API });
}
