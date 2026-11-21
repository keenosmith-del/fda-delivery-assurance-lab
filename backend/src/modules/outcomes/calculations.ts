import { outcomeMeasurement } from '../../../../shared/contracts/measurement.ts';
import type { MeasurementPeriod, OutcomeMeasurement } from '../../../../shared/contracts/measurement.ts';

export function weeklyOpportunity(volume: number, eligibilityBps: number) {
  if (!Number.isSafeInteger(volume) || volume < 0 || !Number.isSafeInteger(eligibilityBps) ||
      eligibilityBps < 0 || eligibilityBps > 10000 || !Number.isSafeInteger(volume * eligibilityBps)) {
    throw new RangeError('Invalid opportunity inputs');
  }
  return Math.round(volume * eligibilityBps / 100) / 100;
}

type Window = { period: MeasurementPeriod; measurement: OutcomeMeasurement | null };

export function calculateOutcome(baseline: Window, comparison: Window) {
  const before = baseline.period;
  const after = comparison.period;
  if (after.startsOn < before.endsOn || after.succeeded + after.failed !== after.attempted ||
      [before.baselineSecondsPerItem, after.succeeded, after.reworkSeconds, after.reviewSeconds]
        .some(value => !Number.isSafeInteger(value) || value < 0) || !before.baselineSecondsPerItem ||
      !Number.isSafeInteger(after.succeeded * before.baselineSecondsPerItem)) {
    throw new RangeError('Invalid outcome comparison');
  }
  const modeledWeeklyOccurrences = weeklyOpportunity(before.observed, before.modeledEligibilityBps);
  const grossEstimatedSeconds = after.succeeded * before.baselineSecondsPerItem;
  const netEstimatedSeconds = grossEstimatedSeconds - after.reworkSeconds - after.reviewSeconds;
  const a = baseline.measurement && outcomeMeasurement.parse(baseline.measurement);
  const b = comparison.measurement && outcomeMeasurement.parse(comparison.measurement);
  const verificationLimits: string[] = [];
  if (before.coverage !== 1 || after.coverage !== 1) verificationLimits.push('One or both opportunity windows are incomplete.');
  if (!a || !b || !a.reviewed || !b.reviewed) verificationLimits.push('A reviewed time study is required for both periods.');
  if (a && b && (!a.measuredItems || a.measuredItems !== b.measuredItems || a.measuredItems !== before.observed ||
      b.measuredItems !== after.observed || a.method !== b.method)) {
    verificationLimits.push('The time studies must cover matched volumes and use the same measurement method.');
  }
  const verifiedSeconds = !verificationLimits.length && a && b ? a.humanHandlingSeconds - b.humanHandlingSeconds : null;

  return { modeledWeeklyOccurrences,
    adoptionAdjustedOpportunity: after.adoption === null ? null : Math.round(modeledWeeklyOccurrences * after.adoption * 100) / 100,
    grossEstimatedSeconds, netEstimatedSeconds, reworkSeconds: after.reworkSeconds, humanReviewSeconds: after.reviewSeconds,
    baselineMeasurement: a, comparisonMeasurement: b, verifiedSeconds, verificationLimits };
}
