import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { adoptionRates, diagnosticSignals } from '../src/modules/adoption/diagnostics.ts';
import { calculateOutcome, weeklyOpportunity } from '../src/modules/outcomes/calculations.ts';
import type { MeasurementPeriod } from '../../shared/contracts/measurement.ts';
import { openTestDatabase } from '../../tests/support/database.ts';
import { seedIntelligence } from '../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../database/seeds/measurement.ts';

const sample: MeasurementPeriod = {
  id: 'baseline-test', label: 'Baseline', startsOn: '2026-11-02', endsOn: '2026-11-09', source: 'Test ledger',
  expected: 10, observed: 10, eligibleOpportunities: 8, population: 5, eligibleUsers: 4, adoptedUsers: 2,
  attempted: 4, succeeded: 3, failed: 1, exceptions: 1, adoption: .5, opportunityUsage: .5, reliability: .75,
  coverage: 1, reworkSeconds: 100, reviewSeconds: 40, exceptionReasons: ['Test exception'],
  baselineSecondsPerItem: 60, modeledEligibilityBps: 8000,
};
const after = { ...sample, id: 'comparison-test', startsOn: '2026-11-09', endsOn: '2026-11-16' };
const timing = { measuredItems: 10, humanHandlingSeconds: 600, method: 'Human handling', source: 'Synthetic timing', reviewed: true };

describe('adoption and outcome calculations', () => {
  it('calculates separate adoption, opportunity, reliability and coverage rates', () => {
    expect(adoptionRates(sample)).toEqual({ adoption: .5, opportunityUsage: .5, reliability: .75, coverage: 1 });
    expect(adoptionRates({ ...sample, adoptedUsers: 0, eligibleUsers: 0, observed: 0, eligibleOpportunities: 0,
      attempted: 0, succeeded: 0, failed: 0, exceptions: 0 })).toEqual({
      adoption: null, opportunityUsage: null, reliability: null, coverage: 0,
    });
    expect(() => adoptionRates({ ...sample, succeeded: 5 })).toThrow('Invalid adoption counts');
  });

  it('separates diagnostic observations from causes and flags usage changes', () => {
    const signals = diagnosticSignals([sample, { ...after, opportunityUsage: .25 }]);
    expect(signals.map(item => item.category)).toContain('inconsistent-usage');
    expect(signals.find(item => item.category === 'low-adoption')).toMatchObject({
      observation: '2 of 4 eligible operators attempted an execution.',
      possibleExplanation: 'Training and workflow handoffs may affect adoption.',
    });
  });

  it('reproduces the modeled estimate and explains net time versus reviewed outcomes', () => {
    expect(weeklyOpportunity(350, 8600) + weeklyOpportunity(46, 8400)).toBeCloseTo(339.64);
    expect(() => weeklyOpportunity(350, 10001)).toThrow('Invalid opportunity inputs');
    expect(calculateOutcome({ period: sample, measurement: timing }, {
      period: after, measurement: { ...timing, humanHandlingSeconds: 450 },
    })).toMatchObject({ grossEstimatedSeconds: 180, netEstimatedSeconds: 40, adoptionAdjustedOpportunity: 4,
      verifiedSeconds: 150, verificationLimits: [] });
    expect(() => calculateOutcome({ period: after, measurement: timing }, { period: sample, measurement: timing }))
      .toThrow('Invalid outcome comparison');
  });

  it('withholds verified results for incomplete or unmatched measurement inputs', () => {
    const result = calculateOutcome({ period: sample, measurement: timing }, {
      period: { ...after, coverage: .8 }, measurement: { ...timing, measuredItems: 8, reviewed: false },
    });
    expect(result.verifiedSeconds).toBeNull();
    expect(result.verificationLimits).toHaveLength(3);
  });
});

describe('measurement APIs and PostgreSQL persistence', () => {
  const token = 'measurement-test-operator-token';
  const authorization = `Bearer ${token}`;
  const prefix = '/api/adoption/pipeline-digest';
  let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixture = await openTestDatabase();
    await seedIntelligence(fixture.pool);
    await seedMeasurement(fixture.pool);
    await seedMeasurement(fixture.pool);
    app = createApp({ pool: fixture.pool, writeToken: token });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await fixture?.close();
  });

  const post = (url: string, payload: object, auth = true) =>
    app.inject({ method: 'POST', url, payload, headers: auth ? { authorization } : {} });

  it('loads reproducible 80% and 50% illustrative adoption and period provenance', async () => {
    const intake = await app.inject('/api/adoption/intake-assist');
    expect(intake.statusCode).toBe(200);
    const digest = await app.inject(prefix);
    expect(digest.statusCode).toBe(200);
    expect(intake.json().periods[0]).toMatchObject({ adoptedUsers: 4, eligibleUsers: 5, adoption: .8, observed: 350 });
    expect(digest.json().periods[0]).toMatchObject({ adoptedUsers: 2, eligibleUsers: 4, adoption: .5, observed: 46 });
    expect(digest.json().population).toContainEqual(expect.objectContaining({ eligible: false, attempted: 0 }));
    expect((await fixture.pool.query('SELECT operator_id FROM lab_adoption_events WHERE period_id = $1',
      ['pipeline-digest-baseline'])).rowCount).toBe(2);
    expect(digest.json().diagnostics).toContainEqual(expect.objectContaining({ category: 'permission' }));
  });

  it('persists an evidence-backed diagnosis, owned intervention, implementation and later review', async () => {
    const diagnosis = { periodId: 'pipeline-digest-baseline', category: 'low-adoption', hypothesis: 'Missed onboarding may explain the observed non-use.' };
    expect((await post(`${prefix}/diagnoses`, diagnosis, false)).statusCode).toBe(401);
    expect((await post(`${prefix}/diagnoses`, { ...diagnosis, hypothesis: 'short' })).statusCode).toBe(400);
    expect((await post('/api/adoption/intake-assist/diagnoses', diagnosis)).statusCode).toBe(404);
    expect((await post(`${prefix}/diagnoses`, { ...diagnosis, category: 'inconsistent-usage' })).statusCode).toBe(422);
    const finding = await post(`${prefix}/diagnoses`, diagnosis);
    expect(finding.statusCode).toBe(201);
    const intervention = await post(`${prefix}/interventions`, {
      findingId: finding.json().id, action: 'Repeat the walkthrough with the operations cohort.',
      owner: 'Operations owner', followUpOn: '2026-11-16',
    });
    expect(intervention.statusCode).toBe(201);
    const path = `${prefix}/interventions/${intervention.json().id}`;
    const followUp = { periodId: 'pipeline-digest-follow-up', notes: 'Compare the later measurements after implementation.' };
    expect((await post(`${path}/follow-ups`, followUp)).statusCode).toBe(409);
    expect((await post(`${path}/implement`, { implementedOn: '2026-11-08' })).statusCode).toBe(422);
    expect((await post(`${path}/implement`, { implementedOn: '2026-11-09' })).statusCode).toBe(200);
    expect((await post(`${path}/implement`, { implementedOn: '2026-11-09' })).statusCode).toBe(200);
    expect((await post(`${path}/follow-ups`, { ...followUp, periodId: diagnosis.periodId })).statusCode).toBe(422);
    expect((await post(`${path}/follow-ups`, followUp)).statusCode).toBe(201);
    expect((await post(`${path}/follow-ups`, followUp)).statusCode).toBe(409);
    const loaded = (await app.inject(prefix)).json();
    expect(loaded.findings[0]).toMatchObject({ evidence: '2 of 4 eligible operators attempted an execution.', hypothesis: diagnosis.hypothesis });
    expect(loaded.interventions[0]).toMatchObject({ owner: 'Operations owner', implementedOn: '2026-11-09' });
    expect(loaded.followUps[0]).toMatchObject(followUp);
    expect(loaded.audit.map(({ event }: { event: string }) => event))
      .toEqual(['follow-up-recorded', 'intervention-implemented', 'intervention-planned', 'diagnosis-recorded']);
    expect((await fixture.pool.query('SELECT notes FROM lab_adoption_follow_ups')).rows).toEqual([{ notes: followUp.notes }]);
  });

  it('exposes the modeled total and exports selected outcome evidence with provenance', async () => {
    const model = await app.inject('/api/outcomes/model');
    expect(model.statusCode).toBe(200);
    expect(model.json().totalModeledWeeklyOccurrences).toBe(339.64);
    const valid = '/api/outcomes/intake-assist?baseline=intake-assist-baseline&comparison=intake-assist-follow-up';
    const summary = await app.inject(valid);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ verifiedSeconds: 22000, verificationLimits: [], baselineMeasurement: {
      measuredItems: 350, humanHandlingSeconds: 84000, source: expect.stringContaining('Synthetic time study'),
    } });
    const missing = await app.inject('/api/outcomes/pipeline-digest');
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toMatchObject({ verifiedSeconds: null, comparisonMeasurement: null });
    expect(missing.json().comparison.coverage).toBeCloseTo(40 / 46);
    expect((await app.inject('/api/outcomes/intake-assist?baseline=intake-assist-baseline')).statusCode).toBe(400);
    expect((await app.inject('/api/outcomes/intake-assist?baseline=intake-assist-follow-up&comparison=intake-assist-baseline')).statusCode).toBe(404);
    const exported = await app.inject(valid.replace('?', '/export?'));
    expect(exported.headers['content-disposition']).toContain('intake-assist-outcome-evidence.json');
    expect(exported.json()).toEqual({ evidenceType: 'synthetic lab measurements', ...summary.json() });
  });
});
