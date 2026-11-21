import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const assetTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

export function registerWeb(app: FastifyInstance, directory: string) {
  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(createReadStream(join(directory, 'index.html'))));
  app.get<{ Params: { name: string } }>('/assets/:name', async (request, reply) => {
    const { name } = request.params;
    const contentType = assetTypes[extname(name)];
    if (!contentType || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const asset = join(directory, 'assets', name);
    if (!(await stat(asset).catch(() => null))?.isFile()) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.type(contentType).send(createReadStream(asset));
  });
}
