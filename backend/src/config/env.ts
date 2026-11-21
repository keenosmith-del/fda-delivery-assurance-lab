import { z } from 'zod';

const password = z.string().min(32).max(128).regex(/^[!-~]+$/);
const env = z.object({
  LAB_MODE: z.enum(['local', 'test', 'staging', 'production']).default('local'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LAB_WRITE_TOKEN: z.string().min(24).optional(),
  LAB_ENABLE_FAULTS: z.enum(['true', 'false']).default('false'),
  LAB_PUBLIC_ORIGIN: z.url({ protocol: /^https$/ }).optional(),
  LAB_VIEWER_PASSWORD: password.optional(),
  LAB_OPERATOR_PASSWORD: password.optional(),
  LAB_DEMO_PASSWORD: password.optional(),
  LAB_DATABASE_TLS: z.enum(['verify', 'railway-private']).optional(),
  LAB_DB_POOL_MAX: z.coerce.number().int().min(1).max(30).optional(),
  LAB_UI_DIR: z.string().min(1).default('frontend/dist'),
  MIGRATIONS_DIR: z.string().min(1).default('database/migrations'),
});

export function readConfig(role: 'api' | 'worker' | 'migration' | 'seed' = 'api', input = process.env) {
  const parsed = env.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const config = parsed.data;
  const hosted = config.LAB_MODE === 'staging' || config.LAB_MODE === 'production';
  if (input.NODE_ENV === 'production' && !hosted) throw new Error('Production runtime requires LAB_MODE=staging or production.');
  const host = config.HOST ?? (hosted ? '0.0.0.0' : '127.0.0.1');
  if (!hosted && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Local and test APIs must bind to loopback.');
  const database = new URL(config.DATABASE_URL);
  if (hosted && (!config.LAB_DATABASE_TLS || (config.LAB_DATABASE_TLS === 'railway-private' &&
    !database.hostname.endsWith('.railway.internal')))) throw new Error('Hosted database requires verified TLS or an explicit Railway private-network policy.');
  if (hosted && [...database.searchParams.keys()].some(key => /^ssl/i.test(key))) throw new Error('Configure hosted database TLS via LAB_DATABASE_TLS.');
  const enableFaults = config.LAB_ENABLE_FAULTS === 'true';
  if (config.LAB_MODE === 'production' && enableFaults) throw new Error('Fault injection is forbidden in production.');
  if (role === 'seed' && config.LAB_MODE === 'production') throw new Error('Synthetic seeding is forbidden in production.');
  let access;
  if (hosted && role === 'api') {
    const { LAB_PUBLIC_ORIGIN: origin, LAB_VIEWER_PASSWORD: viewer, LAB_OPERATOR_PASSWORD: operator, LAB_DEMO_PASSWORD: demo } = config;
    if (!origin || origin !== new URL(origin).origin || !viewer || !operator || viewer === operator) {
      throw new Error('Hosted API requires LAB_PUBLIC_ORIGIN (HTTPS origin) and distinct LAB_VIEWER_PASSWORD and LAB_OPERATOR_PASSWORD.');
    }
    if (config.LAB_WRITE_TOKEN) throw new Error('LAB_WRITE_TOKEN is local-only.');
    if (enableFaults && (!demo || demo === viewer || demo === operator)) throw new Error('Staging faults require a separate LAB_DEMO_PASSWORD.');
    access = { origin, viewer, operator, demo: enableFaults ? demo : undefined };
  }
  return { ...config, HOST: host, hosted, access, enableFaults, databaseOptions: {
    max: config.LAB_DB_POOL_MAX ?? (role === 'api' ? 8 : 2), tls: config.LAB_DATABASE_TLS,
    statementTimeoutMs: role === 'migration' ? 45_000 : 8_000,
  } };
}
