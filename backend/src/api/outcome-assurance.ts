import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OUTCOME_ASSURANCE, OUTCOME_MEASUREMENTS, OUTCOME_RULE, outcomeObservation, outcomeQuery, outcomeReview } from '../../../shared/contracts/outcome-assurance.ts';
import type { AdoptionScope } from '../../../shared/contracts/adoption-assurance.ts';
import type { Database } from '../db/pool.ts';
import { AssuranceError, listAssurance } from '../modules/adoption/assurance.ts';
import { establishOutcome, readOutcomeAssurance, receiveOutcome, recordOutcomeReview } from '../modules/outcomes/assurance.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();
const params = z.object({ id: z.uuid() });
async function respond(reply: FastifyReply, work: () => unknown) {
  try { return await work(); }
  catch (error) { if (error instanceof AssuranceError) return reply.code(error.status).send({ error: error.message }); throw error; }
}

export function registerOutcomeAssurance(app: FastifyInstance, db: Database, scope: AdoptionScope, operator: (req: FastifyRequest) => boolean,
  actor: (req: FastifyRequest) => EvidenceActor, context: ExportContext, sourceToken?: string, downstreamToken?: string) {
  const expected = digest('Bearer ' + (sourceToken ?? ''));
  let until = 0, requests = 0;
  app.post(OUTCOME_MEASUREMENTS, { bodyLimit: 4096, onRequest: async (req, reply) => {
    if (!sourceToken || !timingSafeEqual(digest(req.headers.authorization ?? ''), expected)) {
      return reply.code(401).send({ error: 'SOURCE_AUTHENTICATION_REQUIRED' });
    }
    if (req.headers.origin !== undefined) return reply.code(403).send({ error: 'BROWSER_SOURCE_WRITE_DENIED' });
    if (Date.now() >= until) { until = Date.now() + 60_000; requests = 0; }
    if (requests++ >= 480) return reply.code(429).send({ error: 'RATE_LIMITED' });
  } }, (req, reply) => respond(reply, async () => {
    const input = outcomeObservation.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'INVALID_OUTCOME_MEASUREMENT' });
    const result = await receiveOutcome(db, scope, input.data);
    return reply.code(result.status === 'accepted' ? 201 : result.status === 'duplicate' ? 200 : 409).send(result);
  }));

  app.register(async routes => {
    routes.addHook('onRequest', async (req, reply) => {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
      if (token && [sourceToken, downstreamToken].includes(token)) return reply.code(403).send({ error: 'WORKSPACE_ACCESS_REQUIRED' });
    });
    routes.get('/cases', () => listAssurance(db, scope));
    function read(req: FastifyRequest, reply: FastifyReply, download: boolean) {
      const id = params.safeParse(req.params), query = outcomeQuery.safeParse(req.query);
      if (!id.success || !query.success) return reply.code(400).send({ error: 'INVALID_OUTCOME_QUERY' });
      return respond(reply, async () => {
        const { baseline, comparison, method, interventionId } = query.data;
        const result = await readOutcomeAssurance(db, scope, id.data.id, baseline && comparison
          ? { baseline, comparison, method: method ?? 'matched-items', interventionId } : undefined);
        return download ? evidenceDownload(reply, `${id.data.id}-outcome-assurance`, context, 'delivery-linked synthetic outcome', OUTCOME_RULE, result) : result;
      });
    }
    routes.get('/cases/:id', (req, reply) => read(req, reply, false));
    routes.get('/cases/:id/export', (req, reply) => read(req, reply, true));
    routes.post('/cases/:id', (req, reply) => {
      if (!operator(req)) return reply.code(403).send({ error: 'OPERATOR_REQUIRED' });
      const id = params.safeParse(req.params);
      if (!id.success || !z.strictObject({}).safeParse(req.body ?? {}).success) {
        return reply.code(400).send({ error: 'INVALID_OUTCOME_ASSESSMENT' });
      }
      return respond(reply, () => establishOutcome(db, scope, id.data.id));
    });
    routes.post('/cases/:id/reviews', (req, reply) => {
      if (!operator(req)) return reply.code(403).send({ error: 'OPERATOR_REQUIRED' });
      const id = params.safeParse(req.params), input = outcomeReview.safeParse(req.body);
      if (!id.success || !input.success) return reply.code(400).send({ error: 'INVALID_OUTCOME_REVIEW' });
      return respond(reply, () => recordOutcomeReview(db, scope, id.data.id, input.data, actor(req)));
    });
  }, { prefix: OUTCOME_ASSURANCE });
}
