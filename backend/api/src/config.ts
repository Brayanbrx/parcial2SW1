import { z } from 'zod';

/**
 * Toda la configuracion entra por variables de entorno.
 * Ningun secreto queda escrito en el codigo ni en la composicion de contenedores
 * El proceso falla al arrancar si falta algo obligatorio
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  WORK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),

  DATABASE_URL: z.string().min(1),

  // Sin valor por defecto a proposito. Un secreto con valor por defecto acaba
  // desplegado, y nadie se entera hasta que alguien firma sus propios tokens
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),
  INVITE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),

  // Donde vive el proceso de colaboracion, para pedirle que vuelque el
  // documento antes de congelar el snapshot de generacion.
  // Es una llamada entre procesos dentro de la misma red: nunca la hace el navegador
  COLLAB_INTERNAL_URL: z.string().default('http://collab:3002'),

  /**
   * Ventana del enlace de recuperacion de contrasena.
   * Una hora: suficiente para leer el correo
   */
  PASSWORD_RESET_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  /**
   * Proveedor de correo. `log` escribe el mensaje en el registro del servidor y
   * es el valor por defecto: la plataforma arranca y la recuperacion funciona
   * sin ninguna cuenta configurada.
   */
  MAIL_PROVIDER: z.enum(['log', 'brevo']).default('log'),
  MAIL_FROM: z.string().default('no-responder@plataforma-uml.local'),
  MAIL_FROM_NAME: z.string().default('UMLFORGE AI'),
  BREVO_API_KEY: z.string().optional(),

  // La cookie de refresco solo viaja por HTTPS fuera de desarrollo.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    ...env,
    RATE_LIMIT_ENABLED:
      env['RATE_LIMIT_ENABLED'] ?? (env['NODE_ENV'] === 'production' ? 'true' : 'false'),
  });
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida del proceso api:\n${detalle}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    const problems: string[] = [];
    let origin: URL | undefined;
    try {
      origin = new URL(config.WEB_ORIGIN);
    } catch {
      /* Report a field name, never the supplied secret values. */
    }
    if (!origin || origin.protocol !== 'https:' || origin.origin !== config.WEB_ORIGIN) {
      problems.push('WEB_ORIGIN debe ser un origen HTTPS sin ruta ni barra final');
    }
    if (!config.COOKIE_SECURE) problems.push('COOKIE_SECURE debe ser true');
    if (!config.RATE_LIMIT_ENABLED) problems.push('RATE_LIMIT_ENABLED debe ser true');
    if (
      config.JWT_SECRET.length < 48 ||
      /cambiar|change-me|secreto-de-pruebas/i.test(config.JWT_SECRET)
    ) {
      problems.push('JWT_SECRET debe ser aleatorio y tener al menos 48 caracteres');
    }
    if (config.MAIL_PROVIDER !== 'brevo' || !config.BREVO_API_KEY?.trim()) {
      problems.push('MAIL_PROVIDER=brevo y BREVO_API_KEY son obligatorios en producción');
    }
    if (
      !z.string().email().safeParse(config.MAIL_FROM).success ||
      config.MAIL_FROM.endsWith('.local')
    ) {
      problems.push('MAIL_FROM debe ser un remitente real verificado');
    }
    if (problems.length)
      throw new Error(`Configuracion de producción invalida:\n${problems.join('\n')}`);
  }
  return config;
}
