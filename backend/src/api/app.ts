import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { Database } from '../db/pool.ts';
import { comparison } from '../../../shared/contracts/intelligence.ts';
import { compareSubmissions } from '../modules/submissions/comparison.ts';
import { registerMeasurement } from './measurement.ts';
import { registerIntelligence } from './intelligence.ts';
import { fault, operationId, submission } from '../../../shared/contracts/submissions.ts';
import { BeforeCommitError, getOperation, getOperationEvidence, recordFaultReceipt, submit } from '../modules/submissions/service.ts';

import { installSecurity } from './security.ts';
import type { HostedAccess } from './security.ts';
import { registerWeb } from './web.ts';
import { evidenceDownload, sourceRevision } from './evidence.ts';
import type { ExportContext } from './evidence.ts';
import { queueStatus } from '../workers/telemetry.ts';

import { registerOutcomeAssurance } from './outcome-assurance.ts';
import { registerAdoptionAssurance } from './adoption-assurance.ts';
import { registerDownstream } from './downstream.ts';
import { registerWorkflowAssessments } from './workflow-assessments.ts';
import { registerAgentAssurance } from './agent-assurance.ts';
import { registerFdaIngestion } from './fda-ingestion.ts';
import type { FdaSourceConfig } from './fda-ingestion.ts';

interface Options {
  pool: Database;
  fdaSource?: FdaSourceConfig;
  downstream?: { enabled: boolean; token?: string };
  writeToken?: string;
  enableFaults?: boolean;
  logger?: boolean;
  access?: HostedAccess;
  uiDir?: string;
  environment?: ExportContext['mode'];
  revision?: string;
  checkSchema?: () => Promise<boolean>;
}

export function createApp({ pool, writeToken, enableFaults, logger = false, access, uiDir, checkSchema, environment = 'local', revision, fdaSource, downstream }: Options) {
  const app = Fastify({ logger, genReqId: () => randomUUID(), requestIdHeader: false, requestTimeout: 12_000, bodyLimit: 4096, logController: new LogController({ disableRequestLogging: true }) });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expectedToken = writeToken ? digest(writeToken) : null;

  const canWrite = (token: string | undefined) => Boolean(access) || expectedToken === null ||
    (typeof token === 'string' && token.startsWith('Bearer ') && timingSafeEqual(expectedToken, digest(token.slice(7))));

  const security = installSecurity(app, access);
  const exportContext = { mode: environment, revision: sourceRevision(revision) };
  const actor = (request: Parameters<typeof security.role>[0]) => {
    const role = security.role(request);
    return { role: role === 'operator' || role === 'demo' ? role : writeToken ? 'local-token' as const : 'local-open' as const,
      sourceRevision: exportContext.revision };
  };
  const requestCounts = { success: 0, rejected: 0, throttled: 0, failed: 0 };
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) requestCounts.failed++;
    else if (reply.statusCode === 429) requestCounts.throttled++;
    else if (reply.statusCode >= 400) requestCounts.rejected++;
    else requestCounts.success++;
    request.log.info({ method: request.method, route: request.routeOptions.url, status: reply.statusCode,
      elapsedMs: Math.round(reply.elapsedTime) }, 'Request completed');
  });

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'INVALID_REQUEST' });
    }
    request.log.error({ reqId: request.id, errorType: error instanceof Error ? error.name : 'UnknownError' }, 'API request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async (request, reply) => {
    try {
      if (checkSchema) {
        if (!await checkSchema()) return reply.code(503).send({ status: 'unavailable' });
      } else await pool.query('SELECT 1 FROM confirmation_jobs LIMIT 1');
      return { status: 'ready' };
    } catch {
      request.log.warn({ reqId: request.id }, 'Database readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/operations/:id', async (request, reply) => {
    const id = operationId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_OPERATION_ID' });
    const result = await getOperation(pool, id.data.toLowerCase());
    if (!result) return reply.code(404).send({ error: 'OPERATION_NOT_FOUND' });
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/operations/:id/export', async (request, reply) => {
    const id = operationId.safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_OPERATION_ID' });
    const result = await getOperationEvidence(pool, id.data.toLowerCase());
    if (!result) return reply.code(404).send({ error: 'OPERATION_NOT_FOUND' });
    return evidenceDownload(reply, `${result.operationId}-ats-evidence`, exportContext, 'synthetic ATS recovery', null, result);
  });

  app.post('/api/submissions', async (request, reply) => {
    if (!canWrite(request.headers.authorization)) {
      return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    }

    const key = operationId.safeParse(request.headers['idempotency-key']);
    const payload = submission.safeParse(request.body);
    if (!key.success || !payload.success) return reply.code(400).send({ error: 'INVALID_SUBMISSION' });

    const requestedFault = request.headers['x-lab-fault'];
    const mode = fault.safeParse(requestedFault);
    if (requestedFault !== undefined && (!enableFaults || !security.mayInject(request) || !mode.success)) {
      return reply.code(400).send({ error: 'FAULT_NOT_AVAILABLE' });
    }

    const id = key.data.toLowerCase();
    const receipt = mode.data && { requestId: request.id, fault: mode.data, actor: actor(request) };
    try {
      const result = await submit(pool, id, payload.data, mode.data === 'before-commit', receipt);
      request.log.info({ reqId: request.id, operationId: id, result }, 'Submission processed');
      if (result === 'conflict') return reply.code(409).send({ error: 'PAYLOAD_CONFLICT' });
      if (result === 'created' && mode.data === 'lost-ack') {
        return reply.code(504).send({ error: 'SIMULATED_ACK_TIMEOUT' });
      }
      const state = await getOperation(pool, id);
      if (!state) throw new Error('Committed operation was not found');
      return reply.code(state.state === 'pending_confirmation' ? 202 : 200)
        .header('location', `/api/operations/${id}`).send(state);
    } catch (error) {
      if (error instanceof BeforeCommitError && receipt) {
        await recordFaultReceipt(pool, id, receipt);
        request.log.info({ reqId: request.id, operationId: id }, 'Synthetic interruption rolled back');
        return reply.code(504).send({ error: 'SIMULATED_PRE_COMMIT_TIMEOUT' });
      }
      throw error;
    }
  });

  app.post('/api/lab/submission-comparison', async (request, reply) => {
    if (!enableFaults || !security.mayInject(request)) return reply.code(404).send({ error: 'FAULT_NOT_AVAILABLE' });
    if (!canWrite(request.headers.authorization)) return reply.code(401).send({ error: 'WRITE_TOKEN_REQUIRED' });
    return comparison.parse(await compareSubmissions(pool));
  });

  app.get('/api/ops/status', async () => ({ ...(await queueStatus(pool)), requests: { ...requestCounts } }));
  if (uiDir) registerWeb(app, uiDir);
  registerFdaIngestion(app, pool, fdaSource, exportContext.revision);
  const scope = { tenantId: fdaSource?.tenantId ?? 'tenant-001', sourceId: fdaSource?.sourceId ?? 'source-001' };
  const authorizeOperator = (request: Parameters<typeof security.role>[0]) => {
    if (access) return security.role(request) === 'operator';
    const auth = request.headers.authorization;
    if (fdaSource?.token && auth === `Bearer ${fdaSource.token}`) return false;
    return writeToken ? canWrite(auth) : auth === undefined;
  };
  registerAgentAssurance(app, pool, scope, authorizeOperator, actor, exportContext);
  registerWorkflowAssessments(app, pool, scope, authorizeOperator, actor, exportContext);
  registerDownstream(app, pool, scope, downstream?.enabled === true, authorizeOperator, actor, exportContext, [fdaSource?.token, downstream?.token]);
  registerAdoptionAssurance(app, pool, scope, authorizeOperator, actor, exportContext, fdaSource?.token, downstream?.token);
  registerOutcomeAssurance(app, pool, scope, authorizeOperator, actor, exportContext, fdaSource?.token, downstream?.token);
  registerIntelligence(app, pool, canWrite, actor, exportContext);
  registerMeasurement(app, pool, canWrite, actor, exportContext);
  return app;
}
