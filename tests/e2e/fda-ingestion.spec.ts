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
  await expect(workflow.getByText('Additional evidence required', { exact: true })).toBeVisible();
});
