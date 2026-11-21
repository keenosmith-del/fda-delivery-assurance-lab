import { operation } from '../../../shared/contracts/submissions.ts';
import type { Submission } from '../../../shared/contracts/submissions.ts';

export async function readOperation(id: string) {
  const response = await fetch(`/api/operations/${id}`, { signal: AbortSignal.timeout(5_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Operation lookup returned HTTP ${response.status}.`);
  return operation.parse(await response.json());
}

export async function sendSubmission(id: string, input: Submission, token: string, fault?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': id,
  };
  if (fault) headers['x-lab-fault'] = fault;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch('/api/submissions', {
    method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(7_000),
  });
  if (response.ok) operation.parse(await response.json());
  return response.status;
}
