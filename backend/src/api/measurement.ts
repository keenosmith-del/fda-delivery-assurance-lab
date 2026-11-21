import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { entityId } from '../../../shared/contracts/intelligence.ts';
import { diagnosisInput, interventionInput, followUpInput, implementationInput } from '../../../shared/contracts/measurement.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';
import { transaction } from '../db/pool.ts';
import { adoptionCalculationVersion } from '../modules/adoption/diagnostics.ts';
import { outcomeCalculationVersion } from '../modules/outcomes/calculations.ts';
import type { Database } from '../db/pool.ts';
import { AdoptionError, getAdoption, getAdoptionEvidence, implementIntervention, planIntervention, recordDiagnosis, recordFollowUp } from '../modules/adoption/service.ts';
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

export function registerMeasurement(app: FastifyInstance, pool: Database, canWrite: (token: string | undefined) => boolean,
  actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext) {
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
  app.get('/api/adoption/:id/export', async (request, reply) => {
    const params = pathId.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_AUTOMATION_ID' });
    const result = await getAdoptionEvidence(pool, params.data.id);
    if (!result) return reply.code(404).send({ error: 'AUTOMATION_NOT_FOUND' });
    return evidenceDownload(reply, `${params.data.id}-adoption-evidence`, context, 'synthetic adoption and decisions',
      adoptionCalculationVersion, result);
  });
  app.post('/api/adoption/:id/diagnoses', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = pathId.safeParse(request.params);
    const input = diagnosisInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_DIAGNOSIS' });
    return mutate(reply, () => recordDiagnosis(pool, params.data.id, input.data, actor(request)));
  });
  app.post('/api/adoption/:id/interventions', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = pathId.safeParse(request.params);
    const input = interventionInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_INTERVENTION' });
    return mutate(reply, () => planIntervention(pool, params.data.id, input.data, actor(request)));
  });
  app.post('/api/adoption/:id/interventions/:interventionId/implement', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = interventionPath.safeParse(request.params);
    const input = implementationInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_IMPLEMENTATION' });
    return mutate(reply, () => implementIntervention(pool, params.data.id, params.data.interventionId, input.data.implementedOn, actor(request)), 200);
  });
  app.post('/api/adoption/:id/interventions/:interventionId/follow-ups', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const params = interventionPath.safeParse(request.params);
    const input = followUpInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: 'INVALID_FOLLOW_UP' });
    return mutate(reply, () => recordFollowUp(pool, params.data.id, params.data.interventionId, input.data, actor(request)));
  });
  app.get('/api/outcomes/model', async () => getOpportunityModel(pool));
  const read = async (paramsValue: unknown, queryValue: unknown, reply: FastifyReply, download = false) => {
    const params = pathId.safeParse(paramsValue);
    const query = outcomeQuery.safeParse(queryValue);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'INVALID_OUTCOME_REQUEST' });
    const result = await transaction(pool, client => getOutcome(client, params.data.id, query.data.baseline, query.data.comparison), true);
    if (!result) return reply.code(404).send({ error: 'COMPARABLE_PERIODS_NOT_FOUND' });
    if (!download) return result;
    return evidenceDownload(reply, `${params.data.id}-outcome-evidence`, context, 'synthetic lab measurements',
      outcomeCalculationVersion, {
        ...result,
        units: { duration: 'seconds', rate: 'fraction', opportunity: 'count', eligibilityAssumption: 'basis points' },
        provenance: {
          periods: [result.baseline.id, result.comparison.id],
          sources: ['lab_measurement_periods', 'lab_period_population', 'lab_opportunities', 'lab_executions',
            'lab_adoption_events', 'lab_outcome_measurements'],
          measurementSources: [result.baselineMeasurement?.source ?? null, result.comparisonMeasurement?.source ?? null],
          limitations: ['The time study records aggregate synthetic totals without individual reviewer identity or per-item timings.',
            'A missing or ineligible study remains null. The figures do not measure live production performance.'],
        },
      });
  };
  app.get('/api/outcomes/:id', (request, reply) => read(request.params, request.query, reply));
  app.get('/api/outcomes/:id/export', (request, reply) => read(request.params, request.query, reply, true));
}
