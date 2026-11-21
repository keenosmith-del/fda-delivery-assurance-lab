import { useEffect, useState } from 'react';
import type { ZodType } from 'zod';

export async function jsonRequest<T>(path: string, schema: ZodType<T>, init?: RequestInit) {
  const deadline = AbortSignal.timeout(8000);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const response = await fetch(path, { ...init, signal });
  if (response.status === 401) throw new Error('Enter a valid operator write token.');
  if (!response.ok) throw new Error(`Request returned HTTP ${response.status}.`);
  return schema.parse(await response.json());
}

export function useResource<T>(path: string | null, schema: ZodType<T>) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void jsonRequest(path, schema, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setResult({ path, data }); },
      error => {
        if (!controller.signal.aborted) setResult({ path, error: error instanceof Error ? error.message : 'Request failed.' });
      },
    );
    return () => controller.abort();
  }, [path, revision, schema]);
  return {
    data: result?.path === path ? result?.data : undefined,
    error: result?.path === path ? result?.error : undefined,
    refresh: () => setRevision(n => n + 1),
    retry: () => { setResult(null); setRevision(n => n + 1); },
  };
}
