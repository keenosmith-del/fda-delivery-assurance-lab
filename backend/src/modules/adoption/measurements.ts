import { automation, period } from '../../../../shared/contracts/measurement.ts';
import type { MeasurementPeriod } from '../../../../shared/contracts/measurement.ts';
import type { SqlClient } from '../../db/pool.ts';
import { adoptionRates } from './diagnostics.ts';

export async function listAutomations(client: SqlClient) {
  const result = await client.query('SELECT id, name, workflow, task_id AS "taskId" FROM lab_automations ORDER BY name, id');
  return result.rows.map(item => automation.parse(item));
}

export async function listPeriods(client: SqlClient, automationId: string): Promise<MeasurementPeriod[]> {
  const result = await client.query(`
    SELECT p.id, p.label, p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.source,
      p.expected_opportunities AS expected, p.modeled_eligibility_bps AS "modeledEligibilityBps",
      p.baseline_seconds_per_item AS "baselineSecondsPerItem", population.*,
      execution.*, stats.*
    FROM lab_measurement_periods p
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS population, count(*) FILTER (WHERE a.eligible)::int AS "eligibleUsers",
        count(u.operator_id) FILTER (WHERE a.eligible)::int AS "adoptedUsers"
      FROM lab_period_population a LEFT JOIN lab_adoption_events u USING (period_id, operator_id)
      WHERE a.period_id = p.id
    ) population
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS observed, count(*) FILTER (WHERE eligible)::int AS "eligibleOpportunities"
      FROM lab_opportunities WHERE period_id = p.id
    ) stats
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS attempted,
        count(*) FILTER (WHERE e.succeeded)::int AS succeeded, count(*) FILTER (WHERE NOT e.succeeded)::int AS failed,
        count(e.exception)::int AS exceptions, COALESCE(sum(e.rework_seconds), 0)::int AS "reworkSeconds",
        COALESCE(sum(e.human_review_seconds), 0)::int AS "reviewSeconds",
        COALESCE(array_agg(DISTINCT e.exception ORDER BY e.exception) FILTER (WHERE e.exception IS NOT NULL), ARRAY[]::text[]) AS "exceptionReasons"
      FROM lab_executions e JOIN lab_opportunities o USING (period_id, opportunity_number)
      JOIN lab_period_population a USING (period_id, operator_id)
      WHERE e.period_id = p.id AND a.eligible AND o.eligible
    ) execution
    WHERE p.automation_id = $1 ORDER BY p.starts_on, p.id
  `, [automationId]);
  return result.rows.map(row => period.parse({ ...row, ...adoptionRates({
    population: row.population, eligibleUsers: row.eligibleUsers, adoptedUsers: row.adoptedUsers,
    expected: row.expected, observed: row.observed, eligibleOpportunities: row.eligibleOpportunities,
    attempted: row.attempted, succeeded: row.succeeded, failed: row.failed, exceptions: row.exceptions,
  }) }));
}
