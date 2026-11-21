import { randomUUID } from 'node:crypto';
import { adoptionDetail, barrier } from '../../../../shared/contracts/measurement.ts';
import type { Diagnostic, DiagnosisInput, FollowUpInput, InterventionInput } from '../../../../shared/contracts/measurement.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { compareAdoption, diagnosticSignals } from './diagnostics.ts';
import { listAutomations, listPeriods } from './measurements.ts';

export class AdoptionError extends Error {
  readonly statusCode: 404 | 409 | 422;
  readonly code: string;

  constructor(statusCode: 404 | 409 | 422, code: string) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function collectDiagnostics(client: SqlClient, automationId: string) {
  const periods = await listPeriods(client, automationId);
  const signals = diagnosticSignals(periods);
  const observations = await client.query<{ period_id: string; category: string; observed_count: number; evidence: string }>(`
    SELECT o.* FROM lab_adoption_observations o JOIN lab_measurement_periods p ON p.id = o.period_id
    WHERE p.automation_id = $1 ORDER BY p.starts_on, o.category
  `, [automationId]);
  const explanations: Record<string, string> = {
    integration: 'Validate connector availability with the integration owner.',
    permission: 'An access policy may block part of the eligible cohort.',
    workflow: 'The automation may not support a branch used by operators.',
    training: 'Incomplete onboarding may explain some non-use.',
  };
  for (const row of observations.rows) {
    signals.push({ periodId: row.period_id, category: barrier.parse(row.category),
      observation: `${row.evidence} (${row.observed_count}).`, possibleExplanation: explanations[row.category] });
  }
  return { periods, signals, supportingObservations: observations.rows.map(row => ({
    periodId: row.period_id, category: row.category, count: row.observed_count,
  })) };
}

export async function getAdoption(pool: SqlClient, id: string) {
  const definition = (await listAutomations(pool)).find(item => item.id === id);
  if (!definition) return null;
  const [{ periods, signals, supportingObservations }, population, findings, interventions, followUps, auditRows] = await Promise.all([
    collectDiagnostics(pool, id),
    pool.query(`
      SELECT a.period_id AS "periodId", a.operator_id AS "operatorId", a.eligible,
        count(e.opportunity_number)::int AS attempted
      FROM lab_period_population a JOIN lab_measurement_periods p ON p.id = a.period_id
      LEFT JOIN lab_opportunities o ON o.period_id = a.period_id AND o.operator_id = a.operator_id
      LEFT JOIN lab_executions e ON e.period_id = o.period_id AND e.opportunity_number = o.opportunity_number
      WHERE p.automation_id = $1 GROUP BY a.period_id, a.operator_id, a.eligible
      ORDER BY a.period_id, a.operator_id
    `, [id]),
    pool.query(`
      SELECT id, period_id AS "periodId", category, hypothesis, evidence
      FROM lab_adoption_findings WHERE automation_id = $1 ORDER BY created_at DESC, id
    `, [id]),
    pool.query(`
      SELECT i.id, i.finding_id AS "findingId", i.action, i.owner, i.follow_up_on::text AS "followUpOn", i.implemented_on::text AS "implementedOn", i.implemented_at
      FROM lab_adoption_interventions i JOIN lab_adoption_findings f ON f.id = i.finding_id
      WHERE f.automation_id = $1 ORDER BY i.follow_up_on, i.id
    `, [id]),
    pool.query(`
      SELECT u.id, u.intervention_id AS "interventionId", u.period_id AS "periodId", u.notes
      FROM lab_adoption_follow_ups u JOIN lab_adoption_interventions i ON i.id = u.intervention_id
      JOIN lab_adoption_findings f ON f.id = i.finding_id JOIN lab_measurement_periods p ON p.id = u.period_id
      WHERE f.automation_id = $1 ORDER BY p.starts_on, u.id
    `, [id]),
    pool.query(`
      SELECT id::text, event, subject_id AS "subjectId", occurred_at, actor_role AS "actorRole", source_revision AS "sourceRevision" FROM lab_adoption_audit WHERE automation_id = $1 ORDER BY id DESC
    `, [id]),
  ]);
  return adoptionDetail.parse({ ...definition, periods, population: population.rows, diagnostics: signals, supportingObservations, findings: findings.rows,
    interventions: interventions.rows.map(({ implemented_at, ...row }) => ({ ...row, implementedAt: implemented_at?.toISOString() ?? null })),
    followUps: followUps.rows, audit: auditRows.rows.map(({ occurred_at, ...row }) => ({ ...row, occurredAt: occurred_at.toISOString() })),
  });
}

async function audit(client: SqlClient, automationId: string, subject: string, event: string, actor: EvidenceActor) {
  await client.query(`INSERT INTO lab_adoption_audit (automation_id, subject_id, event, actor_role, source_revision)
    VALUES ($1, $2, $3, $4, $5)`, [automationId, subject, event, actor.role, actor.sourceRevision]);
}

export async function recordDiagnosis(pool: Database, automationId: string, input: DiagnosisInput, actor: EvidenceActor) {
  return transaction(pool, async client => {
    const { periods, signals } = await collectDiagnostics(client, automationId);
    if (!periods.some(item => item.id === input.periodId)) throw new AdoptionError(404, 'PERIOD_NOT_FOUND');
    const signal = signals.find((entry: Diagnostic) => entry.periodId === input.periodId && entry.category === input.category);
    if (!signal) throw new AdoptionError(422, 'EVIDENCE_NOT_FOUND');
    const id = randomUUID();
    await client.query(`
      INSERT INTO lab_adoption_findings (id, automation_id, period_id, category, evidence, hypothesis)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, automationId, input.periodId, input.category, signal.observation, input.hypothesis]);
    await audit(client, automationId, id, 'diagnosis-recorded', actor);
    return { id };
  });
}

export async function planIntervention(pool: Database, automationId: string, input: InterventionInput, actor: EvidenceActor) {
  return transaction(pool, async client => {
    const result = await client.query<{ ends_on: string }>(`
      SELECT p.ends_on::text FROM lab_adoption_findings f JOIN lab_measurement_periods p ON p.id = f.period_id
      WHERE f.id = $1 AND f.automation_id = $2
    `, [input.findingId, automationId]);
    if (!result.rows[0]) throw new AdoptionError(404, 'DIAGNOSIS_NOT_FOUND');
    if (input.followUpOn < result.rows[0].ends_on) throw new AdoptionError(422, 'FOLLOW_UP_BEFORE_DIAGNOSIS_PERIOD_END');
    const id = randomUUID();
    await client.query('INSERT INTO lab_adoption_interventions (id, finding_id, action, owner, follow_up_on) VALUES ($1, $2, $3, $4, $5)',
      [id, input.findingId, input.action, input.owner, input.followUpOn]);
    await audit(client, automationId, id, 'intervention-planned', actor);
    return { id };
  });
}

async function lockIntervention(client: SqlClient, automationId: string, interventionId: string) {
  const result = await client.query<{ implemented_on: string | null; ends_on: string }>(`
    SELECT i.implemented_on::text, p.ends_on::text
    FROM lab_adoption_interventions i JOIN lab_adoption_findings f ON f.id = i.finding_id
    JOIN lab_measurement_periods p ON p.id = f.period_id
    WHERE i.id = $1 AND f.automation_id = $2 FOR UPDATE OF i
  `, [interventionId, automationId]);
  if (!result.rows[0]) throw new AdoptionError(404, 'INTERVENTION_NOT_FOUND');
  return result.rows[0];
}

export async function implementIntervention(pool: Database, automationId: string, id: string, implementedOn: string, actor: EvidenceActor) {
  return transaction(pool, async client => {
    const current = await lockIntervention(client, automationId, id);
    if (current.implemented_on && current.implemented_on !== implementedOn) {
      throw new AdoptionError(409, 'IMPLEMENTATION_ALREADY_RECORDED');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (implementedOn < current.ends_on || implementedOn > today) {
      throw new AdoptionError(422, 'INVALID_IMPLEMENTATION_DATE');
    }
    if (!current.implemented_on) {
      await client.query('UPDATE lab_adoption_interventions SET implemented_on = $2, implemented_at = clock_timestamp() WHERE id = $1',
        [id, implementedOn]);
      await audit(client, automationId, id, 'intervention-implemented', actor);
    }
    return { id };
  });
}

export async function recordFollowUp(pool: Database, automationId: string, interventionId: string, input: FollowUpInput, actor: EvidenceActor) {
  return transaction(pool, async client => {
    const current = await lockIntervention(client, automationId, interventionId);
    if (!current.implemented_on) throw new AdoptionError(409, 'INTERVENTION_NOT_IMPLEMENTED');
    const period = (await listPeriods(client, automationId)).find(row => row.id === input.periodId);
    if (!period) throw new AdoptionError(404, 'PERIOD_NOT_FOUND');
    if (period.startsOn < current.implemented_on || !period.observed) throw new AdoptionError(422, 'FOLLOW_UP_MUST_BE_LATER_AND_OBSERVED');
    const id = randomUUID();
    const result = await client.query(`
      INSERT INTO lab_adoption_follow_ups (id, intervention_id, period_id, notes)
      VALUES ($1, $2, $3, $4) ON CONFLICT (intervention_id, period_id) DO NOTHING
    `, [id, interventionId, input.periodId, input.notes]);
    if (!result.rowCount) throw new AdoptionError(409, 'FOLLOW_UP_ALREADY_RECORDED');
    await audit(client, automationId, id, 'follow-up-recorded', actor);
    return { id };
  });
}

export async function getAdoptionEvidence(pool: Database, id: string) {
  return transaction(pool, async client => {
    const record = await getAdoption(client, id);
    if (!record) return null;
    const { periods, findings, interventions, followUps, audit } = record;
    const byPeriod = new Map(periods.map(period => [period.id, period]));
    const byFinding = new Map(findings.map(finding => [finding.id, finding]));
    const byIntervention = new Map(interventions.map(intervention => [intervention.id, intervention]));
    const first = periods[0];
    const last = periods.at(-1);
    return {
      automation: { id: record.id, name: record.name, workflow: record.workflow, taskId: record.taskId },
      periods,
      diagnostics: record.diagnostics,
      supportingObservations: record.supportingObservations,
      findings: findings.map(({ id, periodId, category, evidence }) => ({ id, periodId, category, evidence })),
      interventions: interventions.map(({ id, findingId, followUpOn, implementedOn, implementedAt }) =>
        ({ id, findingId, followUpOn, implementedOn, implementedAt })),
      followUps: followUps.map(({ id, interventionId, periodId }) => {
        const intervention = byIntervention.get(interventionId);
        const finding = intervention && byFinding.get(intervention.findingId);
        const before = finding && byPeriod.get(finding.periodId);
        const after = byPeriod.get(periodId);
        return { id, interventionId, periodId, comparison: before && after ? compareAdoption(before, after) : null };
      }),
      audit: audit.reverse(),
      observedComparison: first && last && first !== last ? compareAdoption(first, last) : null,
      provenance: {
        sources: ['lab_measurement_periods', 'lab_period_population', 'lab_opportunities', 'lab_executions', 'lab_adoption_events',
          'lab_adoption_observations', 'lab_adoption_findings', 'lab_adoption_interventions', 'lab_adoption_follow_ups', 'lab_adoption_audit'],
        limitations: ['Operator identifiers and operator-authored hypotheses, actions, owners and notes are excluded.',
          'Audit IDs are ordered by insertion. Attribution identifies credential roles, with null for legacy records.'],
      },
      units: { rate: 'fraction', delta: 'percentage points', opportunities: 'count', duration: 'seconds', eligibilityAssumption: 'basis points' },
    };
  }, true);
}
