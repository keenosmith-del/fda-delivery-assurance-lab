import { z } from 'zod';
import { SIMULATOR_API, simulatorRecord } from '../../../../shared/contracts/downstream.ts';
import type { SimulatorRecord, SimulatorWrite } from '../../../../shared/contracts/downstream.ts';

type Dispatch =
  | { kind: 'acknowledged'; status: number; outcome: 'committed' | 'replay' }
  | { kind: 'uncertain'; code: string; status?: number; retryAfter?: number }
  | { kind: 'rejected'; code: string; status: number };
type Lookup =
  | { kind: 'found'; record: SimulatorRecord }
  | { kind: 'absent' | 'pending'; status: number }
  | { kind: 'unavailable'; code: string; status?: number };

export interface DownstreamAdapter {
  dispatch(input: SimulatorWrite): Promise<Dispatch>;
  lookup(key: string): Promise<Lookup>;
}

export const labToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const acknowledgement = z.strictObject({ outcome: z.enum(['committed', 'replay']) });

export function simulatorOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== value) {
    throw new Error('The synthetic destination must be a canonical HTTP origin on loopback with an explicit port.');
  }
  return url.origin;
}

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) throw new Error('SIMULATOR_RESPONSE_LIMIT');
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function retryAfter(value: string | null) {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(60_000, ms) : undefined;
}

export function httpSimulatorAdapter(target: string, token: string, timeoutMs = 1_500, sendRequest = fetch): DownstreamAdapter {
  const origin = simulatorOrigin(target);
  const headers = { authorization: `Bearer ${labToken.parse(token)}`, accept: 'application/json' };
  const send = (path: string, options: RequestInit) => sendRequest(origin + SIMULATOR_API + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  });

  return {
    async dispatch(input) {
      try {
        const response = await send('', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(input) });
        if (response.ok) {
          const ack = acknowledgement.safeParse(await boundedJson(response));
          return ack.success ? { kind: 'acknowledged', status: response.status, outcome: ack.data.outcome }
            : { kind: 'uncertain', code: 'INVALID_ACKNOWLEDGMENT', status: response.status };
        }
        await response.body?.cancel();
        if ([400, 401, 403, 409, 413, 422].includes(response.status)) {
          return { kind: 'rejected', code: response.status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'DOWNSTREAM_REJECTED',
            status: response.status };
        }
        return { kind: 'uncertain', code: response.status === 429 ? 'RATE_LIMITED' : 'DISPATCH_UNCONFIRMED',
          status: response.status, retryAfter: retryAfter(response.headers.get('retry-after')) };
      } catch {
        return { kind: 'uncertain', code: 'ACKNOWLEDGMENT_UNAVAILABLE' };
      }
    },
    async lookup(key) {
      try {
        const response = await send('/' + encodeURIComponent(key), { headers });
        if (response.status === 200) {
          const match = simulatorRecord.safeParse(await boundedJson(response));
          return match.success ? { kind: 'found', record: match.data }
            : { kind: 'unavailable', code: 'INVALID_EFFECT_RESPONSE', status: response.status };
        }
        await response.body?.cancel();
        if (response.status === 404) return { kind: 'absent', status: 404 };
        if (response.status === 202) return { kind: 'pending', status: 202 };
        return { kind: 'unavailable', code: 'VERIFICATION_UNAVAILABLE', status: response.status };
      } catch {
        return { kind: 'unavailable', code: 'VERIFICATION_UNAVAILABLE' };
      }
    },
  };
}
