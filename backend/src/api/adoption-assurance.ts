import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ADOPTION_ASSURANCE, ADOPTION_CALCULATION, ADOPTION_OBSERVATIONS, adoptionAction, observation } from '../../../shared/contracts/adoption-assurance.ts';
import type { AdoptionScope } from '../../../shared/contracts/adoption-assurance.ts';
import type { Database } from '../db/pool.ts';
import { AssuranceError, establishAssurance, listAssurance, readAssurance, receiveObservation, recordAssuranceAction } from '../modules/adoption/assurance.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';

const identity = z.object({ id: z.uuid() });
const digest = (token: string) => createHash('sha256').update(token).digest();
async function respond(reply: FastifyReply, work: () => Promise<unknown>) {
  try { return await work(); }
  catch (e) { if (e instanceof AssuranceError) return reply.code(e.status).send({ error: e.message }); throw e; }
}

export function registerAdoptionAssurance(app: FastifyInstance, db: Database, scope: AdoptionScope, canWrite: (r: FastifyRequest) => boolean,
  actor: (r: FastifyRequest) => EvidenceActor, context: ExportContext, sourceToken?: string, downstreamToken?: string) {
  const expectedBearer = digest('Bearer ' + (sourceToken ?? ''));
  let started = Date.now(), requests = 0;
  app.post(ADOPTION_OBSERVATIONS, { bodyLimit: 4096, onRequest: async (req, reply) => {
    if (Date.now() - started > 60_000) { started = Date.now(); requests = 0; }
    if (requests++ >= 480) return reply.code(429).send({ error: 'RATE_LIMITED' });
    const provided = req.headers.authorization;
    if (!sourceToken || !provided || !timingSafeEqual(digest(provided), expectedBearer)) {
      return reply.code(401).send({ error: 'SOURCE_AUTHENTICATION_REQUIRED' });
    }
    if (req.headers.origin) return reply.code(403).send({ error: 'BROWSER_SOURCE_WRITE_DENIED' });
  } }, (req, reply) => respond(reply, async () => {
    const payload = observation.safeParse(req.body);
    if (!payload.success) return reply.code(400).send({ error: 'INVALID_ADOPTION_OBSERVATION' });
    const result = await receiveObservation(db, scope, payload.data);
    return reply.code(result.status === 'accepted' ? 201 : result.status === 'duplicate' ? 200 : 409).send(result);
  }));

  app.register(async routes => {
    routes.addHook('onRequest', async (req, reply) => {
      const token = req.headers.authorization?.slice(7);
      if (token && [sourceToken, downstreamToken].includes(token)) return reply.code(403).send({ error: 'WORKSPACE_ACCESS_REQUIRED' });
    });
    routes.get('/cases', () => listAssurance(db, scope));
    routes.get('/cases/:id', (req, reply) => byCase(req, reply, id => readAssurance(db, scope, id)));
    routes.get('/cases/:id/export', (req, reply) => byCase(req, reply, async id =>
      evidenceDownload(reply, `${id}-adoption-assurance`, context, 'delivery-linked synthetic adoption', ADOPTION_CALCULATION,
        await readAssurance(db, scope, id))));
    routes.post('/cases/:id', (req, reply) => byCase(req, reply, async id => canWrite(req) ? establishAssurance(db, scope, id) : denied(reply)));
    routes.post('/cases/:id/actions', (req, reply) => byCase(req, reply, async id => {
      if (!canWrite(req)) return denied(reply);
      const payload = adoptionAction.safeParse(req.body);
      if (!payload.success) return reply.code(400).send({ error: 'INVALID_ADOPTION_ACTION' });
      return recordAssuranceAction(db, scope, id, payload.data, actor(req));
    }));
  }, { prefix: ADOPTION_ASSURANCE });
}

const denied = (reply: FastifyReply) => reply.code(403).send({ error: 'OPERATOR_REQUIRED' });
function byCase(req: FastifyRequest, reply: FastifyReply, work: (id: string) => Promise<unknown>) {
  const id = identity.safeParse(req.params);
  return id.success ? respond(reply, () => work(id.data.id)) : reply.code(400).send({ error: 'INVALID_CASE_ID' });
}
