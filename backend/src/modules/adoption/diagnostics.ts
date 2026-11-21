import type { Diagnostic, MeasurementPeriod } from '../../../../shared/contracts/measurement.ts';

type Counts = Pick<MeasurementPeriod, 'population' | 'eligibleUsers' | 'adoptedUsers' | 'expected' | 'observed' |
  'eligibleOpportunities' | 'attempted' | 'succeeded' | 'failed' | 'exceptions'>;

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

export function adoptionRates(input: Counts) {
  const counts = [input.population, input.eligibleUsers, input.adoptedUsers, input.expected, input.observed,
    input.eligibleOpportunities, input.attempted, input.succeeded, input.failed, input.exceptions];
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0) || input.expected === 0 ||
      input.eligibleUsers > input.population || input.adoptedUsers > input.eligibleUsers ||
      input.eligibleOpportunities > input.observed || input.attempted > input.eligibleOpportunities ||
      input.succeeded + input.failed !== input.attempted || input.exceptions > input.attempted) {
    throw new RangeError('Invalid adoption counts');
  }
  return {
    adoption: ratio(input.adoptedUsers, input.eligibleUsers),
    opportunityUsage: ratio(input.attempted, input.eligibleOpportunities),
    reliability: ratio(input.succeeded, input.attempted),
    coverage: Math.min(input.observed / input.expected, 1),
  };
}

export function diagnosticSignals(periods: MeasurementPeriod[]) {
  const signals: Diagnostic[] = [];
  for (const [index, window] of periods.entries()) {
    const add = (category: Diagnostic['category'], observation: string, possibleExplanation: string) => {
      signals.push({ periodId: window.id, category, observation, possibleExplanation });
    };
    if (window.adoption !== null && window.adoption < .7) {
      add('low-adoption', `${window.adoptedUsers} of ${window.eligibleUsers} eligible operators attempted an execution.`,
        'Training and workflow handoffs may affect adoption.');
    }
    const previous = periods[index - 1]?.opportunityUsage;
    if (window.opportunityUsage !== null && previous != null && Math.abs(window.opportunityUsage - previous) >= .1) {
      add('inconsistent-usage', `Opportunity usage changed from ${Math.round(previous * 100)}% to ${Math.round(window.opportunityUsage * 100)}%.`,
        'The eligible workload or the operators using the automation may have changed.');
    }
    if (window.attempted && window.exceptions / window.attempted >= .1) {
      add('exceptions', `${window.exceptions} of ${window.attempted} attempts generated exceptions.`,
        'Some paths may need human handling or a narrower supported workflow.');
    }
    if (window.reliability !== null && window.reliability < .9) {
      add('reliability', `${window.failed} of ${window.attempted} attempts failed.`,
        'Inspect exception reasons for repeated execution failures.');
    }
  }
  return signals;
}

export const adoptionCalculationVersion = 'adoption-comparison/v1';
export const adoptionInterpretationLimits = [
  'The follow-up measurements were seeded independently of the intervention record.',
  'The comparison has no control group or counterfactual and cannot establish a causal effect.',
  'Workload mix, operator mix, instrument coverage and execution conditions are alternative explanations.',
];

export function compareAdoption(before: MeasurementPeriod, after: MeasurementPeriod) {
  const metric = (baseline: number | null, comparison: number | null) => ({
    baseline, comparison, deltaPercentagePoints: baseline === null || comparison === null ? null : (comparison - baseline) * 100,
  });
  return {
    baselinePeriodId: before.id,
    comparisonPeriodId: after.id,
    adoption: metric(before.adoption, after.adoption),
    reliability: metric(before.reliability, after.reliability),
    coverage: metric(before.coverage, after.coverage),
    causality: 'not-established',
    limitations: adoptionInterpretationLimits,
  };
}
