import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { INVESTIGATIONS, investigationRequest, investigationReview, investigationScope, RETRIEVAL_VERSION } from '../../../shared/contracts/investigations.ts';
import type { FdaScope } from '../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../db/pool.ts';
import { AssuranceError, listAssurance } from '../modules/adoption/assurance.ts';
import { finishInvestigation, InvestigationError, listInvestigations, previewInvestigation, readInvestigation, requestInvestigation,
  reviewInvestigation } from '../modules/investigations/service.ts';
import type { Provider } from '../modules/investigations/provider.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';

const params = z.strictObject({ id: z.uuid() });
const caseFilter = z.strictObject({ workflowId: z.string().regex(/^workflow-[0-9]{3,8}$/).optional() });
async function respond(request: FastifyRequest, reply: FastifyReply, work: (id: string) => unknown) {
  const id = params.safeParse(request.params);
  if (!id.success) return reply.code(400).send({ error: 'INVALID_INVESTIGATION_IDENTIFIER' });
  try { return await work(id.data.id); }
  catch (error) {
    if (error instanceof InvestigationError || error instanceof AssuranceError) return reply.code(error.status).send({ error: error.message });
    throw error;
  }
}

export function registerInvestigations(app: FastifyInstance, db: Database, scope: FdaScope, operator: (request: FastifyRequest) => boolean,
  actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext, forbidden: (string | undefined)[], provider?: Provider) {
  const active = new Set<Promise<void>>();
  app.addHook('onClose', async () => { await Promise.allSettled(active); });
  app.register(async routes => {
    routes.addHook('onRequest', async (req, reply) => {
      const authorization = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
      if (authorization && forbidden.includes(authorization)) return reply.code(403).send({ error: 'WORKSPACE_ACCESS_REQUIRED' });
    });
    routes.get('/configuration', req => ({ inferenceAvailable: Boolean(provider), operator: operator(req), local: ['local','test'].includes(context.mode), applicationRevision: context.revision }));
    routes.get('/cases', async (req, reply) => {
      const result = caseFilter.safeParse(req.query);
      if (!result.success) return reply.code(400).send({ error: 'INVALID_CASE_FILTER' });
      const cases = await listAssurance(db, scope);
      return result.data.workflowId ? cases.filter(item => item.workflowId === result.data.workflowId) : cases;
    });
    routes.get('/cases/:id', (req,reply) => respond(req,reply,id => listInvestigations(db,scope,id)));
    routes.get('/cases/:id/evidence', (req,reply) => {
      const query = investigationScope.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'INVALID_INVESTIGATION_SCOPE' });
      return respond(req,reply,id => previewInvestigation(db,scope,id,query.data));
    });
    routes.post('/cases/:id', { bodyLimit: 2048 }, (req,reply) => {
      if (!operator(req)) return reply.code(403).send({ error: 'INVESTIGATION_OPERATOR_REQUIRED' });
      const input = investigationRequest.safeParse(req.body);
      if (!input.success) return reply.code(400).send({ error: 'INVALID_INVESTIGATION_REQUEST' });
      return respond(req,reply,async id => {
        const result = await requestInvestigation(db,scope,id,input.data,actor(req),provider);
        if (result.packet && provider) {
          const task = finishInvestigation(db,scope,result.id,result.packet,input.data.question,provider)
            .catch(() => { req.log.error({ investigationId: result.id }, 'Investigation persistence interrupted'); })
            .finally(() => { active.delete(task); });
          active.add(task);
        }
        return reply.code(result.status === 'running' ? 202 : 200).send({ id: result.id,status: result.status });
      });
    });
    routes.get('/:id', (req,reply) => respond(req,reply,id => readInvestigation(db,scope,id)));
    routes.get('/:id/export', (req,reply) => respond(req,reply,async id =>
      evidenceDownload(reply,id + '-investigation',context,'synthetic evidence investigation',RETRIEVAL_VERSION,await readInvestigation(db,scope,id))));
    routes.post('/:id/reviews', { bodyLimit: 2048 }, (req,reply) => {
      if (!operator(req)) return reply.code(403).send({ error: 'INVESTIGATION_OPERATOR_REQUIRED' });
      const input = investigationReview.safeParse(req.body);
      if (!input.success) return reply.code(400).send({ error: 'INVALID_INVESTIGATION_REVIEW' });
      return respond(req,reply,id => reviewInvestigation(db,scope,id,input.data,actor(req)));
    });
  }, { prefix: INVESTIGATIONS });
}
