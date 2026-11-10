import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../../plugins/auth.js';

const registerBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']).default('android'),
});

/** Registro de dispositivos moviles para notificaciones push. */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Un token pertenece a un solo usuario: si otra cuenta inicia sesion en el
  // mismo telefono, el token cambia de dueño.
  app.put('/devices', async (request, reply) => {
    const body = registerBody.parse(request.body);
    const { userId } = currentUser(request);
    await app.prisma.deviceToken.upsert({
      where: { token: body.token },
      create: { token: body.token, platform: body.platform, userId },
      update: { userId, platform: body.platform },
    });
    reply.code(204);
    return null;
  });

  app.post('/devices/unregister', async (request, reply) => {
    const body = z.object({ token: z.string().min(20).max(4096) }).parse(request.body);
    const { userId } = currentUser(request);
    await app.prisma.deviceToken.deleteMany({ where: { token: body.token, userId } });
    reply.code(204);
    return null;
  });
}
