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
const app = createApp({ pool: fixture.pool, enableFaults: true, environment: 'test', revision: process.env.LAB_SOURCE_REVISION });

async function post(url: string, statusCode: number, payload: object, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'POST', url, payload, headers });
  assert.equal(response.statusCode, statusCode, url);
  return response.json();
}

async function download(url: string, filename: string) {
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200, url);
  await writeFile(join(directory, filename), JSON.stringify(response.json(), null, 2) + '\n', { flag: 'wx' });
}

try {
  await seedIntelligence(fixture.pool);
  await seedMeasurement(fixture.pool);
  await mkdir(directory, { recursive: true });
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
    await post('/api/submissions', 504, payload, { ...headers, 'x-lab-fault': fault });
    const state = await app.inject(`/api/operations/${id}`);
    assert.equal(state.statusCode, fault === 'lost-ack' ? 200 : 404);
    const replay = await post('/api/submissions', 202, payload, headers);
    const claim = await claimConfirmation(fixture.pool);
    assert.equal(claim?.id, id);
    assert(claim);
    await finishConfirmation(fixture.pool, claim);
    const final = (await app.inject(`/api/operations/${id}`)).json();
    assert.equal(final.state, 'confirmed');
    assert.equal(final.recordId, replay.recordId);
    await download(`/api/operations/${id}/export`, `ats-${fault}-evidence.json`);
  }
} finally {
  try { await app.close(); } finally { await fixture.close(); }
}
