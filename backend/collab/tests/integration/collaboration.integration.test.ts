import { HocuspocusProvider } from '@hocuspocus/provider';
import { collaborationRoomName } from '@uml/contracts';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SignJWT } from 'jose';
import { buildCollabServer, type CollabServer } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { startEphemeralDatabase, type EphemeralDatabase } from '../support/database.js';
import { batch, cmd, nextId } from '../support/commands.js';
import { seedProject, type Escenario } from '../support/scenario.js';

/**
 * Las cinco pruebas de colaboracion de la seccion 15.4 mas la de seguridad.
 *
 * Se conectan clientes reales por WebSocket contra el proceso de colaboracion
 * real, con autorizacion real contra PostgreSQL. Un doble de prueba en cualquiera
 * de esas tres capas dejaria sin comprobar justo lo que puede fallar.
 *
 * El cliente usa el `WebSocket` global de Node 22: no hace falta polyfill.
 */

const JWT_SECRET = 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres';

describe('sesion colaborativa', () => {
  let database: EphemeralDatabase;
  let collab: CollabServer;
  let escenario: Escenario;
  let url: string;

  beforeAll(async () => {
    database = await startEphemeralDatabase();

    collab = buildCollabServer(
      loadConfig({
        NODE_ENV: 'test',
        COLLAB_HOST: '127.0.0.1',
        COLLAB_PORT: '0',
        DATABASE_URL: database.url,
        JWT_SECRET,
        // Sin espera: las pruebas comprueban la persistencia y no pueden pasar
        // diez segundos esperando a que se vacie el temporizador.
        STORE_DEBOUNCE_MS: '0',
        STORE_MAX_DEBOUNCE_MS: '1',
      }),
    );

    await collab.listen();
    url = `ws://127.0.0.1:${collab.port()}`;

    escenario = await seedProject(collab.prisma, JWT_SECRET);
  }, 180_000);

  afterAll(async () => {
    await collab?.close();
    await database?.stop();
  });

  /** Conecta un cliente y espera a que reciba el estado inicial. */
  async function conectar(
    room: string,
    token: string,
  ): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: room,
      token,
      document: doc,
    });

    await new Promise<void>((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error(`Sin sincronizar: ${room}`)), 15_000);
      provider.on('synced', () => {
        clearTimeout(temporizador);
        resolve();
      });
    });

    return { doc, provider };
  }

  /** Espera hasta que la condicion se cumpla, o falla. */
  it('rechaza una cuenta pendiente aunque presente un JWT firmado y tenga membresía', async () => {
    const separate = await seedProject(collab.prisma, JWT_SECRET);
    await collab.prisma.user.update({
      where: { id: separate.editorId },
      data: { emailVerifiedAt: null },
    });
    const { authorizeConnection } = await import('../../src/auth/authorize.js');
    await expect(
      authorizeConnection({
        prisma: collab.prisma,
        jwtSecret: new TextEncoder().encode(JWT_SECRET),
        documentName: separate.room,
        token: separate.editorToken,
      }),
    ).rejects.toMatchObject({ reason: 'token-invalido' });
  });

  it('cierra una conexion inactiva revocada y rechaza reconectar con el JWT anterior', async () => {
    const separate = await seedProject(collab.prisma, JWT_SECRET);
    const client = await conectar(separate.room, separate.editorToken);
    try {
      let reason: string | undefined;
      client.provider.on('close', ({ event }: { event: { reason?: string } }) => {
        reason = event.reason;
      });
      await collab.prisma.user.update({
        where: { id: separate.editorId },
        data: { sessionVersion: { increment: 1 } },
      });
      await esperarA(
        () => reason === 'token-invalido',
        'cierre por revocacion sin actividad del cliente',
      );
      const { authorizeConnection } = await import('../../src/auth/authorize.js');
      await expect(
        authorizeConnection({
          prisma: collab.prisma,
          jwtSecret: new TextEncoder().encode(JWT_SECRET),
          documentName: separate.room,
          token: separate.editorToken,
        }),
      ).rejects.toMatchObject({ reason: 'token-invalido' });
    } finally {
      client.provider.destroy();
      client.doc.destroy();
    }
  });

  async function esperarA(condicion: () => boolean, motivo: string): Promise<void> {
    const limite = Date.now() + 10_000;
    while (Date.now() < limite) {
      if (condicion()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No se cumplio a tiempo: ${motivo}`);
  }

  it('CA-A08.1 — un no miembro no entra aunque conozca el identificador de sala', async () => {
    const provider = new HocuspocusProvider({
      url,
      name: escenario.room,
      token: escenario.extranoToken,
      document: new Y.Doc(),
    });

    const rechazo = await new Promise<string>((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error('No se rechazo la conexion')), 15_000);
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        clearTimeout(temporizador);
        resolve(reason);
      });
      provider.on('synced', () => {
        clearTimeout(temporizador);
        reject(new Error('El no miembro entro a la sala'));
      });
    });

    expect(rechazo).toBe('sin-acceso-a-la-pizarra');
    provider.destroy();
  });

  it('rechaza un token invalido', async () => {
    const provider = new HocuspocusProvider({
      url,
      name: escenario.room,
      token: 'esto.no.es.un.token',
      document: new Y.Doc(),
    });

    const rechazo = await new Promise<string>((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error('No se rechazo la conexion')), 15_000);
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        clearTimeout(temporizador);
        resolve(reason);
      });
    });

    expect(rechazo).toBe('token-invalido');
    provider.destroy();
  });

  it('rechaza una sala que no existe en ese proyecto', async () => {
    // Un miembro real montando un nombre de sala con su projectId y la pizarra
    // de otro proyecto.
    const room = collaborationRoomName(escenario.projectId, nextId());

    const provider = new HocuspocusProvider({
      url,
      name: room,
      token: escenario.duenaToken,
      document: new Y.Doc(),
    });

    const rechazo = await new Promise<string>((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error('No se rechazo la conexion')), 15_000);
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        clearTimeout(temporizador);
        resolve(reason);
      });
    });

    // El mismo motivo que para un no miembro: distinguirlos confirmaria que la
    // pizarra existe a quien solo esta probando identificadores.
    expect(rechazo).toBe('sin-acceso-a-la-pizarra');
    provider.destroy();
  });

  it('CA-022.1 — A crea una clase y B la ve sin recargar', async () => {
    const a = await conectar(escenario.room, escenario.duenaToken);
    const b = await conectar(escenario.room, escenario.editorToken);

    const classId = nextId();
    applyBatchToDocument(a.doc, batch(cmd.createClass(classId, 'Producto')));

    await esperarA(
      () => readBoardState(b.doc).semantic.classes.some((c) => c.codeName === 'Producto'),
      'B no vio la clase que creo A',
    );

    a.provider.destroy();
    b.provider.destroy();
  });

  it('A mueve una clase y B lo ve', async () => {
    const a = await conectar(escenario.room, escenario.duenaToken);
    const b = await conectar(escenario.room, escenario.editorToken);

    const classId = nextId();
    applyBatchToDocument(a.doc, batch(cmd.createClass(classId, 'Movible')));
    await esperarA(
      () => readBoardState(b.doc).semantic.classes.some((c) => c.id === classId),
      'B no vio la clase',
    );

    applyBatchToDocument(a.doc, batch(cmd.moveClass(classId, 640, 480)));

    await esperarA(
      () => readBoardState(b.doc).layout.positions[classId]?.x === 640,
      'B no vio el movimiento',
    );

    a.provider.destroy();
    b.provider.destroy();
  });

  it('A cambia una multiplicidad y B lo ve', async () => {
    const a = await conectar(escenario.room, escenario.duenaToken);
    const b = await conectar(escenario.room, escenario.editorToken);

    const origenId = nextId();
    const destinoId = nextId();
    const relacionId = nextId();

    applyBatchToDocument(
      a.doc,
      batch(
        cmd.createClass(origenId, 'Cuenta'),
        cmd.createClass(destinoId, 'Movimiento'),
        cmd.createRelationship(relacionId, origenId, destinoId),
      ),
    );
    await esperarA(
      () => readBoardState(b.doc).semantic.relationships.some((r) => r.id === relacionId),
      'B no vio la relacion',
    );

    applyBatchToDocument(a.doc, batch(cmd.changeMultiplicity(relacionId, '1', '0..1')));

    await esperarA(
      () =>
        readBoardState(b.doc).semantic.relationships.find((r) => r.id === relacionId)
          ?.targetMultiplicity === '0..1',
      'B no vio el cambio de multiplicidad',
    );

    a.provider.destroy();
    b.provider.destroy();
  });

  it('CA-024.1 — un tercero que entra tarde recibe el estado actual', async () => {
    const a = await conectar(escenario.room, escenario.duenaToken);

    for (let i = 0; i < 10; i += 1) {
      applyBatchToDocument(a.doc, batch(cmd.createClass(nextId(), `Tardia ${i + 1}`)));
    }

    const tercero = await conectar(escenario.room, escenario.editorToken);

    await esperarA(
      () =>
        readBoardState(tercero.doc).semantic.classes.filter((c) =>
          c.displayName.startsWith('Tardia'),
        ).length === 10,
      'El tercero no recibio las diez clases',
    );

    a.provider.destroy();
    tercero.provider.destroy();
  });

  it('reconecta, combina los cambios sin conexion y converge otra vez', async () => {
    const a = await conectar(escenario.room, escenario.duenaToken);
    const b = await conectar(escenario.room, escenario.editorToken);

    const desconectado = new Promise<void>((resolve) => {
      b.provider.on('disconnect', () => resolve());
    });
    b.provider.disconnect();
    await desconectado;

    const creadaSinRed = nextId();
    const creadaMientrasNoEstaba = nextId();
    applyBatchToDocument(b.doc, batch(cmd.createClass(creadaSinRed, 'Creada Sin Red')));
    applyBatchToDocument(a.doc, batch(cmd.createClass(creadaMientrasNoEstaba, 'Creada En Linea')));

    b.provider.connect();

    await esperarA(
      () => readBoardState(a.doc).semantic.classes.some((c) => c.id === creadaSinRed),
      'A no recibio el cambio que B hizo sin conexion',
    );
    await esperarA(
      () => readBoardState(b.doc).semantic.classes.some((c) => c.id === creadaMientrasNoEstaba),
      'B no recibio el cambio que ocurrio mientras estaba desconectado',
    );

    expect(readBoardState(a.doc)).toEqual(readBoardState(b.doc));
    a.provider.destroy();
    b.provider.destroy();
  });

  it('CA-004.1 — dos pizarras del mismo proyecto no mezclan actualizaciones', async () => {
    const primera = await conectar(escenario.room, escenario.duenaToken);
    const segunda = await conectar(escenario.otraRoom, escenario.duenaToken);

    applyBatchToDocument(primera.doc, batch(cmd.createClass(nextId(), 'Solo En La Primera')));

    await esperarA(
      () =>
        readBoardState(primera.doc).semantic.classes.some(
          (c) => c.displayName === 'Solo En La Primera',
        ),
      'La primera pizarra no recibio su propia clase',
    );

    // Margen para que, si hubiera fuga entre salas, diera tiempo a manifestarse.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(
      readBoardState(segunda.doc).semantic.classes.some(
        (c) => c.displayName === 'Solo En La Primera',
      ),
    ).toBe(false);

    primera.provider.destroy();
    segunda.provider.destroy();
  });

  it('CA-A08.2 — el servidor descarta las escrituras de un rol de solo lectura', async () => {
    const editor = await conectar(escenario.room, escenario.duenaToken);
    const lector = await conectar(escenario.room, escenario.lectorToken);

    // El lector ve lo que hay.
    const visibleId = nextId();
    applyBatchToDocument(editor.doc, batch(cmd.createClass(visibleId, 'Visible Para Todos')));
    await esperarA(
      () => readBoardState(lector.doc).semantic.classes.some((c) => c.id === visibleId),
      'El lector no vio la clase',
    );

    // Y escribe en su propia replica, que es lo unico que puede hacer nadie sin
    // permiso: lo que importa es que el servidor no lo propague.
    const prohibidoId = nextId();
    applyBatchToDocument(lector.doc, batch(cmd.createClass(prohibidoId, 'No Deberia Llegar')));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(readBoardState(editor.doc).semantic.classes.some((c) => c.id === prohibidoId)).toBe(
      false,
    );

    editor.provider.destroy();
    lector.provider.destroy();
  });

  it('un EDITOR degradado con la pizarra abierta deja de escribir inmediatamente', async () => {
    const propietaria = await conectar(escenario.room, escenario.duenaToken);
    const editor = await conectar(escenario.room, escenario.editorToken);

    await collab.prisma.projectMember.update({
      where: {
        projectId_userId: { projectId: escenario.projectId, userId: escenario.editorId },
      },
      data: { role: 'VIEWER' },
    });

    const prohibidoId = nextId();
    applyBatchToDocument(editor.doc, batch(cmd.createClass(prohibidoId, 'Rol Ya Cambiado')));
    await new Promise((resolve) => setTimeout(resolve, 750));

    expect(readBoardState(propietaria.doc).semantic.classes.some((c) => c.id === prohibidoId)).toBe(
      false,
    );

    // Se devuelve el escenario a su estado inicial para las pruebas siguientes.
    await collab.prisma.projectMember.update({
      where: {
        projectId_userId: { projectId: escenario.projectId, userId: escenario.editorId },
      },
      data: { role: 'EDITOR' },
    });
    propietaria.provider.destroy();
    editor.provider.destroy();
  });

  it('RA-11 — el documento se persiste en binario y se rehidrata', async () => {
    const sala = escenario.terceraRoom;
    const primera = await conectar(sala, escenario.duenaToken);

    const classId = nextId();
    applyBatchToDocument(
      primera.doc,
      batch(cmd.createClass(classId, 'Persistente'), cmd.addAttribute(classId, nextId(), 'nombre')),
    );

    // Al cerrar la ultima conexion, el documento se guarda.
    primera.provider.destroy();

    // Se sondea la base: el guardado ocurre al cerrarse la ultima conexion y no
    // hay evento local al que engancharse.
    let guardado: { state: Uint8Array } | null = null;
    const limite = Date.now() + 10_000;
    while (guardado === null && Date.now() < limite) {
      guardado = await collab.prisma.boardDocument.findUnique({
        where: { boardId: escenario.terceraBoardId },
        select: { state: true },
      });
      if (guardado === null) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(guardado).not.toBeNull();

    // Y la proyeccion canonica se guarda ademas, para poder inspeccionar y
    // generar sin cargar Yjs.
    const snapshot = await collab.prisma.boardSnapshot.findUnique({
      where: { boardId_version: { boardId: escenario.terceraBoardId, version: 1 } },
      select: { canonicalJson: true },
    });
    expect(JSON.stringify(snapshot?.canonicalJson)).toContain('Persistente');

    // Quien vuelve a abrir la sala recibe lo que habia.
    const segunda = await conectar(sala, escenario.duenaToken);
    await esperarA(
      () => readBoardState(segunda.doc).semantic.classes.some((c) => c.id === classId),
      'El documento no se rehidrato desde la base',
    );

    const rehidratada = readBoardState(segunda.doc).semantic.classes.find((c) => c.id === classId);
    expect(rehidratada?.attributes.map((a) => a.codeName)).toEqual(['nombre']);

    segunda.provider.destroy();
  });

  it('un miembro retirado no recibe nuevas ediciones aunque permanezca pasivo', async () => {
    const local = await seedProject(collab.prisma, JWT_SECRET);
    const owner = await conectar(local.room, local.duenaToken);
    const removed = await conectar(local.room, local.editorToken);
    try {
      await collab.prisma.projectMember.delete({
        where: { projectId_userId: { projectId: local.projectId, userId: local.editorId } },
      });
      const classId = nextId();
      applyBatchToDocument(owner.doc, batch(cmd.createClass(classId, 'Privada')));
      await esperarA(
        () => collab.server.hocuspocus.documents.get(local.room)?.getConnectionsCount() === 1,
        'La conexion retirada sigue en la sala',
      );
      expect(readBoardState(removed.doc).semantic.classes.some((c) => c.id === classId)).toBe(
        false,
      );
    } finally {
      owner.provider.destroy();
      removed.provider.destroy();
    }
  });

  it('RNF-01 y RNF-02 — cinco usuarios convergen con P95 local inferior a 500 ms', async () => {
    const local = await seedProject(collab.prisma, JWT_SECRET);
    const tokens = [local.duenaToken, local.editorToken, local.lectorToken];
    for (let index = 0; index < 2; index += 1) {
      const user = await collab.prisma.user.create({
        data: {
          email: `carga-${crypto.randomUUID()}@example.com`,
          displayName: 'Participante',
          emailVerifiedAt: new Date(),
          passwordHash: 'no-se-usa',
          memberships: { create: { projectId: local.projectId, role: 'EDITOR' } },
        },
      });
      tokens.push(
        await new SignJWT({ email: user.email })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(user.id)
          .setIssuer('plataforma-uml')
          .setAudience('plataforma-uml-clients')
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode(JWT_SECRET)),
      );
    }
    const clients: Awaited<ReturnType<typeof conectar>>[] = [];
    try {
      for (const token of tokens) clients.push(await conectar(local.room, token));
      const latencies: number[] = [];
      for (let index = 0; index < 30; index += 1) {
        const classId = nextId();
        const started = performance.now();
        applyBatchToDocument(clients[0]!.doc, batch(cmd.createClass(classId, `Entidad ${index}`)));
        await esperarA(
          () =>
            clients.every(({ doc }) =>
              readBoardState(doc).semantic.classes.some((c) => c.id === classId),
            ),
          'Los cinco usuarios no convergieron',
        );
        latencies.push(performance.now() - started);
      }
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
      // Por stderr, como el resto de mediciones del repositorio: el numero es
      // el resultado de la prueba, no un rastro de depuracion.
      process.stderr.write(
        `RNF-01/02: 5 usuarios, 30 cambios, P95=${p95.toFixed(1)} ms; ` +
          'loopback, sin render del navegador.\n',
      );
      expect(p95).toBeLessThan(500);
    } finally {
      for (const client of clients) client.provider.destroy();
    }
  });

  it('RNF-04 — diez salas del mismo proyecto conservan estados separados', async () => {
    const local = await seedProject(collab.prisma, JWT_SECRET);
    const clients: Awaited<ReturnType<typeof conectar>>[] = [];
    const ids: string[] = [];
    try {
      for (let index = 0; index < 10; index += 1) {
        const board = await collab.prisma.board.create({
          data: { projectId: local.projectId, displayName: `Pizarra ${index}` },
        });
        const client = await conectar(
          collaborationRoomName(local.projectId, board.id),
          local.duenaToken,
        );
        clients.push(client);
        const classId = nextId();
        ids.push(classId);
        applyBatchToDocument(client.doc, batch(cmd.createClass(classId, `Exclusiva ${index}`)));
      }
      for (let index = 0; index < clients.length; index += 1) {
        const client = clients[index]!;
        const mirror = await conectar(client.provider.configuration.name, local.duenaToken);
        try {
          await esperarA(
            () => readBoardState(mirror.doc).semantic.classes.length === 1,
            'No llego el estado de la sala',
          );
          expect(readBoardState(mirror.doc).semantic.classes.map((c) => c.id)).toEqual([
            ids[index],
          ]);
        } finally {
          mirror.provider.destroy();
        }
      }
    } finally {
      for (const client of clients) client.provider.destroy();
    }
  });

  it('un token vencido en una conexion abierta deja de recibir cambios', async () => {
    const local = await seedProject(collab.prisma, JWT_SECRET);
    const expiresAt = Math.floor(Date.now() / 1000) + 2;
    const token = await new SignJWT({ email: 'editor@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(local.editorId)
      .setIssuer('plataforma-uml')
      .setAudience('plataforma-uml-clients')
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(JWT_SECRET));
    const owner = await conectar(local.room, local.duenaToken);
    const expired = await conectar(local.room, token);
    try {
      await esperarA(() => Date.now() >= expiresAt * 1000, 'El token aun no vencio');
      const classId = nextId();
      applyBatchToDocument(owner.doc, batch(cmd.createClass(classId, 'Posterior al vencimiento')));
      await esperarA(
        () => collab.server.hocuspocus.documents.get(local.room)?.getConnectionsCount() === 1,
        'La conexion vencida sigue en la sala',
      );
      expect(readBoardState(expired.doc).semantic.classes.some((c) => c.id === classId)).toBe(
        false,
      );
    } finally {
      owner.provider.destroy();
      expired.provider.destroy();
    }
  });
});
