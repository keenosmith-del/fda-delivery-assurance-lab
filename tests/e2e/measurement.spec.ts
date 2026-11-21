import { expect, test } from '@playwright/test';

test('records an adoption diagnosis, intervention and follow-up with persisted decision history', async ({ page }) => {
  await page.goto('/#adoption');
  await page.getByLabel('Automation', { exact: true }).selectOption('pipeline-digest');
  await expect(page.getByRole('row', { name: /Baseline week 50%/ })).toBeVisible();
  await page.getByLabel('Evidence signal').selectOption('low-adoption');
  await page.getByLabel('Diagnostic hypothesis').fill('Missed onboarding may explain baseline usage in this fixture.');
  await page.getByRole('button', { name: 'Save diagnosis' }).click();
  await page.getByLabel('Proposed action').fill('Repeat the synthetic onboarding walkthrough with the eligible cohort.');
  await page.getByLabel('Intervention owner').fill('Operations owner');
  await page.getByLabel('Follow-up date').fill('2026-11-16');
  await page.getByRole('button', { name: 'Plan intervention' }).click();
  await page.getByLabel('Implementation date').fill('2026-11-09');
  await page.getByRole('button', { name: 'Record implementation' }).click();
  await page.getByLabel('Follow-up notes').fill('Review the subsequent observed usage and reliability.');
  await page.getByRole('button', { name: 'Record follow-up' }).click();
  await expect(page.getByText(/Adoption 50% → 75%/)).toBeVisible();
  await page.reload();
  await page.getByLabel('Automation', { exact: true }).selectOption('pipeline-digest');
  await expect(page.getByText('Review the subsequent observed usage and reliability.')).toBeVisible();
  await page.getByText('Decision audit (4)').click();
  await expect(page.getByText(/follow up recorded/)).toBeVisible();
});

test('examines modeled and incomplete outcomes and downloads evidence', async ({ page }) => {
  await page.goto('/#outcomes');
  await expect(page.getByText('339.64 modeled occurrences')).toBeVisible();
  await expect(page.getByText(/Reviewed time studies recorded a difference/)).toBeVisible();
  await page.getByLabel('Automation', { exact: true }).selectOption('pipeline-digest');
  await expect(page.getByText('Verification incomplete.')).toBeVisible();
  await expect(page.getByText('One or both opportunity windows are incomplete.')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download evidence JSON' }).click();
  expect((await downloading).suggestedFilename()).toBe('pipeline-digest-outcome-evidence.json');
});
