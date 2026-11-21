import type { FastifyInstance, FastifyRequest } from 'fastify';
import { coverage, deviceDetail, entityId, reviewInput, taskDetail, taskSummary } from '../../../shared/contracts/intelligence.ts';
import { transaction } from '../db/pool.ts';
import type { Database } from '../db/pool.ts';
import { evidenceDownload } from './evidence.ts';
import type { EvidenceActor, ExportContext } from './evidence.ts';
import { getTask, listTasks, saveReview } from '../modules/workflow-evidence/service.ts';
import { queryDevices } from '../modules/agent-health/service.ts';

export function registerIntelligence(app: FastifyInstance, pool: Database, canWrite: (authorization: string | undefined) => boolean,
  actor: (request: FastifyRequest) => EvidenceActor, context: ExportContext) {
  app.get('/api/workflow/tasks', async () => (await listTasks(pool)).map(item => taskSummary.parse(item)));
  app.get<{ Params: { id: string } }>('/api/workflow/tasks/:id', async (request, reply) => {
    const id = entityId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_TASK_ID' });
    const task = await getTask(pool, id.data);
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    return taskDetail.parse(task);
  });

  app.get<{ Params: { id: string } }>('/api/workflow/tasks/:id/export', async (request, reply) => {
    const id = entityId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_TASK_ID' });
    const result = await transaction(pool, client => getTask(client, id.data), true);
    if (!result) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    const { reviews, ...task } = result;
    return evidenceDownload(reply, `${id.data}-workflow-evidence`, context, 'synthetic workflow observations', task.scoring.version, {
      ...task,
      reviews: reviews.map(({ id, classification, suitability, reviewedAt, actorRole, sourceRevision }) =>
        ({ id, classification, suitability, reviewedAt, actorRole, sourceRevision })),
      units: { score: 'rubric points out of 100', weight: 'percent', duration: 'seconds' },
      provenance: {
        sources: ['lab_tasks', 'lab_workflow_events', 'lab_observation_windows', 'lab_devices', 'lab_device_events', 'lab_reviews'],
        limitations: ['The latest 100 review decisions are included. Free-text reasons are excluded.'],
      },
    });
  });

  app.post<{ Params: { id: string } }>('/api/workflow/tasks/:id/reviews', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const id = entityId.safeParse(request.params.id);
    const input = reviewInput.safeParse(request.body);
    if (!id.success || !input.success) return reply.code(400).send({ error: 'INVALID_REVIEW' });
    const result = await saveReview(pool, id.data, input.data, actor(request));
    if (!result) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    request.log.info({ taskId: id.data, reviewId: result.id }, 'Synthetic task reviewed');
    return reply.code(201).send(result);
  });

  app.get('/api/agent-health', async () => coverage.parse(await queryDevices(pool)));
  app.get<{ Params: { id: string } }>('/api/agent-health/:id', async (request, reply) => {
    const id = entityId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_DEVICE_ID' });
    const { devices } = await queryDevices(pool);
    const device = devices.find(item => item.id === id.data);
    if (!device) return reply.code(404).send({ error: 'DEVICE_NOT_FOUND' });
    return deviceDetail.parse(device);
  });
}
