import type { SqlClient } from '../../db/pool.ts';
import { outcome, opportunityModel, outcomeMeasurement } from '../../../../shared/contracts/measurement.ts';
import { listAutomations, listPeriods } from '../adoption/measurements.ts';
import { calculateOutcome, weeklyOpportunity } from './calculations.ts';

export async function getOpportunityModel(pool: SqlClient) {
  const automations = await listAutomations(pool);
  const terms = (await Promise.all(automations.map(async item => {
    const [baseline] = await listPeriods(pool, item.id);
    return baseline ? { automation: item.name, baselineVolume: baseline.observed, modeledEligibilityBps: baseline.modeledEligibilityBps,
      modeledOccurrences: weeklyOpportunity(baseline.observed, baseline.modeledEligibilityBps) } : null;
  }))).filter(term => term !== null);
  return opportunityModel.parse({ terms,
    totalModeledWeeklyOccurrences: terms.reduce((total, term) => total + Math.round(term.modeledOccurrences * 100), 0) / 100 });
}

export async function getOutcome(pool: SqlClient, id: string, baselineId?: string, comparisonId?: string) {
  const definition = (await listAutomations(pool)).find(item => item.id === id);
  if (!definition) return null;
  const periods = await listPeriods(pool, id);
  const baseline = baselineId ? periods.find(item => item.id === baselineId) : periods[0];
  const comparison = comparisonId ? periods.find(item => item.id === comparisonId) : periods.at(-1);
  if (!baseline || !comparison || comparison.startsOn < baseline.endsOn) return null;
  const result = await pool.query(`
    SELECT period_id, measured_items AS "measuredItems", human_handling_seconds AS "humanHandlingSeconds", method, source, reviewed, review_provenance AS "reviewProvenance"
    FROM lab_outcome_measurements WHERE period_id IN ($1, $2)
  `, [baseline.id, comparison.id]);
  const measurements = new Map(result.rows.map(row => [row.period_id, outcomeMeasurement.parse(row)]));
  return outcome.parse({ automation: definition, baseline, comparison, ...calculateOutcome(
    { period: baseline, measurement: measurements.get(baseline.id) ?? null },
    { period: comparison, measurement: measurements.get(comparison.id) ?? null },
  ) });
}
