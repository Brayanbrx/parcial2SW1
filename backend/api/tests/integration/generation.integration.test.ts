import { fixture } from '@uml/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * Generación desde la pizarra y registro de auditoría (M6, M7 y RF-A09).
 *
 * Es el paso del guion 16.2 que faltaba: «seleccionar la pizarra y generar →
 * descargar el ZIP». El motor ya estaba verificado sobre siete modelos por
 * `npm run test:bank`; lo que se prueba aquí es el camino desde la pizarra viva
 * hasta un archivo descargable, con la autorización y el congelamiento del
 * snapshot que exige RA-08.
 */
describe('generacion desde la pizarra y auditoria', () => {
  let api: Harness;
  let duena: Awaited<ReturnType<Harness['signUp']>>;
  let lector: Awaited<ReturnType<Harness['signUp']>>;
  let extrano: Awaited<ReturnType<Harness['signUp']>>;
  let projectId: string;
  let boardId: string;

  const t01 = fixture('T01').model;

  /**
   * Escribe la proyeccion viva como lo haria el proceso de colaboracion.
   *
   * Siempre la version 1: las numeradas por encima son las copias inmutables que
   * congela la generacion, y escribirlas a mano falsearia justo lo que se prueba.
   */
  async function publicarProyeccion(model: unknown): Promise<void> {
    await api.app.prisma.boardSnapshot.upsert({
      where: { boardId_version: { boardId, version: 1 } },
      update: { canonicalJson: model as object },
      create: { boardId, version: 1, canonicalJson: model as object },
    });
  }

  beforeAll(async () => {
    api = await startHarness();
    duena = await api.signUp('duena-gen@example.com');
    lector = await api.signUp('lector-gen@example.com');
    extrano = await api.signUp('extrano-gen@example.com');

    const proyecto = await api.request('POST', '/projects', {
      token: duena.token,
      body: { displayName: 'Sistema de Ventas' },
    });
    projectId = proyecto.body.id as string;

    const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
      token: duena.token,
      body: { displayName: 'Ventas' },
    });
    boardId = pizarra.body.id as string;

    const invitacion = await api.request('POST', `/projects/${projectId}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: lector.token });

    await publicarProyeccion(t01);
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  // -------------------------------------------------------------------------
  // Generación
  // -------------------------------------------------------------------------

  describe('generacion (RF-060, RF-061 y RF-072)', () => {
    it('registra la generacion sobre la ultima version del snapshot', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body).toMatchObject({ boardId });
      // La copia congelada nunca es la 1: la 1 es la proyeccion viva, que el
      // proceso de colaboracion reescribe en cada volcado.
      expect(respuesta.body.snapshotVersion).toBeGreaterThan(1);
      expect(respuesta.body.entities).toBe(t01.classes.length);
      expect(respuesta.body.artifactName).toMatch(/\.zip$/);
    });

    it('CA-060.1 — lo que se edite despues no entra en una generacion ya iniciada', async () => {
      const primera = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      const antes = await api.raw('GET', `/generations/${primera.body.id}/download`, {
        token: duena.token,
      });

      // Alguien sigue editando: la proyeccion viva se queda con una sola clase.
      await publicarProyeccion({ ...t01, classes: t01.classes.slice(0, 1), relationships: [] });

      const vigente = await api.request('GET', `/boards/${boardId}`, { token: duena.token });
      expect(vigente.status).toBe(200);
      expect(vigente.body.snapshot.version).toBe(1);
      expect(vigente.body.snapshot.canonicalJson.classes).toHaveLength(1);

      const despues = await api.raw('GET', `/generations/${primera.body.id}/download`, {
        token: duena.token,
      });

      // La descarga corresponde a la copia congelada, no al estado actual. Sin
      // la copia, esta prueba fallaria: la version 1 se reescribe.
      expect(despues.status).toBe(200);
      expect(despues.body.equals(antes.body)).toBe(true);

      await publicarProyeccion(t01);
    });

    it('descarga un ZIP de verdad, no un texto', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      const descarga = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      expect(descarga.status).toBe(200);
      expect(descarga.headers['content-type']).toBe('application/zip');
      expect(String(descarga.headers['content-disposition'])).toContain('.zip');
      // `PK`: la firma de un archivo ZIP. Sin esto, un cuerpo de error
      // en texto plano pasaria por bueno.
      expect(descarga.body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    });

    it('RA-07 — dos descargas de la misma generacion dan los mismos bytes', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      const una = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });
      const otra = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      // Es lo que permite no guardar el binario: la emision es determinista, asi
      // que regenerar desde la version congelada da el mismo archivo.
      expect(una.body.equals(otra.body)).toBe(true);
    });

    it('acepta un paquete base propio y rechaza uno invalido', async () => {
      const valida = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'bo.edu.uagrm.ventas' },
      });
      expect(valida.status).toBe(201);

      const invalida = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'Bo.Edu-UAGRM' },
      });
      expect(invalida.status).toBe(400);
    });

    it('el historial dice quien genero y sobre que version', async () => {
      const historial = await api.request('GET', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      expect(historial.status).toBe(200);
      expect(historial.body.length).toBeGreaterThan(0);
      expect(historial.body[0].author).toMatchObject({ id: duena.userId });
      expect(historial.body[0].snapshotVersion).toBeGreaterThan(1);
    });
  });

  // -------------------------------------------------------------------------
  // Manifiesto: lo que hace cierta la promesa de ADR-018
  // -------------------------------------------------------------------------

  describe('manifiesto de generacion (ADR-018)', () => {
    /**
     * Las rutas dentro del ZIP llevan el paquete convertido en carpetas, y los
     * nombres de entrada del ZIP no van comprimidos: se pueden buscar en los
     * bytes sin descomprimir nada.
     */
    function contienePaquete(zip: Buffer, paquete: string): boolean {
      return zip.includes(Buffer.from(paquete.replaceAll('.', '/')));
    }

    it('AC-11.02.1 — el paquete elegido esta en el ZIP, tambien mas tarde', async () => {
      // Este es el defecto que el manifiesto cierra: el paquete se usaba para
      // responder y se perdia, asi que TODAS las descargas salian con el
      // paquete por defecto. La prueba que ya existia comprobaba que la
      // peticion se aceptaba, no que el codigo generado lo llevara.
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'bo.edu.demo' },
      });
      expect(generacion.status).toBe(201);
      expect(generacion.body).toMatchObject({ basePackage: 'bo.edu.demo', status: 'READY' });

      const inmediata = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });
      expect(contienePaquete(inmediata.body, 'bo.edu.demo')).toBe(true);

      // Otra generacion por medio, con otro paquete: la primera no se contagia.
      await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'com.otra.cosa' },
      });

      const posterior = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });
      expect(contienePaquete(posterior.body, 'bo.edu.demo')).toBe(true);
      expect(contienePaquete(posterior.body, 'com.otra.cosa')).toBe(false);
    });

    it('AC-11.02.2 — renombrar la pizarra no cambia una generacion anterior', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      const antes = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      const renombrada = await api.request('PATCH', `/boards/${boardId}`, {
        token: duena.token,
        body: { displayName: 'Ventas renombrada' },
      });
      expect(renombrada.status).toBe(200);

      const despues = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      // Byte a byte: el nombre viejo esta congelado en el manifiesto y no se
      // vuelve a leer de la pizarra.
      expect(despues.body.equals(antes.body)).toBe(true);
      expect(despues.headers['x-artifact-sha256']).toBe(antes.headers['x-artifact-sha256']);

      // Se deja como estaba: las pruebas siguientes cuentan con este nombre.
      await api.request('PATCH', `/boards/${boardId}`, {
        token: duena.token,
        body: { displayName: 'Ventas' },
      });
    });

    it('AC-11.02.3 — cuatro generaciones simultaneas no chocan', async () => {
      // Leer el maximo y despues insertar maximo+1 son dos operaciones: dos
      // peticiones a la vez leian el mismo maximo y la segunda moria con un 500
      // por clave duplicada, sin ninguna explicacion util.
      const respuestas = await Promise.all(
        Array.from({ length: 4 }, () =>
          api.request('POST', `/boards/${boardId}/generations`, { token: duena.token }),
        ),
      );

      expect(respuestas.map((respuesta) => respuesta.status)).toEqual([201, 201, 201, 201]);

      const versiones = respuestas.map((respuesta) => respuesta.body.snapshotVersion as number);
      expect(new Set(versiones).size).toBe(4);
    });

    it('AC-11.02.4 — dos descargas del mismo objetivo dan el mismo SHA-256', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { includeMobile: true },
      });

      for (const target of ['spring', 'mobile'] as const) {
        const una = await api.raw(
          'GET',
          `/generations/${generacion.body.id}/download?target=${target}`,
          { token: duena.token },
        );
        const otra = await api.raw(
          'GET',
          `/generations/${generacion.body.id}/download?target=${target}`,
          { token: duena.token },
        );

        expect(una.headers['x-artifact-sha256']).toBe(otra.headers['x-artifact-sha256']);
        // Y coincide con lo que se registro al generar, no solo consigo mismo.
        expect(una.headers['x-artifact-sha256']).toBe(
          (generacion.body.sha256 as Record<string, string>)[target],
        );
      }
    });

    it('avisa en lugar de entregar otro archivo si los bytes ya no coinciden', async () => {
      // Es la comprobacion que sostiene ADR-018: no se guarda el ZIP, pero si su
      // huella. Aqui se simula que una plantilla cambio por debajo.
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      await api.app.prisma.generation.update({
        where: { id: generacion.body.id as string },
        data: { springSha256: 'a'.repeat(64), templatesHash: 'otra-version' },
      });

      const descarga = await api.request('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      expect(descarga.status).toBe(409);
      expect(descarga.body.error).toMatchObject({ code: 'artifact_drifted' });
    });

    it('una generacion fallida no se puede descargar, y dice por que', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      await api.app.prisma.generation.update({
        where: { id: generacion.body.id as string },
        data: { status: 'FAILED', error: 'la plantilla entity.java no existe' },
      });

      const descarga = await api.request('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });

      expect(descarga.status).toBe(409);
      expect(String(descarga.body.error.message)).toContain('entity.java');
    });

    it('el historial muestra el manifiesto de cada generacion', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'bo.edu.historial' },
      });

      const historial = await api.request('GET', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      // Se busca la suya y no la primera de la lista: la prueba anterior deja a
      // proposito una generacion FAILED, y depender del orden convertiria esta
      // prueba en un detector de en que orden corren las demas.
      const fila = (historial.body as Record<string, unknown>[]).find(
        (item) => item.id === generacion.body.id,
      );

      expect(fila).toMatchObject({
        status: 'READY',
        basePackage: 'bo.edu.historial',
        projectName: 'Ventas',
      });
      expect(fila?.templatesHash).toBeTruthy();
      expect(fila?.springSha256).toBe((generacion.body.sha256 as Record<string, string>).spring);
    });

    it('una generacion interrumpida no queda preparando para siempre', async () => {
      const base = await api.app.prisma.generation.findFirstOrThrow({
        where: { boardId, status: 'READY' },
      });
      const interrumpida = await api.app.prisma.generation.create({
        data: {
          boardId,
          snapshotVersion: base.snapshotVersion,
          createdBy: duena.userId,
          createdAt: new Date(Date.now() - 10 * 60_000),
          projectName: base.projectName,
          artifactId: base.artifactId,
          basePackage: base.basePackage,
          schemaVersion: base.schemaVersion,
          templatesHash: base.templatesHash,
          status: 'CREATING',
        },
      });

      const rechazada = await api.request('GET', `/generations/${interrumpida.id}/download`, {
        token: extrano.token,
      });
      expect(rechazada.status).toBe(404);
      expect(
        await api.app.prisma.generation.findUnique({ where: { id: interrumpida.id } }),
      ).toMatchObject({ status: 'CREATING', error: null });

      const descarga = await api.request('GET', `/generations/${interrumpida.id}/download`, {
        token: duena.token,
      });
      expect(descarga.status).toBe(409);
      expect(descarga.body.error.message).toContain('se interrumpio');

      const historial = await api.request('GET', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      const fila = (historial.body as Record<string, unknown>[]).find(
        (item) => item.id === interrumpida.id,
      );

      expect(fila).toMatchObject({
        status: 'FAILED',
        error: 'La emision se interrumpio antes de terminar. Genera el proyecto nuevamente.',
      });
    });
  });

  describe('un modelo con errores no se genera', () => {
    it('devuelve 422 con los mismos hallazgos que el panel de validacion', async () => {
      const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
        token: duena.token,
        body: { displayName: 'Rota' },
      });
      const rotaId = pizarra.body.id as string;

      // Un muchos a muchos sin entidad intermedia: es el caso real: el docente
      // dibuja N:M y la herramienta no puede traducirlo a persistencia sin que
      // alguien decida que datos lleva la relacion (ADR-005).
      await api.app.prisma.boardSnapshot.update({
        where: { boardId_version: { boardId: rotaId, version: 1 } },
        data: {
          canonicalJson: {
            ...t01,
            relationships: t01.relationships.map((relacion, indice) =>
              indice === 0
                ? { ...relacion, sourceMultiplicity: '0..*', targetMultiplicity: '0..*' }
                : relacion,
            ),
          },
        },
      });

      const snapshotsAntes = await api.app.prisma.boardSnapshot.count({
        where: { boardId: rotaId },
      });

      const respuesta = await api.request('POST', `/boards/${rotaId}/generations`, {
        token: duena.token,
      });

      // ADR-003: los errores bloquean la generacion, no la edicion. Y se
      // devuelven tal cual para que la interfaz no tenga que traducirlos.
      expect(respuesta.status).toBe(422);
      expect(respuesta.body.error.code).toBe('model_not_generable');
      expect(respuesta.body.error.details.issues).toContainEqual(
        expect.objectContaining({ code: 'MANY_TO_MANY_RELATIONSHIP', severity: 'ERROR' }),
      );
      expect(await api.app.prisma.boardSnapshot.count({ where: { boardId: rotaId } })).toBe(
        snapshotsAntes,
      );
    });

    it('rechaza paquetes con palabras reservadas antes de generar', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
        body: { basePackage: 'bo.class.demo' },
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.code).toBe('validation_failed');
    });

    it('un nombre visual no convertible devuelve 422 y no deja snapshot', async () => {
      const pizarra = await api.request('POST', `/projects/${projectId}/boards`, {
        token: duena.token,
        body: { displayName: '🚀' },
      });
      const invalidaId = pizarra.body.id as string;
      const antes = await api.app.prisma.boardSnapshot.count({ where: { boardId: invalidaId } });

      const respuesta = await api.request('POST', `/boards/${invalidaId}/generations`, {
        token: duena.token,
      });

      expect(respuesta.status).toBe(422);
      expect(respuesta.body.error.code).toBe('project_name_not_generable');
      expect(await api.app.prisma.boardSnapshot.count({ where: { boardId: invalidaId } })).toBe(
        antes,
      );
    });

    it('una pizarra sin snapshot lo dice, en vez de fallar con un 500', async () => {
      const respuesta = await api.request('POST', `/boards/${crypto.randomUUID()}/generations`, {
        token: duena.token,
      });

      expect(respuesta.status).toBe(404);
    });
  });

  describe('autorizacion (RA-15)', () => {
    it('un rol de solo lectura no genera', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/generations`, {
        token: lector.token,
      });

      // Generar produce el entregable del proyecto y queda registrado con nombre
      // y apellido: es una accion de EDITOR, no de VIEWER.
      expect(respuesta.status).toBe(403);
    });

    it('un rol de solo lectura si puede descargar y ver el historial', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      const descarga = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: lector.token,
      });
      const historial = await api.request('GET', `/boards/${boardId}/generations`, {
        token: lector.token,
      });

      expect(descarga.status).toBe(200);
      expect(historial.status).toBe(200);
    });

    it('un extrano no descarga nada', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      const respuesta = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: extrano.token,
      });

      // 404 y no 403: responder "no tienes permiso" confirmaria que existe.
      expect(respuesta.status).toBe(404);
    });

    it('sin sesion no se genera', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/generations`);
      expect(respuesta.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Limpieza del historial
  // -------------------------------------------------------------------------

  describe('eliminar una generacion (limpieza del servidor)', () => {
    it('borra el registro y la version congelada, y la descarga deja de existir', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      const version = generacion.body.snapshotVersion as number;
      expect(
        await api.app.prisma.boardSnapshot.findUnique({
          where: { boardId_version: { boardId, version } },
        }),
      ).not.toBeNull();

      const borrado = await api.request('DELETE', `/generations/${generacion.body.id}`, {
        token: duena.token,
      });
      expect(borrado.status).toBe(204);

      // Lo unico que ocupaba espacio era la copia congelada: se va con la
      // generacion. La version viva (1) sigue ahi para seguir editando.
      expect(
        await api.app.prisma.boardSnapshot.findUnique({
          where: { boardId_version: { boardId, version } },
        }),
      ).toBeNull();
      expect(
        await api.app.prisma.boardSnapshot.findUnique({
          where: { boardId_version: { boardId, version: 1 } },
        }),
      ).not.toBeNull();

      const descarga = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });
      expect(descarga.status).toBe(404);

      const historial = await api.request('GET', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      expect(historial.body.some((g: { id: string }) => g.id === generacion.body.id)).toBe(false);
    });

    it('las demas generaciones siguen descargables', async () => {
      const primera = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      const segunda = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      await api.request('DELETE', `/generations/${primera.body.id}`, { token: duena.token });

      const descarga = await api.raw('GET', `/generations/${segunda.body.id}/download`, {
        token: duena.token,
      });
      expect(descarga.status).toBe(200);
    });

    it('un rol de solo lectura no elimina; un extrano ni sabe que existe', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });

      const lectorIntento = await api.request('DELETE', `/generations/${generacion.body.id}`, {
        token: lector.token,
      });
      const extranoIntento = await api.request('DELETE', `/generations/${generacion.body.id}`, {
        token: extrano.token,
      });
      const sinSesion = await api.request('DELETE', `/generations/${generacion.body.id}`);

      expect(lectorIntento.status).toBe(403);
      expect(extranoIntento.status).toBe(404);
      expect(sinSesion.status).toBe(401);

      // Sigue ahi, intacta.
      const descarga = await api.raw('GET', `/generations/${generacion.body.id}/download`, {
        token: duena.token,
      });
      expect(descarga.status).toBe(200);
    });

    it('eliminar dos veces devuelve 404 la segunda', async () => {
      const generacion = await api.request('POST', `/boards/${boardId}/generations`, {
        token: duena.token,
      });
      await api.request('DELETE', `/generations/${generacion.body.id}`, { token: duena.token });

      const repetido = await api.request('DELETE', `/generations/${generacion.body.id}`, {
        token: duena.token,
      });
      expect(repetido.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Auditoría
  // -------------------------------------------------------------------------

  describe('auditoria de lotes (RF-A09 y CA-023.1)', () => {
    function lote(batchId: string, actorId: string): unknown {
      const issuedAt = new Date().toISOString();
      return {
        batchId,
        origin: 'GUI',
        actorId,
        issuedAt,
        commands: [
          {
            type: 'CREATE_CLASS',
            commandId: crypto.randomUUID(),
            origin: 'GUI',
            actorId,
            issuedAt,
            payload: {
              classId: crypto.randomUUID(),
              displayName: 'Factura',
              position: { x: 10, y: 20 },
            },
          },
        ],
      };
    }

    it('registra el lote con el usuario de la sesion', async () => {
      const batchId = crypto.randomUUID();

      const respuesta = await api.request('POST', `/boards/${boardId}/audit`, {
        token: duena.token,
        body: lote(batchId, duena.userId),
      });

      expect(respuesta.status).toBe(202);

      const historial = await api.request('GET', `/boards/${boardId}/audit`, {
        token: duena.token,
      });
      const entrada = historial.body.find(
        (item: { batchId: string }) => item.batchId === batchId,
      ) as { actorId: string; origin: string; commands: string[] };

      expect(entrada).toMatchObject({ actorId: duena.userId, origin: 'GUI' });
      expect(entrada.commands).toEqual(['CREATE_CLASS']);
    });

    it('el actor es el de la sesion, no el que diga el cuerpo', async () => {
      const batchId = crypto.randomUUID();

      await api.request('POST', `/boards/${boardId}/audit`, {
        token: duena.token,
        // El cuerpo atribuye el lote a otra persona.
        body: lote(batchId, extrano.userId),
      });

      const historial = await api.request('GET', `/boards/${boardId}/audit`, {
        token: duena.token,
      });
      const entrada = historial.body.find((item: { batchId: string }) => item.batchId === batchId);

      // Si esto fallara, cualquiera podria firmar cambios con el nombre de otro,
      // que es justo lo que la auditoria tiene que impedir.
      expect(entrada.actorId).toBe(duena.userId);
    });

    it('reenviar el mismo lote no lo duplica', async () => {
      const batchId = crypto.randomUUID();
      const cuerpo = lote(batchId, duena.userId);

      await api.request('POST', `/boards/${boardId}/audit`, { token: duena.token, body: cuerpo });
      await api.request('POST', `/boards/${boardId}/audit`, { token: duena.token, body: cuerpo });

      const historial = await api.request('GET', `/boards/${boardId}/audit`, {
        token: duena.token,
      });
      const repetidas = historial.body.filter(
        (item: { batchId: string }) => item.batchId === batchId,
      );

      // Un corte de red y un reintento no pueden dejar dos entradas del mismo
      // cambio.
      expect(repetidas).toHaveLength(1);
    });

    it('el mismo batchId en otra pizarra deja una entrada en cada una', async () => {
      const otra = await api.request('POST', `/projects/${projectId}/boards`, {
        token: duena.token,
        body: { displayName: 'Auditoria dos' },
      });
      const otraId = otra.body.id as string;
      const batchId = crypto.randomUUID();
      const cuerpo = lote(batchId, duena.userId);

      await api.request('POST', `/boards/${boardId}/audit`, { token: duena.token, body: cuerpo });
      await api.request('POST', `/boards/${otraId}/audit`, { token: duena.token, body: cuerpo });

      const [primera, segunda] = await Promise.all([
        api.request('GET', `/boards/${boardId}/audit`, { token: duena.token }),
        api.request('GET', `/boards/${otraId}/audit`, { token: duena.token }),
      ]);
      expect(
        primera.body.filter((item: { batchId: string }) => item.batchId === batchId),
      ).toHaveLength(1);
      expect(
        segunda.body.filter((item: { batchId: string }) => item.batchId === batchId),
      ).toHaveLength(1);
    });

    it('un lote vacio se rechaza', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/audit`, {
        token: duena.token,
        body: {
          batchId: crypto.randomUUID(),
          origin: 'GUI',
          actorId: duena.userId,
          issuedAt: new Date().toISOString(),
          commands: [],
        },
      });

      // RA-03: quien lo emitio creia estar cambiando algo.
      expect(respuesta.status).toBe(400);
    });

    it('un rol de solo lectura no registra, pero si lee el historial', async () => {
      const escribir = await api.request('POST', `/boards/${boardId}/audit`, {
        token: lector.token,
        body: lote(crypto.randomUUID(), lector.userId),
      });
      const leer = await api.request('GET', `/boards/${boardId}/audit`, { token: lector.token });

      expect(escribir.status).toBe(403);
      expect(leer.status).toBe(200);
    });

    it('un extrano no ve el historial', async () => {
      const respuesta = await api.request('GET', `/boards/${boardId}/audit`, {
        token: extrano.token,
      });

      expect(respuesta.status).toBe(404);
    });
  });
});
