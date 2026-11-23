import { z } from 'zod';
import { FDA_GATEWAY } from './fda-ingestion.ts';

export const INVESTIGATIONS = FDA_GATEWAY + '/investigations';
export const RETRIEVAL_VERSION = 'fda-lab.investigation-evidence/v1';
export const OUTPUT_VERSION = 'fda-lab.investigation-analysis/v1';
export const PROMPT_VERSION = 'fda-lab.investigation-prompt/v1';
export const investigationCategories = ['evidence-readiness', 'agent-health', 'workflow-feasibility', 'decision-review',
  'downstream-failure', 'retry-reconciliation', 'adoption-usage', 'intervention-follow-up', 'outcome-verification', 'end-to-end'] as const;
export const evidenceCategories = ['source', 'agent', 'engineering', 'downstream', 'adoption', 'outcome'] as const;
export const evidenceClasses = ['source-record', 'source-reported', 'calculated', 'human-decision', 'independently-verified', 'evidence-gap', 'contradiction'] as const;
export const findingClasses = ['supported', 'partially-supported', 'insufficient-evidence', 'contradicted'] as const;
export const hypothesisKinds = ['transport-after-commit', 'pre-commit-interruption', 'reporting-gap', 'permissions', 'workload-mix',
  'review-overhead', 'onboarding-barrier', 'measurement-coverage'] as const;
export const recommendationKinds = ['further-observation', 'source-validation', 'technical-investigation', 'configuration-review',
  'workflow-change-proposal', 'reliability-investigation', 'measurement-improvement', 'human-decision-required'] as const;
export const reviewKinds = ['consider-recommendation', 'reject-findings', 'request-evidence', 'close', 'supersede'] as const;

const selection = { category: z.enum(investigationCategories), baseline: z.string().regex(/^period-[0-9]{3,8}$/).optional(),
  comparison: z.string().regex(/^period-[0-9]{3,8}$/).optional(), method: z.enum(['matched-items', 'normalised-workload']).optional(),
  interventionId: z.uuid().optional() };
const paired = (input: { baseline?: string; comparison?: string; method?: string; interventionId?: string }) =>
  Boolean(input.baseline) === Boolean(input.comparison) && (!input.method && !input.interventionId || Boolean(input.baseline)) &&
  (!input.baseline || input.baseline !== input.comparison);
export const investigationScope = z.strictObject(selection).refine(paired);
export const investigationRequest = z.strictObject({ ...selection, requestId: z.uuid(), question: z.string().trim().min(12).max(500),
  runInference: z.boolean() }).refine(paired);
export const investigationReview = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().min(0).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(reviewKinds), reason: z.string().trim().min(5).max(500) });

const citationId = z.string().regex(/^[a-z]+-[a-f0-9]{24}$/);
const value = z.union([z.number(), z.boolean(), z.string().max(200), z.null()]);
const claim = z.strictObject({ citation: citationId, fact: z.string().regex(/^[a-z][a-zA-Z0-9]{0,49}$/), value });
const finding = z.strictObject({ classification: z.enum(findingClasses), claims: z.array(claim).min(1).max(8) });
const hypothesis = z.strictObject({ kind: z.enum(hypothesisKinds), citations: z.array(citationId).min(1).max(5) });
const recommendation = z.strictObject({ kind: z.enum(recommendationKinds), citations: z.array(citationId).min(1).max(5) });
export const modelAnalysis = z.strictObject({
  summary: z.array(claim).min(1).max(5),
  establishedFacts: z.array(claim).max(16),
  findings: z.array(finding).min(1).max(12),
  contradictions: z.array(citationId).max(16),
  missingEvidence: z.array(citationId).max(16),
  hypotheses: z.array(hypothesis).max(8),
  risks: z.array(citationId).max(12),
  recommendations: z.array(recommendation).min(1).max(8),
  confidence: z.enum(['insufficient', 'limited', 'supported-within-synthetic-scope']),
});
export const factValue = value;
export const citation = z.strictObject({ id: citationId, category: z.enum(evidenceCategories), record: z.string(), recordId: z.string(),
  caseId: z.uuid(), tenantId: z.string(), sourceId: z.string(), version: z.string(), timestamp: z.string().nullable(),
  period: z.string().nullable(), provenance: z.enum(evidenceClasses), summary: z.string(), facts: z.record(z.string(), value),
  links: z.array(z.string()),
});
export const evidencePacket = z.strictObject({ version: z.literal(RETRIEVAL_VERSION), caseId: z.uuid(), workflowId: z.string(),
  assessmentId: z.uuid(), assessmentRevision: z.number().int(), tenantId: z.string(), sourceId: z.string(),
  scope: investigationScope, citations: z.array(citation), truncated: z.boolean(), omitted: z.number().int(),
  limitations: z.array(z.string()), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export type InvestigationScope = z.infer<typeof investigationScope>;
export type InvestigationRequest = z.infer<typeof investigationRequest>;
export type InvestigationReview = z.infer<typeof investigationReview>;
export type ModelAnalysis = z.infer<typeof modelAnalysis>;
export type EvidencePacket = z.infer<typeof evidencePacket>;
export type Citation = z.infer<typeof citation>;
export type FactValue = z.infer<typeof factValue>;
