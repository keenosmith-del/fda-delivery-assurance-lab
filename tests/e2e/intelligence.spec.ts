import { expect, test } from '@playwright/test';

test('evaluates a task and reloads its persisted review', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Workspace' });
  await navigation.getByRole('link', { name: 'Discover' }).click();
  await page.getByLabel('Filter tasks').fill('offer');
  await page.getByRole('button', { name: /Candidate offer review/ }).click();
  await expect(page.getByRole('heading', { name: 'Classification score' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automation suitability' })).toBeVisible();
  await expect(page.getByText(/Deterministic weighted engineering heuristics/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download workflow evidence JSON' }))
    .toHaveAttribute('href', '/api/workflow/tasks/offer-review/export');
  await page.getByText('Supporting observations (12)').click();
  await expect(page.getByText('ATS / inspect feedback').last()).toBeVisible();
  await page.getByLabel('Classification decision').selectOption('approve');
  await page.getByLabel('Automation suitability decision').selectOption('reject');
  const reason = 'The synthetic offer process still requires human approval.';
  await page.getByLabel('Reason for this synthetic task').fill(reason);
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByText(reason)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Candidate offer review/ }).click();
  await expect(page.getByText(reason)).toBeVisible();
});

test('inspects a reporting but permission-limited endpoint', async ({ page }) => {
  await page.goto('/#agent-health');
  await expect(page.getByRole('heading', { name: '7 of 9 endpoints reporting' })).toBeVisible();
  await page.getByRole('button', { name: /Workstation 07/ }).click();
  await expect(page.getByRole('heading', { name: 'Workstation 07' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Missing observation intervals' })).toBeVisible();
  await page.getByText(/Activity history/).click();
  const history = page.locator('details').filter({ hasText: /Activity history/ });
  await expect(history.getByRole('listitem').filter({ hasText: 'Permissions limited' })).toBeVisible();
});

test('compares unsafe duplicate records with the transaction-safe outcome', async ({ page }) => {
  await page.goto('/#ats-reliability');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('2 records', { exact: true })).toBeVisible();
  await expect(page.getByText('1 record', { exact: true })).toBeVisible();
  await expect(page.getByText(/duplicate_linked/)).toBeVisible();
});
