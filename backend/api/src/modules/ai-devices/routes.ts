import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  aiExecutionTargetSchema,
  personalAiChoiceSchema,
  type AiExecutionTarget,
} from '@uml/contracts';
import type { Config } from '../../config.js';
import { currentUser } from '../../plugins/auth.js';
import { badRequest, forbidden, notFound, unauthorized, HttpError } from '../../lib/http-error.js';
import { createAiConnections, type AiConnections } from './connections.js';

export const hashDeviceSecret = (value: string) => createHash('sha256').update(value).digest('hex');
const pairBody = z
  .object({ code: z.string().min(16).max(64), name: z.string().trim().min(1).max(80) })
  .strict();
const params = z.object({ id: z.string().uuid() });

export function buildAiConnections(app: FastifyInstance, config: Config) {
  const allowedEmails = new Set(config.AI_VM_ALLOWED_EMAILS);
  return createAiConnections({
    server: app.server,
    origin: config.WEB_ORIGIN,
    trustProxyHops: config.TRUST_PROXY_HOPS,
    rateLimitEnabled: config.RATE_LIMIT_ENABLED,
    timeoutMs: {
      DEVICE: config.TEAM_AI_DEVICE_TIMEOUT_MS,
      VM: Math.max(1000, Math.min(config.TEAM_AI_TIMEOUT_MS, 300_000)),
    },
    async canUseVm(userId) {
      if (!config.AI_VM_CONNECTOR_TOKEN || !allowedEmails.size) return false;
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      });
      return !!user && user.emailVerifiedAt !== null && allowedEmails.has(user.email.toLowerCase());
    },
    async authenticate(hello) {
      if (hello.kind === 'VM') {
        const expected = config.AI_VM_CONNECTOR_TOKEN;
        if (
          !expected ||
          !timingSafeEqual(
            Buffer.from(hashDeviceSecret(hello.token)),
            Buffer.from(hashDeviceSecret(expected)),
          )
        )
          return null;
        return { key: 'vm', valid: async () => true };
      }
      const device = await app.prisma.aiDevice.findUnique({
        where: { tokenHash: hashDeviceSecret(hello.token) },
      });
      if (!device) return null;
      const valid = async () => {
        const current = await app.prisma.aiDevice.findUnique({
          where: { id: device.id },
          include: { user: { select: { sessionVersion: true, emailVerifiedAt: true } } },
        });
        return (
          !!current &&
          current.expiresAt > new Date() &&
          current.user.emailVerifiedAt !== null &&
          current.sessionVersion === current.user.sessionVersion
        );
      };
      return (await valid()) ? { key: device.id, valid } : null;
    },
  });
}

export async function projectVmEngine(connections: AiConnections | undefined, userId: string) {
  const vmAllowed = (await connections?.canUseVm(userId)) ?? false;
  const vmModel = vmAllowed ? (connections?.status('vm').models[0]?.name ?? null) : null;
  return { vmAllowed, vmModel };
}

export async function requireProjectVm(connections: AiConnections | undefined, userId: string) {
  const { vmAllowed, vmModel } = await projectVmEngine(connections, userId);
  if (!vmAllowed)
    throw forbidden(
      'Tu cuenta aún no tiene acceso a IA de VM. Elige otro motor en «Mi motor de IA».',
    );
  if (!vmModel)
    throw new HttpError(
      409,
      'ai_engine_unavailable',
      'IA de VM está desconectada. Elige otro motor o vuelve a intentar.',
    );
  return { source: 'VM' as const, model: vmModel };
}

export async function resolveAiTarget(
  db: Prisma.TransactionClient,
  connections: AiConnections,
  userId: string,
  projectSource: 'PROVIDERS' | 'LOCAL' | 'VM',
): Promise<AiExecutionTarget> {
  const preference = await db.userAiPreference.findUnique({ where: { userId } });
  if (!preference || preference.source === 'PROJECT') {
    if (projectSource === 'VM') return requireProjectVm(connections, userId);
    return { source: projectSource };
  }
  if (preference.source === 'PROVIDERS') return { source: 'PROVIDERS' };
  const target = aiExecutionTargetSchema.parse(
    preference.source === 'VM'
      ? { source: 'VM', model: preference.model }
      : { source: 'DEVICE', deviceId: preference.deviceId, model: preference.model },
  );
  await authorizeAiTarget(db, connections, userId, target);
  return target;
}

export async function authorizeAiTarget(
  db: Pick<PrismaClient, 'aiDevice'> | Pick<Prisma.TransactionClient, 'aiDevice'>,
  connections: AiConnections,
  userId: string,
  target: AiExecutionTarget,
) {
  if (target.source !== 'VM' && target.source !== 'DEVICE') return;
  if (target.source === 'VM' && !(await connections.canUseVm(userId)))
    throw forbidden('Tu cuenta aún no tiene acceso a IA de VM.');
  if (target.source === 'DEVICE') {
    const device = await db.aiDevice.findFirst({
      where: { id: target.deviceId, userId, expiresAt: { gt: new Date() } },
      include: { user: { select: { sessionVersion: true } } },
    });
    if (!device || device.sessionVersion !== device.user.sessionVersion)
      throw badRequest(
        'ai_device_unavailable',
        'Tu dispositivo no está disponible. Vuelve a vincularlo.',
      );
  }
  const status = connections.status(target.source === 'VM' ? 'vm' : target.deviceId);
  if (!status.connected || !status.models.some((model) => model.name === target.model))
    throw new HttpError(
      409,
      'ai_engine_unavailable',
      target.source === 'VM'
        ? 'IA de VM no está conectada con ese modelo.'
        : 'Tu computadora no está conectada con ese modelo.',
    );
}

export async function aiDeviceRoutes(
  app: FastifyInstance,
  { connections }: { connections: AiConnections },
) {
  const auth = { preHandler: app.authenticate };
  app.get('/ai-devices/connect', async (_request, reply) =>
    reply
      .code(426)
      .send({ error: { code: 'websocket_required', message: 'Usa el conector de IA.' } }),
  );
  app.get('/ai-devices/connector.mjs', async (_request, reply) => {
    const path = fileURLToPath(new URL('../../../../../scripts/ai-connector.mjs', import.meta.url));
    return reply
      .type('text/javascript')
      .header('Content-Disposition', 'attachment; filename="ai-connector.mjs"')
      .send(await readFile(path));
  });
  app.post('/ai-devices/pairing', auth, async (request, reply) => {
    const { userId, sessionVersion = 0 } = currentUser(request);
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await app.prisma.aiDevicePairing.upsert({
      where: { userId },
      create: { userId, codeHash: hashDeviceSecret(code), expiresAt, sessionVersion },
      update: { codeHash: hashDeviceSecret(code), expiresAt, sessionVersion },
    });
    return reply.header('Cache-Control', 'no-store').send({ code, expiresAt });
  });
  app.post('/ai-devices/pair', async (request, reply) => {
    const body = pairBody.parse(request.body);
    const token = randomBytes(48).toString('base64url');
    const device = await app.prisma.$transaction(async (tx) => {
      const pairing = await tx.aiDevicePairing.findUnique({
        where: { codeHash: hashDeviceSecret(body.code) },
        include: { user: { select: { sessionVersion: true, emailVerifiedAt: true } } },
      });
      if (
        !pairing ||
        pairing.expiresAt <= new Date() ||
        pairing.user.emailVerifiedAt === null ||
        pairing.sessionVersion !== pairing.user.sessionVersion
      )
        throw unauthorized('El código de vinculación venció o ya fue utilizado.');
      const consumed = await tx.aiDevicePairing.deleteMany({
        where: { id: pairing.id, codeHash: pairing.codeHash },
      });
      if (consumed.count !== 1) throw unauthorized('El código ya fue utilizado.');
      if ((await tx.aiDevice.count({ where: { userId: pairing.userId } })) >= 10)
        throw badRequest('ai_device_limit', 'Desvincula un dispositivo antes de añadir otro.');
      return tx.aiDevice.create({
        data: {
          userId: pairing.userId,
          name: body.name,
          tokenHash: hashDeviceSecret(token),
          sessionVersion: pairing.sessionVersion,
          expiresAt: new Date(Date.now() + 90 * 86400_000),
        },
      });
    });
    return reply
      .header('Cache-Control', 'no-store')
      .code(201)
      .send({ id: device.id, token, expiresAt: device.expiresAt });
  });
  app.get('/ai-devices', auth, async (request, reply) => {
    const { userId } = currentUser(request);
    const [saved, devices, vmAllowed] = await Promise.all([
      app.prisma.userAiPreference.findUnique({ where: { userId } }),
      app.prisma.aiDevice.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      connections.canUseVm(userId),
    ]);
    const choice = personalAiChoiceSchema.parse(
      saved
        ? { source: saved.source, deviceId: saved.deviceId, model: saved.model }
        : { source: 'PROJECT' },
    );
    return reply.header('Cache-Control', 'no-store').send({
      choice,
      vm: vmAllowed
        ? { ...connections.status('vm'), allowed: true }
        : { allowed: false, connected: false, models: [], active: 0 },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        expiresAt: d.expiresAt,
        ...connections.status(d.id),
      })),
    });
  });
  app.put('/ai-devices/preference', auth, async (request) => {
    const { userId } = currentUser(request);
    const choice = personalAiChoiceSchema.parse(request.body);
    if (choice.source === 'DEVICE' || choice.source === 'VM') {
      const target =
        choice.source === 'VM'
          ? { source: 'VM' as const, model: choice.model! }
          : { source: 'DEVICE' as const, model: choice.model!, deviceId: choice.deviceId! };
      await authorizeAiTarget(app.prisma, connections, userId, target);
    }
    await app.prisma.userAiPreference.upsert({
      where: { userId },
      create: { userId, ...choice },
      update: choice,
    });
    return choice;
  });
  app.delete('/ai-devices/:id', auth, async (request, reply) => {
    const { userId } = currentUser(request);
    const { id } = params.parse(request.params);
    const removed = await app.prisma.$transaction(async (tx) => {
      const result = await tx.aiDevice.deleteMany({ where: { id, userId } });
      if (!result.count) throw notFound();
      await tx.userAiPreference.updateMany({
        where: { userId, deviceId: id },
        data: { source: 'PROJECT', deviceId: null, model: null },
      });
      return result;
    });
    if (removed.count) connections.disconnect(id);
    return reply.code(204).send();
  });
}
