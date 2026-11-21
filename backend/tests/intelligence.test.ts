import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { classify, assessSuitability } from '../src/modules/workflow-evidence/scoring.ts';
import { measureDevice } from '../src/modules/agent-health/service.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { openTestDatabase } from '../../tests/support/database.ts';

const token = 'synthetic-integration-test-token';
let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  fixture = await openTestDatabase();
  await seedIntelligence(fixture.pool);
  app = createApp({ pool: fixture.pool, writeToken: token, enableFaults: true });
}, 30_000);
afterAll(async () => {
  await app?.close();
  await fixture?.close();
});

describe('deterministic calculations', () => {
  it('keeps classification evidence independent of suitability assumptions', () => {
    const observedAt = '2026-11-20T08:00:00.000Z';
    const evidence = [{ id: 'event-1', deviceId: 'device-1', observedAt, sequence: ['Open', 'Save'], durationSeconds: 55, exception: true }];
    expect(classify(['Open', 'Save'], evidence).score).toBe(71);
    expect(classify(['Open', 'Save'], []).score).toBe(0);
    expect(assessSuitability({ determinism: 90, judgment: 90, permissions: 20, integration: 60,
      sensitivity: 80, risk: 90, complexity: 50, value: 40 }, evidence).score).toBe(35);
  });

  it('measures observation gaps separately from a recent heartbeat', () => {
    const instant = (hour: number) => `2026-11-20T${String(hour).padStart(2, '0')}:00:00.000Z`;
    const window = { start: instant(8), end: instant(12) };
    const result = measureDevice({ id: 'device-1', label: 'One', team: 'Lab', enrolledAt: instant(9) }, window, [
      { at: instant(9), kind: 'observation', permissionOk: null },
      { at: instant(10), kind: 'permission', permissionOk: false },
      { at: instant(11), kind: 'heartbeat', permissionOk: null },
    ]);
    expect(result).toMatchObject({ reporting: true, freshness: 'stale', permission: 'limited',
      missingIntervals: [{ start: instant(10), end: instant(12) }] });
  });
});

describe('synthetic datasets and review history', () => {
  it('seeds reproducibly and exposes the evidence and distinct recommendations', async () => {
    await seedIntelligence(fixture.pool);
    const list = (await app.inject('/api/workflow/tasks')).json();
    expect(list).toHaveLength(6);
    const response = await app.inject('/api/workflow/tasks/offer-review');
    expect(response.statusCode).toBe(200);
    const task = response.json();
    expect(task.evidence).toHaveLength(12);
    expect(task.classification.score).toBeGreaterThan(task.suitability.score);
    expect(task.recommendation).toContain('Keep human review');
    expect(task.evidenceGaps).toContain('Some enrolled endpoints were not reporting at the end of the sample window.');
  });

  it('protects review writes and persists two independent decisions in order', async () => {
    const url = '/api/workflow/tasks/offer-review/reviews';
    const payload = { classification: 'approve', suitability: 'reject', reason: 'Human approval remains required.' };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, reason: 'x' }, headers })).statusCode).toBe(400);
    const first = await app.inject({ method: 'POST', url, payload, headers });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url, payload: { ...payload, reason: 'Owner confirmed the escalation policy.' }, headers });
    expect(second.statusCode).toBe(201);
    const loaded = (await app.inject('/api/workflow/tasks/offer-review')).json();
    expect(loaded.reviews.map((item: {id: string}) => item.id)).toEqual([second.json().id, first.json().id]);
    expect(loaded.reviews[1]).toMatchObject(payload);
    expect((await fixture.pool.query('SELECT id FROM lab_reviews WHERE task_id = $1', ['offer-review'])).rowCount).toBe(2);
  });

  it('reports seven endpoints separately from permissions and last observation', async () => {
    const overall = (await app.inject('/api/agent-health')).json();
    expect(overall.devices).toHaveLength(9);
    expect(overall.reporting).toBe(7);
    const limited = (await app.inject('/api/agent-health/device-7')).json();
    expect(limited).toMatchObject({ reporting: true, permission: 'limited', freshness: 'stale' });
    expect(limited.missingIntervals.length).toBeGreaterThan(0);
    expect(limited.history).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'permission', permissionOk: false })]));
    expect((await app.inject('/api/agent-health/device-9')).json()).toMatchObject({ reporting: false, freshness: 'unobserved' });
    expect((await app.inject('/api/agent-health/absent')).statusCode).toBe(404);
  });

  it('runs an isolated unsafe fixture and measures the safe path from SQL', async () => {
    const url = '/api/lab/submission-comparison';
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    const normal = createApp({ pool: fixture.pool, writeToken: token });
    const headers = { authorization: `Bearer ${token}` };
    try {
      expect((await normal.inject({ method: 'POST', url, headers })).statusCode).toBe(404);
    } finally {
      await normal.close();
    }
    const response = await app.inject({ method: 'POST', url, headers });
    expect(response.statusCode).toBe(200);
    const pair = response.json();
    expect(pair.unsafe.records).toBe(2);
    expect(pair.safe.records).toBe(1);
    expect(pair.safe.events).toEqual(['accepted', 'replayed', 'duplicate_linked']);
    const count = await fixture.pool.query('SELECT id FROM submissions');
    expect(count.rows).toEqual([{ id: pair.safe.recordId }]);
  });
});
