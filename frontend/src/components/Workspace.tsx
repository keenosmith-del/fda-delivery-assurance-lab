import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type WorkspaceRoute = { id: string; label: string; group: string };

export function Workspace({ routes, current, children }: { routes: readonly WorkspaceRoute[]; current: WorkspaceRoute; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusOnNavigation = useRef(false);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focusOnNavigation.current) {
      main.current?.focus();
      focusOnNavigation.current = false;
    }
  }, [current.id]);

  function select(route: WorkspaceRoute) {
    setExpanded(false);
    if (route.id !== current.id) focusOnNavigation.current = true;
    else main.current?.focus();
  }

  return <div className="workspace" data-workspace={current.id}>
    <a className="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to workspace content</a>
    <aside className="workspace-sidebar" onKeyDown={event => {
      if (event.key === 'Escape' && expanded) { setExpanded(false); toggle.current?.focus(); }
    }}>
      <header className="workspace-brand">
        <a href="#overview" onClick={() => select(routes[0]!)}>FDA Delivery Assurance Lab</a>
        <button type="button" className="secondary workspace-toggle" aria-expanded={expanded} aria-controls="workspace-navigation"
          ref={toggle} onClick={() => setExpanded(value => !value)}>Workspaces</button>
      </header>
      <nav id="workspace-navigation" className="navigation" aria-label="Workspace" data-open={expanded}>
        {Array.from(new Set(routes.map(route => route.group))).map(group => <div className="navigation-group" key={group}>
          <p>{group}</p>
          {routes.filter(route => route.group === group).map(route => <a key={route.id} href={'#' + route.id}
            aria-current={route.id === current.id ? 'page' : undefined} onClick={() => select(route)}>{route.label}</a>)}
        </div>)}
      </nav>
      <p className="workspace-footnote">Synthetic data</p>
    </aside>
    <div className="workspace-body">
      <div className="workspace-context">
        <span>{current.group}</span><span className="workspace-context-separator" aria-hidden="true" /><strong>{current.label}</strong>
        <span className="workspace-mobile-environment">Synthetic data</span>
      </div>
      <main ref={main} id="workspace-content" tabIndex={-1}>{children}</main>
      <footer>Independent engineering assessment</footer>
    </div>
  </div>;
}

export function PageHeader({ title, summary, actions }: { title: string; summary: string; actions?: ReactNode }) {
  return <header className="heading">
    <div><h1>{title}</h1><p>{summary}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Metrics({ children }: { children: ReactNode }) {
  return <dl className="metrics">{children}</dl>;
}

export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="metric-reading"><dt>{label}</dt><dd>{value}</dd>{detail && <dd className="metric-detail">{detail}</dd>}</div>;
}

export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div tabIndex={0} role="region" aria-label={label} className="table-scroll">{children}</div>;
}

export function SegmentLinks({ children, label }: { children: ReactNode; label: string }) {
  return <nav className="segment-links" aria-label={label}>{children}</nav>;
}
