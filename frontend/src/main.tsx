import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Reliability } from './features/ats-reliability/Reliability.tsx';
import { Discover } from './features/workflow-evidence/Discover.tsx';
import { AgentHealth } from './features/agent-health/AgentHealth.tsx';
import { DeliveryAdoption } from './features/adoption/DeliveryAdoption.tsx';
import { Adoption } from './features/adoption/Adoption.tsx';
import { DeliveryOutcome } from './features/outcomes/DeliveryOutcome.tsx';
import { Investigation } from './features/investigations/Investigation.tsx';
import { Outcomes } from './features/outcomes/Outcomes.tsx';
import { FdaIntegration, ImportedAgentHealth, ImportedWorkflowEvidence } from './features/fda-integration/FdaIntegration.tsx';
import { Workspace, PageHeader, Metrics, Metric } from './components/Workspace.tsx';
import { useResource } from './lib/resource.ts';
import { FDA_GATEWAY, fdaStatus, fdaAgentProjection, fdaWorkflowProjection } from '../../shared/contracts/fda-ingestion.ts';
import './styles/app.css';

const routes = [
  { id: 'overview', label: 'Overview', group: 'Workspace', view: Overview },
  { id: 'fda-integration', label: 'FDA Integration', group: 'Evidence', view: FdaIntegration },
  { id: 'discover', label: 'Discover', group: 'Evidence', view: Discover },
  { id: 'agent-health', label: 'Agent Health', group: 'Evidence', view: AgentHealth },
  { id: 'ats-reliability', label: 'ATS Reliability', group: 'Delivery', view: Reliability },
  { id: 'adoption', label: 'Adoption Diagnostics', group: 'Delivery', view: Adoption },
  { id: 'outcomes', label: 'Outcome Verification', group: 'Review', view: Outcomes },
  { id: 'investigations', label: 'Evidence Investigation', group: 'Review', view: Investigation },
] as const;

const stages = [
  { title: 'Inspect source evidence', items: [
    ['FDA Integration', 'Review ingestion, validation and source receipts.', '#fda-integration'],
    ['Agent Health', 'Check endpoint reporting, permissions and incidents.', '#agent-health?dataset=fda'],
  ] },
  { title: 'Assess and deliver', items: [
    ['Workflow Evidence', 'Review observations, engineering decisions and delivery cases.', '#discover?dataset=fda'],
    ['ATS Reliability', 'Test how a synthetic submission recovers from an interrupted request.', '#ats-reliability'],
    ['Adoption Diagnostics', 'Review adoption, interventions and follow-up measurements.', '#adoption?dataset=fda'],
  ] },
  { title: 'Verify and investigate', items: [
    ['Outcome Verification', 'Compare measured handling effort and reviewed outcomes.', '#outcomes?dataset=fda'],
    ['Evidence Investigation', 'Inspect citations and review advisory findings.', '#investigations'],
  ] },
] as const;

function Overview() {
  const source = useResource(FDA_GATEWAY + '/status', fdaStatus);
  const health = useResource(FDA_GATEWAY + '/agent-health', fdaAgentProjection);
  const workflows = useResource(FDA_GATEWAY + '/workflow-evidence', fdaWorkflowProjection);
  const count = (value: number | undefined, error?: string) => value?.toLocaleString() ?? (error ? 'Unavailable' : 'Loading…');

  return <>
    <PageHeader title="Delivery assurance" summary="Follow synthetic source evidence through engineering decisions, verified execution and outcome review."
      actions={<a className="button-link primary" href="#fda-integration">Inspect source</a>} />
    <section className="overview-live" aria-label="Synthetic source overview">
      <div className="overview-live-heading"><h2>Evidence at a glance</h2><a href="#fda-integration">View source activity</a></div>
      <Metrics>
        <Metric label="Accepted records" value={count(source.data?.acceptedRecords, source.error)} detail="FDA Integration" />
        <Metric label="Endpoints reporting" value={count(health.data?.reporting, health.error)} detail="Agent Health" />
        <Metric label="Workflow candidates" value={count(workflows.data?.length, workflows.error)} detail="Workflow Evidence" />
      </Metrics>
    </section>
    <section className="overview-journey" aria-label="Delivery workflow">
      <h2>Explore the delivery workflow</h2>
      <div className="journey-grid">{stages.map(stage => <article className="journey-card" key={stage.title}>
        <h3>{stage.title}</h3>
        <ul>{stage.items.map(([name, detail, href]) => <li key={href}>
          <a href={href}><strong>{name}</strong><span>{detail}</span></a>
        </li>)}</ul>
      </article>)}</div>
    </section>
  </>;
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function App() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1));
  const [routeId, query] = hash.split('?', 2);
  const params = new URLSearchParams(query);
  const receiptId = params.get('receipt') ?? undefined;
  const active = routes.find(route => route.id === routeId) ?? routes[0];
  const imported = params.get('dataset') === 'fda';
  const View = imported && active.id === 'agent-health' ? ImportedAgentHealth
    : imported && active.id === 'discover' ? ImportedWorkflowEvidence : active.view;
  return <Workspace routes={routes} current={active}>
    {active.id === 'investigations' ? <Investigation caseId={params.get('case') ?? undefined} investigationId={params.get('investigation') ?? undefined}
      workflowId={params.get('workflow') ?? undefined} search={query} /> : imported && active.id === 'adoption'
      ? <DeliveryAdoption caseId={params.get('case') ?? undefined} /> : imported && active.id === 'outcomes'
      ? <DeliveryOutcome caseId={params.get('case') ?? undefined} /> : <View receiptId={receiptId} incidentId={params.get('incident') ?? undefined}
        windowId={params.get('window') ?? undefined} workflowId={params.get('workflow') ?? undefined} />}
  </Workspace>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
