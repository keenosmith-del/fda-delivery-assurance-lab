import { ADOPTION_CALCULATION } from '../../../../shared/contracts/adoption-assurance.ts';
import type { Observation } from '../../../../shared/contracts/adoption-assurance.ts';

export type VerifiedEffect = { id: string; state: string; effectId: string | null; verifiedAt: string | null };
const rate = (n: number, d: number | null) => ({ numerator: n, denominator: d, value: d ? n / d : null });
export function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const existing = groups.get(id);
    if (existing) existing.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}
const at = (date: string) => Date.parse(date);
export const interpretationLimits = ['Observed change cannot establish an intervention effect.',
  'Cohort, opportunity mix, coverage and downstream reliability can change between periods.'];

export function measureWindow(periodId: string, events: Observation[], effect: VerifiedEffect | null) {
  const declarations = events.filter(e => e.kind === 'period');
  const p = declarations[0];
  const missing: string[] = [];
  if (!p) missing.push('Missing period declaration');
  if (declarations.length > 1) missing.push('Multiple period declarations');
  const active = p && declarations.length === 1 ? events.filter(e => e.kind !== 'period' &&
      at(e.occurredAt) >= at(p.start) && at(e.occurredAt) < at(p.end) && at(e.occurredAt) <= at(p.asOf)) : [];
  if (p && events.filter(e => e.kind !== 'period').length !== active.length) missing.push('Observations outside the declared window');
  const members = groupBy(active.filter(e => e.kind === 'member'), e => e.participant);
  const cohort = [...members].filter(([, rows]) => rows.every(e => e.eligible)).map(([id]) => id).sort();
  const ineligible = [...members].filter(([, rows]) => rows.every(e => !e.eligible)).map(([id]) => id).sort();
  if (members.size !== cohort.length + ineligible.length) missing.push('Conflicting membership');
  if (p?.expectedUsers == null) missing.push('Unknown eligible population');
  else if (p.expectedUsers !== cohort.length) missing.push('Eligible population records are incomplete or inconsistent');
  if (!active.some(e => e.kind === 'available')) missing.push('Missing workflow availability evidence');
  const opportunities = groupBy(active.filter(e => e.kind === 'opportunity'), e => e.opportunity);
  const attempts = groupBy(active.filter(e => e.kind === 'attempt'), e => e.opportunity);
  const results = groupBy(active.filter(e => e.kind === 'result'), e => e.opportunity);
  const exceptions = groupBy(active.filter(e => e.kind === 'exception'), e => e.opportunity);
  const handoffs = new Set(active.filter(e => e.kind === 'handoff').map(e => e.opportunity));
  const eligible = new Set(cohort);
  const logical = [];
  if ([...attempts.keys(), ...results.keys(), ...exceptions.keys(), ...handoffs].some(id => !opportunities.has(id))) {
    missing.push('Activity references an unobserved opportunity');
  }
  const effectLinks = new Set(active.flatMap(e => e.kind === 'result' && e.operationId && e.operationId === effect?.id ? [e.opportunity] : []));
  if (effectLinks.size > 1) missing.push('One verified delivery effect was linked to multiple opportunities');
  for (const [id, rows] of opportunities) {
    const first = rows[0]!;
    if (rows.some(e => e.participant !== first.participant || e.eligible !== first.eligible)) {
      missing.push('Conflicting opportunity evidence: ' + id);
      continue;
    }
    const qualified = first.eligible && eligible.has(first.participant);
    if (first.eligible && !qualified) missing.push('Opportunity lacks an eligible member: ' + id);
    const tried = attempts.get(id) ?? [];
    if (tried.some(a => a.participant !== first.participant)) missing.push('Attempt participant mismatch: ' + id);
    const attempted = qualified && tried.some(a => a.participant === first.participant);
    const reported = results.get(id) ?? [];
    const statuses = new Set(reported.map(e => e.result));
    if (statuses.size > 1) missing.push('Contradictory source results: ' + id);
    if (reported.length && !attempted) missing.push('Result has no qualifying attempt: ' + id);
    const linked = Boolean(effect?.effectId && effect.verifiedAt && p && at(effect.verifiedAt) <= at(p.asOf) &&
      effectLinks.size === 1 && reported.some(e => e.operationId === effect.id));
    const verified = attempted && linked && statuses.size === 1 && statuses.has('success');
    const result = !attempted ? null : verified ? 'verified-success' : statuses.size !== 1 ? 'inconclusive'
      : statuses.has('success') ? 'source-reported-success' : statuses.has('failure') && !linked ? 'source-reported-failure' : 'inconclusive';
    if (linked && statuses.has('failure')) missing.push('Source failure conflicts with the verified effect: ' + id);
    logical.push({ id, participant: first.participant, eligible: qualified, attempted, result, operationId: linked ? effect?.id : null,
      exceptions: [...new Set((exceptions.get(id) ?? []).map(e => e.category))], handoff: handoffs.has(id) });
  }
  const expectedUnits = p?.expectedUnits ?? null;
  const units = new Set(active.filter(e => e.kind === 'coverage').map(e => e.unit)).size;
  if (expectedUnits === null || units !== expectedUnits || expectedUnits === 0) missing.push('Incomplete or unknown observation coverage');
  const eligibleCount = logical.filter(o => o.eligible).length;
  const attempted = logical.filter(o => o.attempted);
  const adopters = [...new Set(attempted.map(o => o.participant))].sort();
  const verified = attempted.filter(o => o.result === 'verified-success').length;
  const reportedSuccess = attempted.filter(o => o.result === 'source-reported-success').length;
  const failed = attempted.filter(o => o.result === 'source-reported-failure').length;
  const exceptionCount = attempted.filter(o => o.exceptions.length > 0).length;
  const complete = missing.length === 0;
  return { periodId, declaration: p ?? null, calculationVersion: ADOPTION_CALCULATION,
    missing, coverage: complete ? 'complete' : 'insufficient', cohort, ineligible, adopters, logical,
    observedOpportunities: opportunities.size, verified, reportedSuccess, failed, inconclusive: attempted.length - verified - reportedSuccess - failed,
    exceptionCount, handoffs: attempted.filter(o => o.handoff).length, sourceIds: active.map(e => e.eventId),
    rates: { adoption: rate(adopters.length, p?.expectedUsers === cohort.length ? cohort.length : null),
      opportunityUsage: rate(attempted.length, eligibleCount), reliability: rate(verified, attempted.length),
      coverage: rate(units, expectedUnits !== null && units <= expectedUnits ? expectedUnits : null), exceptions: rate(exceptionCount, attempted.length) } };
}

export type Window = ReturnType<typeof measureWindow>;
export function compareWindows(before: Window, after: Window) {
  const baseline = before.declaration;
  const followUp = after.declaration;
  const changedCohort = JSON.stringify(before.cohort) !== JSON.stringify(after.cohort);
  const reasons = [...before.missing, ...after.missing];
  if (!baseline || !followUp || at(baseline.end) > at(followUp.start)) reasons.push('Measurement windows overlap or are unordered');
  if (before.rates.adoption.value === null || after.rates.adoption.value === null) reasons.push('Adoption denominator is unavailable');
  return { baseline: before.periodId, followUp: after.periodId, changedCohort, reasons, comparable: reasons.length === 0,
    rates: Object.entries(before.rates).map(([metric, first]) => {
      const second = after.rates[metric as keyof Window['rates']];
      return { metric, baseline: first, followUp: second, countChange: second.numerator - first.numerator,
        percentagePoints: reasons.length || first.value === null || second.value === null ? null : (second.value - first.value) * 100 };
    }),
    limitations: [...interpretationLimits, ...(changedCohort ? ['Eligible participants changed between windows.'] : [])] };
}

export function adoptionSignals(windows: Window[], operationId: string | null) {
  return windows.flatMap((w, i) => {
    const add = (category: string, metric: keyof Window['rates'], rule: string, explanation: string) =>
      ({ category, periodId: w.periodId, metric, ...w.rates[metric], rule, explanation, sourceIds: w.sourceIds,
        operationId, limitations: w.missing, calculationVersion: ADOPTION_CALCULATION });
    const prior = windows[i - 1]?.rates.opportunityUsage.value;
    const usage = w.rates.opportunityUsage.value;
    const thresholdSignals = w.coverage === 'complete' ? [
      ...(w.rates.adoption.value !== null && w.rates.adoption.value < .7 ? [add('low-adoption','adoption','< 70%', 'Inspect onboarding and workflow fit.')] : []),
      ...(prior != null && usage != null && windows[i - 1]?.coverage === 'complete' && Math.abs(prior - usage) >= .1 ?
        [add('inconsistent-usage','opportunityUsage','≥ 10 percentage points','Inspect changes in eligible workload and participants.')] : []),
    ] : [add('coverage','coverage','Complete cohort and measurement evidence required','Check source reporting and cohort declarations.')];
    return [...thresholdSignals,
      ...(w.exceptionCount ? [add('exceptions','exceptions','At least one observed exception','Review exception handling and handoffs.')] : []),
      ...(['permission','workflow','training','integration'].filter(category => w.logical.some(o => o.exceptions.some(value => value === category)))
        .map(category => add(category,'exceptions','Source-reported exception','Investigate the reported barrier.'))),
      ...(w.failed ? [add('reliability','reliability','Source reports failure','Inspect independently verified execution evidence.')] : []),
      ...(w.reportedSuccess || w.inconclusive ? [add('unverified-outcome','reliability','Observed result lacks independent confirmation','Inspect the source and downstream linkage.')] : [])];
  });
}
