import { feasible, reviewedRisk } from '../support/workflow-review.ts';
import { expect, test } from '@playwright/test';
import { publishScenario } from '../../scripts/publish-fda.ts';
import { FDA_EVENTS } from '../../shared/contracts/fda-ingestion.ts';
import { browserSource } from '../support/fda-fixture.ts';

test('traces the independent FDA import into the endpoint and workflow workspaces', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const publish = (scenario: string) => publishScenario(async event => {
    const response = await request.post(FDA_EVENTS, {
      data: event, headers: { authorization: `Bearer ${browserSource.token}` },
    });
    return { status: response.status(), body: await response.json() };
  }, scenario);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'FDA Integration' }).click();
  await expect(page.getByText('Awaiting import', { exact: true })).toBeVisible();
  await publish('normal');
  await publish('duplicate-replay');
  await publish('invalid-contract');
  await page.getByRole('button', { name: 'Refresh ingestion' }).click();
  await expect(page.getByText('Records received', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'record-001 · duplicate' })).toBeVisible();
  await page.getByRole('link', { name: 'record-001 · rejected' }).click();
  await expect(page.getByText('UNSUPPORTED_CONTRACT', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'record-017 · processed' }).click();
  await page.getByRole('link', { name: 'Open imported Agent Health' }).click();
  await expect(page.getByRole('heading', { name: '7 of 9 endpoints reporting' })).toBeVisible();
  await expect(page.getByText('endpoint-007 · Reporting · limited capture')).toBeVisible();
  await page.getByRole('link', { name: 'record-017', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Receipt details' })).toBeVisible();
  await page.getByRole('link', { name: 'record-043 · processed' }).click();
  await page.getByRole('link', { name: 'Open imported Workflow Evidence' }).click();
  await expect(page.getByText(/Observation coverage is incomplete/)).toBeVisible();
  const delayedObservation = page.locator('section.observation').filter({ has: page.getByText('observation-003', { exact: true }) });
  await expect(delayedObservation.getByText(/Delayed observation/)).toBeVisible();
  await page.getByRole('link', { name: 'record-043', exact: true }).click();
  const details = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Receipt details' }) });
  await expect(details.getByText('workflow.observation', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic data', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('records an incident, verifies new reporting evidence and exports its audit', async ({ page, request }) => {
  const publish = (scenario: string) => publishScenario(async event => {
    const response = await request.post(FDA_EVENTS, {
      data: event, headers: { authorization: `Bearer ${browserSource.token}` },
    });
    return { status: response.status(), body: await response.json() };
  }, scenario);
  await publish('normal');
  await publish('reporting-interruption');
  await page.goto('/#agent-health?dataset=fda');
  await page.getByText('endpoint-006 assurance · not ready', { exact: true }).click();
  const endpoint = page.locator('details').filter({ has: page.locator('summary').getByText('endpoint-006 assurance · not ready', { exact: true }) });
  await endpoint.getByRole('button', { name: 'Open reporting interruption incident' }).click();
  await page.getByLabel('Engineering hypothesis').fill('A synthetic reporting path may be interrupted.');
  await page.getByLabel('Unresolved questions').fill('The cause of the interruption is unknown.');
  await page.getByLabel('Proposed next action').fill('Compare a later source heartbeat.');
  await page.getByRole('button', { name: 'Record diagnosis' }).click();
  await page.getByLabel('Corrective action').selectOption('restore-reporting');
  await page.getByLabel('Intervention reason').fill('Restore the synthetic reporting path.');
  await page.getByLabel('Owner role').fill('engineer');
  await page.getByLabel('Follow-up date').fill('2026-11-17');
  await page.getByRole('button', { name: 'Plan intervention' }).click();
  await page.getByLabel('Implementation note').fill('Recorded the synthetic connectivity intervention.');
  await page.getByRole('button', { name: 'Record implementation' }).click();
  await page.getByRole('button', { name: 'Evaluate recovery' }).click();
  await expect(page.getByRole('heading', { name: 'Latest verification' })).toBeVisible();
  await expect(page.getByText('insufficient evidence', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluate recovery' })).toBeVisible();
  await publish('recovery');
  await page.getByRole('button', { name: 'Evaluate recovery' }).click();
  await expect(page.getByText('verified recovered', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Incident audit history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluate recovery' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download operational assurance JSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/^agent-incident-.*\.json$/);
  await page.getByRole('link', { name: 'workflow-002', exact: true }).click();
  const workflow = page.locator('details').filter({ has: page.getByText('workflow-002 · record-sync', { exact: true }) });
  await expect(workflow.getByText('Blocked by operational conditions', { exact: true })).toBeVisible();
});

test('assesses an imported candidate, approves planning, creates a delivery case and exports the saved decision', async ({ page, request }) => {
  const publish = (scenario: string) => publishScenario(async event => {
    const response = await request.post(FDA_EVENTS, {
      data: event, headers: { authorization: `Bearer ${browserSource.token}` },
    });
    return { status: response.status(), body: await response.json() };
  }, scenario);
  await publish('normal');
  await publish('assurance-complete-window');
  await page.goto('/#fda-integration');
  await page.getByRole('link', { name: 'record-091 · processed' }).click();
  await page.getByRole('link', { name: 'Open imported Workflow Evidence' }).click();
  const workflow = page.locator('details.panel').filter({ has: page.getByText('workflow-003 · periodic-reporting', { exact: true }) });
  await expect(workflow.getByText('Ready for engineering review', { exact: true })).toBeVisible();
  await workflow.getByRole('button', { name: 'Open engineering assessment' }).click();
  await workflow.getByText('Technical feasibility and assumptions', { exact: true }).click();
  const field = (name: string) => workflow.locator(`[name="${name}"]`);
  for (const [group, fields] of Object.entries({
    understanding: feasible.understanding, integration: feasible.integration, execution: feasible.execution, operations: feasible.operations,
  })) {
    for (const [key, input] of Object.entries(fields)) {
      if (typeof input === 'string' && !['availability', 'authorization', 'model', 'clientApproval', 'credentialAvailability'].includes(key)) {
        await field(group + '.' + key).fill(input);
      }
    }
  }
  for (const [name, input] of Object.entries({
    availability: feasible.integration.availability, authorization: feasible.integration.authorization, model: feasible.execution.model,
    clientApproval: feasible.operations.clientApproval, credentialAvailability: feasible.operations.credentialAvailability,
  })) await field(name).selectOption(input);
  for (const [key, input] of Object.entries(feasible.suitability)) {
    if (key === 'basis') await field('suitability.' + key).fill(input);
    else await field('suitability.' + key).selectOption(input);
  }
  await field('assumptions').fill(feasible.understanding.assumptions.join('\n'));
  await field('phases').fill(feasible.phases.join('\n'));
  if (feasible.alternatives.kind !== 'considered') throw new Error('Expected a fixture alternative');
  await field('alternativeOption').fill(feasible.alternatives.option);
  await field('tradeoff').fill(feasible.alternatives.tradeoff);
  await workflow.getByRole('button', { name: 'Add dependency' }).click();
  const dependency = feasible.dependencies[0];
  await field('dep0.requirement').fill(dependency.requirement);
  await field('dep0.owner').fill(dependency.owner);
  await field('dep0.mandatory').selectOption('mandatory');
  await field('dep0.status').selectOption(dependency.status);
  await field('dep0.basis').fill(dependency.basis);
  await workflow.getByRole('button', { name: 'Save feasibility revision' }).click();
  await workflow.getByRole('button', { name: 'Add risk', exact: true }).click();
  for (const [key, input] of Object.entries(reviewedRisk)) {
    if (['category', 'likelihood', 'impact', 'residual', 'review'].includes(key)) await field('risk0.' + key).selectOption(input);
    else await field('risk0.' + key).fill(input);
  }
  await workflow.getByLabel('Risk review basis').fill('Scope, reliability and the proposed mitigation were reviewed.');
  await workflow.getByRole('button', { name: 'Save risk review' }).click();
  await expect(workflow.getByText('Revision 3 · feasibility review · Responsible role operator', { exact: true })).toBeVisible();
  await workflow.getByLabel('Reason for decision review').fill('Feasibility, risk and supporting source records were reviewed.');
  await workflow.getByRole('button', { name: 'Submit for decision' }).click();
  await workflow.getByLabel('Engineering decision', { exact: true }).selectOption('approve-implementation-planning');
  await workflow.getByLabel('Decision justification').fill('The evidence supports implementation planning in the disposable lab.');
  await workflow.getByRole('button', { name: 'Record engineering decision' }).click();
  await workflow.getByRole('button', { name: 'Create delivery case' }).click();
  await expect(workflow.getByText('Delivery case · ready for technical implementation', { exact: true })).toBeVisible();
  await page.reload();
  await expect(workflow.getByText('Delivery case · ready for technical implementation', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await workflow.getByRole('link', { name: 'Download workflow assessment JSON' }).click();
  expect((await download).suggestedFilename()).toBe('workflow-003-engineering-assessment.json');
  await publish('workflow-evidence-change');
  await workflow.getByRole('button', { name: 'Refresh assessment' }).click();
  await expect(workflow.getByText(/Source evidence has changed since this revision/)).toBeVisible();
});

test('allows deferral for blocked operational evidence without creating an incident', async ({ page, request }) => {
  const incidentsBefore = await request.get('/api/integrations/fda/v1/assurance/incidents?windowId=window-001');
  const before = await incidentsBefore.json();
  await page.goto('/#discover?dataset=fda&workflow=workflow-002');
  const workflow = page.locator('details.panel').filter({ has: page.getByText('workflow-002 · record-sync', { exact: true }) });
  await expect(workflow.getByText('Blocked by operational conditions', { exact: true })).toBeVisible();
  await workflow.getByRole('button', { name: 'Open engineering assessment' }).click();
  await workflow.getByLabel('Reason for decision review').fill('Decide whether to defer this workflow until evidence improves.');
  await workflow.getByRole('button', { name: 'Submit for decision' }).click();
  await workflow.getByLabel('Engineering decision', { exact: true }).selectOption('approve-implementation-planning');
  await workflow.getByLabel('Decision justification').fill('Check whether the mandatory operational gate blocks this decision.');
  await workflow.getByRole('button', { name: 'Record engineering decision' }).click();
  await expect(workflow.getByRole('alert').filter({ hasText: 'Source evidence is not ready' })).toBeVisible();
  await workflow.getByLabel('Engineering decision', { exact: true }).selectOption('defer');
  await workflow.getByRole('button', { name: 'Record engineering decision' }).click();
  await expect(workflow.getByText(/Revision 2 · Defer ·/)).toBeVisible();
  await expect(workflow.getByRole('button', { name: 'Create delivery case' })).toHaveCount(0);
  const incidentsAfter = await request.get('/api/integrations/fda/v1/assurance/incidents?windowId=window-001');
  expect(await incidentsAfter.json()).toEqual(before);
});
