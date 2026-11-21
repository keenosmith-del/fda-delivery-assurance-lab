import { randomUUID } from 'node:crypto';
import type { Database } from '../db/pool.ts';
import { transaction } from '../db/pool.ts';
import { audit } from '../modules/submissions/service.ts';

const maxAttempts = 4;

export async function claimConfirmation(pool: Database, leaseMs = 10_000) {
  return transaction(pool, async client => {
    const next = await client.query<{ operation_id: string; state: string; attempts: number }>(`
      SELECT operation_id, state, attempts FROM confirmation_jobs
      WHERE (state = 'ready' AND available_at <= now()) OR (state = 'leased' AND lease_until <= now())
      ORDER BY CASE WHEN state = 'leased' THEN lease_until ELSE available_at END, operation_id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    const job = next.rows[0];
    if (!job) return null;
    if (job.state === 'leased') await audit(client, job.operation_id, 'lease_expired');
    if (job.attempts >= maxAttempts) {
      await client.query(`
        UPDATE confirmation_jobs SET state = 'dead', lease_token = NULL, lease_until = NULL WHERE operation_id = $1
      `, [job.operation_id]);
      await client.query("UPDATE submission_operations SET state = 'confirmation_failed' WHERE id = $1", [job.operation_id]);
      await audit(client, job.operation_id, 'confirmation_failed');
      return null;
    }

    const token = randomUUID();
    await client.query(`
      UPDATE confirmation_jobs SET state = 'leased', lease_token = $2,
        lease_until = now() + $3::integer * interval '1 millisecond', attempts = attempts + 1
      WHERE operation_id = $1
    `, [job.operation_id, token, leaseMs]);
    return { id: job.operation_id, token, attempt: job.attempts + 1 };
  });
}

type Claim = NonNullable<Awaited<ReturnType<typeof claimConfirmation>>>;

export async function finishConfirmation(pool: Database, claim: Claim, success = true) {
  return transaction(pool, async client => {
    const terminal = !success && claim.attempt >= maxAttempts;
    const state = success ? 'complete' : terminal ? 'dead' : 'ready';
    const delayMs = success || terminal ? 0 : 1000 * 2 ** (claim.attempt - 1);
    const updated = await client.query(`
      UPDATE confirmation_jobs SET state = $3, lease_token = NULL, lease_until = NULL,
        available_at = now() + $4::integer * interval '1 millisecond'
      WHERE operation_id = $1 AND lease_token = $2 AND lease_until > clock_timestamp()
    `, [claim.id, claim.token, state, delayMs]);
    if (!updated.rowCount) return false;

    if (success || terminal) {
      await client.query('UPDATE submission_operations SET state = $2 WHERE id = $1', [
        claim.id, success ? 'confirmed' : 'confirmation_failed',
      ]);
    }
    await audit(client, claim.id, success ? 'confirmed' : terminal ? 'confirmation_failed' : 'confirmation_retry');
    return true;
  });
}
