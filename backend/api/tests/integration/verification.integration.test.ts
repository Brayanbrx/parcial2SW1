import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';
import { hashRefreshToken, createRefreshToken } from '../../src/modules/auth/tokens.js';

describe('activación por correo', () => {
  let api: Harness;
  beforeAll(async () => {
    api = await startHarness();
  }, 180_000);
  afterAll(async () => {
    await api?.stop();
  });
  const password = 'contrasena-de-prueba';
  const register = (email: string) =>
    api.request('POST', '/auth/register', {
      body: { email, displayName: 'Verificación', password },
    });
  const tokenFor = (email: string) =>
    api.mails.findLast((m) => m.to === email)?.text.match(/#token=([^\s]+)/)?.[1] as string;
  const confirm = (token: string) =>
    api.request('POST', '/auth/verification/confirm', { body: { token } });
  const resend = (email: string) =>
    api.request('POST', '/auth/verification/resend', { body: { email } });

  it('almacena solo el hash, no concede acceso y consume el enlace una sola vez incluso en paralelo', async () => {
    const email = 'verify@example.com';
    await register(email);
    const token = tokenFor(email);
    const user = await api.app.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerificationTokenHash).toBe(hashRefreshToken(token));
    expect(user.emailVerifiedAt).toBeNull();
    expect(api.mails.at(-1)?.text).toContain('http://localhost:5173/activar#token=');
    expect(await api.app.prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    const access = await api.app.tokens.signAccessToken({ userId: user.id, email });
    expect((await api.request('GET', '/projects', { token: access })).status).toBe(401);
    const refresh = createRefreshToken();
    await api.app.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: new Date(Date.now() + 60000) },
    });
    expect(
      (await api.request('POST', '/auth/refresh', { cookie: `uml_refresh=${refresh.token}` }))
        .status,
    ).toBe(401);
    const attempts = await Promise.all([confirm(token), confirm(token)]);
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await confirm(token)).status).toBe(400);
    expect((await api.request('POST', '/auth/login', { body: { email, password } })).status).toBe(
      200,
    );
  });

  it('rechaza enlaces caducados e inventados; reenviar rota el enlace y aplica espera por cuenta', async () => {
    const email = 'expire@example.com';
    await register(email);
    const old = tokenFor(email);
    const before = api.mails.length;
    await resend(email);
    expect(api.mails).toHaveLength(before);
    await api.app.prisma.user.update({
      where: { email },
      data: { emailVerificationExpiresAt: new Date(0), emailVerificationSentAt: new Date(0) },
    });
    expect((await confirm(old)).status).toBe(400);
    expect((await confirm('inventado'.repeat(8))).status).toBe(400);
    await Promise.all([resend(email), resend(email)]);
    expect(api.mails).toHaveLength(before + 1);
    const fresh = tokenFor(email);
    expect(fresh).not.toBe(old);
    expect((await confirm(old)).status).toBe(400);
    expect((await confirm(fresh)).status).toBe(200);
    const activated = await resend(email);
    const missing = await resend('missing@example.com');
    expect(activated.status).toBe(202);
    expect(activated.body).toEqual(missing.body);
    expect(api.mails).toHaveLength(before + 1);
  });

  it('un fallo de correo conserva la cuenta pendiente y permite reintentar sin perder el enlace anterior', async () => {
    const email = 'retry@example.com';
    const send = vi.spyOn(api.mail, 'send').mockRejectedValueOnce(new Error('offline'));
    try {
      const result = await register(email);
      expect(result.status).toBe(201);
      expect(result.body).toEqual({ verificationRequired: true, emailSent: false });
      await resend(email);
      const old = tokenFor(email);
      await api.app.prisma.user.update({
        where: { email },
        data: { emailVerificationSentAt: new Date(0) },
      });
      send.mockRejectedValueOnce(new Error('offline'));
      expect((await resend(email)).status).toBe(202);
      expect((await confirm(old)).status).toBe(200);
    } finally {
      send.mockRestore();
    }
  });
});
