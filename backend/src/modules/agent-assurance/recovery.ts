import { ASSURANCE_RULES } from '../../../../shared/contracts/agent-assurance.ts';
import type { AssuranceAssessment, AssuranceDevice, IncidentSummary } from '../../../../shared/contracts/agent-assurance.ts';

type Category = IncidentSummary['category'];
type Evidence = AssuranceDevice['timeline'][number];
type Predicate = { description: string; satisfied: boolean; evidence: Evidence[] };

export const recoveryCriteria: Record<Category, string> = {
  'reporting-interruption': 'A new online status supplies a fresh heartbeat that occurred after the interruption.',
  'stale-observations': 'A new canonical observation supplies a fresh observed timestamp.',
  'missing-coverage': 'A subsequent completed window has independent coverage from post-intervention source receipts for every eligible interval.',
  'capture-permissions': 'New screen permission is granted, capture is available and a canonical observation follows the permission change.',
  'version-readiness': 'A new version report satisfies the lab stable 1.x policy.',
  'delivery-backlog': 'A new status reports a queue below 25 and an observation reaches the server within 300 seconds of source occurrence.',
};

export function evaluateRecovery(category: Category, assessment: AssuranceAssessment, device: AssuranceDevice | undefined,
  conditionSince: string, originalWindowEnd: string, implementedAt: string) {
  const asOf = assessment.asOf;
  const after = (e: Evidence | undefined): e is Evidence => !!e && e.receivedAt > implementedAt && e.occurredAt > conditionSince;
  const status = device?.timeline.find(item => item.recordType === 'endpoint.status');
  const screen = device?.permissionHistory.find(item => item.value.category === 'screen');
  const version = device?.versionHistory[0];
  const observations = device?.observations.filter(item => item.observedAt > conditionSince && after(item.evidence)) ?? [];
  const freshObservation = observations.find(item => asOf && Date.parse(asOf) - Date.parse(item.observedAt) <= 90 * 60_000);
  const promptObservation = observations.find(item => item.occurrenceToReceiptSeconds !== null && item.occurrenceToReceiptSeconds <= 300);
  const row = (description: string, satisfied: boolean, evidence: (Evidence | undefined)[]): Predicate =>
    ({ description, satisfied, evidence: evidence.filter(after) });
  const predicates = (() => {
    switch (category) {
      case 'reporting-interruption': return [row(recoveryCriteria[category], after(status) &&
        Boolean(device?.lastHeartbeat && device.lastHeartbeat > conditionSince &&
          ['reporting', 'recovered'].includes(device.connectivity)), [status])];
      case 'stale-observations': return [row(recoveryCriteria[category], Boolean(freshObservation), [freshObservation?.evidence])];
      case 'missing-coverage': {
        const windowEvidence = device?.timeline.find(item => item.recordType === 'observation.window');
        const subsequent = assessment.window && assessment.window.start >= originalWindowEnd;
        const everyInterval = subsequent && device && observations.length === device.observations.length && device.evidenceComplete;
        return [row(recoveryCriteria[category], Boolean(everyInterval && after(windowEvidence)), [windowEvidence, ...observations.map(o => o.evidence)])];
      }
      case 'capture-permissions': return [
        row('Post-intervention screen permission is granted.', after(screen?.evidence) &&
          screen?.value.status === 'granted' && screen.value.reportedAt > conditionSince, [screen?.evidence]),
        row('Post-intervention endpoint status confirms available capture.', after(status) && device?.capture === 'available', [status]),
        row('A fresh post-intervention observation follows the reported screen permission change.',
          Boolean(freshObservation && screen && freshObservation.observedAt >= screen.value.reportedAt), [freshObservation?.evidence]),
      ];
      case 'version-readiness': return [row(recoveryCriteria[category], after(version?.evidence) && device?.versionPolicy === 'supported', [version?.evidence])];
      case 'delivery-backlog': return [
        row('A new status reports a queue below 25.', after(status) && device?.queueCount != null && device.queueCount < 25, [status]),
        row('A new observation arrives within the 300-second delivery policy.', Boolean(promptObservation), [promptObservation?.evidence]),
      ];
    }
  })();
  const evidence = [...new Map(predicates.flatMap(item => item.evidence).map(item => [item.id, item])).values()];
  const outcome = predicates.every(item => item.satisfied) ? 'verified-recovered'
    : predicates.some(item => item.satisfied) ? 'partially-verified' : evidence.length ? 'not-recovered' : 'insufficient-evidence';
  return { outcome, predicates, evidence, windowId: assessment.window?.windowId ?? null, asOf, ruleVersion: ASSURANCE_RULES };
}
