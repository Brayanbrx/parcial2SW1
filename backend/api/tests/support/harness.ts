import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Correo, MailPort } from '../../src/lib/mail.js';
import { startEphemeralDatabase, type EphemeralDatabase } from './database.js';

/**
 * Cuerpo de una respuesta, tal como lo navega una prueba.
 *
 * Es el unico `any` del repositorio y esta aqui a proposito: tipar cada
 * respuesta obligaria a declarar una interfaz por endpoint solo para las
 * pruebas, y esas interfaces se quedarian atras sin que nada lo detectara. Lo
 * que de verdad comprueba el contrato es la asercion de cada prueba.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResponseBody = any;

/** Cliente minimo sobre `inject`: sin puerto abierto y sin red. */
export interface ApiClient {
  readonly app: FastifyInstance;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: { token?: string; body?: unknown; cookie?: string },
  ): Promise<{ status: number; body: ResponseBody; cookies: { name: string; value: string }[] }>;
  /**
   * Como `request`, pero devuelve los bytes tal cual.
   *
   * Hace falta para las descargas: un ZIP no es texto, y leerlo como cadena lo
   * corrompe sin que nada avise.
   */
  raw(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    options?: { token?: string; body?: unknown },
  ): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>;
}

export interface Harness extends ApiClient {
  readonly mails: Correo[];
  readonly mail: MailPort;
  activate(email: string): Promise<void>;
  stop(): Promise<void>;
  /** Crea una cuenta y devuelve su token de acceso y su identificador. */
  signUp(
    email: string,
    password?: string,
  ): Promise<{ userId: string; token: string; cookie: string }>;
}

export async function startHarness(): Promise<Harness> {
  let database: EphemeralDatabase | undefined;
  let app: FastifyInstance | undefined;
  let collab: Server | undefined;
  const mails: Correo[] = [];
  const mail: MailPort = {
    name: 'test',
    async send(message) {
      mails.push(message);
    },
  };

  try {
    database = await startEphemeralDatabase();
    collab = await startCollabStub();

    app = await buildApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: database.url,
        JWT_SECRET: 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres',
        COLLAB_INTERNAL_URL: `http://127.0.0.1:${(collab.address() as AddressInfo).port}`,
      }),
      { mail },
    );

    const client = makeClient(app);
    const activate = async (email: string): Promise<void> => {
      const message = mails.findLast(
        (item) => item.to === email.toLowerCase() && item.subject.startsWith('Activa'),
      );
      const token = message?.text.match(/#token=([^\s]+)/)?.[1];
      if (!token) throw new Error('No llegó el correo de activación de prueba');
      const result = await client.request('POST', '/auth/verification/confirm', {
        body: { token },
      });
      if (result.status !== 200) throw new Error('No se pudo activar la cuenta de prueba');
    };

    return {
      ...client,
      mails,
      mail,
      activate,
      async signUp(email, password = 'contrasena-de-prueba') {
        const registro = await client.request('POST', '/auth/register', {
          body: { email, displayName: email.split('@')[0], password },
        });

        if (registro.status !== 201) {
          throw new Error(`No se pudo registrar ${email}: ${JSON.stringify(registro.body)}`);
        }

        await activate(email);
        const respuesta = await client.request('POST', '/auth/login', {
          body: { email, password },
        });
        if (respuesta.status !== 200) throw new Error('No se pudo iniciar sesión tras activar');

        const cookie = respuesta.cookies.find((item) => item.name === 'uml_refresh');

        return {
          userId: respuesta.body.user.id as string,
          token: respuesta.body.accessToken as string,
          cookie: cookie === undefined ? '' : `${cookie.name}=${cookie.value}`,
        };
      },
      async stop() {
        await app?.close();
        collab?.close();
        await database?.stop();
      },
    };
  } catch (error) {
    await app?.close();
    collab?.close();
    await database?.stop();
    throw error;
  }
}

/**
 * Sustituto del proceso de colaboracion para el volcado previo a generar.
 *
 * Responde «no habia documento cargado», que es exactamente lo que contestaria
 * el proceso real si nadie tuviera la pizarra abierta — y es la verdad aqui,
 * porque estas pruebas escriben la proyeccion directamente en la base.
 *
 * Que el volcado de verdad funcione se comprueba en `e2e/specs/generacion.spec.ts`,
 * con los dos procesos levantados y un navegador delante.
 */
async function startCollabStub(): Promise<Server> {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ stored: false }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function makeClient(app: FastifyInstance): ApiClient {
  return {
    app,
    async request(method, url, options = {}) {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
      if (options.cookie !== undefined) headers['cookie'] = options.cookie;

      const respuesta = await app.inject({
        method,
        url,
        headers,
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });

      let body: unknown = null;
      if (respuesta.payload.length > 0) {
        try {
          body = respuesta.json();
        } catch {
          body = respuesta.payload;
        }
      }

      return {
        status: respuesta.statusCode,
        body,
        cookies: respuesta.cookies.map((item) => ({ name: item.name, value: item.value })),
      };
    },

    async raw(method, url, options = {}) {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;

      const respuesta = await app.inject({
        method,
        url,
        headers,
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });

      return {
        status: respuesta.statusCode,
        headers: respuesta.headers,
        body: respuesta.rawPayload,
      };
    },
  };
}
