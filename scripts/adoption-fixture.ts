import { createHash } from 'node:crypto';
import { ADOPTION_VERSION, observation } from '../shared/contracts/adoption-assurance.ts';
import type { Observation } from '../shared/contracts/adoption-assurance.ts';
import { fixtureScope } from './fda-fixture.ts';

type Variant = 'baseline' | 'improvement' | 'unchanged' | 'incomplete' | 'changed-cohort';
export function fixtureWindows({ caseId, workflowId, verifiedAt, operationId, sourceRevision = 'a'.repeat(40) }: {
  caseId: string; workflowId: string; verifiedAt: string; operationId: string; sourceRevision?: string;
}) {
  const day = 86_400_000;
  const midnight = Math.floor(Date.parse(verifiedAt) / day) * day;
  const iso = (days: number) => new Date(midnight + days * day).toISOString();
  const implementationDate = iso(3);
  function events(variant: Variant): Observation[] {
    const baseline = variant === 'baseline';
    const periodId = baseline ? 'period-001' : variant === 'improvement' ? 'period-002'
      : variant === 'unchanged' ? 'period-003' : variant === 'incomplete' ? 'period-004' : 'period-005';
    const start = iso(baseline ? 1 : 4);
    const end = iso(baseline ? 2 : 5);
    const cohort = variant === 'changed-cohort' ? ['operator-001', 'operator-002', 'operator-005'] :
      ['operator-001', 'operator-002', 'operator-003', 'operator-004'];
    const used = variant === 'improvement' ? 3 : 1;
    const common = { ...fixtureScope, version: ADOPTION_VERSION, provenance: 'independent-synthetic-usage',
      workflowId, caseId, periodId, occurredAt: start, sourceRevision };
    const output: Observation[] = [];
    function event(identity: string, body: object) {
      const key = createHash('sha256').update([caseId, periodId, identity].join(':')).digest('hex');
      const eventId = `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-8${key.slice(17,20)}-${key.slice(20,32)}`;
      output.push(observation.parse({ ...common, ...body, eventId }));
    }
    event('period', { kind: 'period', start, end, asOf: end, expectedUsers: cohort.length, expectedUnits: 2 });
    event('available', { kind: 'available' });
    event('unit-001', { kind: 'coverage', unit: 'unit-001' });
    if (variant !== 'incomplete') event('unit-002', { kind: 'coverage', unit: 'unit-002' });
    cohort.forEach((participant, pos) => {
      const opportunity = 'opportunity-00' + (pos + 1);
      event(participant, { kind: 'member', participant, eligible: true });
      event(opportunity, { kind: 'opportunity', opportunity, participant, eligible: true });
      if (pos < used) {
        event('attempt-' + opportunity, { kind: 'attempt', opportunity, participant });
        event('result-' + opportunity, { kind: 'result', opportunity, result: 'success',
          ...(baseline && pos === 0 ? { operationId } : {}) });
      }
    });
    if (baseline) {
      event('permission', { kind: 'exception', opportunity: 'opportunity-001', category: 'permission' });
      event('handoff', { kind: 'handoff', opportunity: 'opportunity-001' });
    }
    return output;
  }
  return { events, implementationDate };
}
