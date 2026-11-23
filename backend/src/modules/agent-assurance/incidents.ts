import { lockFdaEvidence } from '../fda-ingestion/scope-lock.ts';
import { randomUUID } from 'node:crypto';
import { ASSURANCE_RULES, incidentDetail } from '../../../../shared/contracts/agent-assurance.ts';
import type { openIncidentInput, IncidentSummary, IncidentCommand, AssuranceDevice } from '../../../../shared/contracts/agent-assurance.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { z } from 'zod';
import type { EvidenceActor } from '../../api/evidence.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { transaction } from '../../db/pool.ts';
import { assess, loadAssuranceRecords, ofKind } from './assessment.ts';
import { evaluateRecovery, recoveryCriteria } from './recovery.ts';

export class AssuranceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const keys = (scope: FdaScope) => [scope.tenantId, scope.sourceId];

type Initial = z.infer<typeof incidentDetail>['initial'];
type State = IncidentSummary['state'];
type IncidentRow = Omit<IncidentSummary, 'detectedAt' | 'resolvedAt'> & {
  detectedAt: Date; resolvedAt: Date | null; implementedAt: Date | null; conditionSince: Date;
  verifiedThrough: Date | null; initial: Initial;
};
type Audit = Omit<z.infer<typeof incidentDetail>['audit'][number], 'at'> & { at: Date };

const fields = `id, endpoint_id AS "endpointId", window_id AS "windowId", category, state,
  detected_at AS "detectedAt", resolved_at AS "resolvedAt", implemented_at AS "implementedAt",
  condition_since AS "conditionSince", verified_through AS "verifiedThrough", initial`;

function summary(row: IncidentRow): IncidentSummary {
  return { id: row.id, endpointId: row.endpointId, windowId: row.windowId, category: row.category, state: row.state,
    detectedAt: row.detectedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null };
}

export async function listIncidents(db: SqlClient, scope: FdaScope, windowId?: string) {
  const { rows } = await db.query<IncidentRow>(`SELECT ${fields} FROM fda_agent_incidents
    WHERE tenant_id = $1 AND source_id = $2 AND ($3::text IS NULL OR window_id = $3)
    ORDER BY detected_at DESC, id`, [...keys(scope), windowId ?? null]);
  return rows.map(summary);
}

async function getIncident(db: SqlClient, scope: FdaScope, id: string, lock = false) {
  const { rows } = await db.query<IncidentRow>(`SELECT ${fields} FROM fda_agent_incidents WHERE tenant_id = $1 AND source_id = $2 AND id = $3 ${lock ? 'FOR UPDATE' : ''}`, [...keys(scope), id]);
  if (!rows[0]) throw new AssuranceError('AGENT_INCIDENT_NOT_FOUND', 404);
  return rows[0];
}

async function history(db: SqlClient, scope: FdaScope, id: string) {
  return (await db.query<Audit>(`SELECT action, before_state AS before, after_state AS after, actor_role AS actor,
    revision, occurred_at AS at, detail FROM fda_agent_incident_audit WHERE tenant_id = $1 AND source_id = $2 AND incident_id = $3 ORDER BY sequence`, [...keys(scope), id])).rows;
}

async function addAudit(db: SqlClient, scope: FdaScope, id: string, action: string, before: State | null,
  after: State, actor: EvidenceActor, detail: Record<string, unknown>, receiptIds: string[] = []) {
  const auditId = randomUUID();
  await db.query(`INSERT INTO fda_agent_incident_audit
    (id, tenant_id, source_id, incident_id, action, before_state, after_state, actor_role, revision, detail)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [auditId, ...keys(scope), id, action, before, after, actor.role, actor.sourceRevision, detail]);
  if (receiptIds.length) await db.query(`INSERT INTO fda_agent_incident_evidence (tenant_id, source_id, audit_id, receipt_id)
    SELECT $1, $2, $3, unnest($4::uuid[])`, [...keys(scope), auditId, [...new Set(receiptIds)]]);
}

export async function openIncident(db: Database, scope: FdaScope, input: z.infer<typeof openIncidentInput>, actor: EvidenceActor) {
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const assessment = assess(await loadAssuranceRecords(client, scope), input);
    const endpoint = assessment?.devices.find(d => d.endpointId === input.endpointId);
    const condition = endpoint?.conditions.find(item => item.category === input.category);
    if (!condition || !endpoint || !assessment?.window || !assessment.asOf) throw new AssuranceError('NO_QUALIFYING_CONDITION', 422);
    const { windowId, start, end } = assessment.window;
    const identity = [...keys(scope), input.endpointId, windowId, input.category];
    const episodes = async () => (await client.query<IncidentRow>(`SELECT ${fields} FROM fda_agent_incidents
      WHERE tenant_id=$1 AND source_id=$2 AND endpoint_id=$3 AND window_id=$4 AND category=$5 ORDER BY detected_at DESC, id`, identity)).rows;
    const existing = await episodes();
    const active = existing.find(row => row.state !== 'resolved');
    if (active) return summary(active);
    const previous = existing[0];
    if (previous?.verifiedThrough && condition.since <= previous.verifiedThrough.toISOString()) {
      return summary(previous);
    }

    const initial = { condition, assessment: { start, end, asOf: assessment.asOf }, endpoint, ruleVersion: ASSURANCE_RULES };
    const id = randomUUID();
    const { rows } = await client.query<IncidentRow>(`INSERT INTO fda_agent_incidents
      (id, tenant_id, source_id, endpoint_id, window_id, category, condition_since, initial)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING ${fields}`, [id, ...identity, condition.since, initial]);
    if (!rows[0]) {
      const conflicts = await episodes();
      const match = conflicts.find(row => row.state !== 'resolved' || row.conditionSince.toISOString() === condition.since);
      if (!match) throw new AssuranceError('INCIDENT_CHANGED');
      return summary(match);
    }
    await addAudit(client, scope, id, 'detect', null, 'open', actor, { condition }, condition.evidence.map(item => item.id));
    return summary(rows[0]);
  });
}

const permitted = {
  diagnose: ['open', 'investigating'],
  plan: ['investigating'],
  implement: ['intervention_planned'],
  verify: ['awaiting_verification'],
} satisfies Record<IncidentCommand['action'], State[]>;

export async function updateIncident(db: Database, scope: FdaScope, id: string, input: IncidentCommand, actor: EvidenceActor) {
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const incident = await getIncident(client, scope, id, true);
    const { state } = incident;
    if ((input.action === 'implement' && (state === 'awaiting_verification' || state === 'resolved')) ||
      (input.action === 'verify' && state === 'resolved')) return summary(incident);
    if (!(permitted[input.action] as readonly State[]).includes(state)) throw new AssuranceError('INVALID_INCIDENT_TRANSITION');

    let next: State = state;
    let detail: Record<string, unknown> = input;
    let evidence: string[] = [];
    let verifiedThrough: string | null = null;
    if (input.action === 'diagnose') {
      const canonical = await loadAssuranceRecords(client, scope);
      const assessment = assess(canonical, { windowId: incident.windowId });
      const current = assessment?.devices.find(d => d.endpointId === incident.endpointId);
      const relevant = new Map([...incident.initial.endpoint.timeline, ...current?.timeline ?? []].map(item => [item.id, item]));
      if (input.evidence.some(receipt => !relevant.has(receipt))) throw new AssuranceError('UNRELATED_SOURCE_EVIDENCE', 422);
      evidence = input.evidence;
      detail = { ...input, evidence: evidence.map(receipt => relevant.get(receipt)), interpretation: 'Engineering hypothesis' };
      next = 'investigating';
    } else if (input.action === 'plan') {
      detail = { ...input, criteria: recoveryCriteria[incident.category], ruleVersion: ASSURANCE_RULES };
      next = 'intervention_planned';
    } else if (input.action === 'implement') {
      next = 'awaiting_verification';
    } else {
      const assessment = assess(await loadAssuranceRecords(client, scope), input);
      if (!assessment?.window || !assessment.asOf || assessment.asOf < incident.conditionSince.toISOString()) {
        throw new AssuranceError('INVALID_VERIFICATION_ASSESSMENT', 422);
      }
      const device = assessment.devices.find(d => d.endpointId === incident.endpointId);
      const evaluation = evaluateRecovery(incident.category, assessment, device, incident.conditionSince.toISOString(),
        incident.initial.assessment.end, incident.implementedAt!.toISOString());
      const prior = (await history(client, scope, id)).findLast(item => item.action === 'verify');
      const key = JSON.stringify([evaluation.outcome, evaluation.windowId, evaluation.asOf, evaluation.evidence.map(row => row.id),
        evaluation.predicates.map(row => row.satisfied)]);
      if (prior?.detail.verificationKey === key) return summary(incident);
      detail = { ...evaluation, verificationKey: key };
      evidence = evaluation.evidence.map(item => item.id);
      if (evaluation.outcome === 'verified-recovered') {
        next = 'resolved';
        verifiedThrough = evaluation.evidence.map(item => item.occurredAt).sort().at(-1) ?? assessment.asOf;
      }
    }

    const { rows } = await client.query<IncidentRow>(`UPDATE fda_agent_incidents
      SET state=$4, implemented_at=CASE WHEN $5 THEN clock_timestamp() ELSE implemented_at END,
        resolved_at=CASE WHEN $4='resolved' THEN clock_timestamp() ELSE resolved_at END, verified_through=$6
      WHERE tenant_id=$1 AND source_id=$2 AND id=$3 RETURNING ${fields}`,
    [...keys(scope), id, next, input.action === 'implement', verifiedThrough]);
    await addAudit(client, scope, id, input.action, state, next, actor, detail, evidence);
    return summary(rows[0]);
  });
}

export function readIncident(db: Database, scope: FdaScope, id: string) {
  return transaction(db, async client => {
    const incident = await getIncident(client, scope, id);
    const records = await loadAssuranceRecords(client, scope);
    const current: AssuranceDevice | null = assess(records)?.devices.find(d => d.endpointId === incident.endpointId) ?? null;
    const workflows = [...new Set(ofKind(records, 'workflow.candidate').filter(row =>
      row.event.payload.windowIds.includes(incident.windowId)).map(row => row.subjectId))];
    const audit = (await history(client, scope, id)).map(item => ({ ...item, at: item.at.toISOString() }));
    return incidentDetail.parse({ ...summary(incident), initial: incident.initial, audit, current, workflows });
  }, true);
}
