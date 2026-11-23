import { workflowAssurance } from '../../../../shared/contracts/agent-assurance.ts';
import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import { transaction } from '../../db/pool.ts';
import type { Database } from '../../db/pool.ts';
import { workflowProjection } from '../fda-ingestion/projections.ts';
import { assess, loadAssuranceRecords } from './assessment.ts';
import { listIncidents } from './incidents.ts';

export function assessWorkflowReadiness(db: Database, scope: FdaScope) {
  return transaction(db, async client => {
    const records = await loadAssuranceRecords(client, scope);
    const incidents = await listIncidents(client, scope);
    const candidates = await workflowProjection(client, scope);
    const assessments = new Map(records.filter(row => row.event.recordType === 'observation.window')
      .map(row => [row.subjectId, assess(records, { windowId: row.subjectId })]));
    return workflowAssurance.parse(candidates.map(item => {
      const windows = item.candidate.windowIds.map(windowId => {
        const assessment = assessments.get(windowId);
        const related = incidents.filter(i => i.windowId === windowId);
        const devices = assessment?.devices ?? [];
        const affectedEndpoints = devices.filter(d => !d.evidenceComplete ||
          related.some(i => i.endpointId === d.endpointId && i.state !== 'resolved')).map(d => d.endpointId);
        return { windowId, affectedEndpoints, incidents: related,
          missingIntervals: devices.flatMap(d => d.missingIntervals.map(interval => ({ endpointId: d.endpointId, ...interval }))),
          gaps: assessment ? assessment.disagreements : ['No canonical observation window is available.'] };
      });
      const blocked = windows.some(window => window.incidents.some(incident => incident.state !== 'resolved' &&
        ['capture-permissions', 'reporting-interruption'].includes(incident.category)));
      const known = windows.every(window => {
        const completeness = assessments.get(window.windowId)?.completeness;
        return completeness && completeness !== 'unknown';
      });
      const needsEvidence = windows.some(window => window.affectedEndpoints.length || window.incidents.some(i => i.state !== 'resolved')) ||
        item.gaps.some(gap => !gap.startsWith('Observation coverage is incomplete or unknown'));
      return { workflowId: item.candidate.workflowId, windows,
        readiness: blocked ? 'blocked-by-operations' : !known ? 'unknown' : needsEvidence ? 'additional-evidence-required' : 'ready-for-review' };
    }));
  }, true);
}
