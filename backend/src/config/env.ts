import { z } from 'zod';

const env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LAB_WRITE_TOKEN: z.string().min(24).optional(),
  LAB_ENABLE_FAULTS: z.enum(['true', 'false']).default('false'),
  MIGRATIONS_DIR: z.string().default('database/migrations'),
});

export function readConfig() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const config = parsed.data;
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.HOST) && !config.LAB_WRITE_TOKEN) {
    throw new Error('LAB_WRITE_TOKEN is required to bind the API beyond loopback.');
  }
  return config;
}
