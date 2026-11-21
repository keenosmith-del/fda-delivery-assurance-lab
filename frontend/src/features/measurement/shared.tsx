import { useState } from 'react';
import type { ReactNode } from 'react';
import { automationList } from '../../../../shared/contracts/measurement.ts';
import { useResource } from '../../lib/resource.ts';

export const percent = (value: number | null) => value === null ? 'Unavailable' :
  new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(value);
export const minutes = (seconds: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(seconds / 60)} min`;

export function AutomationPicker({ children }: { children: (id: string) => ReactNode }) {
  const [choice, setChoice] = useState('');
  const items = useResource('/api/automations', automationList);
  const active = choice || items.data?.[0]?.id;
  if (items.error) return <p role="alert">{items.error} <button className="secondary" onClick={items.retry}>Retry</button></p>;
  if (!items.data) return <p role="status">Loading automations…</p>;
  if (!active) return <p>No automation fixtures available.</p>;
  return <>
    <div className="panel picker">
      <label htmlFor="automation">Automation</label>
      <select id="automation" value={active} onChange={event => setChoice(event.target.value)}>
        {items.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    {children(active)}
  </>;
}
