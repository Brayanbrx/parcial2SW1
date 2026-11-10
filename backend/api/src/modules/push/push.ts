import { importPKCS8, SignJWT } from 'jose';
import type { Command, CommandBatch } from '@uml/contracts';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config.js';
import { isSemanticBatch } from '../team-ai/review-evidence.js';

/**
 * Notificaciones push para la app movil (FCM HTTP v1).
 *
 * Se firma con `jose` el JWT de la cuenta de servicio y se cambia por un token
 * OAuth2; no hace falta el SDK de Firebase. Todo fallo es prescindible: una
 * notificacion perdida nunca debe romper la edicion que la origino.
 */

interface ServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
}

export interface PushNotifier {
  readonly enabled: boolean;
  /** Avisa a los demas miembros del proyecto de un lote ya aplicado. */
  notifyBatch(boardId: string, actorId: string, batch: CommandBatch): void;
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  } catch {
    return null;
  }
}

/** Texto en español del efecto de un lote: «creó la tabla Cliente». */
export function describeBatch(
  commands: readonly Command[],
  knownClasses: ReadonlyMap<string, string>,
): string {
  const names = new Map(knownClasses);
  for (const c of commands) {
    if (c.type === 'CREATE_CLASS' || c.type === 'RENAME_CLASS')
      names.set(c.payload.classId, c.payload.displayName);
  }
  const tabla = (id: string) => {
    const name = names.get(id);
    return name ? `la tabla ${name}` : 'una tabla';
  };
  const parts: string[] = [];
  const add = (text: string) => {
    if (!parts.includes(text)) parts.push(text);
  };
  for (const c of commands) {
    switch (c.type) {
      case 'CREATE_CLASS':
        add(`creó ${tabla(c.payload.classId)}`);
        break;
      case 'RENAME_CLASS':
        add(`renombró ${tabla(c.payload.classId)}`);
        break;
      case 'DELETE_CLASS':
        add(`eliminó ${tabla(c.payload.classId)}`);
        break;
      case 'ADD_ATTRIBUTE':
        add(`agregó el campo ${c.payload.displayName} a ${tabla(c.payload.classId)}`);
        break;
      case 'UPDATE_ATTRIBUTE':
        add(`modificó un campo de ${tabla(c.payload.classId)}`);
        break;
      case 'DELETE_ATTRIBUTE':
        add(`eliminó un campo de ${tabla(c.payload.classId)}`);
        break;
      case 'CREATE_RELATIONSHIP':
        add('creó una relación');
        break;
      case 'UPDATE_RELATIONSHIP':
      case 'CHANGE_MULTIPLICITY':
        add('modificó una relación');
        break;
      case 'DELETE_RELATIONSHIP':
        add('eliminó una relación');
        break;
      case 'MOVE_CLASS':
        break;
    }
  }
  if (parts.length === 0) return 'modificó el diagrama';
  if (parts.length <= 2) return parts.join(' y ');
  return `${parts[0]} y ${parts.length - 1} cambios más`;
}

export function createPushNotifier(
  config: Config,
  prisma: PrismaClient,
  log: Pick<FastifyBaseLogger, 'warn' | 'info'>,
): PushNotifier {
  const account = parseServiceAccount(config.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!account) {
    return { enabled: false, notifyBatch: () => {} };
  }
  const sa: ServiceAccount = account;
  log.info('notificaciones push activas');

  let cached: { token: string; expiresAt: number } | null = null;
  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, 'RS256');
    const assertion = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('55m')
      .sign(key);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`oauth ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  async function sendOne(
    bearer: string,
    token: string,
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<'ok' | 'invalid'> {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data,
            android: { priority: 'HIGH', notification: { channel_id: 'cambios' } },
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.ok) return 'ok';
    if (response.status === 404 || response.status === 400) {
      const text = await response.text();
      if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(text)) return 'invalid';
    }
    throw new Error(`fcm ${response.status}`);
  }

  // Evita una avalancha mientras alguien teclea: un aviso por pizarra y autor cada 20 s.
  const lastSent = new Map<string, number>();
  const THROTTLE_MS = 20_000;

  async function run(boardId: string, actorId: string, batch: CommandBatch): Promise<void> {
    const key = `${boardId}:${actorId}`;
    const now = Date.now();
    if ((lastSent.get(key) ?? 0) + THROTTLE_MS > now) return;
    lastSent.set(key, now);
    if (lastSent.size > 5000) lastSent.clear();

    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: {
        displayName: true,
        projectId: true,
        project: { select: { displayName: true } },
        snapshots: { where: { version: 1 }, select: { canonicalJson: true } },
      },
    });
    if (!board) return;
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { displayName: true },
    });
    const devices = await prisma.deviceToken.findMany({
      where: {
        userId: { not: actorId },
        user: { memberships: { some: { projectId: board.projectId } } },
      },
      select: { token: true },
    });
    if (devices.length === 0) return;

    const known = new Map<string, string>();
    const model = board.snapshots[0]?.canonicalJson as
      { classes?: { id: string; displayName: string }[] } | undefined;
    for (const c of model?.classes ?? []) known.set(c.id, c.displayName);

    const title = `${board.project.displayName} · ${board.displayName}`;
    const body = `${actor?.displayName ?? 'Alguien'} ${describeBatch(batch.commands, known)}`;
    const bearer = await accessToken();
    const invalid: string[] = [];
    await Promise.all(
      devices.map(async ({ token }) => {
        try {
          const result = await sendOne(bearer, token, title, body, {
            projectId: board.projectId,
            boardId,
            type: 'board.changed',
          });
          if (result === 'invalid') invalid.push(token);
        } catch (error) {
          log.warn({ err: String(error) }, 'push no entregado');
        }
      }),
    );
    if (invalid.length > 0)
      await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
  }

  return {
    enabled: true,
    notifyBatch(boardId, actorId, batch) {
      if (!isSemanticBatch(batch.commands)) return;
      void run(boardId, actorId, batch).catch((error: unknown) =>
        log.warn({ err: String(error) }, 'push fallido'),
      );
    },
  };
}
