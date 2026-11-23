import { z } from 'zod';
import { FDA_GATEWAY, fdaAgentProjection, fdaReceipt, fdaRecordLink, fdaStatus, fdaWorkflowProjection } from '../../../../shared/contracts/fda-ingestion.ts';
import { dateLabel } from '../../lib/dates.ts';
import { useResource } from '../../lib/resource.ts';

type ReceiptLink = z.infer<typeof fdaRecordLink>;

function ReceiptLinks({ records }: { records: ReceiptLink[] }) {
  return <ul>{records.map(record => <li key={record.id}>
    <a href={`#fda-integration?receipt=${record.id}`}>{record.sourceRecordId}</a> · {record.recordType}
  </li>)}</ul>;
}

export function FdaIntegration({ receiptId }: { receiptId?: string }) {
  const status = useResource(`${FDA_GATEWAY}/status`, fdaStatus);
  const current = receiptId ?? status.data?.receipts[0]?.id;
  const detail = useResource(current ? `${FDA_GATEWAY}/receipts/${encodeURIComponent(current)}` : null, fdaReceipt);
  const receipt = detail.data;
  const data = status.data;
  return <>
    <section className="heading"><h1>FDA Integration</h1><p>Inspect simulated FDA data ingestion, source validation and operational evidence.</p></section>
    {status.error && <p role="alert">{status.error} <button className="secondary" onClick={status.retry}>Retry</button></p>}
    {!data && !status.error && <p role="status">Loading ingestion status…</p>}
    {data && <>
      <section className="panel">
        <h2>Synthetic source</h2>
        <dl><dt>Connection</dt><dd>{data.connection}</dd>
          <dt>Scope</dt><dd>{data.tenantId} / {data.sourceId}</dd>
          <dt>Contract</dt><dd>{data.schemaVersion}</dd>
          <dt>Status</dt><dd>{data.sourceStatus === 'active' ? 'Records received' : data.sourceStatus === 'disabled' ? 'Source ingestion disabled' : 'Awaiting import'}</dd>
          <dt>Last successful ingestion</dt><dd>{data.lastSuccessful ? dateLabel(data.lastSuccessful) : 'None'}</dd>
          <dt>Accepted records</dt><dd>{data.acceptedRecords}</dd>
          <dt>Duplicates</dt><dd>{data.counts.duplicate}</dd>
          <dt>Rejected records</dt><dd>{data.counts.rejected}</dd>
          <dt>Conflicts</dt><dd>{data.counts.conflict}</dd>
          <dt>Processing failures</dt><dd>{data.counts.processing_failed}</dd>
        </dl>
        <details><summary>Supported record categories</summary><ul>{data.categories.map(category => <li key={category}>{category}</li>)}</ul></details>
        <button className="secondary" type="button" onClick={() => { status.refresh(); detail.refresh(); }}>Refresh ingestion</button>
      </section>
      <div className="panels">
        <section className="panel"><h2>Latest ingestion receipts</h2>
          {data.receipts.length === 0 ? <p>No deliveries recorded.</p> : <ul className="history">{data.receipts.map(item => (
            <li key={item.id}><a aria-current={item.id === current ? 'true' : undefined} href={`#fda-integration?receipt=${item.id}`}>
              {item.sourceRecordId ?? 'Unidentified record'} · {item.status.replaceAll('_', ' ')}
            </a><small>{dateLabel(item.receivedAt)}</small></li>
          ))}</ul>}
        </section>
        <section className="panel"><h2>Receipt details</h2>
          {detail.error && <p role="alert">{detail.error} <button className="secondary" onClick={detail.retry}>Retry</button></p>}
          {current && !receipt && !detail.error && <p role="status">Loading receipt…</p>}
          {receipt && <>
            <dl>
              <dt>Receipt ID</dt><dd>{receipt.id}</dd>
              <dt>Source record</dt><dd>{receipt.sourceRecordId ?? 'Unavailable'}</dd>
              <dt>Record type</dt><dd>{receipt.recordType ?? 'Unavailable'}</dd>
              <dt>Contract</dt><dd>{receipt.schemaVersion ?? 'Unavailable'}</dd>
              <dt>Scope</dt><dd>{receipt.tenantId} / {receipt.sourceId}</dd>
              <dt>Event occurred</dt><dd>{receipt.occurredAt ? dateLabel(receipt.occurredAt) : 'Unavailable'}</dd>
              <dt>Received</dt><dd>{dateLabel(receipt.receivedAt)}</dd>
              <dt>Processed</dt><dd>{receipt.processedAt ? dateLabel(receipt.processedAt) : 'Pending'}</dd>
              <dt>Validation</dt><dd>{receipt.validation}</dd>
              <dt>Status</dt><dd>{receipt.status.replaceAll('_', ' ')}</dd>
              <dt>Canonical record</dt><dd>{receipt.canonicalId ?? 'None'}</dd>
              <dt>Error code</dt><dd>{receipt.errorCode ?? 'None'}</dd>
              <dt>Source role</dt><dd>{receipt.actorRole}</dd>
              <dt>Source revision</dt><dd>{receipt.sourceRevision ?? 'Unavailable'}</dd>
              <dt>Correlation</dt><dd>{receipt.correlationId ?? 'Unavailable'}</dd>
              <dt>Receipt application revision</dt><dd>{receipt.applicationRevision ?? 'Unavailable'}</dd>
              <dt>Processing application revision</dt><dd>{receipt.processingRevision ?? 'Unavailable'}</dd>
              <dt>Fingerprint</dt><dd className="receipt-fingerprint">{receipt.payloadFingerprint}</dd>
            </dl>
            {receipt.canonicalId && <>
              {receipt.recordType?.startsWith('endpoint.') || receipt.recordType === 'observation.window'
                ? <a href={`#agent-health?dataset=fda&receipt=${receipt.id}`}>Open imported Agent Health</a>
                : receipt.recordType?.startsWith('workflow.')
                  ? <a href={`#discover?dataset=fda&receipt=${receipt.id}`}>Open imported Workflow Evidence</a>
                  : null}
            </>}
          </>}
        </section>
      </div>
    </>}
  </>;
}

export function ImportedAgentHealth({ receiptId }: { receiptId?: string }) {
  const resource = useResource(`${FDA_GATEWAY}/agent-health`, fdaAgentProjection);
  const health = resource.data;
  const focused = health?.devices.find(device => device.receipts.some(receipt => receipt.id === receiptId));
  return <>
    <section className="heading"><h1>Agent Health</h1><p>Simulated FDA publisher · <a href="#agent-health">View legacy fixtures</a></p></section>
    {resource.error && <p role="alert">{resource.error} <button className="secondary" onClick={resource.retry}>Retry</button></p>}
    {!health && !resource.error && <p role="status">Loading imported health…</p>}
    {health && <section className="panel">
      <h2>{health.reporting} of {health.devices.length} endpoints reporting</h2>
      {health.window ? <p>Assessment window {health.window.windowId} · {dateLabel(health.window.start)} to {dateLabel(health.window.end)}</p>
        : <p>No observation window received.</p>}
      {health.devices.map(device => <details key={device.endpointId} open={device.endpointId === focused?.endpointId || undefined}>
        <summary>{device.endpointId} · {device.reporting ? 'Reporting' : 'Offline'} · {device.capture} capture</summary>
        <dl>
          <dt>Operating system</dt><dd>{device.os}</dd>
          <dt>Agent version</dt><dd>{device.agentVersion}</dd>
          <dt>Heartbeat</dt><dd>{device.lastHeartbeat ? dateLabel(device.lastHeartbeat) : 'None'}</dd>
          <dt>Last observation</dt><dd>{device.lastObservation ? dateLabel(device.lastObservation) : 'None'}</dd>
          <dt>Evidence freshness</dt><dd>{device.evidenceFreshness}</dd>
          <dt>Evidence coverage</dt><dd>{device.evidenceComplete ? 'Complete' : 'Incomplete'}</dd>
          <dt>Diagnostics</dt><dd>{device.diagnostics.join(', ') || 'None reported'}</dd>
        </dl>
        <h3>Reported permissions</h3>
        {device.permissions.length ? <ul>{device.permissions.map(permission => <li key={permission.category}>
          {permission.category} · {permission.status} · consent reference {permission.consentReference}
        </li>)}</ul> : <p>Unknown</p>}
        <h3>Missing observation intervals</h3>
        {device.missingIntervals.length ? <ul>{device.missingIntervals.map(interval => (
          <li key={interval.start}>{dateLabel(interval.start)} to {dateLabel(interval.end)}</li>
        ))}</ul> : <p>Every eligible hour has a supporting observation.</p>}
        <h3>Ingestion provenance</h3><ReceiptLinks records={device.receipts} />
      </details>)}
    </section>}
  </>;
}

export function ImportedWorkflowEvidence({ receiptId }: { receiptId?: string }) {
  const resource = useResource(`${FDA_GATEWAY}/workflow-evidence`, fdaWorkflowProjection);
  return <>
    <section className="heading"><h1>Workflow Evidence</h1><p>Simulated FDA publisher · <a href="#discover">View legacy fixtures</a></p></section>
    {resource.error && <p role="alert">{resource.error} <button className="secondary" onClick={resource.retry}>Retry</button></p>}
    {!resource.data && !resource.error && <p role="status">Loading imported workflows…</p>}
    {resource.data?.length === 0 && <p>No workflow candidates received.</p>}
    {resource.data?.map(item => <details className="panel" key={item.candidate.workflowId}
      open={!receiptId || item.receipts.some(receipt => receipt.id === receiptId) || item.observations.some(o => o.receipt.id === receiptId) || undefined}>
      <summary>{item.candidate.workflowId} · {item.candidate.category}</summary>
      <p>Source estimate {item.candidate.frequency} {item.candidate.unit.replaceAll('-', ' ')}. Source recommendation {item.candidate.recommendation.replaceAll('-', ' ')}.</p>
      <h3>Observation windows</h3>
      <ul>{item.windows.map(window => <li key={window.windowId}>
        {window.windowId} · {dateLabel(window.start)} to {dateLabel(window.end)} · {window.completeness} coverage
      </li>)}</ul>
      {item.gaps.length > 0 && <><h3>Evidence gaps</h3><ul>{item.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></>}
      <h3>Supporting observations</h3>
      {item.observations.map(observation => <section className="observation" key={observation.observationId}>
        <strong>{observation.observationId}</strong>
        <p>{observation.endpointId} · {dateLabel(observation.observedAt)} · {observation.durationSeconds}s
          {observation.exception && ' · Exception'}{observation.deliveredLate && ' · Delayed observation'}</p>
        <ol>{observation.sequence.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <ReceiptLinks records={[observation.receipt]} />
      </section>)}
      <h3>Candidate and window provenance</h3><ReceiptLinks records={item.receipts} />
    </details>)}
  </>;
}
