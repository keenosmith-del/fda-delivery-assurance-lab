import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ADOPTION_OBSERVATIONS } from '../../../shared/contracts/adoption-assurance.ts';
import { FDA_EVENTS } from '../../../shared/contracts/fda-ingestion.ts';

type Role = 'viewer' | 'operator' | 'demo';
export interface HostedAccess {
  origin: string;
  viewer: string;
  operator: string;
  demo?: string;
  limits?: { anonymous: number; authenticated: number; writes: number };
}

const hash = (value: string) => createHash('sha256').update(value).digest();
const safeMethods = new Set(['GET', 'HEAD']);
const probes = new Set(['/api/health', '/api/ready']);

export function installSecurity(app: FastifyInstance, access?: HostedAccess) {
  const roles = new WeakMap<FastifyRequest, Role>();
  const passwords = new Map<string, Buffer>();
  if (access) {
    passwords.set('viewer', hash(access.viewer));
    passwords.set('operator', hash(access.operator));
    if (access.demo) passwords.set('demo', hash(access.demo));
  }
  const counts = new Map<string, number>();
  let windowStart = performance.now();
  const limits = access?.limits ?? { anonymous: 30, authenticated: 240, writes: 40 };
  const dummy = hash('unassigned');
  const consume = (key: string, max: number) => {
    if (performance.now() - windowStart >= 60_000) {
      counts.clear();
      windowStart = performance.now();
    }
    const next = (counts.get(key) ?? 0) + 1;
    if (next > max) return false;
    counts.set(key, next);
    return true;
  };

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers({
      'cache-control': 'no-store',
      'x-request-id': request.id,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (access) reply.headers({
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
    });
    return payload;
  });

  if (access) app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0];
    // The exact POST has its own mandatory credential gate before body parsing.
    if (request.method === 'POST' && [FDA_EVENTS, ADOPTION_OBSERVATIONS].includes(request.routeOptions.url ?? '')) return;
    const isRead = safeMethods.has(request.method);
    if (isRead && probes.has(pathname)) return;
    const token = request.headers.authorization;
    const encoded = token?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1];
    const match = encoded && Buffer.from(encoded, 'base64').toString('utf8').match(/^(viewer|operator|demo):([^\r\n]{1,128})$/);
    const role = match ? match[1] as Role : undefined;
    const expected = role && passwords.get(role);
    const valid = timingSafeEqual(hash(match ? match[2] : ''), expected || dummy) && Boolean(expected);
    if (!valid || !role) {
      if (!consume('anonymous', limits.anonymous)) return reply.header('retry-after', '60').code(429).send({ error: 'RATE_LIMITED' });
      return reply.header('www-authenticate', 'Basic realm="FDA private workspace", charset="UTF-8"')
        .code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
    }
    const limit = isRead ? limits.authenticated : limits.writes;
    if (!consume(`${role}:${isRead}`, limit)) return reply.header('retry-after', '60').code(429).send({ error: 'RATE_LIMITED' });
    const origin = request.headers.origin;
    if ((!isRead && origin !== access.origin) || (origin !== undefined && origin !== access.origin)) {
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    }
    if ((!isRead || pathname === '/api/ops/status') && role === 'viewer') {
      return reply.code(403).send({ error: 'INSUFFICIENT_ACCESS' });
    }
    roles.set(request, role);
  });

  return {
    role: (request: FastifyRequest) => roles.get(request),
    mayInject: (request: FastifyRequest) => !access || roles.get(request) === 'demo',
  };
}
