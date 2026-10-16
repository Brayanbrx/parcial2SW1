import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { createAiPorts, describeAiChains, loadAiConfig } from '@uml/ai';
import { SCHEMA_VERSION } from '@uml/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { loadConfig, type Config } from './config.js';
import { HttpError } from './lib/http-error.js';
import { createMailPort, type MailPort } from './lib/mail.js';
import { verificationRoutes } from './modules/auth/verification.js';
import { aiRoutes } from './modules/ai/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { profileRoutes } from './modules/auth/profile.js';
import { authRoutes } from './modules/auth/routes.js';
import { InvalidTokenError } from './modules/auth/tokens.js';
import { boardRoutes } from './modules/boards/routes.js';
import { generationRoutes } from './modules/generation/routes.js';
import { importRoutes } from './modules/import/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { authPlugin } from './plugins/auth.js';
import { prismaPlugin } from './plugins/prisma.js';
import { securityPlugin } from './plugins/security.js';

export const SERVICE_NAME = 'api';

/**
 * Construye la aplicacion sin escucharla. Separar construccion de escucha es lo
 * que permite probarla por inyeccion, sin abrir un puerto
 */
export async function buildApp(
  config: Config = loadConfig(),
  options: { mail?: MailPort } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    // Registro estructurado. Los campos de proyecto, pizarra, sesion, lote, comando,
    // generacion, actor y origen se anaden por peticion en las fases que los introducen.
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            base: { service: SERVICE_NAME },
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
          },
    genReqId: () => crypto.randomUUID(),
    trustProxy: (_address, hop) => hop < config.TRUST_PROXY_HOPS,
    requestTimeout: 30_000,
  });

  await app.register(cors, {
    // CORS = Cross Origin Resource sharing, intercambio de recursos
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition', 'Retry-After'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(prismaPlugin, { config });
  await app.register(securityPlugin, { config });
  await app.register(authPlugin, { config });

  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({
    status: 'ok',
    service: SERVICE_NAME,
    schemaVersion: SCHEMA_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  // La App esta viva ? PostgreSQL y Collab
  app.get('/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      const collab = await fetch(`${config.COLLAB_INTERNAL_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!collab.ok) throw new Error('collab unavailable');
      return { status: 'ok', service: SERVICE_NAME };
    } catch {
      return reply.code(503).send({ status: 'unavailable', service: SERVICE_NAME });
    }
  });

  // Una sola pasarela de IA para todo el proceso.
  const aiConfig = loadAiConfig();
  const aiPorts = createAiPorts(aiConfig);
  app.log.info({ cadenas: describeAiChains(aiConfig) }, 'capa de IA');

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
  await app.register(authRoutes, { config, mail });
  await app.register(verificationRoutes, { config, mail });
  await app.register(profileRoutes, { config, mail });
  await app.register(projectRoutes, { config });
  await app.register(boardRoutes);
  await app.register(aiRoutes, { ports: aiPorts });
  await app.register(importRoutes, { ports: aiPorts });
  await app.register(generationRoutes, { config });
  await app.register(auditRoutes);

  return app;
}

/**
 * Cuerpo de error uniforme para toda la API
 * Un solo formato hace que el cliente tenga un solo camino de manejo
 */
function errorHandler(
  error: unknown,
  request: Parameters<Parameters<FastifyInstance['setErrorHandler']>[0]>[1],
  reply: Parameters<Parameters<FastifyInstance['setErrorHandler']>[0]>[2],
): void {
  const respond = (statusCode: number, code: string, message: string, details?: unknown): void => {
    void reply.code(statusCode).send({
      error: { code, message, ...(details === undefined ? {} : { details }) },
      requestId: request.id,
    });
  };

  if (error instanceof HttpError) {
    respond(error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof InvalidTokenError) {
    respond(401, 'unauthorized', error.message);
    return;
  }

  if (error instanceof ZodError) {
    respond(
      400,
      'validation_failed',
      'La peticion no cumple el contrato.',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
    return;
  }

  // Fastify rechaza por su cuenta antes de llegar a la ruta: cuerpo vacio con
  // content-type JSON, carga demasiado grande, JSON mal formado. Traen su propio
  // codigo de estado y hay que respetarlo
  //
  // Devolver 500 por un error del cliente hace perder tiempo buscando un fallo del servidor que no existe
  // ensucia los registros de errores con ruido que nadie puede arreglar.
  const conEstado = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  if (
    typeof conEstado.statusCode === 'number' &&
    conEstado.statusCode >= 400 &&
    conEstado.statusCode < 500
  ) {
    respond(
      conEstado.statusCode,
      typeof conEstado.code === 'string' ? conEstado.code.toLowerCase() : 'bad_request',
      typeof conEstado.message === 'string' ? conEstado.message : 'Peticion invalida.',
    );
    return;
  }

  // Cualquier otra cosa si es un fallo nuestro. Se registra entero y al cliente
  // solo le llega que fue del servidor: un mensaje de excepcion puede contener
  // fragmentos de consulta o de configuracion.
  request.log.error({ err: error }, 'error no controlado');
  respond(500, 'internal_error', 'Error interno del servidor.');
}
