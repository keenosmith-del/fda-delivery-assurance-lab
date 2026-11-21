import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../../db/pool.ts';
import { getOperation, submit } from './service.ts';

function runUnreliableFixture() {
  const rows: { id: number; candidate: string }[] = [];
  const save = (candidate: string) => rows.push({ id: rows.length + 1, candidate });
  save('CAND-0001');
  // Model a reply discarded after the write. The retry carries no stable identity.
  save('CAND-0001');
  return {
    records: rows.filter(row => row.candidate === 'CAND-0001').length,
    steps: ['First write committed in the isolated fixture.', 'The response was discarded.', 'Retry inserted another row for the same candidate.'],
  };
}

export async function compareSubmissions(pool: Database) {
  const unsafe = runUnreliableFixture();
  const operationId = randomUUID();
  const input = { candidateCode: `CAND-${String(randomInt(10_000_000_000)).padStart(10, '0')}`, requisition: 'engineering' } as const;
  const first = await submit(pool, operationId, input);
  if (first !== 'created') throw new Error('Comparison expected a new operation');
  // Deliberately discard the initial API-layer result and reconcile from durable state.
  const recovered = await getOperation(pool, operationId);
  const replay = await submit(pool, operationId, input);
  const after = await getOperation(pool, operationId);
  if (!recovered || replay !== 'replayed' || !after || recovered.recordId !== after.recordId) {
    throw new Error('Comparison did not recover its committed record');
  }
  const independentId = randomUUID();
  await submit(pool, independentId, input);
  const linked = await getOperation(pool, independentId);
  if (!linked?.duplicate || linked.recordId !== after.recordId) {
    throw new Error('Comparison did not link the duplicate business record');
  }

  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM submissions WHERE candidate_code = $1 AND requisition = $2',
    [input.candidateCode, input.requisition],
  );
  return { unsafe, safe: { records: result.rows[0].count, operationId, recordId: after.recordId,
    events: [...after.events, ...linked.events].map(event => event.kind).filter(kind => kind !== 'confirmed'),
    steps: ['First write committed in PostgreSQL.', 'The response was discarded.', 'Lookup recovered the committed record and replay reused it.',
      'A fresh operation ID also linked to the existing record under the business uniqueness constraint.'] } };
}
