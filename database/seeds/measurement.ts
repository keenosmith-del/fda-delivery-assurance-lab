import type { Database } from '../../backend/src/db/pool.ts';
import { transaction } from '../../backend/src/db/pool.ts';

const automations = [
  { id: 'intake-assist', name: 'Candidate intake assistant', workflow: 'Recruiting intake', task: 'ats-intake',
    volume: 350, eligibility: 8600, seconds: 240, population: 5, baselineUsers: 4, followUpUsers: 5 },
  { id: 'pipeline-digest', name: 'Pipeline digest assistant', workflow: 'Weekly operations reporting', task: 'weekly-digest',
    volume: 46, eligibility: 8400, seconds: 180, population: 4, baselineUsers: 2, followUpUsers: 3 },
];

export async function seedMeasurement(pool: Database) {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(731820003)');
    for (const item of automations) {
      await client.query('INSERT INTO lab_automations VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [item.id, item.name, item.workflow, item.task]);
      for (const followUp of [false, true]) {
        const periodId = `${item.id}-${followUp ? 'follow-up' : 'baseline'}`;
        const observed = item.volume - (item.id === 'pipeline-digest' && followUp ? 6 : 0);
        const users = followUp ? item.followUpUsers : item.baselineUsers;
        await client.query(`
          INSERT INTO lab_measurement_periods VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING
        `, [periodId, item.id, followUp ? '2026-11-09' : '2026-11-02', followUp ? '2026-11-16' : '2026-11-09',
          followUp ? 'Follow-up week' : 'Baseline week', item.volume, item.eligibility, item.seconds,
          'Synthetic workflow opportunity and execution ledger, fixture v1']);
        await client.query(`
          INSERT INTO lab_period_population
          SELECT $1, 'operator-' || n, n <= $2::integer FROM generate_series(1, $2::integer + 1) n ON CONFLICT DO NOTHING
        `, [periodId, item.population]);
        await client.query(`
          INSERT INTO lab_opportunities
          SELECT $1, n, 'operator-' || CASE WHEN n % 11 = 0 THEN $3::integer + 1
            ELSE ((n - 1) % $3::integer) + 1 END, n % 11 <> 0
          FROM generate_series(1, $2::integer) n ON CONFLICT DO NOTHING
        `, [periodId, observed, item.population]);
        await client.query(`
          INSERT INTO lab_executions
          SELECT period_id, opportunity_number, opportunity_number % $3::integer <> 0,
            CASE WHEN opportunity_number % $3::integer = 0 THEN 'Connector timeout'
                 WHEN opportunity_number % 11 = 1 THEN 'Manual exception review' END,
            CASE WHEN opportunity_number % $3::integer = 0 THEN 95 ELSE 0 END,
            CASE WHEN opportunity_number % 11 = 1 THEN 60 ELSE 20 END
          FROM lab_opportunities
          WHERE period_id = $1 AND eligible AND substring(operator_id FROM '[0-9]+')::int <= $2
            AND (opportunity_number <= 5 OR opportunity_number % $4::integer <> 0)
          ON CONFLICT DO NOTHING
        `, [periodId, users, followUp ? 13 : 7, followUp ? 5 : 3]);
        await client.query(`
          INSERT INTO lab_adoption_events
          SELECT o.period_id, o.operator_id, min(o.opportunity_number)
          FROM lab_opportunities o JOIN lab_executions e USING (period_id, opportunity_number)
          WHERE o.period_id = $1 AND o.eligible
          GROUP BY o.period_id, o.operator_id ON CONFLICT DO NOTHING
        `, [periodId]);
        await client.query(`
          INSERT INTO lab_adoption_observations VALUES
            ($1, 'integration', $2, 'Required connector was unavailable in the fixture capability checks'),
            ($1, 'permission', $3, 'Fixture access checks denied a required operation'),
            ($1, 'workflow', $4, 'Fixture traces included a manual workflow branch'),
            ($1, 'training', $5, 'Fixture onboarding records showed a missed orientation session')
          ON CONFLICT DO NOTHING
        `, [periodId, followUp ? 1 : 4, followUp ? 1 : 3, 2, followUp ? 1 : 2]);
        if (item.id === 'intake-assist' || !followUp) {
          await client.query(`
            INSERT INTO lab_outcome_measurements
              (period_id, measured_items, human_handling_seconds, method, source, reviewed, review_provenance)
            VALUES ($1, $2, $3, $4, $5, $6, 'synthetic-fixture') ON CONFLICT DO NOTHING
          `, [periodId, observed, followUp ? 62_000 : observed * item.seconds,
            'End-to-end human handling, including review and rework',
            'Synthetic time study, separately seeded fixture totals', true]);
        }
      }
    }
  });
}
