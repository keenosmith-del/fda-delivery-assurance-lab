import { modelAnalysis, OUTPUT_VERSION } from '../../../../shared/contracts/investigations.ts';
import type { Citation, EvidencePacket, ModelAnalysis } from '../../../../shared/contracts/investigations.ts';

type Check = 'schema' | 'unknown-citation' | 'citation-scope' | 'unknown-fact' | 'numeric-mismatch' | 'value-mismatch' |
  'classification' | 'missing-evidence-omitted' | 'contradiction-omitted' | 'confidence';
export const invalidSchema = { version: OUTPUT_VERSION, status: 'failed', issues: ['schema'], referenced: 0, numericChecks: 0,
  materialContradictions: 0, missingEvidence: 0 } as const;

export function validateAnalysis(packet: EvidencePacket, candidate: unknown) {
  const parsed = modelAnalysis.safeParse(candidate);
  if (!parsed.success) return { analysis: null, validation: invalidSchema };
  const analysis = parsed.data;
  const registry = new Map(packet.citations.map(entry => [entry.id, entry]));
  const referenced = new Set<string>();
  const issues = new Set<Check>();
  let numericChecks = 0;
  function reference(id: string): Citation | undefined {
    const entry = registry.get(id);
    if (!entry) issues.add('unknown-citation');
    else if (entry.caseId !== packet.caseId || entry.tenantId !== packet.tenantId || entry.sourceId !== packet.sourceId) issues.add('citation-scope');
    else { referenced.add(id); return entry; }
  }
  function claim(item: ModelAnalysis['summary'][number]) {
    const entry = reference(item.citation);
    if (!entry) return;
    if (!Object.hasOwn(entry.facts, item.fact)) issues.add('unknown-fact');
    else if (typeof entry.facts[item.fact] === 'number') {
      numericChecks++;
      if (entry.facts[item.fact] !== item.value) issues.add('numeric-mismatch');
    } else if (entry.facts[item.fact] !== item.value) issues.add('value-mismatch');
    return entry;
  }
  for (const item of [...analysis.summary,...analysis.establishedFacts]) claim(item);
  for (const finding of analysis.findings) {
    const evidence = finding.claims.map(claim);
    if ((finding.classification === 'supported' && evidence.some(x => x && ['evidence-gap','contradiction'].includes(x.provenance))) ||
        (finding.classification === 'insufficient-evidence' && !evidence.some(x => x?.provenance === 'evidence-gap')) ||
        (finding.classification === 'contradicted' && !evidence.some(x => x?.provenance === 'contradiction'))) {
      issues.add('classification');
    }
  }
  for (const [ids, provenance] of [[analysis.contradictions,'contradiction'],[analysis.missingEvidence,'evidence-gap']] as const) {
    for (const id of ids) if (reference(id)?.provenance !== provenance) issues.add('classification');
  }
  for (const id of analysis.risks) reference(id);
  for (const item of [...analysis.hypotheses, ...analysis.recommendations]) for (const id of item.citations) reference(id);
  const contradictions = packet.citations.filter(entry => entry.provenance === 'contradiction');
  const missing = packet.citations.filter(entry => entry.provenance === 'evidence-gap');
  if (contradictions.some(entry => !analysis.contradictions.includes(entry.id))) issues.add('contradiction-omitted');
  if (missing.some(entry => !analysis.missingEvidence.includes(entry.id))) issues.add('missing-evidence-omitted');
  if ((missing.length || contradictions.length) && analysis.confidence === 'supported-within-synthetic-scope') issues.add('confidence');
  return { analysis: issues.size ? null : analysis,
    validation: { version: OUTPUT_VERSION, status: issues.size ? 'failed' : 'passed', issues: [...issues],
      referenced: referenced.size, numericChecks, materialContradictions: contradictions.length, missingEvidence: missing.length } };
}
