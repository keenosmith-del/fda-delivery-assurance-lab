import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMigrations, migrationsReady } from './db/migrations.ts';
import { createApp } from './api/app.ts';
import { readConfig } from './config/env.ts';
import { labToken } from './modules/downstream/adapter.ts';
import { database } from './db/pool.ts';

const config = readConfig();
if (config.hosted) await access(join(config.LAB_UI_DIR, 'index.html'));
const migrations = await loadMigrations(config.MIGRATIONS_DIR);
const pool = database(config.DATABASE_URL, config.databaseOptions);
const downstreamToken = labToken.optional().parse(process.env.LAB_DOWNSTREAM_TOKEN);
if (downstreamToken && [config.LAB_FDA_SOURCE_TOKEN, config.LAB_WRITE_TOKEN, config.LAB_OPERATOR_PASSWORD,
  config.LAB_VIEWER_PASSWORD, config.LAB_DEMO_PASSWORD].includes(downstreamToken)) throw new Error('Use a dedicated downstream service credential.');
const app = createApp({
  pool,
  fdaSource: config.fdaSource,
  downstream: { enabled: !config.hosted && Boolean(downstreamToken), token: downstreamToken },
  environment: config.LAB_MODE,
  revision: process.env.LAB_SOURCE_REVISION ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  writeToken: config.LAB_WRITE_TOKEN,
  enableFaults: config.enableFaults,
  access: config.access,
  uiDir: config.hosted ? config.LAB_UI_DIR : undefined,
  checkSchema: () => migrationsReady(pool, migrations),
  logger: true,
});

pool.on('error', () => app.log.error('Idle database connection failed'));
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Could not start API');
  await app.close();
  process.exitCode = 1;
}
