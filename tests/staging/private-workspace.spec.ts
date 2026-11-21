import { expect, test } from '@playwright/test';
import { privateFixture } from '../support/private-fixture.ts';

const live = Boolean(process.env.LAB_SMOKE_ORIGIN);
const credential = (role: 'viewer' | 'operator') => ({ username: role,
  password: live ? process.env[role === 'viewer' ? 'LAB_SMOKE_VIEWER_PASSWORD' : 'LAB_SMOKE_OPERATOR_PASSWORD']! : privateFixture[role],
});

test('protected origin serves the compiled frontend to a viewer and rejects public reads', async ({ browser, request, baseURL }) => {
  expect((await request.get('/')).status()).toBe(401);
  expect((await request.get('/api/adoption/pipeline-digest')).status()).toBe(401);
  const context = await browser.newContext({ baseURL, httpCredentials: credential('viewer') });
  try {
    const page = await context.newPage();
    await page.goto('/#outcomes');
    await expect(page.getByText('339.64 modeled occurrences')).toBeVisible();
    await expect(page.getByText(/Reviewed time studies recorded a difference/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('operator submits and reloads a confirmed operation through the protected same-origin UI', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, httpCredentials: credential('operator') });
  try {
    const page = await context.newPage();
    await page.goto('/#ats-reliability');
    await page.getByRole('button', { name: 'Run scenario' }).click();
    await expect(page.locator('.status')).toHaveText('Confirmed');
    const operationId = await page.locator('dd code').first().textContent();
    await page.reload();
    await expect(page.locator('dd code').first()).toHaveText(operationId!);
    await page.getByRole('button', { name: 'Recover this operation' }).click();
    await expect(page.locator('.status')).toHaveText('Confirmed');
  } finally {
    await context.close();
  }
});
