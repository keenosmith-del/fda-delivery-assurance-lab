import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { claimConfirmation, finishConfirmation } from '../src/workers/confirmation.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../database/seeds/measurement.ts';

const revision = '0123456789abcdef0123456789abcdef01234567';
const origin = 'https://staging.example.test';
const access = { origin, operator: 'test-only-operator-password', viewer: 'test-only-viewer-password' };
const authorization = (role: 'operator' | 'viewer') => 'Basic ' + Buffer.from(role + ':' + access[role]).toString('base64');
const privateText = 'Unexportable operator text test@example.test';
let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
let app: ReturnType<typeof createApp>;
let hosted: ReturnType<typeof createApp>;

beforeAll(async () => {
  fixture = await openTestDatabase();
  await seedIntelligence(fixture.pool);
  await seedMeasurement(fixture.pool);
  app = createApp({ pool: fixture.pool, enableFaults: true, environment: 'test', revision });
  hosted = createApp({ pool: fixture.pool, access, environment: 'test', revision });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await hosted?.close();
  await fixture?.close();
});

it('exports complete and incomplete outcome inputs and reconciles distinct calculations', async () => {
  const complete = (await app.inject('/api/outcomes/intake-assist/export')).json();
  expect(complete).toMatchObject({
    evidenceType: 'synthetic lab measurements', schemaVersion: 'fda-evidence/v1',
    calculationVersion: 'outcome-comparison/v1', sourceRevision: revision,
    baseline: { id: 'intake-assist-baseline', observed: 350, eligibleOpportunities: 319, modeledEligibilityBps: 8600 },
    baselineMeasurement: { measuredItems: 350, humanHandlingSeconds: 84000, reviewProvenance: 'synthetic-fixture' },
    comparisonMeasurement: { measuredItems: 350, humanHandlingSeconds: 62000, reviewProvenance: 'synthetic-fixture' },
    verifiedSeconds: 22000, modeledWeeklyOccurrences: 301, grossEstimatedSeconds: 56880,
    netEstimatedSeconds: 48915, reworkSeconds: 1805, humanReviewSeconds: 6160,
    reconciliation: { modeledMinusReviewedSeconds: 26915 },
    units: { duration: 'seconds' },
  });
  expect(complete.reconciliation.baselineObservedEligibility).toBeCloseTo(319 / 350);
  expect(complete.netEstimatedSeconds).toBe(complete.comparison.succeeded * complete.baseline.baselineSecondsPerItem -
    complete.comparison.reworkSeconds - complete.comparison.reviewSeconds);
  expect(complete.verifiedSeconds).toBe(complete.baselineMeasurement.humanHandlingSeconds - complete.comparisonMeasurement.humanHandlingSeconds);
  const incomplete = (await app.inject('/api/outcomes/pipeline-digest/export')).json();
  expect(incomplete).toMatchObject({ verifiedSeconds: null, comparisonMeasurement: null, netEstimatedSeconds: 2575,
    reconciliation: { modeledMinusReviewedSeconds: null } });
  expect(incomplete.verificationLimits).toHaveLength(2);
});

it('links workflow scores to observations and records authenticated role without exporting reasons', async () => {
  const url = '/api/workflow/tasks/offer-review';
  await fixture.pool.query(`
    INSERT INTO lab_reviews (task_id, classification, suitability, reason)
    VALUES ('offer-review', 'reject', 'reject', 'legacy free text')
  `);
  const payload = { classification: 'approve', suitability: 'reject', reason: privateText };
  const postReview = (role: 'operator' | 'viewer') => hosted.inject({
    method: 'POST', url: url + '/reviews', payload,
    headers: { authorization: authorization(role), origin, 'x-actor-role': 'demo', 'x-source-revision': 'untrusted' },
  });
  expect((await postReview('viewer')).statusCode).toBe(403);
  expect((await hosted.inject(url + '/export')).statusCode).toBe(401);
  const created = await postReview('operator');
  expect(created.statusCode).toBe(201);
  const receipt = await hosted.inject({
    url: url + '/export', headers: { authorization: authorization('viewer') },
  });
  expect(receipt.statusCode).toBe(200);
  expect(receipt.body).not.toContain(privateText);
  expect(receipt.body).not.toContain('legacy free text');
  const data = receipt.json();
  expect(data).toMatchObject({
    calculationVersion: 'workflow-weighted-rubric/v1', classification: { score: 94 }, suitability: { score: 44 },
    scoring: { observationWindow: { id: 'lab-day' } },
    reviews: [
      { id: created.json().id, actorRole: 'operator', sourceRevision: revision },
      { actorRole: null, sourceRevision: null },
    ],
  });
  for (const result of [data.classification, data.suitability]) {
    const factors: { score: number; weight: number }[] = result.factors;
    expect(factors.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(Math.round(factors.reduce((sum, item) => sum + item.score * item.weight, 0) / 100)).toBe(result.score);
  }
  expect(data.evidence).toHaveLength(12);
  expect(data.scoring.suitabilityInputs).toHaveProperty('judgment');
});

it('exports linked adoption decisions, attributable audit events and the observed trade-offs', async () => {
  const base = '/api/adoption/pipeline-digest';
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: base + path, payload });
  const finding = await post('/diagnoses', { periodId: 'pipeline-digest-baseline', category: 'training', hypothesis: privateText });
  expect(finding.statusCode).toBe(201);
  const plan = await post('/interventions', { findingId: finding.json().id, action: privateText, owner: privateText, followUpOn: '2026-11-16' });
  expect(plan.statusCode).toBe(201);
  const path = '/interventions/' + plan.json().id;
  expect((await post(path + '/implement', { implementedOn: '2026-11-09' })).statusCode).toBe(200);
  const followUp = await post(path + '/follow-ups', { periodId: 'pipeline-digest-follow-up', notes: privateText });
  expect(followUp.statusCode).toBe(201);
  const receipt = await app.inject(base + '/export');
  expect(receipt.statusCode).toBe(200);
  expect(receipt.body).not.toContain(privateText);
  expect(receipt.body).not.toContain('operator-1');
  const data = receipt.json();
  expect(data.interventions).toMatchObject([{ id: plan.json().id, findingId: finding.json().id }]);
  expect(data.followUps).toMatchObject([{ id: followUp.json().id, interventionId: plan.json().id, comparison: {
    baselinePeriodId: 'pipeline-digest-baseline', comparisonPeriodId: 'pipeline-digest-follow-up', causality: 'not-established',
  } }]);
  expect(data.audit).toMatchObject([
    { id: expect.any(String), event: 'diagnosis-recorded', subjectId: finding.json().id, actorRole: 'local-open', sourceRevision: revision },
    { event: 'intervention-planned', subjectId: plan.json().id },
    { event: 'intervention-implemented', subjectId: plan.json().id },
    { event: 'follow-up-recorded', subjectId: followUp.json().id },
  ]);
  expect(data.supportingObservations).toContainEqual({ periodId: 'pipeline-digest-baseline', category: 'training', count: 2 });
  expect(data.observedComparison.adoption).toEqual({ baseline: .5, comparison: .75, deltaPercentagePoints: 25 });
  expect(data.observedComparison.reliability).toMatchObject({ baseline: 14 / 15, comparison: 19 / 22 });
  expect(data.observedComparison.coverage).toMatchObject({ baseline: 1, comparison: 40 / 46 });
});

it.each(['before-commit', 'lost-ack'])('exports persistent %s evidence without candidate data', async fault => {
  const id = randomUUID();
  const url = '/api/operations/' + id;
  const candidateCode = fault === 'before-commit' ? 'CAND-9120' : 'CAND-9121';
  const request = (value?: string) => app.inject({
    method: 'POST', url: '/api/submissions', payload: { candidateCode, requisition: 'operations' },
    headers: { 'idempotency-key': id, ...(value && { 'x-lab-fault': value }) },
  });
  const interrupted = await request(fault);
  expect(interrupted.statusCode).toBe(504);
  const beforeRetry = await app.inject(url + '/export');
  expect(beforeRetry.statusCode).toBe(200);
  expect(beforeRetry.json().operation === null).toBe(fault === 'before-commit');
  expect((await request()).statusCode).toBe(202);
  const claim = await claimConfirmation(fixture.pool);
  expect(claim?.id).toBe(id);
  if (!claim) throw new Error('Expected queued confirmation');
  await finishConfirmation(fixture.pool, claim);
  const reported = await app.inject(url + '/export');
  expect(reported.body).not.toContain(candidateCode);
  expect(reported.body).not.toContain('leaseToken');
  const evidence = reported.json();
  expect(evidence.operation).toMatchObject({ state: 'confirmed', confirmationJobState: 'complete' });
  expect(evidence.operation.recordId).toBe((await app.inject(url)).json().recordId);
  expect(evidence.faultDecisions).toMatchObject([{ operationId: id, requestId: interrupted.headers['x-request-id'],
    fault, plannedHttpStatus: 504, sourceRevision: revision }]);
  expect(evidence.events.map((event: { kind: string }) => event.kind)).toEqual(
    fault === 'before-commit' ? ['accepted', 'confirmed'] : ['accepted', 'replayed', 'confirmed'],
  );
});

it('rejects invalid IDs and outcome selections and leaves an unknown source revision unset', async () => {
  for (const url of ['/api/operations/invalid/export', '/api/workflow/tasks/INVALID/export', '/api/adoption/INVALID/export',
    '/api/outcomes/intake-assist/export?baseline=intake-assist-baseline']) {
    expect((await app.inject(url)).statusCode).toBe(400);
  }
  expect((await app.inject('/api/operations/' + randomUUID() + '/export')).statusCode).toBe(404);
  expect((await app.inject('/api/outcomes/intake-assist/export?baseline=pipeline-digest-baseline&comparison=intake-assist-follow-up')).statusCode).toBe(404);
  const local = createApp({ pool: fixture.pool, revision: 'invalid' });
  try {
    expect((await local.inject('/api/outcomes/intake-assist/export')).json().sourceRevision).toBeNull();
  } finally {
    await local.close();
  }
});
