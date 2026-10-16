import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { badRequest } from '../../lib/http-error.js';
import type { MailPort } from '../../lib/mail.js';
import { createRefreshToken, hashRefreshToken } from './tokens.js';

const emailBody = z.object({ email: z.string().trim().email().max(254) });
const tokenBody = z.object({ token: z.string().min(20).max(200) });
const LIFETIME_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;

/** Reserva el envío atómicamente para limitar también peticiones desde distintas IP. */
export async function sendVerification(
  app: FastifyInstance,
  config: Config,
  mail: MailPort,
  user: { id: string; email: string },
): Promise<boolean> {
  const previous = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const token = createRefreshToken();
  const now = new Date();
  const reserved = await app.prisma.user.updateMany({
    where: {
      id: user.id,
      emailVerifiedAt: null,
      OR: [
        { emailVerificationSentAt: null },
        { emailVerificationSentAt: { lte: new Date(now.getTime() - COOLDOWN_MS) } },
      ],
    },
    data: {
      emailVerificationTokenHash: token.hash,
      emailVerificationExpiresAt: new Date(now.getTime() + LIFETIME_MS),
      emailVerificationSentAt: now,
    },
  });
  if (reserved.count !== 1) return false;

  try {
    // Fragmento: el token no viaja en los registros HTTP ni en el Referer
    const link = `${config.WEB_ORIGIN}/activar#token=${token.token}`;
    await mail.send({
      to: user.email,
      subject: 'Activa tu cuenta — UMLFORGE AI',
      text: [
        'Confirma tu correo para activar tu cuenta de UMLFORGE AI.',
        '',
        'Abre este enlace y pulsa «Activar mi cuenta». Caduca en 24 horas y solo se puede usar una vez:',
        link,
        '',
        'Si no creaste esta cuenta, ignora este mensaje.',
      ].join('\n'),
    });
    return true;
  } catch {
    // No dejar bloqueada la cuenta ni invalidar el último enlace entregado
    await app.prisma.user.updateMany({
      where: { id: user.id, emailVerificationTokenHash: token.hash, emailVerifiedAt: null },
      data: {
        emailVerificationTokenHash: previous.emailVerificationTokenHash,
        emailVerificationExpiresAt: previous.emailVerificationExpiresAt,
        emailVerificationSentAt: previous.emailVerificationSentAt,
      },
    });
    app.log.error({ provider: mail.name }, 'no se pudo enviar el correo de activación');
    return false;
  }
}

export async function verificationRoutes(
  app: FastifyInstance,
  { config, mail }: { config: Config; mail: MailPort },
): Promise<void> {
  app.post('/auth/verification/resend', async (request, reply) => {
    const { email } = emailBody.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user !== null && user.emailVerifiedAt === null) {
      await sendVerification(app, config, mail, user);
    }
    // Misma respuesta para inexistentes, activadas y envíos limitados o fallidos
    reply.code(202);
    return { sent: true };
  });

  app.post('/auth/verification/confirm', async (request) => {
    const { token } = tokenBody.parse(request.body);
    const result = await app.prisma.user.updateMany({
      where: {
        emailVerificationTokenHash: hashRefreshToken(token),
        emailVerificationExpiresAt: { gt: new Date() },
        emailVerifiedAt: null,
      },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });
    if (result.count !== 1) {
      throw badRequest(
        'verification_invalid',
        'El enlace caducó o ya fue utilizado. Pide uno nuevo o inicia sesión si ya activaste tu cuenta.',
      );
    }
    return { verified: true };
  });
}
