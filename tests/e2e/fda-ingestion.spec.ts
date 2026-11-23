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
  await expect(page.getByText(/Delayed observation/)).toBeVisible();
  await page.getByRole('link', { name: 'record-043', exact: true }).click();
  const details = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Receipt details' }) });
  await expect(details.getByText('workflow.observation', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic data', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
