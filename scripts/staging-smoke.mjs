import { randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const { LAB_SMOKE_ORIGIN, LAB_SMOKE_OPERATOR_PASSWORD, LAB_SMOKE_VIEWER_PASSWORD, LAB_SMOKE_STATE } = process.env;
const origin = new URL(LAB_SMOKE_ORIGIN ?? 'invalid');
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' ||
    !LAB_SMOKE_OPERATOR_PASSWORD || !LAB_SMOKE_VIEWER_PASSWORD || !LAB_SMOKE_STATE) {
  throw new Error('Configure the HTTPS staging origin, both staging passwords, and an explicit local smoke-state path.');
}
const credentials = {
  operator: LAB_SMOKE_OPERATOR_PASSWORD,
  viewer: LAB_SMOKE_VIEWER_PASSWORD,
};

async function request(path, expected, role, options = {}) {
  const response = await fetch(origin.origin + path, {
    method: options.method,
    redirect: 'error',
    headers: {
      ...(role && { authorization: 'Basic ' + Buffer.from(role + ':' + credentials[role]).toString('base64') }),
      ...(options.method && { origin: origin.origin }),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(9000),
  });
  if (!expected.includes(response.status)) throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}; expected ${expected.join('/')}.`);
  return response;
}

async function verifyOperation(id) {
  for (let attempts = 0; attempts < 24; attempts++) {
    const operation = await (await request('/api/operations/' + id, [200], 'operator')).json();
    if (operation.state === 'confirmed' && operation.events.some(event => event.kind === 'confirmed')) return operation;
    if (operation.state === 'confirmation_failed') throw new Error('Worker exhausted its retries.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Worker did not confirm the smoke operation within 24 seconds.');
}

if (process.argv[2] === 'after-restart') {
  const previous = JSON.parse(await readFile(LAB_SMOKE_STATE, 'utf8'));
  if (previous.origin !== origin.origin || !/^[a-f0-9-]{36}$/i.test(previous.operationId)) throw new Error('Invalid smoke state.');
  const operation = await verifyOperation(previous.operationId);
  if (operation.recordId !== previous.recordId) throw new Error('Persisted smoke record ID changed.');
  console.log('The confirmed operation and original record ID survived restart.');
} else if (process.argv.length === 2) {
  await request('/api/health', [200]);
  await request('/api/ready', [200]);
  await request('/', [401]);
  await request('/api/workflow/tasks', [401]);
  await request('/api/ops/status', [403], 'viewer');
  const index = await request('/', [200], 'viewer');
  if (!(await index.text()).includes('FDA Delivery Assurance Lab') ||
      !index.headers.get('content-security-policy')?.includes("default-src 'self'")) throw new Error('Protected built frontend is missing.');
  for (const path of ['/api/workflow/tasks', '/api/agent-health', '/api/adoption/pipeline-digest', '/api/outcomes/model']) {
    const body = await (await request(path, [200], 'viewer')).json();
    if (!body || (Array.isArray(body) && body.length === 0)) throw new Error(path + ' returned no seeded evidence.');
  }
  const body = { candidateCode: 'CAND-' + String(randomInt(1_000_000_000, 9_999_999_999)), requisition: 'engineering' };
  const id = randomUUID();
  const submission = { method: 'POST', body, headers: { 'content-type': 'application/json', 'idempotency-key': id } };
  await request('/api/submissions', [401], undefined, submission);
  await request('/api/submissions', [403], 'viewer', submission);
  await request('/api/submissions', [400], 'operator', { ...submission, headers: { ...submission.headers, 'x-lab-fault': 'lost-ack' } });
  await request('/api/lab/submission-comparison', [404], 'operator', { method: 'POST' });
  await request('/api/submissions', [202, 200], 'operator', submission);
  const operation = await verifyOperation(id);
  const metrics = await (await request('/api/ops/status', [200], 'operator')).json();
  if (metrics.worker.state !== 'running') throw new Error('Worker heartbeat is not current.');
  await writeFile(LAB_SMOKE_STATE, JSON.stringify({ origin: origin.origin, operationId: id, recordId: operation.recordId }) + '\n',
    { mode: 0o600, flag: 'wx' });
  console.log('Private UI, access boundaries, module reads, rejected faults, PostgreSQL write and worker confirmation verified.');
} else {
  throw new Error('Usage: node scripts/staging-smoke.mjs [after-restart]');
}
