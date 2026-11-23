import { WORKFLOW_READINESS_RULES, workflowAssurance } from '../../../../shared/contracts/agent-assurance.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import { transaction } from '../../db/pool.ts';
import type { Database, SqlClient } from '../../db/pool.ts';
import { workflowProjection } from '../fda-ingestion/projections.ts';
import { assess, loadAssuranceRecords } from './assessment.ts';
import { listIncidents } from './incidents.ts';

const isBlocking = (category: string) => ['capture-permissions', 'reporting-interruption'].includes(category);

export async function workflowEvidenceState(db: SqlClient, scope: FdaScope) {
  const records = await loadAssuranceRecords(db, scope);
  const incidents = await listIncidents(db, scope);
  const candidates = await workflowProjection(db, scope);
  const ids = new Set(candidates.flatMap(item => item.candidate.windowIds));
  const assessments = new Map([...ids].map(id => [id, assess(records, { windowId: id })]));
  const readiness = workflowAssurance.parse(candidates.map(item => {
    const windows = item.candidate.windowIds.map(windowId => {
      const assessment = assessments.get(windowId);
      const related = incidents.filter(incident => incident.windowId === windowId);
      const devices = assessment?.devices ?? [];
      const blockers = devices.flatMap(device => device.conditions.filter(condition => condition.severity === 'blocking')
        .map(({ category, reason }) => ({ endpointId: device.endpointId, category, reason })));
      const affectedEndpoints = devices.filter(d => !d.evidenceComplete || d.freshness !== 'fresh' ||
        related.some(i => i.endpointId === d.endpointId && i.state !== 'resolved')).map(d => d.endpointId);
      return { windowId, affectedEndpoints, incidents: related, blockers,
        missingIntervals: devices.flatMap(d => d.missingIntervals.map(interval => ({ endpointId: d.endpointId, ...interval }))),
        gaps: assessment ? assessment.disagreements : ['No canonical observation window is available.'] };
    });
    const blocked = windows.some(window => window.blockers.length ||
      window.incidents.some(i => i.state !== 'resolved' && isBlocking(i.category)));
    const unknown = windows.some(window => {
      const result = assessments.get(window.windowId);
      return !result || result.completeness === 'unknown' || result.window?.completeness === 'unknown' ||
        result.devices.some(d => d.connectivity === 'unknown' || d.capture === 'unknown' ||
          !d.permissions.some(p => p.category === 'screen' && p.status !== 'unknown'));
    });
    // Replaying a historical lab fixture adds receipt delay without changing its source window.
    // Observations produced after their source window still require evidence review.
    const incomplete = item.gaps.length > 0 || item.observations.some(o => o.reportedAfterWindow ||
      o.deliverySeconds === null || (o.deliveredLate && !o.arrivedAfterWindow)) ||
      windows.some(window => window.gaps.length || window.affectedEndpoints.length || window.incidents.some(i => i.state !== 'resolved'));
    return { workflowId: item.candidate.workflowId, windows, ruleVersion: WORKFLOW_READINESS_RULES,
      readiness: blocked ? 'blocked-by-operations' : unknown ? 'unknown' : incomplete ? 'additional-evidence-required' : 'ready-for-review' };
  }));
  return { candidates, readiness, records, assessments };
}

export function assessWorkflowReadiness(db: Database, scope: FdaScope) {
  return transaction(db, async client => (await workflowEvidenceState(client, scope)).readiness, true);
}
