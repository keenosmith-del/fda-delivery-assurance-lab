import { INVESTIGATIONS } from '../shared/contracts/investigations.ts';
import { fixtureProvider } from '../tests/support/investigation-model.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { OUTCOME_ASSURANCE, OUTCOME_MEASUREMENTS } from '../shared/contracts/outcome-assurance.ts';
import { outcomeFixture } from './outcome-fixture.ts';
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
const app = createApp({ pool: fixture.pool, enableFaults: true, environment: 'test', investigationProvider: fixtureProvider, revision: process.env.LAB_SOURCE_REVISION,
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

async function investigate(caseId: string, question: string, scope: object, filename?: string, status = 'ready') {
  const requested = await post(INVESTIGATIONS + '/cases/' + caseId, 202, { ...scope, question, requestId: randomUUID(), runInference: true });
  const url = INVESTIGATIONS + '/' + requested.id;
  let result = (await app.inject(url)).json();
  for (let i=0; result.status === 'running' && i<20; i++) {
    await delay(20);
    result = (await app.inject(url)).json();
  }
  assert.equal(result.status,status,question);
  if (filename) await download(url + '/export',filename);
  return {url,result};
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
  const outcomeUrl = OUTCOME_ASSURANCE + '/cases/' + firstCase;
  const study = outcomeFixture({ caseId: firstCase, workflowId: 'workflow-003', verifiedAt: lost.operation.updated_at.toISOString(),
    sourceRevision: process.env.LAB_SOURCE_REVISION });
  await download(outcomeUrl + '/export', 'delivery-outcome-without-time-study.json');
  for (const event of study.events('model')) await post(OUTCOME_MEASUREMENTS, 201, event, { authorization: 'Bearer ' + sourceToken });
  await download(outcomeUrl + '/export', 'delivery-outcome-modeled-opportunity.json');
  for (const variant of ['baseline', 'comparison', 'negative', 'unchanged', 'incomplete'] as const) {
    for (const event of study.events(variant)) await post(OUTCOME_MEASUREMENTS, 201, event, { authorization: 'Bearer ' + sourceToken });
  }
  for (const periodId of ['period-003', 'period-004', 'period-005']) {
    for (const event of adoptionFixture.events('improvement')) {
      await post(ADOPTION_OBSERVATIONS, 201, { ...event, eventId: randomUUID(), periodId }, { authorization: 'Bearer ' + sourceToken });
    }
  }
  const selection = { baseline: 'period-001', comparison: 'period-002', method: 'matched-items', interventionId: deliveryIntervention };
  const query = '?' + new URLSearchParams(selection);
  const result = (await app.inject(outcomeUrl + query)).json();
  assert.equal(result.ready, true);
  assert.equal(result.comparison.difference, 140);
  await post(outcomeUrl + '/reviews', 200, { ...selection, requestId: randomUUID(), expectedRevision: 0, fingerprint: result.fingerprint,
    outcome: 'reviewed-synthetic-comparison', justification: 'Matched the same four synthetic opportunities and included all effort.',
    limitations: 'Synthetic observations support a handling-time comparison only.' });
  await download(outcomeUrl + '/export' + query, 'delivery-outcome-assurance.json');
  const recoveryScope = { category: 'retry-reconciliation' };
  const recovery = await investigate(firstCase, 'Why did downstream recovery require an authoritative lookup?', recoveryScope,
    'investigation-lost-acknowledgment.json');
  assert.equal(recovery.result.packet.citations.find(item => item.record === 'downstream-operation').facts.verifiedEffects,1);
  const connected = await investigate(firstCase, 'Which persisted records support the reviewed synthetic handling result?',
    { category:'end-to-end', ...selection });
  assert.equal(connected.result.packet.citations.find(item => item.record === 'outcome-assessment').facts.reviewedDifference,140);
  await post(connected.url + '/reviews', 200, { requestId:randomUUID(),expectedRevision:0,fingerprint:connected.result.fingerprint,
    decision:'reject-findings',reason:'Preserved the evidence for review and rejected the proposed next step.' });
  await download(connected.url + '/export','investigation-connected-reviewed.json');
  await investigate(firstCase,'Which evidence explains higher human handling overhead?',
    {category:'outcome-verification',baseline:'period-001',comparison:'period-003'},'investigation-negative-outcome.json');
  await investigate(firstCase,'What time-study coverage is missing from this comparison?',
    {category:'outcome-verification',baseline:'period-001',comparison:'period-005'},'investigation-insufficient-outcome.json');
  await investigate(firstCase,'Exercise unknown citation in the bounded model output.', recoveryScope,'investigation-rejected-citation.json','validation-failed');

  for (const [comparison, scenario, expected] of [
    ['period-003', 'increased-overhead', -100], ['period-004', 'unchanged-effort', 0], ['period-005', 'incomplete-coverage', null],
  ] as const) {
    const query = '?' + new URLSearchParams({ baseline: selection.baseline, comparison, method: selection.method });
    const scenarioResult = (await app.inject(outcomeUrl + query)).json();
    assert.equal(scenarioResult.comparison.difference, expected, scenario);
    await download(outcomeUrl + '/export' + query, 'delivery-outcome-' + scenario + '.json');
  }
  const late = study.events('comparison').find(event => event.kind === 'effort' && event.category === 'review')!;
  await post(OUTCOME_MEASUREMENTS, 200, late, { authorization: 'Bearer ' + sourceToken });
  await post(OUTCOME_MEASUREMENTS, 409, { ...late, duration: 25 }, { authorization: 'Bearer ' + sourceToken });
  await post(OUTCOME_MEASUREMENTS, 201, { ...late, duration: 25, eventId: randomUUID(), sourceRevision: 'b'.repeat(40) },
    { authorization: 'Bearer ' + sourceToken });
  const stale = (await app.inject(outcomeUrl + query)).json();
  assert.equal(stale.status, 'stale-review');
  assert.equal(stale.reviewedDifference, null);
  assert.equal(stale.reviewHistory[0].snapshot.comparison.difference, 140);
  await download(outcomeUrl + '/export' + query, 'delivery-outcome-stale-review.json');
  assert.equal((await app.inject(connected.url)).json().stale,true);
  await download(connected.url + '/export','investigation-stale-snapshot.json');




  await post(assessment + '/revisions', 200, { revision: 4, action: 'reassess', reason: 'Open a new synthetic baseline for the pre-commit recovery scenario.' });
  await createFixtureDelivery((path, payload) => post(path, 200, payload), assessment);
  const secondCase = (await app.inject(assessment)).json().deliveryCases.at(-1).id;
  const redrive = await exerciseDownstreamEvidence(fixture.pool, secondCase, 'pre-commit');
  await download(DOWNSTREAM_API + '/operations/' + redrive.operation.id + '/export', 'downstream-exhaustion-and-redrive.json');
  await investigate(secondCase,'What changed after the initial pre-commit execution failed?',
    {category:'downstream-failure'},'investigation-pre-commit-redrive.json');

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
