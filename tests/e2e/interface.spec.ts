import { expect, test } from '@playwright/test';
import { captureInterface } from '../support/interface-capture.ts';

const workspaces = [
  ['Overview','/','Delivery assurance'],
  ['FDA Integration','/#fda-integration','FDA Integration'],
  ['Discover','/#discover','Discover'],
  ['Agent Health','/#agent-health','Agent Health'],
  ['ATS Reliability','/#ats-reliability','ATS Reliability'],
  ['Adoption Diagnostics','/#adoption','Adoption Diagnostics'],
  ['Outcome Verification','/#outcomes','Outcome Verification'],
  ['Evidence Investigation','/#investigations','Evidence Investigation'],
] as const;
const widths = [1440,1280,1024,768,390,375];
for (const width of widths) test(`workspaces fit at ${width}px and retain accessible navigation`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  for (const [workspace,url,title] of workspaces) {
    await page.goto(url);
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('.workspace-brand a')).toHaveText('FDA Delivery Assurance Lab');
    await expect(page.locator('.brand-mark, .workspace-brand img, .workspace-brand svg')).toHaveCount(0);
    await expect(page.getByRole('main').locator('h1, h2, h3, h4, .section-label, .metric-reading > dt').getByText(/^\d{2}\s*\//)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const navigation = page.getByRole('navigation',{name:'Workspace',exact:true});
    if (width <= 850) {
      const toggle = page.getByRole('button',{name:'Workspaces'});
      await expect(navigation).toBeHidden();
      await toggle.click();
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole('link',{name:workspace,exact:true})).toHaveAttribute('aria-current','page');
      await navigation.getByRole('link',{name:workspace === 'FDA Integration' ? 'Overview' : 'FDA Integration',exact:true}).click();
      await expect(toggle).toHaveAttribute('aria-expanded','false');
      await expect(navigation).toBeHidden();
    } else await expect(navigation.getByRole('link',{name:workspace,exact:true})).toHaveAttribute('aria-current','page');
  }
});

test('keyboard reaches the workspace navigation and focuses the selected view', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link',{name:'Skip to workspace content'});
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const link = page.getByRole('navigation',{name:'Workspace',exact:true}).getByRole('link',{name:'ATS Reliability',exact:true});
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{level:1,name:'ATS Reliability',exact:true})).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('heading',{level:1,name:'Delivery assurance',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Evidence at a glance'})).toBeVisible();
  await captureInterface(page,'overview',undefined,true);
  await link.click();
  await page.getByRole('button',{name:'Run scenario',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Confirmed');
  await captureInterface(page,'ats-reliability',undefined,true);
});
