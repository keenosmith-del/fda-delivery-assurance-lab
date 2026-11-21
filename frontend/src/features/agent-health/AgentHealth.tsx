import { useState } from 'react';
import { coverage, deviceDetail } from '../../../../shared/contracts/intelligence.ts';
import { useResource } from '../../lib/resource.ts';
import { dateLabel } from '../../lib/dates.ts';

export function AgentHealth() {
  const health = useResource('/api/agent-health', coverage);
  const [selected, setSelected] = useState('');
  const active = selected || health.data?.devices[0]?.id;
  const details = useResource(active ? `/api/agent-health/${active}` : null, deviceDetail);
  const device = details.data;
  return <>
    <section className="heading"><h1>Agent Health</h1><p>Review synthetic endpoint reporting, permissions and gaps in the observation window.</p></section>
    {health.error ? <p role="alert">{health.error} <button className="secondary" onClick={health.retry}>Retry</button></p>
      : !health.data ? <p role="status">Loading coverage…</p> : <>
        <div className="panel coverage-summary">
          <div><h2>{health.data.reporting} of {health.data.devices.length} endpoints reporting</h2>
            {health.data.window && <p>{dateLabel(health.data.window.start)} to {dateLabel(health.data.window.end)}</p>}
          </div>
          <p>Coverage measures enrolled devices with a recent heartbeat. Missing observations or permissions limit what workflow recommendations can support.</p>
        </div>
        <div className="panels">
          <section className="panel"><h2>Enrolled devices</h2>
            {health.data.devices.length === 0 && <p>No synthetic devices seeded.</p>}
            <ul className="entity-list">{health.data.devices.map(item => <li key={item.id}>
              <button type="button" aria-pressed={item.id === active} onClick={() => setSelected(item.id)}>
                <strong>{item.label}</strong><small>{item.reporting ? 'Reporting' : 'Offline'} · {item.permission} permissions</small>
              </button>
            </li>)}</ul>
          </section>
          <section className="panel"><h2>{device?.label ?? 'Device history'}</h2>
            {details.error && <p role="alert">{details.error} <button className="secondary" onClick={details.retry}>Retry</button></p>}
            {!device && !details.error && <p role="status">{active ? 'Loading device…' : 'Select a device to inspect it.'}</p>}
            {device && <>
              <dl><dt>Team</dt><dd>{device.team}</dd>
                <dt>Enrolled</dt><dd>{dateLabel(device.enrolledAt)}</dd>
                <dt>Heartbeat</dt><dd>{device.lastHeartbeat ? dateLabel(device.lastHeartbeat) : 'None'}</dd>
                <dt>Last observation</dt><dd>{device.lastObservation ? dateLabel(device.lastObservation) : 'None'}</dd>
                <dt>Permission</dt><dd>{device.permission}</dd>
                <dt>Evidence freshness</dt><dd>{device.freshness}</dd>
              </dl>
              <h3>Missing observation intervals</h3>
              {device.missingIntervals.length ? <ul>{device.missingIntervals.map(item => (
                <li key={item.start}>{dateLabel(item.start)} to {dateLabel(item.end)}</li>
              ))}</ul> : <p>Every observed hour contains a successful observation.</p>}
              <details><summary>Activity history ({device.history.length})</summary>
                <ol className="history">{[...device.history].reverse().map((event, index) => (
                  <li key={index}>{event.kind === 'permission' ? (event.permissionOk ? 'Permissions granted' : 'Permissions limited') : event.kind}
                    <small>{dateLabel(event.at)}</small></li>
                ))}</ol>
              </details>
            </>}
          </section>
        </div>
      </>}
  </>;
}
