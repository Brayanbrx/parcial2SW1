import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  COLLAB_HOST: z.string().default('0.0.0.0'),
  COLLAB_PORT: z.coerce.number().int().nonnegative().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  // El mismo secreto que firma los tokens en el proceso HTTP.
  //  Los dos procesos comparten la clave porque uno emite y el otro verifica.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  COLLAB_INTERNAL_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),

  STORE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  STORE_MAX_DEBOUNCE_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida del proceso collab:\n${detalle}`);
  }
  if (parsed.data.COLLAB_INTERNAL_SECRET === parsed.data.JWT_SECRET)
    throw new Error('COLLAB_INTERNAL_SECRET debe ser distinto de JWT_SECRET');
  return parsed.data;
}
