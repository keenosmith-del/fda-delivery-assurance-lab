import type { Provider } from '../../backend/src/modules/investigations/provider.ts';
import type { Citation, EvidencePacket, ModelAnalysis } from '../../shared/contracts/investigations.ts';

const priorities: Record<string, string[]> = {
  'downstream-operation': ['state','dispatches','lookups','verifiedEffects','redriven'],
  'downstream-attempt': ['phase','result','error','method','effectMatch'],
  'adoption-period': ['adopters','eligibleParticipants','adoptionRate','verifiedSuccesses','reportedSuccesses'],
  'time-study-period': ['humanSeconds','reviewSeconds','reworkSeconds','missingRework'],
  'outcome-assessment': ['status','difference','reviewedDifference','unit'],
  'agent-window': ['completeness','eligible','reporting','observed'],
  'engineering-decision': ['outcome','revision','labScopeOnly'],
};
export function fixtureAnalysis(packet: EvidencePacket): ModelAnalysis {
  const getClaims = (entry: Citation) => (priorities[entry.record] ?? Object.keys(entry.facts)).slice(0,5)
    .filter(fact => Object.hasOwn(entry.facts,fact)).map(fact => ({ citation:entry.id,fact,value:entry.facts[fact]! }));
  const focus = packet.citations.filter(item => Object.hasOwn(priorities,item.record));
  const ordering = [...focus.filter(item => item.category !== 'engineering'), ...focus.filter(item => item.category === 'engineering')];
  const items = (ordering.length ? ordering : packet.citations).slice(0,12);
  const first = items[0]!;
  const contradictions = packet.citations.filter(item => item.provenance === 'contradiction').map(item => item.id);
  const missingEvidence = packet.citations.filter(item => item.provenance === 'evidence-gap').map(item => item.id);
  const recovery = packet.citations.find(item => item.record === 'downstream-attempt' && item.facts.error === 'ACKNOWLEDGMENT_UNAVAILABLE');
  return { summary: getClaims(first), establishedFacts: items.filter(item => !['evidence-gap','contradiction'].includes(item.provenance)).flatMap(getClaims).slice(0,16),
    findings: items.map(entry => ({ classification: entry.provenance === 'contradiction' ? 'contradicted'
      : entry.provenance === 'evidence-gap' ? 'insufficient-evidence' : 'supported', claims: getClaims(entry) })),
    contradictions, missingEvidence, hypotheses: recovery ? [{kind:'transport-after-commit',citations:[recovery.id]}] : [],
    risks: [...contradictions,...missingEvidence].slice(0,12), recommendations: [{kind:'technical-investigation',citations:[first.id]}],
    confidence: contradictions.length || missingEvidence.length ? 'limited' : 'supported-within-synthetic-scope' };
}

export const fixtureProvider: Provider = {
  name:'offline-test-fixture',model:'investigation-evaluation-v1',inputLimit:90000,outputLimit:8192,timeoutMs:1000,
  async infer(packet,question) {
    const candidate = fixtureAnalysis(packet);
    if (question.startsWith('Exercise unknown citation')) candidate.summary[0]!.citation = 'fake-000000000000000000000000';
    if (question.startsWith('Exercise numeric mismatch')) {
      const numeric = candidate.findings.flatMap(item => item.claims).find(claim => typeof claim.value === 'number');
      if (numeric) numeric.value = -999;
    }
    return { candidate };
  },
};
