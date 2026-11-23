import { OUTCOME_RULE, effortCategories } from '../../../../shared/contracts/outcome-assurance.ts';
import type { OutcomeObservation, OutcomeSelection } from '../../../../shared/contracts/outcome-assurance.ts';
import type { Window } from '../adoption/assurance-metrics.ts';
import { groupBy } from '../adoption/assurance-metrics.ts';

type Period = Extract<OutcomeObservation, { kind: 'period' }>;
type Effort = Extract<OutcomeObservation, { kind: 'effort' }>;
type Model = Extract<OutcomeObservation, { kind: 'model' }>;
const instant = Date.parse;
const humanCategories = effortCategories.filter(category => category !== 'processing');
const baselineRequired = ['manual'] as const;
const comparisonRequired = effortCategories.filter(category => category !== 'manual');
export const outcomeFormulas = {
  timeUnit: 'seconds',
  itemEffort: 'Sum manual handling, remaining manual, human review, exception, rework, recovery and instrumentation. Automated processing is recorded separately.',
  reviewedDifference: 'Baseline comparable human seconds minus comparison comparable human seconds. For normalised workload compare per-item rates.',
  modeledGross: 'Volume × eligible proportion × suitable proportion × implementation coverage × manual seconds',
  modeledNet: 'Gross modeled seconds minus the modeled eligible workload multiplied by review, exception and rework seconds',
  weekly: 'Modeled period opportunity × explicit recurrences per week',
};

export function modelOpportunity(input: Model) {
  const items = input.volume * (input.eligibleBps / 10000) * (input.suitableBps / 10000) * (input.implementationBps / 10000);
  const gross = items * input.manualSeconds;
  const adjustment = input.reviewSeconds === null || input.exceptionSeconds === null || input.reworkSeconds === null
    ? null : input.reviewSeconds + input.exceptionSeconds + input.reworkSeconds;
  const net = adjustment === null ? null : gross - items * adjustment;
  return { classification: 'modeled-opportunity', input, modeledItems: items, grossSeconds: gross, netSeconds: net,
    weeklyGrossSeconds: input.recurrencesPerWeek === null ? null : gross * input.recurrencesPerWeek,
    weeklyNetSeconds: input.recurrencesPerWeek === null || net === null ? null : net * input.recurrencesPerWeek };
}

export function study(periodId: string, observations: OutcomeObservation[]) {
  const all = observations.filter(e => e.periodId === periodId);
  const definitions = all.filter(e => e.kind === 'period');
  const definition = definitions.length === 1 ? definitions[0]! : null;
  const missing: string[] = [];
  if (!definition) missing.push(definitions.length ? 'Conflicting study declarations' : 'Missing study declaration');
  if (definition?.provenance !== 'independent-synthetic-time-study' && definition) missing.push('Study declaration is source reported');
  const entries = all.filter(e => e.kind === 'effort');
  const within = (event: Effort, d: Period) => instant(event.occurredAt) >= instant(d.start) &&
    instant(event.occurredAt) < instant(d.end) && instant(event.occurredAt) <= instant(d.asOf);
  const eligible = definition ? entries.filter(e => e.provenance === 'independent-synthetic-time-study' && within(e, definition)) : [];
  if (eligible.length !== entries.length) missing.push('Excluded source-reported or out-of-window observations');
  const items = [...groupBy(eligible, e => e.opportunity)].map(([opportunity, rows]) => {
    const workload = rows[0]!.workload;
    const participants = [...new Set(rows.flatMap(row => row.participant ? [row.participant] : []))];
    if (participants.length > 1) missing.push(`Inconsistent participant for ${opportunity}`);
    if (rows.some(e => e.workload !== workload)) missing.push(`Inconsistent workload for ${opportunity}`);
    const categories = Object.fromEntries(effortCategories.map(category => [category, null])) as Record<typeof effortCategories[number], number | null>;
    for (const [category, records] of groupBy(rows, r => r.category)) {
      const values = new Set(records.map(r => r.duration * (r.unit === 's' ? 1000 : 1)));
      if (values.size !== 1) missing.push(`Conflicting ${category} observations for ${opportunity}`);
      else categories[records[0]!.category] = [...values][0]! / 1000;
    }
    const required = definition?.stage === 'baseline' ? baselineRequired : comparisonRequired;
    for (const category of required) if (categories[category] === null) missing.push(`Missing ${category} for ${opportunity}`);
    const humanMilliseconds = humanCategories.reduce((sum, category) => sum + Math.round((categories[category] ?? 0) * 1000), 0);
    return { opportunity, workload, participant: participants[0] ?? null, categories, humanSeconds: humanMilliseconds / 1000,
      humanMilliseconds, sourceEventIds: rows.map(r => r.eventId).sort() };
  }).sort((a, b) => a.opportunity.localeCompare(b.opportunity));
  if (definition && items.length !== definition.expectedItems) missing.push('Study coverage does not match the declared item count');
  const sums = Object.fromEntries(effortCategories.map(category => [category, items.some(x => x.categories[category] !== null)
    ? items.reduce((sum, item) => sum + Math.round((item.categories[category] ?? 0) * 1000), 0) / 1000 : null]));
  const humanMilliseconds = items.reduce((sum, item) => sum + item.humanMilliseconds, 0);
  return { periodId, definition, items, missing, sums, humanMilliseconds, humanSeconds: humanMilliseconds / 1000 };
}
type Study = ReturnType<typeof study>;
export function compareStudies(baseline: Study, comparison: Study, selection: OutcomeSelection, adoption?: Window) {
  const reasons = [...baseline.missing, ...comparison.missing];
  const a = baseline.definition, b = comparison.definition;
  if (a?.stage !== 'baseline' || b?.stage !== 'comparison' || a && b && instant(a.end) > instant(b.start)) {
    reasons.push('Study periods must be distinct, ordered baseline and comparison windows');
  }
  if (a?.method !== b?.method) reasons.push('Incompatible measurement methods');
  if (!adoption?.declaration || !b || instant(b.start) !== instant(adoption.declaration.start) || instant(b.end) !== instant(adoption.declaration.end)) {
    reasons.push('Comparison study must align exactly to its explicitly linked adoption period');
  } else if (adoption.coverage !== 'complete' || adoption.rates.adoption.denominator === null ||
      !adoption.logical.some(x => x.eligible && x.attempted)) {
    reasons.push('Comparison adoption evidence is insufficient');
  }
  const adoptionItems = new Map(adoption?.logical.filter(x => x.eligible).map(x => [x.id, x]));
  if (comparison.items.some(x => !adoptionItems.has(x.opportunity))) reasons.push('Comparison items lack eligible workload observations');
  if (comparison.items.some(x => x.participant && adoptionItems.has(x.opportunity) &&
    adoptionItems.get(x.opportunity)?.participant !== x.participant)) reasons.push('Time-study participants differ from eligible workload records');
  if (selection.method === 'matched-items') {
    if (JSON.stringify(baseline.items.map(x => [x.opportunity, x.workload])) !== JSON.stringify(comparison.items.map(x => [x.opportunity, x.workload]))) {
      reasons.push('Matched item identities and workload classes differ');
    }
  } else if (baseline.items.length === 0 || comparison.items.length === 0 || ['routine','exception'].some(k =>
    baseline.items.filter(x => x.workload === k).length * comparison.items.length !==
    comparison.items.filter(x => x.workload === k).length * baseline.items.length)) {
    reasons.push('Normalisation requires the same workload-class proportions');
  }
  const unit = selection.method === 'matched-items' ? 'seconds' : 'seconds per item';
  const baselineRate = baseline.items.length ? baseline.humanSeconds / baseline.items.length : null;
  const comparisonRate = comparison.items.length ? comparison.humanSeconds / comparison.items.length : null;
  const comparable = reasons.length === 0;
  return { method: selection.method, version: OUTCOME_RULE, comparable, reasons, unit,
    cohortChanged: Boolean(a && b && a.cohort !== b.cohort), baselineRate, comparisonRate,
    difference: !comparable || baselineRate === null || comparisonRate === null ? null : selection.method === 'matched-items'
      ? (baseline.humanMilliseconds - comparison.humanMilliseconds) / 1000 : baselineRate - comparisonRate };
}
