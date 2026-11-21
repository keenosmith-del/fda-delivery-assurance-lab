import type { SqlClient } from '../../db/pool.ts';
import { review, suitabilityInputs } from '../../../../shared/contracts/intelligence.ts';
import type { ReviewInput, TaskDetail } from '../../../../shared/contracts/intelligence.ts';
import { queryDevices } from '../agent-health/service.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { assessSuitability, classify, recommend, workflowScoringLimits, workflowScoringMethod, workflowScoringVersion } from './scoring.ts';

interface TaskRow {
  id: string;
  label: string;
  category: string;
  expected_sequence: string[];
  suitability_inputs: unknown;
}

async function evidenceByTask(pool: SqlClient, id: string | null) {
  const rows = await pool.query<{
    task_id: string; id: string; device_id: string; occurred_at: Date;
    sequence: string[]; duration_seconds: number; exception: boolean;
  }>(`
    SELECT * FROM lab_workflow_events
    WHERE ($1::text IS NULL OR task_id = $1) ORDER BY occurred_at, id
  `, [id]);
  const groups = new Map<string, TaskDetail['evidence']>();
  for (const row of rows.rows) {
    const entries = groups.get(row.task_id) ?? [];
    entries.push({ id: row.id, deviceId: row.device_id, observedAt: row.occurred_at.toISOString(),
      sequence: row.sequence, durationSeconds: row.duration_seconds, exception: row.exception });
    groups.set(row.task_id, entries);
  }
  return groups;
}

function describe(task: TaskRow, evidence: TaskDetail['evidence']) {
  const { id, label, category } = task;
  const inputs = suitabilityInputs.parse(task.suitability_inputs);
  const classification = classify(task.expected_sequence, evidence);
  const suitability = assessSuitability(inputs, evidence);
  return { id, label, category, classification, suitability, evidenceCount: evidence.length,
    recommendation: recommend(classification.score, suitability.score, inputs.judgment, inputs.risk) };
}

export async function listTasks(pool: SqlClient) {
  const [tasks, evidence] = await Promise.all([
    pool.query<TaskRow>('SELECT * FROM lab_tasks ORDER BY label, id'), evidenceByTask(pool, null),
  ]);
  return tasks.rows.map(task => describe(task, evidence.get(task.id) ?? []));
}

export async function getTask(pool: SqlClient, id: string): Promise<TaskDetail | null> {
  const tasks = await pool.query<TaskRow>('SELECT * FROM lab_tasks WHERE id = $1', [id]);
  const task = tasks.rows[0];
  if (!task) return null;
  const [events, reviews, devices] = await Promise.all([
    evidenceByTask(pool, id),
    pool.query<ReviewInput & { id: string; reviewed_at: Date; actorRole: EvidenceActor["role"] | null; sourceRevision: string | null }>(`
      SELECT id::text, classification, suitability, reason, reviewed_at, actor_role AS "actorRole", source_revision AS "sourceRevision"
      FROM lab_reviews WHERE task_id = $1 ORDER BY id::bigint DESC LIMIT 100
    `, [id]),
    queryDevices(pool),
  ]);
  const evidence = events.get(id) ?? [];
  const evidenceGaps = [];
  if (evidence.length < 10) evidenceGaps.push('Fewer than ten matching or related events in the sample.');
  if (new Set(evidence.map(event => event.deviceId)).size < 4) evidenceGaps.push('Evidence comes from fewer than four endpoints.');
  if (devices.reporting < devices.devices.length) evidenceGaps.push('Some enrolled endpoints were not reporting at the end of the sample window.');
  if (devices.devices.some(device => device.missingIntervals.length)) evidenceGaps.push('The sample includes intervals without successful observation.');
  return { ...describe(task, evidence), expectedSequence: task.expected_sequence, evidence, evidenceGaps,
    scoring: { version: workflowScoringVersion, method: workflowScoringMethod, limitations: workflowScoringLimits,
      suitabilityInputs: suitabilityInputs.parse(task.suitability_inputs),
      observationWindow: devices.window && devices.windowId ? { id: devices.windowId, ...devices.window } : null,
    },
    reviews: reviews.rows.map(({ reviewed_at, ...item }) => review.parse({ ...item, reviewedAt: reviewed_at.toISOString() })) };
}

export async function saveReview(pool: SqlClient, id: string, input: ReviewInput, actor: EvidenceActor) {
  const result = await pool.query<ReviewInput & { id: string; reviewed_at: Date; actorRole: EvidenceActor["role"] | null; sourceRevision: string | null }>(`
    INSERT INTO lab_reviews (task_id, classification, suitability, reason, actor_role, source_revision)
    SELECT id, $2, $3, $4, $5, $6 FROM lab_tasks WHERE id = $1
    RETURNING id::text, classification, suitability, reason, reviewed_at, actor_role AS "actorRole", source_revision AS "sourceRevision"
  `, [id, input.classification, input.suitability, input.reason, actor.role, actor.sourceRevision]);
  const row = result.rows[0];
  if (!row) return null;
  const { reviewed_at, ...item } = row;
  return review.parse({ ...item, reviewedAt: reviewed_at.toISOString() });
}
