import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { entityId } from '../../../shared/contracts/intelligence.ts';
import { diagnosisInput, interventionInput, followUpInput, implementationInput } from '../../../shared/contracts/measurement.ts';
import type { Database } from '../db/pool.ts';
import { AdoptionError, getAdoption, implementIntervention, planIntervention, recordDiagnosis, recordFollowUp } from '../modules/adoption/service.ts';
import { listAutomations, listPeriods } from '../modules/adoption/measurements.ts';
import { getOpportunityModel, getOutcome } from '../modules/outcomes/service.ts';

const pathId = z.object({ id: entityId });
const interventionPath = pathId.extend({ interventionId: z.uuid({ version: 'v4' }) });
const outcomeQuery = z.strictObject({ baseline: entityId.optional(), comparison: entityId.optional() })
  .refine(input => Boolean(input.baseline) === Boolean(input.comparison));

async function mutate(reply: FastifyReply, action: () => Promise<{ id: string }>, status = 201) {
  try {
    return reply.code(status).send(await action());
  } catch (error) {
    if (error instanceof AdoptionError) return reply.code(error.statusCode).send({ error: error.code });
    throw error;
  }
}

export function registerMeasurement(app: FastifyInstance, pool: Database, canWrite: (token: string | undefined) => boolean) {
  app.get('/api/automations', async () => listAutomations(pool));
  app.get('/api/automations/:id/periods', async (request, reply) => {
    const params = pathId.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_AUTOMATION_ID' });
    if (!(await listAutomations(pool)).some(item => item.id === params.data.id)) return reply.code(404).send({ error: 'AUTOMATION_NOT_FOUND' });
    return listPeriods(pool, params.data.id);
  });
  app.get('/api/adoption/:id', async (request, reply) => {
    const params = pathId.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_AUTOMATION_ID' });
    const result = await getAdoption(pool, params.data.id);
    return result ?? reply.code(404).send({ error: 'AUTOMATION_NOT_FOUND' });
  });
  app.post('/api/adoption/:id/diagnoses', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = pathId.safeParse(request.params);
    const input = diagnosisInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_DIAGNOSIS' });
    return mutate(reply, () => recordDiagnosis(pool, params.data.id, input.data));
  });
  app.post('/api/adoption/:id/interventions', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = pathId.safeParse(request.params);
    const input = interventionInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_INTERVENTION' });
    return mutate(reply, () => planIntervention(pool, params.data.id, input.data));
  });
  app.post('/api/adoption/:id/interventions/:interventionId/implement', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = interventionPath.safeParse(request.params);
    const input = implementationInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_IMPLEMENTATION' });
    return mutate(reply, () => implementIntervention(pool, params.data.id, params.data.interventionId, input.data.implementedOn), 200);
  });
  app.post('/api/adoption/:id/interventions/:interventionId/follow-ups', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = interventionPath.safeParse(request.params);
    const input = followUpInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_FOLLOW_UP' });
    return mutate(reply, () => recordFollowUp(pool, params.data.id, params.data.interventionId, input.data));
  });
  app.get('/api/outcomes/model', async () => getOpportunityModel(pool));
  const read = async (paramsValue: unknown, queryValue: unknown, reply: FastifyReply, download = false) => {
    const params = pathId.safeParse(paramsValue);
    const query = outcomeQuery.safeParse(queryValue);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'INVALID_OUTCOME_REQUEST' });
    const result = await getOutcome(pool, params.data.id, query.data.baseline, query.data.comparison);
    if (!result) return reply.code(404).send({ error: 'COMPARABLE_PERIODS_NOT_FOUND' });
    if (download) reply.header('content-disposition', `attachment; filename="${params.data.id}-outcome-evidence.json"`);
    return download ? { evidenceType: 'synthetic lab measurements', ...result } : result;
  };
  app.get('/api/outcomes/:id', (request, reply) => read(request.params, request.query, reply));
  app.get('/api/outcomes/:id/export', (request, reply) => read(request.params, request.query, reply, true));
}
