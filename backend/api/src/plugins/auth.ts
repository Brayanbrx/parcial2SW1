import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import { unauthorized } from '../lib/http-error.js';
import { enforceLimit, isExpensiveRequest } from './security.js';
import {
  createTokenIssuer,
  type AccessTokenClaims,
  type TokenIssuer,
} from '../modules/auth/tokens.js';

// Dentro de la ampliacion, `FastifyRequest` y `FastifyReply` resuelven a las
declare module 'fastify' {
  interface FastifyInstance {
    readonly tokens: TokenIssuer;
    /** Rechaza la peticion si no trae un token de acceso valido. */
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }

  interface FastifyRequest {
    /** Presente solo despues de pasar por `authenticate`. */
    user?: AccessTokenClaims;
  }
}

export const REFRESH_COOKIE = 'uml_refresh';

export const authPlugin = fp(
  async (app: FastifyInstance, options: { config: Config }) => {
    const tokens = createTokenIssuer(
      options.config.JWT_SECRET,
      options.config.ACCESS_TOKEN_TTL_SECONDS,
    );

    app.decorate('tokens', tokens);
    app.decorateRequest('user', undefined);

    const workQuota = app.createRateLimit({
      max: options.config.WORK_RATE_LIMIT_MAX,
      timeWindow: 60_000,
      keyGenerator: (request) => request.user?.userId ?? request.ip,
    });
    app.decorate('authenticate', async (request: FastifyRequest, reply) => {
      const header = request.headers.authorization;
      if (header === undefined || !header.startsWith('Bearer ')) {
        throw unauthorized('Falta el token de acceso.');
      }

      const claims = await tokens.verifyAccessToken(header.slice('Bearer '.length));
      const user = await app.prisma.user.findUnique({
        where: { id: claims.userId },
        select: { sessionVersion: true, emailVerifiedAt: true },
      });
      if (
        user === null ||
        user.emailVerifiedAt === null ||
        user.sessionVersion !== claims.sessionVersion
      ) {
        throw unauthorized('La sesión fue revocada. Inicia sesión nuevamente.');
      }
      request.user = claims;
      if (options.config.RATE_LIMIT_ENABLED && isExpensiveRequest(request))
        await enforceLimit(workQuota, request, reply);

      // El actor entra en el registro estructurado de la peticion
      // `setBindings` existe en pino pero no esta declarado en el tipo que
      // Fastify expone, asi que se accede de forma estructural y opcional.
      const log = request.log as { setBindings?: (bindings: Record<string, unknown>) => void };
      log.setBindings?.({ actorId: claims.userId });
    });
  },
  { name: 'auth' },
);

export function currentUser(request: FastifyRequest): AccessTokenClaims {
  if (request.user === undefined) {
    // Llegar aqui significa que a la ruta le falta el gancho de autenticacion
    throw new Error('La ruta no declaro preHandler: authenticate');
  }
  return request.user;
}
