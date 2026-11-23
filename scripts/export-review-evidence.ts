import { ADOPTION_ASSURANCE, ADOPTION_OBSERVATIONS } from '../shared/contracts/adoption-assurance.ts';
import { fixtureWindows } from './adoption-fixture.ts';
import { DOWNSTREAM_API } from '../shared/contracts/downstream.ts';
import { exerciseDownstreamEvidence } from './downstream-evidence-fixture.ts';
import { fixtureScope } from './fda-fixture.ts';
import { publishScenario } from './publish-fda.ts';
import { FDA_EVENTS } from '../shared/contracts/fda-ingestion.ts';
import { WORKFLOW_ASSESSMENTS } from '../shared/contracts/workflow-assessments.ts';
import { createFixtureDelivery } from '../tests/support/workflow-review.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../backend/src/api/app.ts';
import { claimConfirmation, finishConfirmation } from '../backend/src/workers/confirmation.ts';
import { seedIntelligence } from '../database/seeds/intelligence.ts';
import { seedMeasurement } from '../database/seeds/measurement.ts';
import { openTestDatabase } from '../tests/support/database.ts';

const directory = process.argv[2];
assert(directory, 'Pass a new output directory.');
const fixture = await openTestDatabase();
const sourceToken = randomUUID().replaceAll('-', '');
const app = createApp({ pool: fixture.pool, enableFaults: true, environment: 'test', revision: process.env.LAB_SOURCE_REVISION,
  fdaSource: { ...fixtureScope, token: sourceToken } });

type Observation = { method: 'GET' | 'POST'; path: string; status: number; requestId: string | undefined };
async function post(url: string, statusCode: number, payload: object, headers: Record<string, string> = {}, trace?: Observation[]) {
  const response = await app.inject({ method: 'POST', url, payload, headers });
  assert.equal(response.statusCode, statusCode, url);
  trace?.push({ method: 'POST', path: url, status: response.statusCode, requestId: response.headers['x-request-id']?.toString() });
  return response.json();
}

async function download(url: string, filename: string, trace?: Observation[]) {
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200, url);
  const data = response.json();
  if (trace) data.testRequestTrace = { transport: 'Fastify in-process HTTP injection', requests: trace };
  await writeFile(join(directory, filename), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}

try {
  await seedIntelligence(fixture.pool);
  await seedMeasurement(fixture.pool);
  await mkdir(directory, { recursive: true });
  for (const scenario of ['normal', 'assurance-complete-window']) {
    await publishScenario(async event => {
      const r = await app.inject({ method: 'POST', url: FDA_EVENTS, payload: event as object,
        headers: { authorization: `Bearer ${sourceToken}` } });
      return { status: r.statusCode, body: r.json() };
    }, scenario);
  }
  const assessment = WORKFLOW_ASSESSMENTS + '/workflow-003';
  await createFixtureDelivery((path, payload) => post(path, 200, payload), assessment);
  await download(assessment + '/export', 'workflow-003-engineering-assessment.json');
  const firstCase = (await app.inject(assessment)).json().deliveryCases[0].id;
  const lost = await exerciseDownstreamEvidence(fixture.pool, firstCase, 'lost-acknowledgment');
  await download(DOWNSTREAM_API + '/operations/' + lost.operation.id + '/export', 'downstream-lost-acknowledgment.json');
  const adoptionFixture = fixtureWindows({ caseId: firstCase, workflowId: 'workflow-003', operationId: lost.operation.id,
    verifiedAt: lost.operation.updated_at.toISOString(), sourceRevision: process.env.LAB_SOURCE_REVISION });
  const actionUrl = ADOPTION_ASSURANCE + '/cases/' + firstCase + '/actions';
  const diagnosis = randomUUID(), deliveryIntervention = randomUUID();
  const reason = 'Reviewed the delivery-linked synthetic observations.';
  for (const event of adoptionFixture.events('baseline')) await post(ADOPTION_OBSERVATIONS, 201, event, { authorization: 'Bearer ' + sourceToken });
  await post(actionUrl, 200, { kind: 'diagnose', requestId: diagnosis, periodId: 'period-001', category: 'low-adoption',
    reason, hypothesis: 'Onboarding steps may be unclear.', unresolved: 'Check permission restrictions.',
    nextAction: 'Clarify the first qualifying action.', responsible: 'Delivery engineer' });
  await post(actionUrl, 200, { kind: 'plan', requestId: deliveryIntervention, diagnosisId: diagnosis, followUpPeriodId: 'period-002',
    improvement: 'Make the synthetic instructions clearer.', responsible: 'Delivery engineer', reason });
  await post(actionUrl, 200, { kind: 'implement', requestId: randomUUID(), interventionId: deliveryIntervention,
    implementedAt: adoptionFixture.implementationDate, reason });
  for (const event of adoptionFixture.events('improvement')) await post(ADOPTION_OBSERVATIONS, 201, event, { authorization: 'Bearer ' + sourceToken });
  await post(actionUrl, 200, { kind: 'follow-up', requestId: randomUUID(), interventionId: deliveryIntervention, reason });
  await download(ADOPTION_ASSURANCE + '/cases/' + firstCase + '/export', 'delivery-adoption-assurance.json');

  await post(assessment + '/revisions', 200, { revision: 4, action: 'reassess', reason: 'Open a new synthetic baseline for the pre-commit recovery scenario.' });
  await createFixtureDelivery((path, payload) => post(path, 200, payload), assessment);
  const secondCase = (await app.inject(assessment)).json().deliveryCases.at(-1).id;
  const redrive = await exerciseDownstreamEvidence(fixture.pool, secondCase, 'pre-commit');
  await download(DOWNSTREAM_API + '/operations/' + redrive.operation.id + '/export', 'downstream-exhaustion-and-redrive.json');
  const task = '/api/workflow/tasks/offer-review';
  await post(task + '/reviews', 201, {
    classification: 'approve', suitability: 'reject', reason: 'Synthetic offer review requires human judgment.',
  });
  await download(task + '/export', 'offer-review-workflow-evidence.json');

  const adoption = '/api/adoption/pipeline-digest';
  const finding = await post(adoption + '/diagnoses', 201, {
    periodId: 'pipeline-digest-baseline', category: 'training', hypothesis: 'Missed walkthrough may affect cohort usage.',
  });
  const intervention = await post(adoption + '/interventions', 201, {
    findingId: finding.id, action: 'Repeat the onboarding walkthrough with the eligible cohort.',
    owner: 'Synthetic operations owner', followUpOn: '2026-11-16',
  });
  const interventionUrl = adoption + '/interventions/' + intervention.id;
  await post(interventionUrl + '/implement', 200, { implementedOn: '2026-11-09' });
  await post(interventionUrl + '/follow-ups', 201, {
    periodId: 'pipeline-digest-follow-up', notes: 'Investigate reduced observation coverage and execution reliability.',
  });
  await download(adoption + '/export', 'pipeline-digest-adoption-evidence.json');

  for (const id of ['intake-assist', 'pipeline-digest']) {
    await download(`/api/outcomes/${id}/export`, `${id}-outcome-evidence.json`);
  }

  for (const [index, fault] of ['lost-ack', 'before-commit'].entries()) {
    const id = randomUUID();
    const headers = { 'idempotency-key': id };
    const payload = { candidateCode: `CAND-500${index}`, requisition: 'operations' };
    const trace: Observation[] = [];
    const path = `/api/operations/${id}`;
    await post('/api/submissions', 504, payload, { ...headers, 'x-lab-fault': fault }, trace);
    const state = await app.inject(path);
    trace.push({ method: 'GET', path, status: state.statusCode, requestId: state.headers['x-request-id']?.toString() });
    assert.equal(state.statusCode, fault === 'lost-ack' ? 200 : 404);
    const replay = await post('/api/submissions', 202, payload, headers, trace);
    const claim = await claimConfirmation(fixture.pool);
    assert.equal(claim?.id, id);
    assert(claim);
    assert.equal(await finishConfirmation(fixture.pool, claim), true);
    const confirmation = await app.inject(path);
    trace.push({ method: 'GET', path, status: confirmation.statusCode, requestId: confirmation.headers['x-request-id']?.toString() });
    assert.equal(confirmation.statusCode, 200);
    const final = confirmation.json();
    assert.equal(final.state, 'confirmed');
    assert.equal(final.recordId, replay.recordId);
    await download(path + '/export', `ats-${fault}-evidence.json`, trace);
  }
} finally {
  try { await app.close(); } finally { await fixture.close(); }
}
