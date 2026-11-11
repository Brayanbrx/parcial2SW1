import Fastify from 'fastify';
import { createAiPorts, loadAiConfig, type VisionPort } from '@uml/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importRoutes } from '../src/modules/import/routes.js';

const boardId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const base = `/boards/${boardId}/import`;
const model = {
  classes: [
    {
      id: '00000000-0000-4000-8000-000000000003',
      displayName: 'Cliente',
      codeName: 'Cliente',
      databaseName: 'cliente',
      attributes: [],
    },
  ],
  relationships: [],
};
const photo = {
  model,
  image:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  mediaType: 'image/png',
  mode: 'REPLACE',
};

const servers: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

async function setup(extractModel: VisionPort['extractModel']) {
  const app = Fastify({ forceCloseConnections: true });
  servers.push(app);
  app.decorate('authenticate', async (request) => {
    request.user = { userId: actorId, email: 'editor@example.test', sessionVersion: 0 };
  });
  app.decorate('prisma', {
    board: {
      findUnique: async () => ({ id: boardId, projectId: 'project', displayName: 'Prueba' }),
    },
    projectMember: { findUnique: async () => ({ role: 'EDITOR' }) },
  } as never);
  const ports = createAiPorts(loadAiConfig({}));
  await app.register(importRoutes, { ports: { ...ports, vision: { name: 'test', extractModel } } });
  return app;
}

describe('seguridad al importar', () => {
  it.each([
    { operations: [], needsClarification: 'La foto no contiene un diagrama de clases.' },
    { operations: [{ op: 'CREATE_CLASS' as const, className: '***' }] },
    {
      operations: [{ op: 'DELETE_CLASS' as const, className: 'Pedido' }],
    },
  ])('una foto sin clases utilizables no prepara borrados ($operations)', async (proposal) => {
    const app = await setup(async () => ({ proposal }));
    const response = await app.inject({ method: 'POST', url: `${base}/image`, payload: photo });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ kind: 'QUESTION' });
    expect(response.json()).not.toHaveProperty('batch');
  });

  it('una foto con clases utilizables permite preparar el reemplazo completo', async () => {
    const app = await setup(async () => ({
      proposal: { operations: [{ op: 'CREATE_CLASS', className: 'Pedido' }] },
    }));
    const response = await app.inject({ method: 'POST', url: `${base}/image`, payload: photo });
    expect(response.statusCode).toBe(200);
    expect(response.json().batch.commands).toEqual([
      expect.objectContaining({ type: 'DELETE_CLASS' }),
      expect.objectContaining({
        type: 'CREATE_CLASS',
        payload: expect.objectContaining({ displayName: 'Pedido' }),
      }),
    ]);
  });

  it('ordena la transcripción de la foto, conserva métodos y omite borrados del modelo', async () => {
    const app = await setup(async () => ({
      proposal: {
        operations: [
          {
            op: 'CREATE_RELATIONSHIP',
            fromClass: 'Cliente',
            toClass: 'Pedido',
            fromMultiplicity: '1',
            toMultiplicity: '0..*',
          },
          {
            op: 'ADD_OPERATION',
            className: 'Pedido',
            operationName: 'calcular',
            returnType: 'Decimal',
          },
          { op: 'DELETE_CLASS', className: 'Cliente' },
          { op: 'CREATE_CLASS', className: 'Pedido' },
        ],
      },
    }));
    const response = await app.inject({
      method: 'POST',
      url: `${base}/image`,
      payload: { ...photo, mode: 'ADD' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().batch.commands.map((command: { type: string }) => command.type)).toEqual(
      ['CREATE_CLASS', 'ADD_OPERATION', 'CREATE_RELATIONSHIP'],
    );
    expect(response.json().warnings).toContainEqual({
      element: 'la fotografía',
      reason: 'Se omitieron cambios ajenos a la transcripción del diagrama.',
    });
  });

  it('rechaza una foto con un formato declarado incorrecto antes de consultar al proveedor', async () => {
    const vision = vi.fn<VisionPort['extractModel']>();
    const app = await setup(vision);
    const response = await app.inject({
      method: 'POST',
      url: `${base}/image`,
      payload: { ...photo, mediaType: 'image/jpeg' },
    });
    expect(response.statusCode).toBe(422);
    expect(vision).not.toHaveBeenCalled();
  });

  it('un XMI sin clasificadores utilizables no ofrece reemplazar las clases existentes', async () => {
    const app = await setup(async () => ({ proposal: { operations: [] } }));
    const xml =
      '<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model xmi:type="uml:Model" name="Servicios"><packagedElement xmi:type="uml:Package" xmi:id="i" name="Servicios"/></uml:Model></xmi:XMI>';
    const response = await app.inject({
      method: 'POST',
      url: `${base}/xmi`,
      payload: { model, xml, mode: 'REPLACE' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'QUESTION',
      question: expect.stringContaining('no contiene clases'),
    });
    expect(response.json()).not.toHaveProperty('batch');
  });

  it('ofrece importar una interfaz soportada con confirmación antes de reemplazar', async () => {
    const app = await setup(async () => ({ proposal: { operations: [] } }));
    const response = await app.inject({
      method: 'POST',
      url: `${base}/xmi`,
      payload: {
        model,
        mode: 'REPLACE',
        xml: '<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model name="Servicios"><packagedElement xmi:type="uml:Interface" xmi:id="i" name="Servicio"/></uml:Model></xmi:XMI>',
      },
    });
    expect(response.json()).toMatchObject({
      kind: 'CONFIRMATION',
      batch: {
        commands: [
          expect.objectContaining({ type: 'DELETE_CLASS' }),
          expect.objectContaining({
            type: 'CREATE_CLASS',
            payload: expect.objectContaining({ kind: 'INTERFACE' }),
          }),
        ],
      },
    });
  });

  it('cancela la lectura de la foto cuando el cliente cierra la conexión', async () => {
    let captured: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const app = await setup(async ({ signal }) => {
      captured = signal;
      await new Promise<void>((resolve) => {
        release = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { proposal: { operations: [] } };
    });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = fetch(url + `${base}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(photo),
      signal: controller.signal,
    }).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(captured?.aborted).toBe(false));
      controller.abort();
      await response;
      await vi.waitFor(() => expect(captured?.aborted).toBe(true));
    } finally {
      controller.abort();
      release?.();
    }
  }, 15_000);
});
