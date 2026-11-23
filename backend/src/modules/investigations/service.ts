import { randomUUID } from 'node:crypto';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import { OUTPUT_VERSION, PROMPT_VERSION, RETRIEVAL_VERSION } from '../../../../shared/contracts/investigations.ts';
import type { EvidencePacket, InvestigationRequest, InvestigationReview, InvestigationScope } from '../../../../shared/contracts/investigations.ts';
import type { EvidenceActor } from '../../api/evidence.ts';
import { transaction } from '../../db/pool.ts';
import type { Database } from '../../db/pool.ts';
import { lookupDelivery } from '../adoption/assurance.ts';
import { lockFdaEvidence } from '../fda-ingestion/scope-lock.ts';
import { fingerprint } from '../workflow-assessments/evidence.ts';
import { collectPacket } from './evidence.ts';
import { validateAnalysis } from './grounding.ts';
import { canFit, ProviderFailure, safeQuestion } from './provider.ts';
import type { Provider } from './provider.ts';

const scoped = (scope: FdaScope, id: string) => [scope.tenantId, scope.sourceId, id];
export class InvestigationError extends Error {
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.status = status; }
}
type Row = { id: string; caseId: string; question: string; status: string; reviewRevision: number; fingerprint: string;
  selection: InvestigationScope; requestHash: string; applicationRevision: string | null; actorRole: string; createdAt: Date;
  updatedAt: Date; deadlineAt: Date | null };
const fields = `id,case_id AS "caseId",question,status,review_revision AS "reviewRevision",evidence_fingerprint AS fingerprint,
  request_hash AS "requestHash",selection,application_revision AS "applicationRevision",actor_role AS "actorRole",
  created_at AS "createdAt",updated_at AS "updatedAt",deadline_at AS "deadlineAt"`;
const interrupted = (row: Row) => row.status === 'running' && row.deadlineAt && row.deadlineAt.getTime() <= Date.now();
function publicRow(row: Row) {
  const { requestHash: _, deadlineAt: _deadline, ...visible } = row;
  return { ...visible, status: interrupted(row) ? 'failed' : row.status };
}
const selectionOf = ({ category, baseline, comparison, method, interventionId }: InvestigationScope): InvestigationScope =>
  baseline && comparison ? { category, baseline, comparison, method: method ?? 'matched-items', ...(interventionId && { interventionId }) } : { category };
export const previewInvestigation = (db: Database, scope: FdaScope, id: string, selection: InvestigationScope) =>
  transaction(db, client => collectPacket(client, scope, id, selectionOf(selection)), true);

export function listInvestigations(db: Database, scope: FdaScope, caseId: string) {
  return transaction(db, async client => {
    await lookupDelivery(client, scope, caseId);
    const { rows } = await client.query<Row>(`SELECT ${fields} FROM fda_investigations WHERE (tenant_id,source_id,case_id)=($1,$2,$3)
      ORDER BY created_at DESC,id LIMIT 50`, scoped(scope, caseId));
    return rows.map(publicRow);
  }, true);
}

type Launch = { id: string; status: string; packet?: EvidencePacket };
export async function requestInvestigation(db: Database, scope: FdaScope, caseId: string, input: InvestigationRequest,
  actor: EvidenceActor, provider?: Provider): Promise<Launch> {
  if (!safeQuestion(input.question)) throw new InvestigationError('QUESTION_CONTAINS_UNSUPPORTED_CONTENT', 422);
  const selection = selectionOf(input);
  const hash = fingerprint({ caseId, ...input, ...selection });
  const existing = async (client: Pick<Database,'query'>) => (await client.query<Row>(`SELECT ${fields} FROM fda_investigations
    WHERE (tenant_id,source_id,request_id)=($1,$2,$3)`, scoped(scope,input.requestId))).rows[0];
  function replay(row: Row) {
    if (row.requestHash !== hash) throw new InvestigationError('INVESTIGATION_REPLAY_CONFLICT');
    return { id: row.id, status: publicRow(row).status };
  }
  const prior = await existing(db);
  if (prior) return replay(prior);
  const packet = await previewInvestigation(db, scope, caseId, selection);
  const status = !input.runInference ? 'evidence-only' : !provider ? 'disabled'
    : canFit(packet, input.question, provider.inputLimit) ? 'running' : 'insufficient-evidence';
  return transaction(db, async client => {
    await lockFdaEvidence(client, scope);
    const prior = await existing(client);
    if (prior) return replay(prior);
    const delivery = await lookupDelivery(client, scope, caseId);
    const { rows: [count] } = await client.query<{ recent: number; active: number; caseCount: number }>(`
      SELECT count(*) FILTER (WHERE actor_role=$3 AND created_at > clock_timestamp()-interval '1 minute')::int AS recent,
      count(*) FILTER (WHERE status='running' AND deadline_at > clock_timestamp())::int AS active,
      count(*) FILTER (WHERE case_id=$4)::int AS "caseCount"
      FROM fda_investigations WHERE tenant_id=$1 AND source_id=$2`, [scope.tenantId,scope.sourceId,actor.role,caseId]);
    if (count!.recent >= 8 || status === 'running' && count!.active >= 2) throw new InvestigationError('INVESTIGATION_RATE_LIMIT',429);
    if (count!.caseCount >= 100) throw new InvestigationError('INVESTIGATION_CASE_LIMIT',409);
    const { rows: expired } = await client.query<{id: string}>(`UPDATE fda_investigations SET status='failed',updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND source_id=$2 AND status='running' AND deadline_at<=clock_timestamp() RETURNING id`, [scope.tenantId,scope.sourceId]);
    if (expired.length) await client.query(`UPDATE fda_investigation_attempts SET status='failed',error_code='interrupted',finished_at=clock_timestamp()
      WHERE tenant_id=$1 AND source_id=$2 AND investigation_id=ANY($3::uuid[]) AND status='running'`,
      [scope.tenantId,scope.sourceId,expired.map(row => row.id)]);
    const id = randomUUID(), keys = scoped(scope,id);
    await client.query(`INSERT INTO fda_investigations (tenant_id,source_id,id,case_id,assessment_id,assessment_revision,decision_id,
      request_id,request_hash,question,selection,status,evidence_fingerprint,retrieval_version,application_revision,actor_role,deadline_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [...keys, caseId, delivery.assessmentId, delivery.revision, delivery.decisionId, input.requestId,hash,input.question,selection,status,
        packet.fingerprint,RETRIEVAL_VERSION,actor.sourceRevision,actor.role,
        status === 'running' && provider ? new Date(Date.now() + provider.timeoutMs + 5000) : null]);
    await client.query(`INSERT INTO fda_investigation_snapshots (tenant_id,source_id,investigation_id,packet) VALUES ($1,$2,$3,$4)`,
      [...keys,packet]);
    if (status === 'running' && provider) {
      await client.query(`INSERT INTO fda_investigation_attempts (tenant_id,source_id,investigation_id,provider,model,prompt_version,
        output_version,configuration,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running')`,
        [...keys,provider.name,provider.model,PROMPT_VERSION,OUTPUT_VERSION,{ version: 'v1', inputLimit: provider.inputLimit,
          outputLimit: provider.outputLimit, timeoutMs: provider.timeoutMs }]);
      return { id,status,packet };
    }
    return { id,status };
  });
}

export async function finishInvestigation(db: Database, scope: FdaScope, id: string, packet: EvidencePacket, question: string, provider: Provider) {
  let result: ReturnType<typeof validateAnalysis> | undefined, usage: object | undefined, errorCode: string | undefined;
  const deadline = AbortSignal.timeout(provider.timeoutMs);
  try {
    const output = await Promise.race([provider.infer(packet, question, deadline), new Promise<never>((_, reject) => {
      deadline.addEventListener('abort', () => reject(new ProviderFailure('provider-timeout')), { once: true });
    })]);
    result = validateAnalysis(packet, output.candidate);
    usage = output.usage;
  } catch (error) { errorCode = deadline.aborted ? 'provider-timeout' : error instanceof ProviderFailure ? error.code : 'provider-unavailable'; }
  return transaction(db, async client => {
    const keys = scoped(scope,id);
    const { rows: [live] } = await client.query<{ active: boolean }>(`SELECT (deadline_at>clock_timestamp()) AS active FROM fda_investigations
      WHERE (tenant_id,source_id,id)=($1,$2,$3) AND status='running' AND evidence_fingerprint=$4 FOR UPDATE`, [...keys,packet.fingerprint]);
    if (!live) return;
    if (!live.active) { result = undefined; usage = undefined; errorCode = 'interrupted'; }
    const status = result?.analysis ? 'ready' : result ? 'validation-failed' : 'failed';
    await client.query(`UPDATE fda_investigations SET status=$4,updated_at=clock_timestamp() WHERE (tenant_id,source_id,id)=($1,$2,$3)`, [...keys,status]);
    await client.query(`UPDATE fda_investigation_attempts SET status=$4,result=$5,validation=$6,usage=$7,error_code=$8,finished_at=clock_timestamp()
      WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3) AND status='running'`,
      [...keys,status === 'ready' ? 'succeeded' : status,result?.analysis ?? null,result?.validation ?? null,usage ?? null,errorCode ?? null]);
  });
}

export function readInvestigation(db: Database, scope: FdaScope, id: string) {
  return transaction(db, async client => {
    const keys = scoped(scope,id);
    const { rows: [row] } = await client.query<Row>(`SELECT ${fields} FROM fda_investigations WHERE (tenant_id,source_id,id)=($1,$2,$3)`,keys);
    if (!row) throw new InvestigationError('INVESTIGATION_NOT_FOUND',404);
    const { rows: [historical] } = await client.query<{packet: EvidencePacket}>(`SELECT packet FROM fda_investigation_snapshots
      WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3)`,keys);
    const { rows: [attempt] } = await client.query(`SELECT provider,model,prompt_version AS "promptVersion",output_version AS "outputVersion",
      configuration,status,usage,result AS analysis,validation,error_code AS "errorCode",started_at AS "startedAt",finished_at AS "finishedAt"
      FROM fda_investigation_attempts WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3)`,keys);
    const { rows: reviews } = await client.query(`SELECT revision,decision,actor_role AS "actorRole",recorded_at AS "recordedAt",
      application_revision AS "applicationRevision",output_version AS "outputVersion",evidence_fingerprint AS fingerprint
      FROM fda_investigation_reviews WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3) ORDER BY revision`,keys);
    const packet = historical!.packet;
    const current = await collectPacket(client,scope,row.caseId,row.selection);
    return { ...publicRow(row), packet, attempt: interrupted(row) && attempt ? {...attempt,status:'failed',errorCode:'interrupted'} : attempt ?? null,
      reviews, stale: packet.fingerprint !== current.fingerprint, currentFingerprint: current.fingerprint,
      evidenceClassifications: ['persisted-evidence','model-generated-interpretation','deterministic-validation','human-review'] };
  }, true);
}

export function reviewInvestigation(db: Database, scope: FdaScope, id: string, input: InvestigationReview, actor: EvidenceActor) {
  if (!safeQuestion(input.reason)) throw new InvestigationError('REVIEW_CONTAINS_UNSUPPORTED_CONTENT',422);
  return transaction(db, async client => {
    const keys = scoped(scope,id);
    const { rows: [row] } = await client.query<Row>(`SELECT ${fields} FROM fda_investigations
      WHERE (tenant_id,source_id,id)=($1,$2,$3) FOR UPDATE`,keys);
    if (!row) throw new InvestigationError('INVESTIGATION_NOT_FOUND',404);
    const { rows: [previous] } = await client.query<{decision: InvestigationReview; revision: number}>(`SELECT decision,revision FROM fda_investigation_reviews
      WHERE (tenant_id,source_id,investigation_id,request_id)=($1,$2,$3,$4)`,[...keys,input.requestId]);
    if (previous) {
      if (fingerprint(previous.decision) !== fingerprint(input)) throw new InvestigationError('INVESTIGATION_REVIEW_REPLAY_CONFLICT');
      return { id,revision:previous.revision };
    }
    if (row.reviewRevision !== input.expectedRevision || row.fingerprint !== input.fingerprint) throw new InvestigationError('INVESTIGATION_REVIEW_CHANGED');
    const currentStatus = publicRow(row).status;
    if (['running','closed','superseded'].includes(currentStatus)) throw new InvestigationError('INVESTIGATION_REVIEW_UNAVAILABLE');
    if (input.decision === 'consider-recommendation') {
      if (currentStatus !== 'ready' && currentStatus !== 'reviewed') throw new InvestigationError('NO_VALIDATED_ANALYSIS');
      const live = await collectPacket(client,scope,row.caseId,row.selection);
      if (live.fingerprint !== row.fingerprint) throw new InvestigationError('INVESTIGATION_STALE');
    }
    if (row.reviewRevision >= 50) throw new InvestigationError('INVESTIGATION_REVIEW_LIMIT');
    const revision = row.reviewRevision + 1;
    const status = { 'consider-recommendation':'reviewed','reject-findings':'rejected','request-evidence':'needs-evidence',
      close:'closed', supersede:'superseded' }[input.decision];
    const { rows: [attempt] } = await client.query<{output_version: string}>(`SELECT output_version FROM fda_investigation_attempts
      WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3) AND status='succeeded'`,keys);
    if (interrupted(row)) await client.query(`UPDATE fda_investigation_attempts SET status='failed',error_code='interrupted',finished_at=clock_timestamp()
      WHERE (tenant_id,source_id,investigation_id)=($1,$2,$3) AND status='running'`,keys);
    await client.query(`INSERT INTO fda_investigation_reviews (tenant_id,source_id,investigation_id,revision,request_id,decision,
      evidence_fingerprint,output_version,actor_role,application_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [...keys,revision,input.requestId,input,input.fingerprint,attempt?.output_version ?? null,actor.role,actor.sourceRevision]);
    await client.query(`UPDATE fda_investigations SET status=$4,review_revision=$5,updated_at=clock_timestamp()
      WHERE (tenant_id,source_id,id)=($1,$2,$3)`,[...keys,status,revision]);
    return {id,revision};
  });
}
