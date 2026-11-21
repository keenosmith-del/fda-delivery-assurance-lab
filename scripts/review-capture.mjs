import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const output = 'FDA_Application_Review';
const screenshots = join(output, 'screenshots');
const baseURL = 'http://127.0.0.1:5179';
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: false,
  args: ['--kiosk', '--window-position=0,0', '--no-first-run'] });
const context = await browser.newContext({ viewport: null, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

const heading = (name) => page.getByRole('heading', { name, exact: true });
const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const label = (name) => page.getByLabel(name, { exact: true });
const text = (value) => page.getByText(value, { exact: typeof value === 'string' });
const navigation = page.getByRole('navigation', { name: 'Workspace' });

let pointer = [15, 25];
async function point(target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Capture target lacks a bounding box');
  const next = [Math.round(box.x + box.width / 2), Math.round(box.y + Math.min(box.height / 2, 45))];
  for (let step = 1; step <= 8; step++) {
    const t = Math.sin(step / 8 * Math.PI / 2);
    const [x, y] = next.map((v, i) => String(Math.round(pointer[i] + (v - pointer[i]) * t)));
    execFileSync('xdotool', ['mousemove', x, y]);
    await delay(25);
  }
  pointer = next;
}
async function click(target) {
  await point(target);
  await target.click();
  await delay(480);
}
async function pick(target, value) {
  await point(target);
  await target.selectOption(value);
  await delay(620);
}
async function type(target, value, date = false) {
  await point(target);
  await target.click();
  if (date) await target.fill(value);
  else await target.pressSequentially(value, { delay: 28 });
  await delay(400);
}
async function frame(target, y = 110) {
  await target.evaluate((el, top) => window.scrollBy({ top: el.getBoundingClientRect().top - top, behavior: 'smooth' }), y);
  await delay(850);
}
async function top() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await delay(760);
}
async function nav(name) {
  await top();
  await click(navigation.getByRole('link', { name, exact: true }));
}
const shot = (name) => page.screenshot({ path: join(screenshots, name + '.png') });
const dwell = (seconds) => delay(seconds * 1000);
const operationID = () => page.locator('.result dd code').first();
const confirmed = () => expect(page.locator('.result .status')).toHaveText('Confirmed', { timeout: 12_000 });

let capture;
let captureDone;
let captureStarted;
let recorderLog = '';
const chapters = [];
function chapter(title) {
  const start = Math.floor((performance.now() - captureStarted) / 1000);
  const label = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  chapters.push({ title, label });
  console.log(label, title);
}
const overview = async () => {
  await expect(heading('Delivery Assurance')).toBeVisible();
  for (const title of ['Discover', 'ATS Reliability', 'Agent Health', 'Adoption Diagnostics', 'Outcome Verification']) {
    await expect(navigation.getByRole('link', { name: title, exact: true })).toBeVisible();
  }
};

try {
  await page.goto(baseURL);
  await overview();
  const viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  expect(viewport).toEqual([1920, 1080, 1]);
  expect((await (await page.request.get(baseURL + '/api/ready')).json()).status).toBe('ready');
  expect((await (await page.request.get(baseURL + '/api/ops/status')).json()).worker.state).toBe('running');

  execFileSync('xdotool', ['mousemove', ...pointer.map(String)]);
  capture = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-y', '-f', 'x11grab', '-draw_mouse', '1',
    '-framerate', '25', '-video_size', '1920x1080', '-i', process.env.DISPLAY,
    '-an', '-c:v', 'libx264', '-threads', '3', '-preset', 'veryfast', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'application-walkthrough.mp4')],
  { stdio: ['pipe', 'ignore', 'pipe'] });
  captureDone = once(capture, 'exit');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out starting live screen capture')), 10_000);
    capture.on('error', reject);
    capture.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Recorder exited early (${code}): ${recorderLog}`)); });
    capture.stderr.on('data', chunk => {
      recorderLog = (recorderLog + chunk.toString()).slice(-3000);
      if (recorderLog.includes('Output #0')) { clearTimeout(timer); resolve(); }
    });
  });
  captureStarted = performance.now();
  chapter('A · Overview and workspace navigation');
  await shot('01-overview');
  await point(heading('Delivery Assurance'));
  await dwell(8);
  await point(navigation.getByRole('link', { name: 'ATS Reliability', exact: true }));
  await dwell(6);

  chapter('B · ATS reliability, acknowledgment recovery and pre-commit retry');
  await nav('ATS Reliability');
  const scenario = page.getByRole('combobox', { name: 'Scenario', exact: true });
  await dwell(5);
  await click(button('Run scenario'));
  await confirmed();
  await expect(text('Created one submission')).toBeVisible();
  await shot('02-ats-reliability');
  await point(heading('Database result'));
  await dwell(15);

  await pick(scenario, 'lost-ack');
  await click(button('Generate'));
  await dwell(5);
  await click(button('Run scenario'));
  await expect(text('Commit found in PostgreSQL')).toBeVisible();
  await expect(text('Replay with the original operation ID')).toBeVisible();
  await confirmed();
  await expect(text('replayed')).toBeVisible();
  const originalId = await operationID().textContent();
  await shot('08-ats-lost-acknowledgment');
  await point(heading('Audit events'));
  await dwell(19);
  await page.reload();
  await expect(operationID()).toHaveText(originalId);
  await dwell(4);
  await click(button('Recover this operation'));
  await confirmed();
  await expect(operationID()).toHaveText(originalId);
  await dwell(11);

  await pick(scenario, 'before-commit');
  await click(button('Generate'));
  await dwell(4);
  await click(button('Run scenario'));
  await expect(text('Operation absent after rollback')).toBeVisible();
  await expect(text('Replay with the original operation ID')).toBeVisible();
  await confirmed();
  await shot('09-ats-pre-commit-retry');
  await dwell(20);

  chapter('C · Unsafe fixture compared with idempotent PostgreSQL');
  await frame(heading('Compare lost-acknowledgment recovery'));
  await dwell(6);
  await click(button('Run comparison'));
  await expect(text('2 records')).toBeVisible();
  await expect(text('1 record')).toBeVisible();
  await expect(text(/duplicate_linked/)).toBeVisible();
  await expect(text(/accepted, replayed, duplicate_linked/)).toBeVisible();
  await frame(heading('Compare lost-acknowledgment recovery'));
  await shot('03-ats-comparison');
  await point(heading('Unreliable reference'));
  await dwell(9);
  await point(heading('Transaction-safe submission'));
  await dwell(16);

  chapter('D · Workflow evidence, scoring and a persisted review');
  await nav('Discover');
  const offer = button(/Candidate offer review/);
  await click(offer);
  await expect(heading('Classification confidence')).toBeVisible();
  await expect(heading('Automation suitability')).toBeVisible();
  await expect(heading('Evidence gaps')).toBeVisible();
  await shot('04-workflow-evidence');
  await dwell(12);
  for (const name of ['Classification confidence', 'Automation suitability']) {
    const factors = page.locator('.metric').filter({ has: heading(name) }).getByText('Scoring factors');
    await click(factors);
  }
  await frame(heading('Classification confidence'));
  await dwell(15);
  const observations = text(/Supporting observations \(12\)/);
  await click(observations);
  await expect(text('ATS / inspect feedback').last()).toBeVisible();
  await frame(observations);
  await shot('10-workflow-supporting-observations');
  await dwell(12);
  await click(observations);

  await frame(heading('Record a review'));
  await pick(label('Classification decision'), 'approve');
  await pick(label('Automation suitability decision'), 'reject');
  const reason = 'Synthetic review: offer feedback still requires a human decision.';
  await type(label('Reason for this synthetic task'), reason);
  await click(button('Save review'));
  await expect(text(reason)).toBeVisible();
  await frame(heading('Review history'), 360);
  await dwell(11);
  await page.reload();
  await click(offer);
  await expect(text(reason)).toBeVisible();
  await frame(heading('Review history'), 430);
  await shot('11-workflow-review-persisted');
  await dwell(13);

  chapter('E · Endpoint coverage, permission limitations and missing evidence');
  await nav('Agent Health');
  await expect(heading('7 of 9 endpoints reporting')).toBeVisible();
  await expect(page.locator('.entity-list li')).toHaveCount(9);
  await dwell(11);
  await click(button(/Workstation 07/));
  await expect(heading('Workstation 07')).toBeVisible();
  await expect(heading('Missing observation intervals')).toBeVisible();
  await shot('05-agent-health');
  await dwell(13);
  await click(text(/Activity history/));
  const limitation = page.locator('.history li').filter({ hasText: 'Permissions limited' });
  await expect(limitation).toBeVisible();
  await frame(limitation, 385);
  await shot('12-agent-permission-history');
  await dwell(11);
  await click(button(/Workstation 09/));
  await expect(heading('Workstation 09')).toBeVisible();
  await frame(heading('Workstation 09'), 310);
  await shot('13-agent-insufficient-evidence');
  await dwell(15);

  chapter('F · Adoption baseline, diagnosis, intervention and follow-up');
  await nav('Adoption Diagnostics');
  await pick(label('Automation'), 'pipeline-digest');
  await expect(page.getByRole('row', { name: /Baseline week 50%/ })).toBeVisible();
  await shot('06-adoption-diagnostics');
  await dwell(13);
  await frame(heading('Diagnostic signals'));
  await dwell(11);
  await frame(heading('Record a diagnosis'));
  await pick(label('Evidence signal'), 'low-adoption');
  await type(label('Diagnostic hypothesis'), 'Missed onboarding may explain the baseline usage in this synthetic fixture.');
  await click(button('Save diagnosis'));
  await expect(heading('Plan an intervention')).toBeVisible();
  await dwell(8);
  await frame(heading('Plan an intervention'));
  await type(label('Proposed action'), 'Repeat the synthetic onboarding walkthrough with eligible operators.');
  await type(label('Intervention owner'), 'Operations owner');
  await type(label('Follow-up date'), '2026-11-16', true);
  await click(button('Plan intervention'));
  await expect(label('Implementation date')).toBeVisible();
  await dwell(6);
  await type(label('Implementation date'), '2026-11-09', true);
  await click(button('Record implementation'));
  await expect(text('Implemented on 2026-11-09')).toBeVisible();
  await type(label('Follow-up notes'), 'Review the subsequent synthetic usage and execution reliability.');
  await click(button('Record follow-up'));
  await expect(text(/Adoption 50% → 75%/)).toBeVisible();
  await frame(text(/Adoption 50% → 75%/), 430);
  await shot('14-adoption-follow-up');
  await dwell(17);
  await page.reload();
  await pick(label('Automation'), 'pipeline-digest');
  await expect(text('Review the subsequent synthetic usage and execution reliability.')).toBeVisible();
  await click(text('Decision audit (4)'));
  await expect(text(/follow up recorded/)).toBeVisible();
  await frame(text('Decision audit (4)'), 340);
  await shot('15-adoption-audit-persisted');
  await dwell(13);

  chapter('G · Outcome model, observed execution, limitations and JSON export');
  await nav('Outcome Verification');
  await expect(text('339.64 modeled occurrences')).toBeVisible();
  await expect(text(/Reviewed time studies recorded a difference/)).toBeVisible();
  await shot('07-outcome-verification');
  await dwell(14);
  await frame(heading('Measured activity'));
  await shot('16-outcome-verified-comparison');
  await dwell(18);
  await frame(heading('Input provenance'), 420);
  await dwell(12);
  await top();
  await pick(label('Automation'), 'pipeline-digest');
  await expect(text('Verification incomplete.')).toBeVisible();
  await expect(text('One or both opportunity windows are incomplete.')).toBeVisible();
  await frame(heading('Measured activity'));
  await shot('17-outcome-incomplete-comparison');
  await dwell(17);
  const exportLink = page.getByRole('link', { name: 'Download evidence JSON' });
  await frame(exportLink, 330);
  const downloading = page.waitForEvent('download');
  await click(exportLink);
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('pipeline-digest-outcome-evidence.json');
  const jsonFile = join(output, download.suggestedFilename());
  await download.saveAs(jsonFile);
  const exported = JSON.parse(await readFile(jsonFile, 'utf8'));
  expect(exported.evidenceType).toBe('synthetic lab measurements');
  expect(exported.verifiedSeconds).toBeNull();
  await dwell(10);

  chapter('H · Workspace overview and end state');
  await nav('Overview');
  await overview();
  await shot('18-overview-end-state');
  await dwell(12);
  expect(pageErrors).toEqual([]);
  expect((await (await page.request.get(baseURL + '/api/ops/status')).json()).worker.state).toBe('running');

  const notes = [
    '# FDA Delivery Assurance Lab application review', '',
    `- Source commit: \`${process.env.APP_COMMIT}\`. Capture-only scripts and workflow were isolated on a separate branch.`,
    `- Recording environment: GitHub Actions Ubuntu 24.04, Chromium ${browser.version()}, 1920 × 1080 viewport at device scale 1, continuous X11 screen capture with native mouse pointer.`,
    '- Backend: built Fastify API and built Vite frontend served on loopback. Disposable native PostgreSQL 17 was migrated before the walkthrough.',
    '- Worker: the separate confirmation-worker process ran throughout and was confirmed healthy before and after capture.',
    '- Fault injection: enabled only in the isolated test environment, for the two ATS interruption scenarios and the unsafe-versus-safe comparison.',
    '- Data: synthetic intelligence and measurement seeds plus synthetic candidates, offer review, adoption diagnosis, intervention and follow-up entered during the walkthrough.',
    '- Interpretation: 339.64 is a modeled weekly occurrence figure. Timing studies, adoption rates and operations are synthetic. This recording shows a CI environment and does not establish a live hosted deployment.',
    '- Export: the selected incomplete pipeline-digest comparison downloaded from the UI and is included as JSON. Chromium can complete this direct download without opening another view.',
    '- Incomplete demonstrations: none. Application errors: none outside the intentional ATS 504 responses.',
    '', '## Recording timestamps', '',
    ...chapters.map(({ title, label }) => `- ${label} · ${title}`), '',
  ];
  await writeFile(join(output, 'review-notes.md'), notes.join('\n'));
} finally {
  if (capture?.exitCode === null) {
    capture.stdin.end('q\n');
    const [code] = await captureDone;
    if (code !== 0) throw new Error(`Screen recording encoder exited with ${code}: ${recorderLog}`);
  }
  await browser.close();
}
