import { z } from 'zod';
import { operationId, scenarios, submission } from '../../../../shared/contracts/submissions.ts';
import type { Operation, Scenario, Submission } from '../../../../shared/contracts/submissions.ts';
import { readOperation, sendSubmission } from '../../lib/api.ts';

export const scenarioLabels: Record<Scenario, string> = {
  normal: 'Normal submission',
  'repeat-click': 'Repeated submit',
  replay: 'Identical replay',
  conflict: 'Conflicting replay',
  concurrent: 'Concurrent requests',
  'before-commit': 'Timeout before commit',
  'lost-ack': 'Lost acknowledgment',
};

export interface Attempt {
  id: string;
  input: Submission;
  token: string;
  scenario: Scenario;
}
const attemptSchema = z.strictObject({ id: operationId, input: submission, scenario: scenarios });
const storageKey = 'fda-current-operation';

export function readSavedAttempt(): Attempt | null {
  try {
    const saved = attemptSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'));
    return saved.success ? { ...saved.data, token: '' } : null;
  } catch {
    return null;
  }
}

export function saveAttempt({ id, input, scenario }: Attempt) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ id, input, scenario }));
  } catch {
    // The current page can still recover the operation if browser storage is blocked.
  }
}

export interface Step {
  action: string;
  result: string;
}
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export async function inspectOperation(id: string) {
  let result = await readOperation(id);
  for (const delay of [200, 350, 650, 1000, 1500, 2000]) {
    if (result?.state !== 'pending_confirmation') break;
    await wait(delay);
    result = await readOperation(id);
  }
  return result;
}

export async function executeScenario(attempt: Attempt, addStep: (step: Step) => void, recover = false): Promise<Operation | null> {
  const { id, input, token, scenario } = attempt;
  const initial = await readOperation(id);
  addStep({ action: 'Authoritative lookup', result: initial ? initial.state : 'No operation exists for this ID' });
  const submit = async (name: string, payload = input, fault?: string, expectedError?: number) => {
    const status = await sendSubmission(id, payload, token, fault);
    addStep({ action: name, result: `HTTP ${status}` });
    if (status !== expectedError && status !== 200 && status !== 202) {
      throw new Error(`The submission returned HTTP ${status}. Check the operation before retrying.`);
    }
    if (expectedError && expectedError !== status) {
      throw new Error(`Expected HTTP ${expectedError}, received HTTP ${status}.`);
    }
  };

  if (recover) {
    if (!initial) await submit('Retry with the original operation ID');
  } else if (scenario === 'concurrent' || scenario === 'repeat-click') {
    const requests = await Promise.allSettled([submit('Request A'), submit('Request B')]);
    const failure = requests.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  } else if (scenario === 'before-commit' || scenario === 'lost-ack') {
    await submit(scenarioLabels[scenario], input, scenario, 504);
    const afterFault = await readOperation(id);
    addStep({
      action: 'Lookup after timeout',
      result: afterFault ? 'Commit found in PostgreSQL' : 'Operation absent after rollback',
    });
    await submit('Replay with the original operation ID');
  } else {
    await submit('Submit');
    if (scenario === 'replay') await submit('Replay with the original payload');
    if (scenario === 'conflict') {
      const requisition = input.requisition === 'engineering' ? 'operations' : 'engineering';
      await submit('Replay with a different requisition', { ...input, requisition }, undefined, 409);
    }
  }
  return inspectOperation(id);
}

export function syntheticCandidate() {
  const number = crypto.getRandomValues(new Uint32Array(1))[0];
  return `CAND-${String(number).padStart(10, '0')}`;
}
