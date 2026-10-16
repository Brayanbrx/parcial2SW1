import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError, badRequest, notFound, unauthorized } from '../../lib/http-error.js';
import { MailDeliveryError, createMailPort, type MailPort } from '../../lib/mail.js';
import { REFRESH_COOKIE, currentUser } from '../../plugins/auth.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createRefreshToken, hashRefreshToken } from './tokens.js';

/**
 * Perfil, cambio de contrasena y recuperacion
 *
 * 1. Cambiar la contrasena cierra las demas sesiones
 * 2. Pedir recuperacion nunca revela si el correo existe
 * 3. El testigo se guarda con hash y es de un solo uso
 */

const perfilBody = z.object({
  displayName: z.string().trim().min(1).max(120),
});

const cambioBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

const olvidoBody = z.object({
  email: z.string().email().max(254),
});

const restablecerBody = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(200),
});

/** Formatos que se aceptan como foto. Cualquier otro se rechaza antes de tocar la base. */
const TIPOS_DE_IMAGEN = ['image/png', 'image/jpeg', 'image/webp'] as const;

// Tope de la foto ya recortada
const MAXIMO_AVATAR = 256 * 1024;

const avatarBody = z.object({
  image: z
    .string()
    .min(1)
    .max(Math.ceil((MAXIMO_AVATAR * 4) / 3) + 1024),
  mediaType: z.enum(TIPOS_DE_IMAGEN),
});

export async function profileRoutes(
  app: FastifyInstance,
  options: { config: Config; mail?: MailPort },
): Promise<void> {
  const { config } = options;
  const mail =
    options.mail ??
    createMailPort(
      {
        provider: config.MAIL_PROVIDER,
        from: config.MAIL_FROM,
        fromName: config.MAIL_FROM_NAME,
        brevoApiKey: config.BREVO_API_KEY,
      },
      app.log,
    );

  // -------------------------------------------------------------------------
  // Perfil
  // -------------------------------------------------------------------------

  app.patch('/auth/me', { preHandler: app.authenticate }, async (request) => {
    const body = perfilBody.parse(request.body);
    const { userId } = currentUser(request);

    const user = await app.prisma.user.update({
      where: { id: userId },
      data: { displayName: body.displayName },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });

    return { ...user, hasAvatar: await tieneAvatar(app, userId) };
  });

  app.put('/auth/me/avatar', { preHandler: app.authenticate }, async (request) => {
    const body = avatarBody.parse(request.body);
    const { userId } = currentUser(request);

    const bytes = Buffer.from(body.image, 'base64');
    if (bytes.byteLength === 0) throw badRequest('imagen_vacia', 'La imagen llego vacia.');
    if (bytes.byteLength > MAXIMO_AVATAR) {
      throw badRequest(
        'imagen_grande',
        `La foto supera ${Math.round(MAXIMO_AVATAR / 1024)} kB una vez recortada.`,
      );
    }

    await app.prisma.user.update({
      where: { id: userId },
      data: { avatar: bytes, avatarMimeType: body.mediaType },
    });

    return { hasAvatar: true, bytes: bytes.byteLength };
  });

  app.delete('/auth/me/avatar', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = currentUser(request);

    await app.prisma.user.update({
      where: { id: userId },
      data: { avatar: null, avatarMimeType: null },
    });

    reply.code(204);
    return null;
  });

  app.get('/auth/users/:userId/avatar', async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);

    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, avatarMimeType: true },
    });

    if (user === null || user.avatar === null || user.avatarMimeType === null) {
      throw notFound('Ese usuario no tiene foto.');
    }

    reply
      .header('content-type', user.avatarMimeType)
      .header('content-length', String(user.avatar.byteLength))
      .header('cache-control', 'public, max-age=60');

    return reply.send(Buffer.from(user.avatar));
  });

  // -------------------------------------------------------------------------
  // Cambio de contraseña
  // -------------------------------------------------------------------------

  app.post('/auth/me/password', { preHandler: app.authenticate }, async (request) => {
    const body = cambioBody.parse(request.body);
    const { userId } = currentUser(request);

    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    // Se pide la actual aunque haya sesion: una pantalla desatendida no puede
    // servir para cambiar la contrasena de quien la dejo abierta.
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw unauthorized('La contrasena actual no es correcta.');
    }

    if (body.currentPassword === body.newPassword) {
      throw badRequest('misma_contrasena', 'La nueva contrasena es igual a la actual.');
    }

    const presented = request.cookies[REFRESH_COOKIE];

    await app.prisma.$transaction([
      app.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          sessionVersion: { increment: 1 },
        },
      }),
      // Las demas sesiones se cierran; la actual sobrevive
      app.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(presented === undefined ? {} : { NOT: { tokenHash: hashRefreshToken(presented) } }),
        },
        data: { revokedAt: new Date() },
      }),
      app.prisma.passwordReset.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { changed: true };
  });

  // -------------------------------------------------------------------------
  // Recuperacion
  // -------------------------------------------------------------------------

  app.post('/auth/password/forgot', async (request, reply) => {
    const body = olvidoBody.parse(request.body);
    const email = body.email.trim().toLowerCase();

    const user = await app.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (user !== null) {
      const testigo = createRefreshToken();

      await app.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: testigo.hash,
          expiresAt: new Date(Date.now() + config.PASSWORD_RESET_TTL_SECONDS * 1000),
        },
      });

      const enlace = `${config.WEB_ORIGIN.replace(/\/$/, '')}/restablecer?token=${testigo.token}`;
      const minutos = Math.round(config.PASSWORD_RESET_TTL_SECONDS / 60);

      try {
        await mail.send({
          to: email,
          subject: 'Restablecer tu contrasena — UMLFORGE AI',
          text: [
            'Alguien pidio restablecer la contrasena de esta cuenta.',
            '',
            `Abre este enlace para elegir una nueva (caduca en ${minutos} minutos):`,
            enlace,
            '',
            'Si no fuiste tu, ignora este mensaje: la contrasena no ha cambiado.',
          ].join('\n'),
        });
      } catch (error) {
        // El fallo se registra y no se propaga
        app.log.error(
          {
            proveedor: mail.name,
            motivo: error instanceof MailDeliveryError ? error.message : 'desconocido',
          },
          'no se pudo enviar el correo de recuperacion',
        );
      }
    }

    // Misma respuesta exista o no la cuenta.
    reply.code(202);
    return { sent: true };
  });

  app.post('/auth/password/reset', async (request) => {
    const body = restablecerBody.parse(request.body);

    const registro = await app.prisma.passwordReset.findUnique({
      where: { tokenHash: hashRefreshToken(body.token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (registro === null || registro.usedAt !== null || registro.expiresAt <= new Date()) {
      // Un solo mensaje para las tres situaciones
      throw new HttpError(
        400,
        'enlace_invalido',
        'Ese enlace ya no sirve. Pide uno nuevo desde «Olvide mi contrasena».',
      );
    }

    const passwordHash = await hashPassword(body.newPassword);
    const ahora = new Date();

    await app.prisma.$transaction(async (tx) => {
      // El cambio bloquea la fila de usuario y serializa tambien dos enlaces
      // distintos de la misma cuenta.
      await tx.user.update({
        where: { id: registro.userId },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      const consumido = await tx.passwordReset.updateMany({
        where: { id: registro.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: ahora },
      });
      if (consumido.count !== 1) {
        throw new HttpError(400, 'enlace_invalido', 'Ese enlace ya se uso.');
      }
      // Aqui si se cierran todas
      await tx.refreshToken.updateMany({
        where: { userId: registro.userId, revokedAt: null },
        data: { revokedAt: ahora },
      });
      // Los demas enlaces pendientes de esa cuenta dejan de servir.
      await tx.passwordReset.updateMany({
        where: { userId: registro.userId, usedAt: null },
        data: { usedAt: ahora },
      });
    });

    return { reset: true };
  });
}

async function tieneAvatar(app: FastifyInstance, userId: string): Promise<boolean> {
  const fila = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { avatarMimeType: true },
  });
  return fila !== null && fila.avatarMimeType !== null;
}
