import { createHash } from 'node:crypto';
import { OUTCOME_MEASUREMENT_VERSION, outcomeObservation } from '../shared/contracts/outcome-assurance.ts';
import type { OutcomeObservation } from '../shared/contracts/outcome-assurance.ts';
import { fixtureScope } from './fda-fixture.ts';

export const outcomeVariants = ['model', 'baseline', 'comparison', 'negative', 'unchanged', 'incomplete', 'changed-cohort', 'different-method'] as const;
type Variant = typeof outcomeVariants[number];

export function outcomeFixture({ caseId, workflowId, verifiedAt, sourceRevision = 'a'.repeat(40) }: {
  caseId: string; workflowId: string; verifiedAt: string; sourceRevision?: string;
}) {
  const day = 86_400_000;
  const midnight = Math.floor(Date.parse(verifiedAt) / day) * day;
  const iso = (offset: number) => new Date(midnight + offset * day).toISOString();
  function events(variant: Variant): OutcomeObservation[] {
    const baseline = variant === 'baseline';
    const periodId = baseline || variant === 'model' ? 'period-001' :
      ({ comparison: 'period-002', negative: 'period-003', unchanged: 'period-004', incomplete: 'period-005',
        'changed-cohort': 'period-006', 'different-method': 'period-007' } as const)[variant];
    const start = iso(baseline || variant === 'model' ? 1 : 4), end = iso(baseline || variant === 'model' ? 2 : 5);
    function event(identity: string, body: object) {
      const key = createHash('sha256').update([caseId, periodId, 'time-study', identity].join(':')).digest('hex');
      const eventId = `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-8${key.slice(17,20)}-${key.slice(20,32)}`;
      return outcomeObservation.parse({ ...fixtureScope, version: OUTCOME_MEASUREMENT_VERSION,
        provenance: 'independent-synthetic-time-study', caseId, workflowId, periodId, occurredAt: start, sourceRevision, eventId, ...body });
    }
    if (variant === 'model') return [
      event('complete-model', { kind: 'model', provenance: 'source-reported-aggregate', volume: 4, recurrencesPerWeek: 2,
        eligibleBps: 10000, suitableBps: 7500, implementationBps: 10000, manualSeconds: 120, reviewSeconds: 20, exceptionSeconds: 5,
        reworkSeconds: 10, limitation: 'Synthetic workload projection, with expected overhead per qualifying opportunity.' }),
      event('incomplete-model', { kind: 'model', provenance: 'source-reported-aggregate', volume: 4, recurrencesPerWeek: null,
        eligibleBps: 10000, suitableBps: 7500, implementationBps: 10000, manualSeconds: 120, reviewSeconds: null, exceptionSeconds: 5,
        reworkSeconds: 10, limitation: 'Review effort and recurrence are unknown.' }),
    ];
    const result = [event('period', { kind: 'period', stage: baseline ? 'baseline' : 'comparison', start, end, asOf: end,
      method: variant === 'different-method' ? 'structured-observation' : 'item-timing',
      cohort: variant === 'changed-cohort' ? 'cohort-002' : 'cohort-001', expectedItems: 4 })];
    const overhead = variant === 'negative' ? 70 : variant === 'unchanged' ? 45 : 10;
    for (let index = 1; index <= 4; index++) {
      const opportunity = 'opportunity-00' + index;
      const participant = 'operator-00' + index;
      const workload = index <= 2 ? 'routine' : 'exception';
      const categories = baseline ? { manual: 120 } : {
        processing: 30, review: 20, exception: 5, rework: overhead, recovery: 0, 'remaining-manual': 50, instrumentation: 0,
      };
      for (const [category, duration] of Object.entries(categories)) {
        if (variant === 'incomplete' && index === 4 && category === 'rework') continue;
        const millisecond = category === 'review' && index === 2;
        result.push(event(opportunity + '-' + category, { kind: 'effort', opportunity, participant,
          workload, category, duration: millisecond ? duration * 1000 : duration, unit: millisecond ? 'ms' : 's' }));
      }
    }
    return result;
  }
  return { events };
}
