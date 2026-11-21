import { expect, test } from '@playwright/test';

test('recovers a lost acknowledgment and displays the persisted record', async ({ page }) => {
  await page.goto('/#ats-reliability');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('lost-ack');
  await page.getByRole('button', { name: 'Run scenario' }).click();
  await expect(page.getByText('Commit found in PostgreSQL')).toBeVisible();
  await expect(page.locator('.status').filter({ hasText: 'Confirmed' })).toBeVisible();
  await expect(page.getByText('Created one submission')).toBeVisible();
  await expect(page.getByText('replayed', { exact: true })).toBeVisible();

  const operationId = await page.locator('dd code').first().textContent();
  await page.reload();
  await expect(page.locator('dd code').first()).toHaveText(operationId!);
  await page.getByRole('button', { name: 'Recover this operation' }).click();
  await expect(page.locator('.status')).toHaveText('Confirmed');
});

test('shows the rollback and reuses the same operation after a pre-commit interruption', async ({ page }) => {
  await page.goto('/#ats-reliability');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('before-commit');
  await page.getByRole('button', { name: 'Run scenario' }).click();
  await expect(page.getByText('Operation absent after rollback')).toBeVisible();
  await expect(page.getByText('Replay with the original operation ID')).toBeVisible();
  await expect(page.locator('.status').filter({ hasText: 'Confirmed' })).toBeVisible();
});
