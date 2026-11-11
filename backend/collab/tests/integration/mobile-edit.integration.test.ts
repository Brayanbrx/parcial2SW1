import type { FastifyInstance } from 'fastify';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Command } from '@uml/contracts';
import { readBoardState } from '@uml/yjs-adapter';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { buildCollabServer, type CollabServer } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../../api/src/app.js';
import { loadConfig as loadApiConfig } from '../../../api/src/config.js';
import { startEphemeralDatabase, type EphemeralDatabase } from '../support/database.js';
import { batch, cmd, nextId } from '../support/commands.js';
import { seedProject } from '../support/scenario.js';

const JWT_SECRET = 'local-ephemeral-test-secret-longer-than-32-characters';
const COLLAB_INTERNAL_SECRET = 'other-ephemeral-test-secret-longer-than-32-characters';
let database: EphemeralDatabase;
let collab: CollabServer;
let api: FastifyInstance;
let url: string;

beforeAll(async () => {
  database = await startEphemeralDatabase();
  const env = { NODE_ENV: 'test', DATABASE_URL: database.url, JWT_SECRET, COLLAB_INTERNAL_SECRET };
  collab = buildCollabServer(loadConfig({ ...env, COLLAB_HOST: '127.0.0.1', COLLAB_PORT: '0' }));
  await collab.listen();
  url = `http://127.0.0.1:${collab.port()}`;
  api = await buildApp(loadApiConfig({ ...env, COLLAB_INTERNAL_URL: url }), {
    teamAi: false,
    moderator: false,
  });
  await api.ready();
});

afterAll(async () => {
  await api?.close();
  await collab?.close();
  await database?.stop();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const context = await seedProject(collab.prisma, JWT_SECRET);
  const actorId = (
    await collab.prisma.project.findUniqueOrThrow({ where: { id: context.projectId } })
  ).ownerId;
  function make(...commands: readonly Pick<Command, 'type' | 'payload'>[]) {
    const value = batch(...commands);
    return {
      ...value,
      actorId,
      commands: value.commands.map((command) => ({ ...command, actorId })),
    };
  }
  const send = (payload: ReturnType<typeof make>) =>
    api.inject({
      method: 'POST',
      url: `/boards/${context.boardId}/commands`,
      headers: auth(context.duenaToken),
      payload,
    });
  const read = (token = context.duenaToken) =>
    api.inject({
      method: 'GET',
      url: `/boards/${context.boardId}/state`,
      headers: auth(token),
    });
  return { context, make, send, read };
}

it('reintentar un lote móvil no pisa una edición posterior y un conflicto no cambia el modelo', async () => {
  const { context, make, send, read } = await setup();
  const id = nextId();
  const rename = (displayName: string) => ({
    type: 'RENAME_CLASS' as const,
    payload: { classId: id, displayName },
  });
  const create = make(cmd.createClass(id, 'Pedido'));
  expect((await send(create)).statusCode).toBe(200);
  expect((await send(create)).statusCode).toBe(200);

  // Simula que se perdió la respuesta de colaboración antes de registrar la auditoría.
  const first = make(rename('Pedido Confirmado'));
  const internal = await fetch(`${url}/internal/apply`, {
    method: 'POST',
    headers: { ...auth(COLLAB_INTERNAL_SECRET), 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: context.projectId, boardId: context.boardId, batch: first }),
  });
  expect(internal.status).toBe(200);
  expect((await send(make(rename('Pedido Facturado')))).statusCode).toBe(200);
  expect((await send(first)).statusCode).toBe(200);
  expect((await read()).json().semantic.classes[0].displayName).toBe('Pedido Facturado');
  const conflict = {
    ...first,
    commands: first.commands.map((c) =>
      c.type === 'RENAME_CLASS' ? { ...c, payload: rename('Pedido Mutado').payload } : c,
    ),
  };
  expect((await send(conflict)).statusCode).toBe(409);
  expect((await read()).json().semantic.classes[0].displayName).toBe('Pedido Facturado');
  expect(await collab.prisma.auditOperation.count({ where: { boardId: context.boardId } })).toBe(3);
});

it('retira a un miembro expulsado antes de difundir un cambio móvil', async () => {
  const { context, make, send, read } = await setup();
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: url.replace('http:', 'ws:'),
    name: context.room,
    token: context.editorToken,
    document: doc,
  });
  try {
    await vi.waitFor(() => expect(provider.synced).toBe(true), { timeout: 6000 });
    await collab.prisma.projectMember.delete({
      where: { projectId_userId: { projectId: context.projectId, userId: context.editorId } },
    });
    expect((await read(context.editorToken)).statusCode).toBe(404);
    const id = nextId();
    expect((await send(make(cmd.createClass(id, 'Cambio después de expulsar')))).statusCode).toBe(
      200,
    );
    await vi.waitFor(() => expect(provider.synced).toBe(false));
    expect(readBoardState(doc).semantic.classes.some((c) => c.id === id)).toBe(false);
    expect((await read()).json().semantic.classes.some((c: { id: string }) => c.id === id)).toBe(
      true,
    );
  } finally {
    provider.destroy();
    doc.destroy();
  }
});
