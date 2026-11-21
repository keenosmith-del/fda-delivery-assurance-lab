import type { Database } from '../../backend/src/db/pool.ts';
import { transaction } from '../../backend/src/db/pool.ts';
import type { SuitabilityInputs } from '../../shared/contracts/intelligence.ts';

const start = Date.parse('2026-11-20T08:00:00Z');
const hour = 3_600_000;
const at = (hours: number) => new Date(start + hours * hour).toISOString();

const tasks = [
  { id: 'ats-intake', label: 'Candidate intake', category: 'Recruiting', sequence: ['ATS / open requisition', 'ATS / validate candidate', 'ATS / save submission'], count: 14, deviation: 6, inputs: [95, 18, 90, 90, 44, 30, 28, 89] },
  { id: 'weekly-digest', label: 'Weekly pipeline digest', category: 'Operations', sequence: ['ATS / export counts', 'Sheets / reconcile pipeline', 'Email / prepare digest'], count: 9, deviation: 8, inputs: [86, 20, 85, 82, 27, 20, 25, 77] },
  { id: 'offer-review', label: 'Candidate offer review', category: 'Recruiting', sequence: ['ATS / inspect feedback', 'Docs / review offer', 'Email / request approval'], count: 12, deviation: 6, inputs: [55, 95, 32, 65, 82, 87, 55, 73] },
  { id: 'calendar-reminder', label: 'Interview reminder', category: 'Recruiting', sequence: ['Calendar / find interview', 'ATS / verify status', 'Email / draft reminder'], count: 11, deviation: 11, inputs: [94, 15, 87, 86, 34, 24, 25, 79] },
  { id: 'client-escalation', label: 'Client escalation triage', category: 'Client success', sequence: ['Inbox / open escalation', 'CRM / review account', 'Slack / notify owner'], count: 5, deviation: 2, inputs: [37, 93, 55, 45, 64, 92, 67, 85] },
  { id: 'contact-sync', label: 'Update contact directories', category: 'Operations', sequence: ['CRM / review contact', 'Sheets / compare directory', 'CRM / update contact'], count: 2, deviation: 2, inputs: [92, 14, 80, 85, 47, 39, 32, 74] },
] as const;

export async function seedIntelligence(pool: Database) {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(731820002)');
    await client.query("INSERT INTO lab_observation_windows VALUES ('lab-day', $1, $2) ON CONFLICT DO NOTHING", [at(0), at(24)]);
    for (let n = 1; n <= 9; n++) {
      const id = `device-${n}`;
      const team = n <= 4 ? 'Recruiting' : n <= 7 ? 'Operations' : 'Client success';
      await client.query('INSERT INTO lab_devices VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [id, `Workstation ${String(n).padStart(2, '0')}`, team, 'lab-day', at(-24)]);
      const events = [{ key: 'permission-start', time: 0, kind: 'permission', ok: true as boolean | null }];
      if (n === 7) events.push({ key: 'permission-limited', time: 15, kind: 'permission', ok: false });
      for (let slot = 0; slot < (n <= 7 ? 24 : n === 8 ? 13 : 0); slot++) {
        if ((slot + n) % 13 === 0 && slot < 23) continue;
        events.push({ key: `heartbeat-${slot}`, time: slot + .2, kind: 'heartbeat', ok: null });
        if (n !== 7 || slot < 15) {
          events.push({ key: `observation-${slot}`, time: slot + .25, kind: 'observation', ok: null });
        }
      }
      for (const event of events) {
        await client.query('INSERT INTO lab_device_events VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [`${id}-${event.key}`, id, at(event.time), event.kind, event.ok]);
      }
    }

    for (const task of tasks) {
      const [determinism, judgment, permissions, integration, sensitivity, risk, complexity, value] = task.inputs;
      const inputs: SuitabilityInputs = { determinism, judgment, permissions, integration, sensitivity, risk, complexity, value };
      await client.query('INSERT INTO lab_tasks VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING',
        [task.id, task.label, task.category, [...task.sequence], JSON.stringify(inputs)]);
      for (let i = 0; i < task.count; i++) {
        const sequence: string[] = [...task.sequence];
        const deviation = (i + 1) % task.deviation === 0;
        if (deviation) sequence[1] = 'Notes / manual verification';
        await client.query('INSERT INTO lab_workflow_events VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
          [`${task.id}-${i + 1}`, task.id, `device-${1 + (i % 6)}`, at(1 + i), sequence, 85 + i * 11, deviation]);
      }
    }
  });
}
