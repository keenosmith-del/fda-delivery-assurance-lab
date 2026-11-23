import { FDA_CONTRACT, fdaEvent } from '../shared/contracts/fda-ingestion.ts';
import type { FdaEvent, FdaScope } from '../shared/contracts/fda-ingestion.ts';

const time = (clock: string) => `2026-11-16T${clock}:00.000Z`;
const endpoint = (n: number) => `endpoint-${String(n).padStart(3, '0')}`;
const endpoints = Array.from({ length: 9 }, (_, i) => endpoint(i + 1));
export const fixtureScope = { tenantId: 'tenant-001', sourceId: 'source-001' } as const;

export function buildFixture(scope: FdaScope = fixtureScope) {
  function event<T extends FdaEvent['recordType']>(
    n: number, recordType: T, clock: string, payload: Extract<FdaEvent, { recordType: T }>['payload'],
  ): FdaEvent {
    return fdaEvent.parse({
      ...scope, schemaVersion: FDA_CONTRACT, recordType, sourceRecordId: `record-${String(n).padStart(3, '0')}`,
      occurredAt: time(clock), sourceRevision: 'rev-1', correlationId: 'batch-001', payload,
    });
  }
  const registrations = endpoints.map((endpointId, i) => event(i + 1, 'endpoint.registration', '07:00', {
    endpointId, enrollment: 'enrolled', os: i % 2 ? 'windows' : 'macos', agentVersion: '1.0.0', enrolledAt: time('07:00'),
  }));
  const status = [
    ...endpoints.map((endpointId, i) => event(11 + i, 'endpoint.status', i < 7 ? '11:45' : '09:00', {
      endpointId, heartbeatAt: time(i < 7 ? '11:44' : '08:59'), connection: i < 7 ? 'online' : 'offline',
      lastObservationAt: i < 6 ? time(i === 2 ? '09:30' : '11:30') : null, capture: i === 6 ? 'limited' : 'available',
      diagnostics: i === 6 ? ['permission-limited'] : i === 0 ? ['version-updated'] : [],
      ...(i === 0 ? { agentVersion: '1.1.0' } : {}),
    })),
  ];
  const permissions = endpoints.slice(0, 7).map((endpointId, i) => event(21 + i, 'endpoint.permission', '08:00', {
    endpointId, category: 'screen', status: i === 6 ? 'limited' : 'granted', reportedAt: time('08:00'), consentReference: 'unknown',
  }));
  const primaryWindow = event(31, 'observation.window', '12:00', {
    windowId: 'window-001', start: time('09:00'), end: time('12:00'),
    eligibleEndpoints: endpoints, observedEndpoints: endpoints.slice(0, 6), reportingCount: 7, completeness: 'partial',
  });
  const fullWindow = event(32, 'observation.window', '09:00', {
    windowId: 'window-002', start: time('08:00'), end: time('09:00'),
    eligibleEndpoints: [endpoint(1)], observedEndpoints: [endpoint(1)], reportingCount: 1, completeness: 'complete',
  });
  const observations = [
    event(41, 'workflow.observation', '08:32', {
      workflowId: 'workflow-001', observationId: 'observation-001', windowId: 'window-002', endpointId: endpoint(1),
      observedAt: time('08:30'), sequence: ['receive', 'classify', 'assign'], durationSeconds: 120, exception: false,
    }),
    event(42, 'workflow.observation', '11:32', {
      workflowId: 'workflow-002', observationId: 'observation-002', windowId: 'window-001', endpointId: endpoint(2),
      observedAt: time('11:30'), sequence: ['receive', 'validate', 'transfer'], durationSeconds: 160, exception: true,
    }),
  ];
  const delayed = event(43, 'workflow.observation', '12:04', {
    workflowId: 'workflow-002', observationId: 'observation-003', windowId: 'window-001', endpointId: endpoint(1),
    observedAt: time('09:30'), sequence: ['receive', 'validate', 'transfer'], durationSeconds: 145, exception: false,
  });
  const candidates = [
    event(51, 'workflow.candidate', '09:10', {
      workflowId: 'workflow-001', windowIds: ['window-002'], observationIds: ['observation-001'],
      category: 'support-escalation', frequency: 8, unit: 'per-week', recommendation: 'consider-supervised-pilot',
    }),
    event(52, 'workflow.candidate', '12:10', {
      workflowId: 'workflow-002', windowIds: ['window-001'], observationIds: ['observation-002', 'observation-003', 'observation-004', 'observation-005'],
      category: 'record-sync', frequency: 14, unit: 'per-week', recommendation: 'collect-evidence',
    }),
  ];
  const measurements = [
    event(61, 'automation.measurement', '12:10', {
      automationId: 'automation-001', workflowId: 'workflow-001', windowId: 'window-002',
      state: 'deployed', eligible: 8, attempted: 7, successes: 6, failures: 1, exceptions: 1,
    }),
    event(62, 'automation.measurement', '12:10', {
      automationId: 'automation-002', workflowId: 'workflow-002', windowId: 'window-001',
      state: 'proposed', eligible: 14, attempted: 0, successes: 0, failures: 0, exceptions: 0,
    }),
  ];
  return {
    normal: [...registrations, ...status, ...permissions, primaryWindow, fullWindow, ...observations, ...candidates, ...measurements, delayed],
    replay: registrations[0],
    conflict: { ...registrations[0], payload: { ...registrations[0].payload, agentVersion: '1.2.0' } },
    permission: event(71, 'endpoint.permission', '11:50', {
      endpointId: endpoint(6), category: 'screen', status: 'limited', reportedAt: time('11:50'), consentReference: 'unknown',
    }),
    interruption: event(72, 'endpoint.status', '11:52', {
      endpointId: endpoint(6), heartbeatAt: time('09:00'), connection: 'offline', lastObservationAt: time('09:00'),
      capture: 'limited', diagnostics: ['reporting-interrupted'],
    }),
    delayed: event(76, 'workflow.observation', '12:02', {
      observationId: 'observation-005', workflowId: 'workflow-002', endpointId: endpoint(3), windowId: 'window-001',
      observedAt: time('10:20'), sequence: ['receive', 'validate', 'transfer'], durationSeconds: 130, exception: false,
    }),
    recovery: [
      event(73, 'endpoint.permission', '11:57', {
        endpointId: endpoint(6), category: 'screen', status: 'granted', reportedAt: time('11:57'), consentReference: 'unknown',
      }),
      event(74, 'endpoint.status', '11:58', {
        endpointId: endpoint(6), heartbeatAt: time('11:58'), connection: 'online', lastObservationAt: time('11:55'),
        capture: 'available', diagnostics: ['recovered'],
      }),
      event(75, 'workflow.observation', '11:59', {
        observationId: 'observation-004', workflowId: 'workflow-002', endpointId: endpoint(6), windowId: 'window-001',
        observedAt: time('11:55'), sequence: ['receive', 'validate', 'transfer'], durationSeconds: 125, exception: false,
      }),
    ],
    assuranceVersion: [event(81, 'endpoint.status', '11:55', {
      endpointId: endpoint(4), heartbeatAt: time('11:54'), connection: 'online', lastObservationAt: time('11:30'),
      capture: 'available', agentVersion: '2.0.0', diagnostics: ['version-updated'],
    })],
    assuranceVersionRecovery: [event(82, 'endpoint.status', '11:59', {
      endpointId: endpoint(4), heartbeatAt: time('11:58'), connection: 'online', lastObservationAt: time('11:30'),
      capture: 'available', agentVersion: '1.2.0', diagnostics: ['version-updated'],
    })],
    assurancePartial: [
      event(83, 'endpoint.permission', '11:54', { endpointId: endpoint(7), category: 'screen', status: 'granted',
        reportedAt: time('11:54'), consentReference: 'unknown' }),
      event(84, 'endpoint.status', '11:55', { endpointId: endpoint(7), heartbeatAt: time('11:55'), connection: 'online',
        capture: 'available', lastObservationAt: null, diagnostics: ['recovered'] }),
    ],
    assurancePermissionRecovery: [event(85, 'workflow.observation', '11:59', {
      observationId: 'observation-006', workflowId: 'workflow-002', endpointId: endpoint(7), windowId: 'window-001',
      observedAt: time('11:58'), sequence: ['receive', 'validate', 'transfer'], durationSeconds: 130, exception: false,
    })],
    assuranceRegression: [event(86, 'endpoint.status', '11:59', {
      endpointId: endpoint(6), heartbeatAt: time('11:58'), connection: 'offline', lastObservationAt: time('11:55'),
      capture: 'limited', diagnostics: ['reporting-interrupted'],
    })],
    assuranceOlder: [event(87, 'endpoint.status', '11:53', {
      endpointId: endpoint(6), heartbeatAt: time('09:00'), connection: 'offline', lastObservationAt: time('09:00'),
      capture: 'limited', diagnostics: ['reporting-interrupted'],
    })],
    assuranceComplete: [
      event(88, 'endpoint.status', '12:55', { endpointId: endpoint(6), heartbeatAt: time('12:54'), connection: 'online',
        lastObservationAt: time('12:45'), capture: 'available', queueCount: 0, diagnostics: ['recovered'] }),
      event(89, 'observation.window', '13:00', { windowId: 'window-003', start: time('12:00'), end: time('13:00'),
        eligibleEndpoints: [endpoint(6)], observedEndpoints: [endpoint(6)], reportingCount: 1, completeness: 'complete' }),
      event(90, 'workflow.observation', '12:46', { observationId: 'observation-007', workflowId: 'workflow-003', endpointId: endpoint(6),
        windowId: 'window-003', observedAt: time('12:45'), sequence: ['receive', 'report'], durationSeconds: 60, exception: false }),
      event(91, 'workflow.candidate', '13:05', { workflowId: 'workflow-003', windowIds: ['window-003'],
        observationIds: ['observation-007'], category: 'periodic-reporting', frequency: 1, unit: 'per-window', recommendation: 'investigate' }),
    ],
    workflowEvidenceChange: [event(92, 'workflow.observation', '12:57', {
      observationId: 'observation-007', workflowId: 'workflow-003', endpointId: endpoint(6),
      windowId: 'window-003', observedAt: time('12:53'), sequence: ['receive', 'validate', 'report'], durationSeconds: 95, exception: false,
    })],
    invalid: { ...registrations[0], schemaVersion: 'fda-lab.ingestion/v99' },
    violation: { ...registrations[0], tenantId: scope.tenantId === 'tenant-999' ? 'tenant-998' : 'tenant-999' },
  };
}
