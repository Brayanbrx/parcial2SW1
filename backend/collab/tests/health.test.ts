import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCollabServer, type CollabServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  CONNECTION_REJECTIONS,
  UnauthorizedConnection,
  parseRoomName,
} from '../src/auth/authorize.js';

/**
 * Lo que se puede comprobar sin base de datos. El cliente de Prisma no conecta
 * hasta la primera consulta, asi que la sonda de vida y el analisis del nombre
 * de sala se prueban aqui, en el bucle rapido.
 *
 * La autorizacion completa necesita PostgreSQL y vive en `tests/integration/`.
 */
const ENTORNO_MINIMO = {
  NODE_ENV: 'test',
  COLLAB_HOST: '127.0.0.1',
  COLLAB_PORT: '0',
  DATABASE_URL: 'postgresql://nadie:nadie@127.0.0.1:1/inexistente',
  JWT_SECRET: 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres',
} as const;

describe('proceso collab', () => {
  let collab: CollabServer;
  let base: string;

  beforeAll(async () => {
    collab = buildCollabServer(loadConfig(ENTORNO_MINIMO));
    await collab.listen();
    base = `http://127.0.0.1:${collab.port()}`;
  });

  afterAll(async () => {
    await collab?.close();
  });

  it('responde /health sin depender de la base de datos', async () => {
    const respuesta = await fetch(`${base}/health`);

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ status: 'ok', service: 'collab' });
  });

  it('no expone ninguna otra ruta HTTP', async () => {
    // Todo el trafico util de este proceso va por WebSocket. Sin atender el
    // resto de rutas, Hocuspocus responde su propio 200 con un texto que nombra
    // el software.
    const respuesta = await fetch(`${base}/documentos`);

    expect(respuesta.status).toBe(404);
    await expect(respuesta.text()).resolves.not.toMatch(/hocuspocus/i);
  });

  it.each(['null', '[]', '42', '"texto"', '{}', '{'])(
    'rechaza el cuerpo de flush %s con 400',
    async (body) => {
      const respuesta = await fetch(`${base}/flush`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(2000),
      });
      expect(respuesta.status).toBe(400);
      await expect(respuesta.json()).resolves.toEqual({ error: 'cuerpo_invalido' });
    },
  );
});

describe('nombre de sala', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const boardId = '22222222-2222-4222-8222-222222222222';

  it('extrae proyecto y pizarra', () => {
    expect(parseRoomName(`project:${projectId}:board:${boardId}`)).toEqual({ projectId, boardId });
  });

  it('rechaza cualquier cosa que no tenga la forma esperada', () => {
    // El cliente elige el nombre del documento: es entrada no confiable como
    // cualquier otra, y se analiza en lugar de confiarse.
    for (const invalido of [
      'documento-cualquiera',
      `project:${projectId}`,
      `project:no-es-un-uuid:board:${boardId}`,
      `project:${projectId}:board:${boardId}:extra`,
      '',
    ]) {
      expect(() => parseRoomName(invalido)).toThrow(UnauthorizedConnection);
    }
  });

  it('el motivo del rechazo viaja al cliente', () => {
    try {
      parseRoomName('lo-que-sea');
      throw new Error('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedConnection);
      expect((error as UnauthorizedConnection).reason).toBe(CONNECTION_REJECTIONS.SALA_INVALIDA);
    }
  });
});

describe('configuracion del proceso collab', () => {
  it('exige el secreto de firma y la cadena de conexion', () => {
    const { JWT_SECRET: _sinSecreto, ...faltaSecreto } = ENTORNO_MINIMO;
    const { DATABASE_URL: _sinBase, ...faltaBase } = ENTORNO_MINIMO;

    expect(() => loadConfig(faltaSecreto)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig(faltaBase)).toThrow(/DATABASE_URL/);
  });
});
