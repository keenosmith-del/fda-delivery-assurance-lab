import { feasibilityInput, riskInput } from '../../shared/contracts/workflow-assessments.ts';

export const feasible = feasibilityInput.parse({
  understanding: {
    objective: 'Assemble the periodic synthetic report.', observedSequence: 'Receive a source observation and prepare a report.',
    trigger: 'Close the known synthetic observation window.', inputs: 'Scoped canonical source records.',
    outputs: 'A single synthetic report.', businessRules: 'Only verified lab records qualify.',
    humanJudgement: 'Operator reviews exceptional items.', exceptions: 'Escalate missing evidence to review.',
    systems: 'Canonical source store and synthetic reporting sink.', assumptions: ['The next lab window uses the same scope.'],
  },
  integration: {
    source: 'Synthetic canonical records', destination: 'Lab reporting workspace', method: 'Read the scoped canonical record interface.',
    availability: 'verified-in-lab', identityRequirement: 'Dedicated scoped lab service role', permissions: 'Read scoped source records.',
    authorization: 'acknowledged', contract: 'Versioned synthetic observation contract.', mapping: 'Map source window to report identifier.',
    throughput: 'One report per eligible source window.', failureHandling: 'Record a failed attempt and stop on missing evidence.',
    reconciliation: 'Compare expected window and stored report.',
  },
  execution: {
    model: 'human-supervised', checkpoints: 'Confirm report scope before publishing.', idempotency: 'Store a stable report operation ID.',
    retry: 'Only retry explicitly transient errors.', successCriteria: 'Persist matching report and authoritative receipt.',
    deduplication: 'One durable report per scope and window.', exceptions: 'Return exceptional reports to review.',
    recovery: 'Reconcile accepted reports before replay.', escalation: 'Escalate unresolved errors to the operator.',
    monitoring: 'Record confirmation and outstanding work.',
  },
  operations: {
    environment: 'Disposable lab environment only.', deploymentAssumptions: 'Delivery case is stored as a lab plan.',
    monitoring: 'Inspect synthetic success and exception counts.', recoveryOwner: 'engineer', support: 'The lab operator reviews failures.',
    retention: 'Preserve report receipts within lab retention bounds.', securityBoundary: 'Only scoped synthetic records cross the boundary.',
    rollback: 'Withdraw a synthetic report by authoritative ID.', clientApproval: 'not-required', credentialAvailability: 'not-applicable',
  },
  alternatives: { kind: 'considered', option: 'Use a manually prepared periodic report.',
    tradeoff: 'Manual preparation preserves judgement and takes more operator time.' },
  dependencies: [{ requirement: 'Read canonical report evidence.', owner: 'engineer', mandatory: true,
    status: 'verified-in-lab', basis: 'The scoped records were validated in the lab.' }],
  suitability: { determinism: 'high', humanJudgement: 'low', integrationComplexity: 'low', dataSensitivity: 'low',
    failureImpact: 'low', recoverability: 'high', expectedValue: 'medium', implementationComplexity: 'low', maintenance: 'low',
    basis: 'This lab workflow uses a versioned and reviewed synthetic contract.' },
  phases: ['Validate the report contract.', 'Run acceptance cases in a disposable lab.'],
});

export const reviewedRisk = riskInput.parse({
  category: 'reliability', description: 'Duplicate report creation.', likelihood: 'medium', impact: 'medium',
  basis: 'Repeated synthetic source records can be delivered.', mitigation: 'Use one operation ID per reporting window.',
  owner: 'engineer', residual: 'low', review: 'reviewed',
});

export async function createFixtureDelivery(post: (path: string, body: object) => Promise<{ current: { revision: number } }>, base: string) {
  const open = await post(base, {});
  const feasibility = await post(base + '/revisions', { revision: open.current.revision, action: 'feasibility', feasibility: feasible });
  const risks = await post(base + '/revisions', { revision: feasibility.current.revision, action: 'risks', risks: [reviewedRisk],
    rationale: 'Reviewed the synthetic risk and its mitigation against the source evidence.' });
  const submitted = await post(base + '/revisions', { revision: risks.current.revision, action: 'submit',
    reason: 'The synthetic feasibility and risk reviews are ready for decision.' });
  const approved = await post(base + '/decisions', { revision: submitted.current.revision, outcome: 'approve-implementation-planning',
    justification: 'The scoped synthetic report has enough evidence for implementation planning.', conditions: [] });
  await post(base + '/delivery-cases', { revision: approved.current.revision });
}
