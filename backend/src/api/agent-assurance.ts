import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ASSURANCE_RULES, assessmentQuery, incidentCommand, openIncidentInput } from '../../../shared/contracts/agent-assurance.ts';
import type { FdaScope } from '../../../shared/contracts/fda-ingestion.ts';
import { FDA_GATEWAY } from '../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../db/pool.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';
import { assess, loadAssuranceRecords } from '../modules/agent-assurance/assessment.ts';
import { AssuranceError, listIncidents, openIncident, readIncident, updateIncident } from '../modules/agent-assurance/incidents.ts';
import { assessWorkflowReadiness } from '../modules/agent-assurance/workflow.ts';

const params = z.object({ id: z.uuid() });
const incidentQuery = assessmentQuery.pick({ windowId: true });

async function respond<T>(reply: FastifyReply, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AssuranceError) return reply.code(error.status).send({ error: error.code });
    throw error;
  }
}

export function registerAgentAssurance(app: FastifyInstance, db: Database, scope: FdaScope,
  authorise: (request: FastifyRequest) => boolean, actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext) {
  app.register(async routes => {
    routes.get('/assessment', async (request, reply) => {
      const input = assessmentQuery.safeParse(request.query);
      if (!input.success) return reply.code(400).send({ error: 'INVALID_AGENT_ASSESSMENT_QUERY' });
      const data = assess(await loadAssuranceRecords(db, scope), input.data);
      return data ?? reply.code(404).send({ error: 'AGENT_ASSESSMENT_NOT_FOUND' });
    });
    routes.get('/workflow-readiness', () => assessWorkflowReadiness(db, scope));
    routes.get('/incidents', async (request, reply) => {
      const query = incidentQuery.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'INVALID_AGENT_INCIDENT_QUERY' });
      return listIncidents(db, scope, query.data.windowId);
    });
    routes.get('/incidents/:id', (request, reply) => {
      const input = params.safeParse(request.params);
      if (!input.success) return reply.code(404).send({ error: 'AGENT_INCIDENT_NOT_FOUND' });
      return respond(reply, () => readIncident(db, scope, input.data.id));
    });
    routes.get('/incidents/:id/export', (request, reply) => {
      const input = params.safeParse(request.params);
      if (!input.success) return reply.code(404).send({ error: 'AGENT_INCIDENT_NOT_FOUND' });
      return respond(reply, async () => {
        const incident = await readIncident(db, scope, input.data.id);
        return evidenceDownload(reply, `agent-incident-${incident.id}`, context, 'operational-assurance', ASSURANCE_RULES,
          { incident, scope, units: { duration: 'seconds', time: 'ISO 8601 UTC' },
            limitations: ['Source and observations are synthetic.', 'Reported permissions do not establish consent.', 'Diagnostic hypotheses are engineering interpretations.'] });
      });
    });
    routes.post('/incidents', { bodyLimit: 4096 }, (request, reply) => {
      if (!authorise(request)) return reply.code(403).send({ error: 'AGENT_OPERATOR_REQUIRED' });
      const input = openIncidentInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'INVALID_AGENT_INCIDENT' });
      return respond(reply, () => openIncident(db, scope, input.data, actor(request)));
    });
    routes.post('/incidents/:id/actions', { bodyLimit: 4096 }, (request, reply) => {
      if (!authorise(request)) return reply.code(403).send({ error: 'AGENT_OPERATOR_REQUIRED' });
      const id = params.safeParse(request.params);
      const input = incidentCommand.safeParse(request.body);
      if (!id.success || !input.success) return reply.code(400).send({ error: 'INVALID_AGENT_ACTION' });
      return respond(reply, () => updateIncident(db, scope, id.data.id, input.data, actor(request)));
    });
  }, { prefix: `${FDA_GATEWAY}/assurance` });
}
