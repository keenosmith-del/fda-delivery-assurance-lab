import type { FastifyInstance } from 'fastify';
import { coverage, deviceDetail, entityId, reviewInput, taskDetail, taskSummary } from '../../../shared/contracts/intelligence.ts';
import type { Database } from '../db/pool.ts';
import { getTask, listTasks, saveReview } from '../modules/workflow-evidence/service.ts';
import { queryDevices } from '../modules/agent-health/service.ts';

export function registerIntelligence(app: FastifyInstance, pool: Database, canWrite: (authorization: string | undefined) => boolean) {
  app.get('/api/workflow/tasks', async () => (await listTasks(pool)).map(item => taskSummary.parse(item)));
  app.get<{ Params: { id: string } }>('/api/workflow/tasks/:id', async (request, reply) => {
    const id = entityId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_TASK_ID' });
    const task = await getTask(pool, id.data);
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
    return taskDetail.parse(task);
  });

  app.post<{ Params: { id: string } }>('/api/workflow/tasks/:id/reviews', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    const id = entityId.safeParse(request.params.id);
    const input = reviewInput.safeParse(request.body);
    if (!id.success || !input.success) return reply.code(400).send({ error: 'INVALID_REVIEW' });
    const result = await saveReview(pool, id.data, input.data);
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
