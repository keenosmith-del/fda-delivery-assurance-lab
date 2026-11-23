import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assessmentAction, decisionInput, revisionInput, WORKFLOW_ASSESSMENTS, workflowKey } from '../../../shared/contracts/workflow-assessments.ts';
import type { FdaScope } from '../../../shared/contracts/fda-ingestion.ts';
import type { Database } from '../db/pool.ts';
import { listRoots } from '../modules/workflow-assessments/repository.ts';
import { createDeliveryCase, getAssessment, makeDecision, openAssessment, reviewAssessment, WorkflowAssessmentError } from '../modules/workflow-assessments/service.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';

const params = z.object({ workflowId: workflowKey });
const empty = z.strictObject({});

async function respond<T>(reply: FastifyReply, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkflowAssessmentError) {
      return reply.code(error.status).send({ error: error.message, blockers: error.blockers });
    }
    throw error;
  }
}

export function registerWorkflowAssessments(app: FastifyInstance, db: Database, scope: FdaScope,
  authorize: (request: FastifyRequest) => boolean, actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext) {
  app.register(async routes => {
    routes.get('/', () => listRoots(db, scope));
    routes.get('/:workflowId', async (request, reply) => {
      const id = params.safeParse(request.params);
      const detail = id.success && await getAssessment(db, scope, id.data.workflowId);
      return detail || reply.code(404).send({ error: 'WORKFLOW_ASSESSMENT_NOT_FOUND' });
    });
    routes.get('/:workflowId/export', async (request, reply) => {
      const id = params.safeParse(request.params);
      const detail = id.success && await getAssessment(db, scope, id.data.workflowId);
      if (!detail) return reply.code(404).send({ error: 'WORKFLOW_ASSESSMENT_NOT_FOUND' });
      return evidenceDownload(reply, `${detail.workflowId}-engineering-assessment`, context, 'workflow-engineering-assessment',
        detail.current.snapshot.readiness.ruleVersion, {
          assessment: detail,
          units: { duration: 'seconds', time: 'UTC', frequency: 'source-declared unit', exceptions: 'observed count / sample count' },
          limitations: ['Synthetic source records and lab-verified conditions only.',
            'Engineering decisions attest to a shared operator role. External authorisation requires independent evidence.',
            'The suitability recommendation is a deterministic review aid. Delivery cases are plans.'],
        });
    });

    function write<T>(path: string, input: z.ZodType<T>, work: (workflowId: string, value: T, by: EvidenceActor) => Promise<unknown>) {
      routes.post(path, { bodyLimit: 32_768 }, (request, reply) => {
        if (!authorize(request)) return reply.code(403).send({ error: 'WORKFLOW_OPERATOR_REQUIRED' });
        const id = params.safeParse(request.params);
        const data = input.safeParse(request.body);
        if (!id.success || !data.success) return reply.code(400).send({ error: 'INVALID_WORKFLOW_ASSESSMENT_INPUT' });
        return respond(reply, () => work(id.data.workflowId, data.data, actor(request)));
      });
    }
    write('/:workflowId', empty, (id, _, by) => openAssessment(db, scope, id, by));
    write('/:workflowId/revisions', assessmentAction, (id, input, by) => reviewAssessment(db, scope, id, input, by));
    write('/:workflowId/decisions', decisionInput, (id, input, by) => makeDecision(db, scope, id, input, by));
    write('/:workflowId/delivery-cases', revisionInput, (id, input, by) => createDeliveryCase(db, scope, id, input.revision, by));
  }, { prefix: WORKFLOW_ASSESSMENTS });
}
