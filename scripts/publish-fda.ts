import { pathToFileURL } from 'node:url';
import { FDA_EVENTS, fdaReceipt, sourceId, tenantId } from '../shared/contracts/fda-ingestion.ts';
import type { FdaScope } from '../shared/contracts/fda-ingestion.ts';
import { buildFixture, fixtureScope } from './fda-fixture.ts';

export type PublisherTransport = (event: unknown) => Promise<{ status: number; body: unknown }>;
export function httpTransport(base: string, token: string): PublisherTransport {
  const url = new URL(base);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.origin !== base || url.protocol !== 'http:') {
    throw new Error('FDA publisher expects a loopback HTTP origin.');
  }
  return async event => {
    const response = await fetch(`${url.origin}${FDA_EVENTS}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    return { status: response.status, body: await response.json() };
  };
}

export async function publishScenario(transport: PublisherTransport, scenario: string, selectedId?: string, scope: FdaScope = fixtureScope) {
  const f = buildFixture(scope);
  const replay = selectedId ? f.normal.find(event => event.sourceRecordId === selectedId) : f.replay;
  const scenarios = {
    normal: { events: f.normal, statuses: [200, 201] },
    'duplicate-replay': { events: replay ? [replay] : [], statuses: [200] },
    'conflicting-replay': { events: [f.conflict], statuses: [409] },
    'permission-degradation': { events: [f.permission], statuses: [200, 201] },
    'reporting-interruption': { events: [f.interruption], statuses: [200, 201] },
    'delayed-delivery': { events: [f.delayed], statuses: [200, 201] },
    recovery: { events: f.recovery, statuses: [200, 201] },
    'assurance-version-transition': { events: f.assuranceVersion, statuses: [200, 201] },
    'assurance-version-recovery': { events: f.assuranceVersionRecovery, statuses: [200, 201] },
    'assurance-partial-recovery': { events: f.assurancePartial, statuses: [200, 201] },
    'assurance-permission-recovery': { events: f.assurancePermissionRecovery, statuses: [200, 201] },
    'assurance-regression': { events: f.assuranceRegression, statuses: [200, 201] },
    'assurance-out-of-order': { events: f.assuranceOlder, statuses: [200, 201] },
    'assurance-complete-window': { events: f.assuranceComplete, statuses: [200, 201] },
    'invalid-contract': { events: [f.invalid], statuses: [400] },
    'tenant-violation': { events: [f.violation], statuses: [403] },
  };
  const selected = scenarios[scenario as keyof typeof scenarios];
  if (!Object.hasOwn(scenarios, scenario) || !selected.events.length) throw new Error('Unknown FDA scenario or replay source record.');

  const receipts = [];
  for (const event of selected.events) {
    const result = await transport(event);
    if (!selected.statuses.includes(result.status)) throw new Error(`Unexpected gateway response HTTP ${result.status}.`);
    receipts.push(fdaReceipt.parse(result.body));
  }
  return receipts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const token = process.env.LAB_FDA_SOURCE_TOKEN;
    if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('Set LAB_FDA_SOURCE_TOKEN to the configured source credential.');
    const scope = {
      tenantId: tenantId.parse(process.env.LAB_FDA_TENANT_ID ?? fixtureScope.tenantId),
      sourceId: sourceId.parse(process.env.LAB_FDA_SOURCE_ID ?? fixtureScope.sourceId),
    };
    const transport = httpTransport(process.env.LAB_FDA_PUBLISHER_ORIGIN ?? 'http://127.0.0.1:3000', token);
    const receipts = await publishScenario(transport, process.argv[2] ?? 'normal', process.argv[3], scope);
    for (const receipt of receipts) process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'FDA publishing failed.'}\n`);
    process.exitCode = 1;
  }
}
