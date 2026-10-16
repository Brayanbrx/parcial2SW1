import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

const base = {
  NODE_ENV: 'test',
  RATE_LIMIT_ENABLED: 'true',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  JWT_SECRET: 'a'.repeat(64),
  RATE_LIMIT_MAX: '100',
  AUTH_RATE_LIMIT_MAX: '2',
  WORK_RATE_LIMIT_MAX: '2',
};
const production = {
  ...base,
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://uml.example.org',
  COOKIE_SECURE: 'true',
  MAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'test-mail-key',
  MAIL_FROM: 'mail@example.org',
};
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('production safeguards', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows %s preflight from the configured HTTPS origin',
    async (method) => {
      const origin = 'https://uml.asiscarretera.online';
      app = await buildApp(loadConfig({ ...base, WEB_ORIGIN: origin }));
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/projects',
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(
        String(response.headers['access-control-allow-methods'])
          .split(',')
          .map((value) => value.trim()),
      ).toContain(method);
      expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
        'authorization',
      );
      expect(String(response.headers.vary).toLowerCase()).toContain('origin');
    },
  );
  it.each([
    'https://asiscarretera.online',
    'http://uml.asiscarretera.online',
    'https://35.255.28.222',
    'https://uml.asiscarretera.online.evil.test',
    'null',
  ])('does not grant CORS to %s', async (origin) => {
    app = await buildApp(loadConfig({ ...base, WEB_ORIGIN: 'https://uml.asiscarretera.online' }));
    for (const method of ['GET', 'OPTIONS'] as const) {
      const response = await app.inject({
        method,
        url: '/health',
        headers: { origin, 'access-control-request-method': 'PATCH' },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
  it.each([
    ['COOKIE_SECURE', 'false'],
    ['WEB_ORIGIN', 'http://example.org'],
    ['WEB_ORIGIN', 'https://example.org/path'],
    ['JWT_SECRET', 'cambiar-'.repeat(10)],
    ['MAIL_PROVIDER', 'log'],
    ['BREVO_API_KEY', ''],
    ['MAIL_FROM', 'mail@demo.local'],
  ])('rejects unsafe %s=%s', (field, value) => {
    expect(() => loadConfig({ ...production, [field]: value })).toThrow(field);
  });
  it('accepts a complete production configuration', () => {
    expect(loadConfig(production).COOKIE_SECURE).toBe(true);
  });
  it('limits authentication across routes and ignores forged forwarding headers by default', async () => {
    app = await buildApp(loadConfig(base));
    const send = (url: string, ip: string) =>
      app!.inject({ method: 'POST', url, payload: {}, headers: { 'x-forwarded-for': ip } });
    expect((await send('/auth/login', '1.1.1.1')).statusCode).toBe(400);
    expect((await send('/auth/register', '2.2.2.2')).statusCode).toBe(400);
    const blocked = await send('/auth/password/forgot', '3.3.3.3');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limit_exceeded');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
  it('trusts only the closest forwarded hop, keeping distinct clients separate', async () => {
    app = await buildApp(loadConfig({ ...base, TRUST_PROXY_HOPS: '1', RATE_LIMIT_MAX: '1' }));
    const send = (forwarded: string) =>
      app!.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {},
        headers: { 'x-forwarded-for': forwarded },
      });
    expect((await send('fake-a, 192.0.2.1')).statusCode).toBe(400);
    expect((await send('fake-b, 192.0.2.1')).statusCode).toBe(429);
    expect((await send('fake-a, 192.0.2.2')).statusCode).toBe(400);
  });
  it('applies the shared authentication rate limit to activation and resend', async () => {
    app = await buildApp(loadConfig(base));
    const send = (url: string) => app!.inject({ method: 'POST', url, payload: {} });
    expect((await send('/auth/verification/confirm')).statusCode).toBe(400);
    expect((await send('/auth/verification/resend')).statusCode).toBe(400);
    expect((await send('/auth/verification/resend')).statusCode).toBe(429);
  });
  it('shares work quota across boards and IPs for the same authenticated user', async () => {
    app = await buildApp(loadConfig(base));
    vi.spyOn(app.prisma.user, 'findUnique').mockResolvedValue({ sessionVersion: 0 } as never);
    app.post('/boards/:id/assistant/test', { preHandler: app.authenticate }, async () => ({
      ok: true,
    }));
    app.post('/boards/:id/import/test', { preHandler: app.authenticate }, async () => ({
      ok: true,
    }));
    const token = await app.tokens.signAccessToken({ userId: 'user-a', email: 'a@example.org' });
    const send = (url: string, tokenValue: string, ip: string) =>
      app!.inject({
        method: 'POST',
        url,
        remoteAddress: ip,
        headers: { authorization: `Bearer ${tokenValue}` },
      });
    expect((await send('/boards/a/assistant/test', token, '192.0.2.1')).statusCode).toBe(200);
    expect((await send('/boards/b/import/test', token, '192.0.2.2')).statusCode).toBe(200);
    expect((await send('/boards/c/assistant/test', token, '192.0.2.3')).statusCode).toBe(429);
    const other = await app.tokens.signAccessToken({ userId: 'user-b', email: 'b@example.org' });
    expect((await send('/boards/a/import/test', other, '192.0.2.1')).statusCode).toBe(200);
  });
  it('readiness returns 503 when the database is unavailable while liveness remains 200', async () => {
    app = await buildApp(loadConfig(base));
    vi.spyOn(app.prisma, '$queryRaw').mockRejectedValue(new Error('offline'));
    expect((await app.inject('/ready')).statusCode).toBe(503);
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
  it('readiness checks the collaboration dependency as well', async () => {
    app = await buildApp(loadConfig(base));
    vi.spyOn(app.prisma, '$queryRaw').mockResolvedValue([{ value: 1 }]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }));
    expect((await app.inject('/ready')).statusCode).toBe(503);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect((await app.inject('/ready')).statusCode).toBe(200);
  });
});
