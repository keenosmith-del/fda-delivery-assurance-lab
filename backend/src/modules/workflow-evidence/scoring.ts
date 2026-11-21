import type { SuitabilityInputs, TaskDetail } from '../../../../shared/contracts/intelligence.ts';

export const workflowScoringVersion = 'workflow-weighted-rubric/v1';

export const workflowScoringMethod = 'Deterministic weighted engineering heuristics on a 0–100 scale. Scores are rubric points.';
export const workflowScoringLimits = [
  'Scores have no statistical calibration or demonstrated predictive accuracy.',
  'Synthetic sample frequency and endpoint coverage influence the classification score.',
  'Suitability includes assigned engineering inputs and counts the observed exception-free share.',
];

type Evidence = TaskDetail['evidence'];
const percent = (fraction: number) => Math.round(100 * fraction);
const cap = (count: number, full: number) => percent(Math.min(count / full, 1));

function weighted(rows: [name: string, score: number, weight: number][]) {
  const factors = rows.map(([name, score, weight]) => ({ name, score, weight }));
  return { score: Math.round(factors.reduce((total, item) => total + item.score * item.weight / 100, 0)), factors };
}

export function classify(expected: string[], history: Evidence) {
  const sequenceCounts = new Map<string, number>();
  let cumulative = 0;
  for (const event of history) {
    const signature = JSON.stringify(event.sequence);
    sequenceCounts.set(signature, (sequenceCounts.get(signature) ?? 0) + 1);
    const matching = expected.filter((step, index) => step === event.sequence[index]).length;
    cumulative += matching / Math.max(expected.length, event.sequence.length);
  }
  const count = history.length;
  return weighted([
    ['Ordered sequence similarity', count ? percent(cumulative / count) : 0, 45],
    ['Evidence frequency (10 events for full credit)', cap(count, 10), 20],
    ['Most repeated sequence', count ? percent(Math.max(...sequenceCounts.values()) / count) : 0, 20],
    ['Endpoint corroboration (4 devices for full credit)', cap(new Set(history.map(e => e.deviceId)).size, 4), 15],
  ]);
}

export function assessSuitability(input: SuitabilityInputs, history: Evidence) {
  const execution = history.length ? percent(history.filter(event => !event.exception).length / history.length) : 0;
  return weighted([
    ['Determinism', input.determinism, 15], ['Exception-free observations', execution, 10],
    ['Independence from human judgment', 100 - input.judgment, 15],
    ['Permission readiness', input.permissions, 10], ['Integration availability', input.integration, 10],
    ['Low data sensitivity', 100 - input.sensitivity, 8], ['Low operational risk', 100 - input.risk, 10],
    ['Low implementation complexity', 100 - input.complexity, 7], ['Expected business value', input.value, 15],
  ]);
}

export function recommend(classification: number, suitability: number, judgment: number, risk: number) {
  if (classification < 65) return 'Collect additional evidence before deciding on automation.';
  if (judgment >= 80 || risk >= 80) return 'Keep human review because the work requires judgment or carries high operational risk.';
  if (suitability >= 75) return 'Consider a supervised pilot and verify exceptions with the process owner.';
  return 'Resolve the lowest suitability factors before testing an automation.';
}
