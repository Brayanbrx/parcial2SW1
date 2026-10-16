import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * Estas pruebas no tocan la base de datos: el cliente de Prisma no conecta hasta
 * la primera consulta, asi que una cadena de conexion que no apunta a nada
 * sirve para comprobar todo lo que no consulta.
 *
 * Lo que si necesita base vive en `tests/integration/`.
 */
const ENTORNO_MINIMO = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nadie:nadie@127.0.0.1:1/inexistente',
  JWT_SECRET: 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres',
} as const;

describe('proceso api', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig(ENTORNO_MINIMO));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('responde /health sin depender de la base de datos', async () => {
    // Una sonda de vida que consulta la base deja de responder justo cuando mas
    // falta hace saber si el proceso sigue en pie.
    const respuesta = await app.inject({ method: 'GET', url: '/health' });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('exige token en las rutas protegidas antes de tocar la base', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/projects' });

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json().error.code).toBe('unauthorized');
  });

  it('no disfraza de 500 un error que Fastify ya rechazo', async () => {
    // Un POST que declara JSON sin cuerpo lo rechaza Fastify antes de la ruta,
    // con su propio 400. Devolverlo como 500 haria perder tiempo buscando un
    // fallo del servidor que no existe.
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().error.code).not.toBe('internal_error');
  });

  it('devuelve un cuerpo de error uniforme', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'no-es-un-correo' },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
    expect(typeof respuesta.json().requestId).toBe('string');
  });
});

describe('configuracion del proceso api', () => {
  it('rechaza arrancar con configuracion invalida en lugar de asumir un valor', () => {
    expect(() => loadConfig({ ...ENTORNO_MINIMO, API_PORT: 'no-es-un-puerto' })).toThrow(
      /Configuracion invalida/,
    );
  });

  it('exige un secreto de firma y no inventa uno por defecto', () => {
    // Un secreto con valor por defecto acaba desplegado, y nadie se entera hasta
    // que alguien firma sus propios tokens.
    const { JWT_SECRET: _omitido, ...sinSecreto } = ENTORNO_MINIMO;

    expect(() => loadConfig(sinSecreto)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...ENTORNO_MINIMO, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });

  it('exige la cadena de conexion', () => {
    const { DATABASE_URL: _omitida, ...sinBase } = ENTORNO_MINIMO;

    expect(() => loadConfig(sinBase)).toThrow(/DATABASE_URL/);
  });
});
