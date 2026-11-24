import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export async function captureInterface(page: Page, screen: string, target?: string, mobile = false) {
  const directory = process.env.LAB_SCREENSHOTS_DIR;
  if (!directory) return;
  const previous = page.viewportSize();
  await mkdir(directory, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, ...(mobile ? [{ width: 390, height: 844 }] : [])]) {
      await page.setViewportSize(viewport);
      if (target) await page.locator(target).first().scrollIntoViewIfNeeded();
      else await page.evaluate(() => window.scrollTo(0, 0));
      const name = screen + '-' + viewport.width;
      await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled', scale: 'css' });
      await writeFile(join(directory, name + '.json'), JSON.stringify({
        screen, viewport, sourceCommit: process.env.LAB_SCREENSHOT_REVISION ?? null, image: name + '.png',
      }, null, 2) + '\n');
    }
  } finally {
    if (previous) await page.setViewportSize(previous);
  }
}
