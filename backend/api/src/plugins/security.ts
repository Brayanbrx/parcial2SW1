import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { HttpError } from '../lib/http-error.js';

export async function enforceLimit(
  limiter: ReturnType<FastifyInstance['createRateLimit']>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await limiter(request);
  if (!result.isAllowed && result.isExceeded) {
    reply.header('retry-after', result.ttlInSeconds);
    throw new HttpError(
      429,
      'rate_limit_exceeded',
      'Demasiadas peticiones. Espera antes de reintentar.',
    );
  }
}

export function isExpensiveRequest(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? '';
  return (
    request.method === 'POST' &&
    (/\/assistant\//.test(path) || /\/import\//.test(path) || /\/generations$/.test(path))
  );
}


export const securityPlugin = fp(
  async (app: FastifyInstance, { config }: { config: Config }) => {
    await app.register(rateLimit, { global: false, cache: 10000 });
    const general = app.createRateLimit({ max: config.RATE_LIMIT_MAX, timeWindow: 60_000 });
    const authentication = app.createRateLimit({
      max: config.AUTH_RATE_LIMIT_MAX,
      timeWindow: 900_000,
    });
    app.addHook('onRequest', async (request, reply) => {
      if (!config.RATE_LIMIT_ENABLED) return;
      const path = request.url.split('?')[0];
      if (path === '/health' || path === '/ready') return;
      await enforceLimit(general, request, reply);
      if (
        request.method === 'POST' &&
        [
          '/auth/login',
          '/auth/register',
          '/auth/password/forgot',
          '/auth/password/reset',
          '/auth/verification/resend',
          '/auth/verification/confirm',
        ].includes(path ?? '')
      ) {
        await enforceLimit(authentication, request, reply);
      }
    });
  },
  { name: 'security' },
);
