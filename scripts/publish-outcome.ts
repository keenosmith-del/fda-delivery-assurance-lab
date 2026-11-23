import { z } from 'zod';
import { OUTCOME_MEASUREMENTS } from '../shared/contracts/outcome-assurance.ts';
import { outcomeFixture, outcomeVariants } from './outcome-fixture.ts';

const token = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).parse(process.env.LAB_FDA_SOURCE_TOKEN);
const [caseId, workflowId, verifiedAt, variant] = z.tuple([z.uuid(), z.string().regex(/^workflow-\d{3,8}$/),
  z.iso.datetime(), z.enum(outcomeVariants)]).parse(process.argv.slice(2));
const target = new URL(process.env.LAB_FDA_PUBLISHER_ORIGIN ?? 'http://127.0.0.1:3000');
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.href !== target.origin + '/') {
  throw new Error('Use a loopback synthetic lab API origin.');
}
for (const event of outcomeFixture({ caseId, workflowId, verifiedAt }).events(variant)) {
  const response = await fetch(target.origin + OUTCOME_MEASUREMENTS, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(event) });
  if (!response.ok) throw new Error(`Observation ${event.eventId} rejected with HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json()));
}
