import type { DeviceDetail, DeviceHealth } from '../../../../shared/contracts/intelligence.ts';
import type { Database } from '../../db/pool.ts';

const hour = 3_600_000;
const freshnessLimit = 90 * 60_000;
type Window = { start: string; end: string };
type Event = DeviceDetail['history'][number];
type Device = Pick<DeviceHealth, 'id' | 'label' | 'team' | 'enrolledAt'>;

export function measureDevice(device: Device, window: Window, history: Event[]): DeviceDetail {
  const asOf = Date.parse(window.end);
  const start = Math.max(Date.parse(window.start), Date.parse(device.enrolledAt));
  const observed = history.filter(event => Date.parse(event.at) <= asOf).sort((a, b) => a.at.localeCompare(b.at));
  const lastHeartbeat = observed.findLast(event => event.kind === 'heartbeat')?.at ?? null;
  const lastObservation = observed.findLast(event => event.kind === 'observation')?.at ?? null;
  const permission = observed.findLast(event => event.kind === 'permission')?.permissionOk;
  const observationTimes = observed.filter(event => event.kind === 'observation').map(event => Date.parse(event.at));
  const missingIntervals: Window[] = [];

  for (let cursor = start; cursor < asOf; cursor += hour) {
    const end = Math.min(cursor + hour, asOf);
    if (observationTimes.some(time => time >= cursor && time < end)) continue;
    const from = new Date(cursor).toISOString();
    const to = new Date(end).toISOString();
    const previous = missingIntervals.at(-1);
    if (previous?.end === from) previous.end = to;
    else missingIntervals.push({ start: from, end: to });
  }

  return {
    ...device, lastHeartbeat, lastObservation, missingIntervals, history: observed,
    reporting: lastHeartbeat !== null && asOf - Date.parse(lastHeartbeat) <= freshnessLimit,
    permission: permission == null ? 'unknown' : permission ? 'granted' : 'limited',
    freshness: lastObservation === null ? 'unobserved' : asOf - Date.parse(lastObservation) <= freshnessLimit ? 'fresh' : 'stale',
  };
}

export async function queryDevices(pool: Database) {
  const result = await pool.query<{ id: string; starts_at: Date; ends_at: Date }>(
    'SELECT * FROM lab_observation_windows ORDER BY ends_at DESC, id LIMIT 1',
  );
  const latest = result.rows[0];
  if (!latest) return { window: null, reporting: 0, devices: [] as DeviceDetail[] };
  const window = { start: latest.starts_at.toISOString(), end: latest.ends_at.toISOString() };

  const [deviceRows, eventRows] = await Promise.all([
    pool.query<{ id: string; label: string; team: string; enrolled_at: Date }>(
      'SELECT id, label, team, enrolled_at FROM lab_devices WHERE window_id = $1 ORDER BY id', [latest.id],
    ),
    pool.query<{ device_id: string; occurred_at: Date; kind: Event['kind']; permission_ok: boolean | null }>(`
      SELECT e.device_id, e.occurred_at, e.kind, e.permission_ok FROM lab_device_events e
      JOIN lab_devices d ON d.id = e.device_id
      WHERE d.window_id = $1 AND e.occurred_at BETWEEN d.enrolled_at AND $2 ORDER BY e.occurred_at, e.id
    `, [latest.id, latest.ends_at]),
  ]);
  const history = new Map<string, Event[]>();
  for (const event of eventRows.rows) {
    const deviceHistory = history.get(event.device_id) ?? [];
    deviceHistory.push({ at: event.occurred_at.toISOString(), kind: event.kind, permissionOk: event.permission_ok });
    history.set(event.device_id, deviceHistory);
  }
  const devices = deviceRows.rows.map(({ enrolled_at, ...device }) => measureDevice(
    { ...device, enrolledAt: enrolled_at.toISOString() }, window, history.get(device.id) ?? [],
  ));
  return { window, reporting: devices.filter(device => device.reporting).length, devices };
}
