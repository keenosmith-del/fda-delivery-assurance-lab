import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { effectKey, SIMULATOR_API, simulatorWrite } from '../../../../shared/contracts/downstream.ts';
import type { SimulatorRecord, SimulatorWrite } from '../../../../shared/contracts/downstream.ts';
import type { Database } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';
import { effectIdentity } from './operations.ts';
import { labToken } from './adapter.ts';

export type Fault = 'pre-commit' | 'lost-acknowledgment' | 'rate-limit' | 'reject' | 'delay-lookup' | 'mismatch';
type StoredEffect = { body: SimulatorWrite; effect_id: string; fingerprint: string; committed_at: Date };

export async function initialiseSimulator(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS synthetic_effects (
    key text PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, effect_id uuid NOT NULL UNIQUE,
    fingerprint text NOT NULL, body jsonb NOT NULL, committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS synthetic_requests (
    key text PRIMARY KEY, writes integer NOT NULL, lookups integer NOT NULL DEFAULT 0
  )`);
}

function closeAcknowledgmentSocket(reply: FastifyReply) {
  reply.hijack();
  reply.raw.destroy();
}

export function createSimulator(db: Database, token: string, faultFor?: (key: string) => Fault | undefined,
  dropAcknowledgment = closeAcknowledgmentSocket) {
  const app = Fastify({ bodyLimit: 4096, requestTimeout: 5_000 });
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const expected = hash(`Bearer ${labToken.parse(token)}`);
  app.addHook('onRequest', async (request, reply) => {
    const provided = request.headers.authorization ?? '';
    if (!timingSafeEqual(hash(provided), expected)) return reply.code(401).send({ error: 'SYNTHETIC_CREDENTIAL_REQUIRED' });
  });
  app.post(SIMULATOR_API, async (request, reply) => {
    const input = simulatorWrite.safeParse(request.body);
    if (!input.success) return reply.code(422).send({ error: 'INVALID_SYNTHETIC_EFFECT' });
    const body = input.data;
    if (body.key !== effectIdentity(body.effect)) return reply.code(422).send({ error: 'INVALID_BUSINESS_EFFECT_IDENTITY' });
    const payloadFingerprint = fingerprint(body.effect);
    const fault = faultFor?.(body.key);
    const result = await transaction(db, async client => {
      // This counter serialises requests for one stable identity and persists test fault state across restarts.
      const { rows: [count] } = await client.query<{ writes: number }>(`INSERT INTO synthetic_requests (key,writes)
        VALUES ($1,1) ON CONFLICT (key) DO UPDATE SET writes=synthetic_requests.writes+1 RETURNING writes`, [body.key]);
      const { rows: [existing] } = await client.query<StoredEffect>('SELECT * FROM synthetic_effects WHERE key=$1', [body.key]);
      if (existing) return existing.body.operationId === body.operationId && existing.fingerprint === payloadFingerprint ? 'replay' : 'conflict';
      if (fault === 'reject') return 'reject';
      if (count!.writes === 1 && (fault === 'pre-commit' || fault === 'rate-limit')) return fault;
      const inserted = await client.query(`INSERT INTO synthetic_effects (key,operation_id,effect_id,fingerprint,body)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [body.key, body.operationId, randomUUID(), payloadFingerprint, body]);
      if (inserted.rowCount !== 1) return 'conflict';
      return count!.writes === 1 && fault === 'lost-acknowledgment' ? 'lost-acknowledgment' : 'committed';
    });
    if (result === 'lost-acknowledgment') return dropAcknowledgment(reply);
    if (result === 'pre-commit') return reply.code(503).send({ error: 'TEMPORARILY_UNAVAILABLE' });
    if (result === 'rate-limit') return reply.code(429).header('Retry-After', '1').send({ error: 'RATE_LIMITED' });
    if (result === 'reject') return reply.code(422).send({ error: 'SYNTHETIC_REJECTION' });
    if (result === 'conflict') return reply.code(409).send({ error: 'IDEMPOTENCY_CONFLICT' });
    return reply.code(result === 'committed' ? 201 : 200).send({ outcome: result });
  });

  app.get(SIMULATOR_API + '/:key', async (request, reply) => {
    const key = effectKey.safeParse((request.params as { key: string }).key);
    if (!key.success) return reply.code(400).send({ error: 'INVALID_EFFECT_KEY' });
    const { rows: [stored] } = await db.query<StoredEffect>('SELECT * FROM synthetic_effects WHERE key=$1', [key.data]);
    if (!stored) return reply.code(404).send({ error: 'EFFECT_NOT_FOUND' });
    const fault = faultFor?.(key.data);
    if (fault === 'delay-lookup') {
      const { rows: [count] } = await db.query<{ lookups: number }>(`UPDATE synthetic_requests SET lookups=lookups+1 WHERE key=$1 RETURNING lookups`, [key.data]);
      if (count?.lookups === 1) return reply.code(202).send({ status: 'pending' });
    }
    const record: SimulatorRecord = { ...stored.body, effectId: stored.effect_id,
      fingerprint: fault === 'mismatch' ? '0'.repeat(64) : stored.fingerprint, committedAt: stored.committed_at.toISOString() };
    return record;
  });
  return app;
}
