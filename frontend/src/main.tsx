import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Reliability } from './features/ats-reliability/Reliability.tsx';
import { Discover } from './features/workflow-evidence/Discover.tsx';
import { AgentHealth } from './features/agent-health/AgentHealth.tsx';
import { Adoption } from './features/adoption/Adoption.tsx';
import { Outcomes } from './features/outcomes/Outcomes.tsx';
import { FdaIntegration, ImportedAgentHealth, ImportedWorkflowEvidence } from './features/fda-integration/FdaIntegration.tsx';
import './styles/app.css';

const routes = [
  { id: 'overview', label: 'Overview', view: Overview },
  { id: 'fda-integration', label: 'FDA Integration', view: FdaIntegration },
  { id: 'discover', label: 'Discover', view: Discover },
  { id: 'ats-reliability', label: 'ATS Reliability', view: Reliability },
  { id: 'agent-health', label: 'Agent Health', view: AgentHealth },
  { id: 'adoption', label: 'Adoption Diagnostics', view: Adoption },
  { id: 'outcomes', label: 'Outcome Verification', view: Outcomes },
] as const;

function Overview() {
  const descriptions = [
    'Inspect simulated source ingestion, canonical records and processing receipts.',
    'Inspect observed task sequences, scoring factors and review decisions.',
    'Trace submissions through commitment, acknowledgment loss and safe recovery.',
    'Inspect synthetic endpoint history, permissions and observation gaps.',
    'Diagnose usage barriers, record interventions and compare follow-up measurements.',
    'Inspect opportunity models, execution costs and the evidence for measured outcomes.',
  ];
  return <>
    <section className="heading"><h1>Delivery Assurance</h1>
      <p>Investigate how workflow evidence supports an automation decision and verify how the submission system recovers from failure.</p></section>
    <div className="overview-grid">{routes.slice(1).map(({ id, label }, index) => (
      <section className="panel" key={id}><h2><a href={`#${id}`}>{label}</a></h2><p>{descriptions[index]}</p></section>
    ))}</div>
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
  return <div className="workspace">
    <header className="masthead">
      <div className="brand"><span className="brand-mark" aria-hidden="true">fda</span> Delivery Assurance Lab</div>
      <span className="environment"><span aria-hidden="true" /> Synthetic data</span>
    </header>
    <nav className="navigation" aria-label="Workspace">
      {routes.map(route => <a href={`#${route.id}`} key={route.id} aria-current={active.id === route.id ? 'page' : undefined}>{route.label}</a>)}
    </nav>
    <main><View receiptId={receiptId} incidentId={params.get('incident') ?? undefined}
      windowId={params.get('window') ?? undefined} workflowId={params.get('workflow') ?? undefined} /></main>
    <footer>Independent engineering assessment</footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
