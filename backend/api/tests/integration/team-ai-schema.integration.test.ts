import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  AI_PROPOSAL_TTL_MS,
  DEFAULT_AI_SETTINGS,
  TEAM_REQUEST_STATUSES,
  aiProposalSchema,
  projectAiSettingsSchema,
  teamMessageSchema,
} from '@uml/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEphemeralDatabase, type EphemeralDatabase } from '../support/database.js';

const run = promisify(execFile);
const migration = '20261027010000_team_ai';
const schema = resolve('backend/prisma/schema.prisma');
const cli = resolve('node_modules/prisma/build/index.js');
const createdAt = new Date('2026-10-27T18:00:00.000Z');
const model = { classes: [], relationships: [] };
const asJson = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, item: unknown) => (key === 'requestModel' ? undefined : item)),
  );

function request(boardId: string, authorId: string): Prisma.TeamMessageUncheckedCreateInput {
  return {
    boardId,
    authorId,
    authorKind: 'USER',
    clientRequestId: randomUUID(),
    mode: 'INSTRUCT',
    inputMode: 'TEXT',
    kind: 'INSTRUCTION',
    text: 'Crea Persona',
    status: 'QUEUED',
    createdAt,
    updatedAt: createdAt,
  };
}

function proposal(
  boardId: string,
  requestMessageId: string,
  requesterId: string,
): Prisma.AiProposalUncheckedCreateInput {
  const batchId = randomUUID();
  return {
    boardId,
    requestMessageId,
    requesterId,
    batchId,
    batch: {
      batchId,
      actorId: requesterId,
      origin: 'AI_TEXT',
      issuedAt: createdAt.toISOString(),
      commands: [
        {
          commandId: randomUUID(),
          actorId: requesterId,
          origin: 'AI_TEXT',
          issuedAt: createdAt.toISOString(),
          type: 'CREATE_CLASS',
          payload: { classId: randomUUID(), displayName: 'Persona' },
        },
      ],
    },
    expectedSemantic: model,
    status: 'READY',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(createdAt.getTime() + AI_PROPOSAL_TTL_MS),
  };
}

async function legacyFixture(db: PrismaClient) {
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@test.invalid`,
      displayName: 'Ana',
      passwordHash: 'fixture',
    },
  });
  const project = await db.project.create({
    data: {
      displayName: 'Proyecto anterior',
      ownerId: user.id,
      schemaVersion: '1.0.0',
    },
  });
  const board = await db.board.create({ data: { projectId: project.id, displayName: 'Clases' } });
  return { user, project, board };
}

describe('paso 2: persistencia Team AI en PostgreSQL limpio', () => {
  let database: EphemeralDatabase;
  let db: PrismaClient;
  let boardId: string;
  let otherBoardId: string;
  let projectId: string;
  let authorId: string;

  beforeAll(async () => {
    database = await startEphemeralDatabase();
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) });
    const fixture = await legacyFixture(db);
    boardId = fixture.board.id;
    projectId = fixture.project.id;
    authorId = fixture.user.id;
    otherBoardId = (await db.board.create({ data: { projectId, displayName: 'Otra' } })).id;
  });
  afterAll(async () => {
    await db?.$disconnect();
    await database?.stop();
  });

  it('crea las cuatro tablas y conserva los defaults del contrato', async () => {
    const settings = await db.projectAiSettings.create({ data: { projectId } });
    expect(settings).toMatchObject(DEFAULT_AI_SETTINGS);
    expect(projectAiSettingsSchema.safeParse(asJson(settings)).success).toBe(true);
    expect(await db.aiReviewState.create({ data: { boardId } })).toMatchObject({
      lastIssueKeys: [],
      lastReviewedBatchId: null,
      lastReviewAt: null,
      lastInterventionAt: null,
    });
    const message = await db.teamMessage.create({ data: request(boardId, authorId) });
    expect(teamMessageSchema.safeParse(asJson(message)).success).toBe(true);
    const saved = await db.aiProposal.create({ data: proposal(boardId, message.id, authorId) });
    expect(aiProposalSchema.safeParse(asJson(saved)).success).toBe(true);
  });

  it.each(TEAM_REQUEST_STATUSES)('persiste el estado de solicitud %s', async (status) => {
    const saved = await db.teamMessage.create({ data: { ...request(boardId, authorId), status } });
    expect(teamMessageSchema.safeParse(asJson(saved)).success).toBe(true);
  });

  it('una carrera por clientRequestId inserta exactamente una solicitud', async () => {
    const data = request(boardId, authorId);
    const results = await Promise.allSettled([
      db.teamMessage.create({ data }),
      db.teamMessage.create({ data }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'P2002' },
    });
    await expect(
      db.teamMessage.create({
        data: {
          ...data,
          boardId: otherBoardId,
          authorId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('admite varios mensajes IA sin clientRequestId e hilos dentro de su pizarra', async () => {
    const parent = await db.teamMessage.create({ data: request(boardId, authorId) });
    const data = {
      boardId,
      authorKind: 'AI' as const,
      kind: 'ANSWER' as const,
      text: 'Respuesta',
      replyToId: parent.id,
      addressedToId: authorId,
    };
    const answers = await Promise.all([
      db.teamMessage.create({ data }),
      db.teamMessage.create({ data }),
    ]);
    expect(answers.every((answer) => teamMessageSchema.safeParse(asJson(answer)).success)).toBe(
      true,
    );
    await expect(
      db.teamMessage.create({ data: { ...data, boardId: otherBoardId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.teamMessage.create({ data: { ...data, replyToId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.teamMessage.delete({ where: { id: parent.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it.each([
    { authorId: null },
    { mode: null },
    { kind: 'ANSWER' as const },
    { addressedToId: randomUUID() },
    { text: '' },
    { updatedAt: new Date(createdAt.getTime() - 1) },
  ])('rechaza una solicitud incoherente: %j', async (change) => {
    await expect(
      db.teamMessage.create({ data: { ...request(boardId, authorId), ...change } }),
    ).rejects.toThrow();
  });

  it('restringe propuesta a su pizarra y deduplica por solicitud y lote', async () => {
    const first = await db.teamMessage.create({ data: request(boardId, authorId) });
    const second = await db.teamMessage.create({ data: request(boardId, authorId) });
    const data = proposal(boardId, first.id, authorId);
    await expect(
      db.aiProposal.create({ data: { ...data, boardId: otherBoardId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await db.aiProposal.create({ data });
    await expect(
      db.aiProposal.create({ data: proposal(boardId, first.id, authorId) }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.aiProposal.create({ data: { ...data, requestMessageId: second.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([
    { expiresAt: new Date(createdAt.getTime() + AI_PROPOSAL_TTL_MS + 1) },
    { status: 'STALE' as const },
    { status: 'REJECTED' as const },
    { rejectReason: 'USER' as const },
    { decidedById: randomUUID() },
    { batch: [] },
  ])('rechaza propuesta incoherente: %j', async (change) => {
    const message = await db.teamMessage.create({ data: request(boardId, authorId) });
    await expect(
      db.aiProposal.create({ data: { ...proposal(boardId, message.id, authorId), ...change } }),
    ).rejects.toThrow();
  });

  it.each([
    { status: 'PENDING_CONFIRMATION' as const, rejectReason: null },
    { status: 'APPLIED' as const, rejectReason: null },
    { status: 'EXPIRED' as const, rejectReason: null },
    { status: 'STALE' as const, rejectReason: 'STALE' as const },
    { status: 'REJECTED' as const, rejectReason: 'USER' as const },
    { status: 'REJECTED' as const, rejectReason: 'APPLY_FAILED' as const },
  ])('conserva estado y motivo válidos: %j', async (change) => {
    const message = await db.teamMessage.create({ data: request(boardId, authorId) });
    const saved = await db.aiProposal.create({
      data: {
        ...proposal(boardId, message.id, authorId),
        ...change,
        decidedById: authorId,
        decidedAt: createdAt,
      },
    });
    expect(aiProposalSchema.safeParse(asJson(saved)).success).toBe(true);
  });

  it('conserva hallazgos como arreglo JSON y rechaza objetos', async () => {
    await expect(
      db.aiReviewState.update({ where: { boardId }, data: { lastIssueKeys: {} } }),
    ).rejects.toThrow();
    const keys = ['ERROR:missing-type:class-1', 'ERROR:cycle:class-2'];
    expect(
      await db.aiReviewState.update({ where: { boardId }, data: { lastIssueKeys: keys } }),
    ).toMatchObject({ lastIssueKeys: keys });
  });

  it('pagina sin perder mensajes que comparten timestamp y tiene índices de cursores', async () => {
    const board = await db.board.create({ data: { projectId, displayName: 'Cursores' } });
    for (let n = 0; n < 3; n++) await db.teamMessage.create({ data: request(board.id, authorId) });
    const first = await db.teamMessage.findFirstOrThrow({
      where: { boardId: board.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const remaining = await db.teamMessage.findMany({
      where: {
        boardId: board.id,
        OR: [
          { createdAt: { gt: first.createdAt } },
          { createdAt: first.createdAt, id: { gt: first.id } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(remaining).toHaveLength(2);
    const indexes = await db.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'team_messages_boardId_createdAt_id_idx',
        'team_messages_boardId_updatedAt_id_idx',
        'ai_proposals_boardId_updatedAt_id_idx',
      ]),
    );
  });

  it.each(['board', 'project'] as const)(
    'elimina en cascada desde %s sin afectar otra pizarra',
    async (target) => {
      const fixture = await legacyFixture(db);
      const id = fixture.board.id;
      await db.projectAiSettings.create({ data: { projectId: fixture.project.id } });
      await db.aiReviewState.create({ data: { boardId: id } });
      const parent = await db.teamMessage.create({ data: request(id, authorId) });
      await db.teamMessage.create({
        data: {
          boardId: id,
          authorKind: 'AI',
          kind: 'ANSWER',
          text: 'Respuesta',
          replyToId: parent.id,
          addressedToId: authorId,
        },
      });
      await db.aiProposal.create({ data: proposal(id, parent.id, authorId) });
      if (target === 'board') await db.board.delete({ where: { id } });
      else await db.project.delete({ where: { id: fixture.project.id } });
      expect(await db.teamMessage.count({ where: { boardId: id } })).toBe(0);
      expect(await db.aiProposal.count({ where: { boardId: id } })).toBe(0);
      expect(await db.aiReviewState.count({ where: { boardId: id } })).toBe(0);
      expect(await db.projectAiSettings.count({ where: { projectId: fixture.project.id } })).toBe(
        target === 'board' ? 1 : 0,
      );
      expect(await db.teamMessage.count({ where: { boardId } })).toBeGreaterThan(0);
    },
  );
});

describe('paso 2: actualización de una base del primer parcial', () => {
  it('preserva datos existentes, se puede reaplicar y no deja diferencias con el esquema', async () => {
    const tempRoot = resolve('tmp');
    await mkdir(tempRoot, { recursive: true });
    const temporary = await mkdtemp(resolve(tempRoot, 'team-ai-upgrade-'));
    const child = relative(tempRoot, temporary);
    if (child.startsWith('..') || isAbsolute(child) || child.length === 0)
      throw new Error('Ruta temporal fuera de tmp');
    let database: EphemeralDatabase | undefined;
    let db: PrismaClient | undefined;
    try {
      const migrations = resolve('backend/prisma/migrations');
      const entries = await readdir(migrations);
      for (const name of entries.filter(
        (name) => name < migration || name === 'migration_lock.toml',
      )) {
        await cp(resolve(migrations, name), resolve(temporary, 'migrations', name), {
          recursive: true,
        });
      }
      const config = resolve(temporary, 'prisma.config.ts');
      await writeFile(
        config,
        `import { defineConfig } from 'prisma/config';\nexport default defineConfig({schema: ${JSON.stringify(schema)}, migrations: {path: './migrations'}, datasource: {url: process.env.DATABASE_URL}});\n`,
      );
      database = await startEphemeralDatabase({ prismaConfig: config });
      db = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) });
      const { user, project, board } = await legacyFixture(db);
      await db.boardDocument.create({
        data: { boardId: board.id, state: Buffer.from([0, 255, 1, 128]) },
      });
      await db.boardSnapshot.create({
        data: { boardId: board.id, version: 1, canonicalJson: model },
      });
      await db.auditOperation.create({
        data: {
          boardId: board.id,
          batchId: randomUUID(),
          origin: 'GUI',
          actorId: user.id,
          payload: { preserved: true },
        },
      });
      await db.generation.create({
        data: {
          boardId: board.id,
          snapshotVersion: 1,
          createdBy: user.id,
          projectName: 'Anterior',
          artifactId: 'anterior',
          basePackage: 'com.example',
          schemaVersion: '1.0.0',
          templatesHash: 'fixture',
        },
      });
      const readLegacy = () =>
        db!.board.findUniqueOrThrow({
          where: { id: board.id },
          include: {
            document: true,
            snapshots: true,
            operations: true,
            generations: true,
            project: true,
          },
        });
      const before = await readLegacy();
      const tablesBefore = await db.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
      const env = { ...process.env, DATABASE_URL: database.url };
      // Actualizar primero hasta el paso 2 y conservar una solicitud anterior a
      // requestModel. La ampliacion del paso 3 no puede borrar el historial.
      await cp(resolve(migrations, migration), resolve(temporary, 'migrations', migration), {
        recursive: true,
      });
      await run(process.execPath, [cli, 'migrate', 'deploy', '--config', config], { env });
      const legacyMessageId = randomUUID();
      await db.$executeRaw`INSERT INTO team_messages
        (id, "boardId", "authorKind", "authorId", "clientRequestId", mode, "inputMode", kind, text, status, "updatedAt")
        VALUES (${legacyMessageId}::uuid, ${board.id}::uuid, 'USER', ${user.id}::uuid,
          ${randomUUID()}::uuid, 'ASK', 'TEXT', 'QUESTION', 'Pregunta anterior', 'DONE', now())`;
      await run(process.execPath, [cli, 'migrate', 'deploy'], { env });
      expect(
        await db.teamMessage.findUniqueOrThrow({ where: { id: legacyMessageId } }),
      ).toMatchObject({
        text: 'Pregunta anterior',
        status: 'DONE',
        authorId: user.id,
        requestModel: null,
      });
      expect(await readLegacy()).toEqual(before);
      expect(await db.user.findUnique({ where: { id: user.id } })).toEqual(user);
      const tablesAfter = await db.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
      expect(
        tablesAfter
          .filter((row) => !tablesBefore.some((old) => old.tablename === row.tablename))
          .map((row) => row.tablename),
      ).toEqual(['ai_proposals', 'ai_review_states', 'project_ai_settings', 'team_messages']);
      expect(
        await db.projectAiSettings.findUnique({ where: { projectId: project.id } }),
      ).toBeNull();
      expect(await db.projectAiSettings.create({ data: { projectId: project.id } })).toMatchObject(
        DEFAULT_AI_SETTINGS,
      );
      const second = await run(process.execPath, [cli, 'migrate', 'deploy'], { env });
      expect(second.stdout).toContain('No pending migrations');
      const diff = await run(
        process.execPath,
        [cli, 'migrate', 'diff', '--from-config-datasource', '--to-schema', schema, '--exit-code'],
        { env },
      );
      expect(diff.stdout).toContain('No difference');
    } finally {
      await db?.$disconnect();
      await database?.stop();
      await rm(temporary, { recursive: true, force: true });
    }
  }, 180_000);
});
