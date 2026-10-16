import { roleCanWrite, SCHEMA_VERSION } from '@uml/contracts';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  IncomingMessage as HocuspocusIncomingMessage, // Servidor Colaborativo
  MessageType,
  Server,
  type Connection,
} from '@hocuspocus/server';
import type { IncomingMessage } from 'node:http';
import type { Config } from './config.js';
import {
  UnauthorizedConnection,
  authorizeConnection,
  parseRoomName,
  type CollaborationContext,
} from './auth/authorize.js';
import { loadBoardDocument, storeBoardDocument } from './persistence/board-store.js';

export const SERVICE_NAME = 'collab';

/**
 * Fuerza la escritura del documento vivo antes de generar
 */
async function atenderVolcado(options: {
  server: Server<CollaborationContext>;
  prisma: PrismaClient;
  jwtSecret: Uint8Array;
  request: IncomingMessage;
  responder: (status: number, cuerpo: unknown) => void;
}): Promise<void> {
  const { server, prisma, jwtSecret, request, responder } = options;

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await leerCuerpo(request));
  } catch {
    responder(400, { error: 'cuerpo_invalido' });
    return;
  }

  if (
    typeof cuerpo !== 'object' ||
    cuerpo === null ||
    !('room' in cuerpo) ||
    !('token' in cuerpo)
  ) {
    responder(400, { error: 'cuerpo_invalido' });
    return;
  }
  const room = cuerpo.room;
  const token = cuerpo.token;
  if (typeof room !== 'string' || typeof token !== 'string') {
    responder(400, { error: 'cuerpo_invalido' });
    return;
  }

  let boardId: string;
  try {
    await authorizeConnection({ prisma, jwtSecret, documentName: room, token });
    boardId = parseRoomName(room).boardId;
  } catch (error) {
    responder(403, {
      error: error instanceof UnauthorizedConnection ? error.reason : 'sin-acceso-a-la-pizarra',
    });
    return;
  }

  const document = server.hocuspocus.documents.get(room); // Hopuscopus mantiene los documentos abiertos en memoria

  if (document === undefined) {
    responder(200, { stored: false });
    return;
  }

  await storeBoardDocument(prisma, boardId, document);
  responder(200, { stored: true });
}

async function leerCuerpo(request: IncomingMessage): Promise<string> {
  const trozos: Buffer[] = [];
  let total = 0;

  for await (const trozo of request) {
    const buffer = trozo as Buffer;
    total += buffer.byteLength;
    // Este cuerpo son dos cadenas. Cualquier cosa mayor es un error o un abuso.
    if (total > 8192) throw new Error('cuerpo demasiado grande');
    trozos.push(buffer);
  }

  return Buffer.concat(trozos).toString('utf8');
}

export interface CollabServer {
  readonly server: Server<CollaborationContext>;
  readonly prisma: PrismaClient;
  listen(): Promise<void>;
  /** Puerto real. Util cuando se pide el 0 para que el sistema elija. */
  port(): number;
  close(): Promise<void>;
}

/**
 * Proceso de colaboracion
 * Cada sala tiene su propio documento, y por eso dos pizarras del mismo proyecto
 * no mezclan actualizaciones: son dos documentos distintos, no dos vistas del mismo.
 */
export function buildCollabServer(config: Config): CollabServer {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

  const server = new Server<CollaborationContext>({
    port: config.COLLAB_PORT,
    address: config.COLLAB_HOST,
    // El apagado lo gobierna el proceso, no la libreria:
    // asi se cierra tambien la conexion a la base.
    stopOnSignals: false,
    quiet: config.NODE_ENV !== 'development',

    debounce: config.STORE_DEBOUNCE_MS,
    maxDebounce: config.STORE_MAX_DEBOUNCE_MS,

    /**
     * Se autoriza antes de entregar el documento
     * Lanzar aqui rechaza la conexion. Hocuspocus solo llama a este gancho si el
     * cliente envia un token, asi que una conexion sin token nunca queda
     * autenticada y no recibe nada.
     */
    async onAuthenticate(data) {
      let resultado;
      try {
        resultado = await authorizeConnection({
          prisma,
          jwtSecret,
          documentName: data.documentName,
          token: data.token,
        });
      } catch (error) {
        if (error instanceof UnauthorizedConnection) {
          // El detalle queda aqui; al cliente solo le llega el motivo corto.
          console.warn(
            JSON.stringify({
              service: SERVICE_NAME,
              msg: 'conexion rechazada',
              room: data.documentName,
              reason: error.reason,
              detail: error.message,
            }),
          );
        }
        throw error;
      }

      const { context, readOnly } = resultado;

      // El rol de lectura se conecta y ve, pero el servidor descarta
      // sus escrituras. No basta con ocultarlas en la interfaz.
      data.connectionConfig.readOnly = readOnly;

      return context;
    },

    /** Se rehidrata desde la representacion binaria nativa. */
    async onLoadDocument(data) {
      const { boardId } = parseRoomName(data.documentName);
      await loadBoardDocument(prisma, boardId, data.document);
      return data.document;
    },

    /**
     * El rol no se congela al abrir la pestaña. Antes de procesar cada mensaje se
     * consulta la membresia actual: degradar a VIEWER bloquea el siguiente update
     * y quitar al miembro cierra la conexion existente.
     */
    async beforeHandleMessage(data) {
      // Presencia y ping no esperan SQL. Los mensajes sin estado sí revisan
      // permisos: permiten detectar cambios de rol aun sin editar el documento.
      if (!requiereRevisarAcceso(data.update)) return;

      // Se revisan tambien los receptores: un miembro expulsado que no escriba
      // nada no debe seguir recibiendo los cambios del resto de la sala.
      const connections = [
        ...new Set([
          ...(data.document.getConnections() as Connection<CollaborationContext>[]),
          data.connection,
        ]),
      ];
      const board = await prisma.board.findUnique({
        where: { id: data.context.boardId },
        select: {
          projectId: true,
          project: {
            select: {
              members: {
                where: {
                  userId: { in: connections.map((connection) => connection.context.userId) },
                },
                select: { userId: true, role: true, user: { select: { sessionVersion: true } } },
              },
            },
          },
        },
      });
      const roles = new Map(board?.project.members.map((member) => [member.userId, member.role]));
      const versions = new Map(
        board?.project.members.map((member) => [member.userId, member.user.sessionVersion]),
      );
      for (const connection of connections) {
        const role = roles.get(connection.context.userId);
        const expired =
          connection.context.expiresAt <= Date.now() ||
          (role !== undefined &&
            versions.get(connection.context.userId) !== connection.context.sessionVersion);
        if (expired || role === undefined || board?.projectId !== connection.context.projectId) {
          connection.close({
            code: expired ? 4401 : 4403,
            reason: expired ? 'token-invalido' : 'sin-acceso-a-la-pizarra',
          });
        } else {
          const readOnly = !roleCanWrite(role);
          if (connection.readOnly !== readOnly) {
            connection.readOnly = readOnly;
            // El cliente debe descartar su réplica con cambios rechazados y
            // resincronizar antes de volver a mostrar el documento como vivo.
            connection.sendStateless(JSON.stringify({ type: 'access-changed', readOnly }));
          }
        }
      }
      // Una desconexion normal puede ocurrir mientras SQL responde. Sus ultimos
      // mensajes recibidos siguen siendo validos y deben alcanzar la persistencia.
      if (
        data.context.expiresAt <= Date.now() ||
        versions.get(data.context.userId) !== data.context.sessionVersion ||
        !roles.has(data.context.userId) ||
        board?.projectId !== data.context.projectId
      ) {
        throw new UnauthorizedConnection(
          'sin-acceso-a-la-pizarra',
          'La sesion ya no tiene acceso.',
        );
      }
    },

    async onStoreDocument(data) {
      const { boardId } = parseRoomName(data.documentName);
      await storeBoardDocument(prisma, boardId, data.document);
    },

    /**
     * Sonda de vida.
     * Todo el trafico util de este proceso va por WebSocket.
     * El gancho atiende todas las rutas, no solo `/health`. Si resolviera sin
     * escribir, Hocuspocus responderia su propio 200 con un texto que nombra el
     * software: superficie HTTP que nadie vigila y una pista gratuita sobre la
     * pila para quien este mirando.
     *
     * Rechazar sin motivo es como se le dice a Hocuspocus que la peticion ya
     * esta atendida.
     */
    async onRequest(data) {
      const responder = (status: number, cuerpo: unknown): void => {
        data.response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        data.response.end(JSON.stringify(cuerpo));
      };

      if (data.request.method === 'GET' && data.request.url === '/health') {
        responder(200, {
          status: 'ok',
          service: SERVICE_NAME,
          schemaVersion: SCHEMA_VERSION,
          uptimeSeconds: Math.round(process.uptime()),
        });
        return Promise.reject();
      }

      if (data.request.method === 'POST' && data.request.url === '/flush') {
        await atenderVolcado({ server, prisma, jwtSecret, request: data.request, responder });
        return Promise.reject();
      }

      responder(404, { error: 'not_found' });
      return Promise.reject();
    },
  });

  let revocationTimer: ReturnType<typeof setInterval> | undefined;
  let revocationCheck: Promise<void> | undefined;
  async function closeRevokedSessions(): Promise<void> {
    const connections = [...server.hocuspocus.documents.values()].flatMap(
      (document) => document.getConnections() as Connection<CollaborationContext>[],
    );
    if (connections.length === 0) return;
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(connections.map((c) => c.context.userId))] } },
      select: { id: true, sessionVersion: true },
    });
    const versions = new Map(users.map((user) => [user.id, user.sessionVersion]));
    for (const connection of connections) {
      if (
        connection.context.expiresAt <= Date.now() ||
        versions.get(connection.context.userId) !== connection.context.sessionVersion
      ) {
        connection.close({ code: 4401, reason: 'token-invalido' });
      }
    }
  }

  return {
    server,
    prisma,
    async listen() {
      await server.listen();
      // También cierra clientes inactivos que no envían el latido del navegador.
      revocationTimer = setInterval(() => {
        revocationCheck ??= closeRevokedSessions()
          .catch((error: unknown) =>
            console.warn('No se pudo comprobar la revocación de sesiones', error),
          )
          .finally(() => {
            revocationCheck = undefined;
          });
      }, 5000);
      revocationTimer.unref();
    },
    port() {
      return server.address.port;
    },
    async close() {
      clearInterval(revocationTimer);
      await revocationCheck;
      await server.destroy();
      await prisma.$disconnect();
    },
  };
}

function requiereRevisarAcceso(update: Uint8Array): boolean {
  try {
    const message = new HocuspocusIncomingMessage(update);
    message.readVarString(); // dirección de documento
    const type = message.readVarUint();
    return (
      type === MessageType.Sync || type === MessageType.SyncReply || type === MessageType.Stateless
    );
  } catch {
    // Que el receptor normal produzca el error de protocolo correspondiente.
    // Autorizar por defecto un mensaje indescifrable sería peor que una consulta
    // adicional que terminará igualmente con el cierre de la conexión.
    return true;
  }
}

export { UnauthorizedConnection };
