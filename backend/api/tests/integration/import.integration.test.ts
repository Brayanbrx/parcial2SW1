import { fixture } from '@uml/fixtures';
import { planBatch, validateModel } from '@uml/domain-core';
import { emptyBoardState } from '@uml/contracts';
import { parseXmi, serializeToXmi } from '@uml/xmi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

/**
 * Importacion por fotografia y XMI, y exportacion (M4 y M5).
 *
 * Con el adaptador simulado de vision: estas pruebas corren en integracion
 * continua y nunca llaman a un proveedor de pago (15.5).
 */
describe('importacion y exportacion', () => {
  let api: Harness;
  let duena: Awaited<ReturnType<Harness['signUp']>>;
  let lector: Awaited<ReturnType<Harness['signUp']>>;
  let extrano: Awaited<ReturnType<Harness['signUp']>>;
  let boardId: string;

  const t01 = fixture('T01').model;
  const vacio = { classes: [], relationships: [] };

  // Un PNG de un pixel: el adaptador simulado no lo mira, pero la ruta valida el
  // formato antes de llamarlo.
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    api = await startHarness();
    duena = await api.signUp('duena-import@example.com');
    lector = await api.signUp('lector-import@example.com');
    extrano = await api.signUp('extrano-import@example.com');

    const proyecto = await api.request('POST', '/projects', {
      token: duena.token,
      body: { displayName: 'Proyecto con importacion' },
    });
    const pizarra = await api.request('POST', `/projects/${proyecto.body.id}/boards`, {
      token: duena.token,
      body: { displayName: 'Ventas' },
    });
    boardId = pizarra.body.id as string;

    const invitacion = await api.request('POST', `/projects/${proyecto.body.id}/invites`, {
      token: duena.token,
      body: { role: 'VIEWER' },
    });
    await api.request('POST', `/invites/${invitacion.body.code}/accept`, { token: lector.token });
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
  });

  // -------------------------------------------------------------------------
  // Exportacion
  // -------------------------------------------------------------------------

  describe('exportacion (RF-050)', () => {
    it('exporta XMI 2.5.1 y permite reimportarlo conservando identidades', async () => {
      const response = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: lector.token,
        body: { model: t01, format: 'UML_251' },
      });
      expect(response.status).toBe(200);
      expect(String(response.body)).toContain('xmlns:xmi="http://www.omg.org/spec/XMI/20131001"');
      expect(String(response.body)).toContain('xmlns:uml="http://www.omg.org/spec/UML/20161101"');
      const imported = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml: String(response.body), mode: 'REPLACE', model: t01 },
      });
      expect(imported.status).toBe(200);
      const planned = planBatch({ ...emptyBoardState(), semantic: t01 }, imported.body.batch);
      expect(planned.applied).toBe(true);
      if (!planned.applied) throw new Error('El XMI 2.5.1 debe conservar el modelo');
      expect(planned.state.semantic.classes).toEqual(t01.classes);
      expect(
        [...planned.state.semantic.relationships].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual([...t01.relationships].sort((a, b) => a.id.localeCompare(b.id)));
    });

    it('rechaza un formato de exportación desconocido', async () => {
      const response = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: duena.token,
        body: { model: t01, format: 'desconocido' },
      });
      expect(response.status).toBe(400);
    });

    it('devuelve un XMI descargable', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: duena.token,
        body: { model: t01 },
      });

      expect(respuesta.status).toBe(200);
      expect(String(respuesta.body)).toContain('xmi:version="2.1"');
      expect(String(respuesta.body)).toContain(
        '<xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>',
      );
      expect(String(respuesta.body)).toContain('name="Cliente"');
    });

    it('un rol de solo lectura tambien puede exportar', async () => {
      // Exportar no modifica nada, y quien puede ver el diagrama puede llevarselo.
      const respuesta = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: lector.token,
        body: { model: t01 },
      });

      expect(respuesta.status).toBe(200);
    });

    it('descarga un diagrama de EA con las posiciones y tamaños enviados por el editor', async () => {
      const classId = t01.classes[0]!.id;
      const respuesta = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: duena.token,
        body: {
          model: t01,
          layout: {
            positions: { [classId]: { x: 80, y: 120 } },
            sizes: { [classId]: { width: 320, height: 210 } },
          },
        },
      });
      expect(respuesta.status).toBe(200);
      const xml = String(respuesta.body);
      expect(xml).toContain('Left=80;Top=120;Right=400;Bottom=330;');
      expect(xml).toContain('<primitivetypes>');
      expect(xml).toContain('type="Logical"');
      expect(parseXmi(xml).classes[0]?.xmiId).toBe(classId);
    });

    it('un no miembro no puede exportar', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/export/xmi`, {
        token: extrano.token,
        body: { model: t01 },
      });

      expect(respuesta.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Importacion XMI
  // -------------------------------------------------------------------------

  describe('importacion XMI (RF-051 y RF-052)', () => {
    const xml = serializeToXmi(fixture('T05').model, { modelName: 'Cuentas' });

    it('produce un candidato, sin aplicar nada', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml, mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.kind).toBe('BATCH');
      expect(respuesta.body.batch.origin).toBe('XMI');

      // La pizarra sigue vacia: el candidato se aplica desde el navegador.
      const pizarra = await api.request('GET', `/boards/${boardId}`, { token: duena.token });
      expect(pizarra.body.snapshot.canonicalJson).toEqual({ classes: [], relationships: [] });
    });

    it('el candidato trae las tres clases de T05 con sus relaciones', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml, mode: 'ADD', model: vacio },
      });

      const tipos = respuesta.body.batch.commands.map((c: { type: string }) => c.type);
      expect(tipos.filter((t: string) => t === 'CREATE_CLASS')).toHaveLength(3);
      expect(tipos.filter((t: string) => t === 'CREATE_RELATIONSHIP')).toHaveLength(2);
    });

    it('volver a importar lo mismo informa que no hay cambios, sin pregunta bloqueada', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml, mode: 'ADD', model: fixture('T05').model },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.kind).toBe('NO_CHANGES');
      expect(respuesta.body.message).toMatch(/ya est[aá] en la pizarra/i);
      expect(respuesta.body.warnings.length).toBeGreaterThan(0);
    });

    it('RF-052 — el candidato pasa por el validador del dominio', async () => {
      // Un XMI con dos clases que colapsan al mismo nombre tecnico: el lote se
      // aplica y el validador lo marca, igual que en el editor.
      const conColision = serializeToXmi(
        {
          classes: [
            {
              id: '55555555-5555-4555-8555-000000000001',
              displayName: 'Detalle de Venta',
              codeName: 'DetalleVenta',
              databaseName: 'detalle_venta',
              attributes: [
                {
                  id: '55555555-5555-4555-8555-000000000003',
                  displayName: 'importe',
                  codeName: 'importe',
                  databaseName: 'importe',
                  type: 'Decimal',
                  primaryKey: false,
                  nullable: true,
                  unique: false,
                },
              ],
            },
            {
              id: '55555555-5555-4555-8555-000000000002',
              displayName: 'detalle venta',
              codeName: 'DetalleVenta',
              databaseName: 'detalle_venta',
              attributes: [
                {
                  id: '55555555-5555-4555-8555-000000000004',
                  displayName: 'cantidad',
                  codeName: 'cantidad',
                  databaseName: 'cantidad',
                  type: 'Integer',
                  primaryKey: false,
                  nullable: true,
                  unique: false,
                },
              ],
            },
          ],
          relationships: [
            {
              id: '55555555-5555-4555-8555-000000000005',
              kind: 'ASSOCIATION',
              sourceClassId: '55555555-5555-4555-8555-000000000001',
              targetClassId: '55555555-5555-4555-8555-000000000002',
              sourceMultiplicity: '1',
              targetMultiplicity: '0..*',
            },
          ],
        },
        { modelName: 'Con colision' },
      );

      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml: conColision, mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.kind).toBe('BATCH');
      const planned = planBatch(emptyBoardState(), respuesta.body.batch);
      expect(planned.applied).toBe(true);
      if (!planned.applied) throw new Error('El candidato debe poder editarse');
      const model = planned.state.semantic;
      expect(model.classes.map((c) => c.attributes.map((a) => a.displayName))).toEqual([
        ['importe'],
        ['cantidad'],
      ]);
      expect(model.relationships[0]).toMatchObject({
        sourceClassId: model.classes[0]?.id,
        targetClassId: model.classes[1]?.id,
      });
      expect(validateModel(model)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_CLASS_NAME' })]),
      );
    });

    it('RF-044 — el modo de reemplazo borra primero, en el mismo lote', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml, mode: 'REPLACE', model: t01 },
      });

      // Reemplazar la pizarra entera es destructivo de alcance amplio, asi que
      // pasa por confirmacion (RF-035). El lote esta listo; falta el visto bueno.
      expect(respuesta.body.kind).toBe('CONFIRMATION');
      expect(respuesta.body.question).toMatch(/elimina \d+ elementos/i);

      const tipos = respuesta.body.batch.commands.map((c: { type: string }) => c.type);
      expect(tipos.slice(0, 4).every((t: string) => t === 'DELETE_CLASS')).toBe(true);
    });

    it('los avisos del parser viajan con el candidato', async () => {
      const conTipoRaro = `<?xml version="1.0"?>
<xmi:XMI xmlns:uml="u" xmlns:xmi="x">
  <uml:Model xmi:type="uml:Model" name="Raro">
    <packagedElement xmi:type="uml:Class" xmi:id="_c1" name="Cliente">
      <ownedAttribute xmi:type="uml:Property" xmi:id="_a1" name="foto" type="Blob"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml: conTipoRaro, mode: 'ADD', model: vacio },
      });

      // Lo que no se pudo traducir tiene que verse antes de aplicar.
      expect(respuesta.body.warnings).toHaveLength(1);
      expect(respuesta.body.warnings[0].reason).toMatch(/tipo/i);
    });

    it('dice que pasa cuando el archivo no es XMI', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml: '<html><body>no</body></html>', mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.code).toBe('xmi_invalido');
      expect(respuesta.body.error.message).toMatch(/XMI 2\.1/);
    });

    it('no prepara un reemplazo destructivo a partir de XML truncado', async () => {
      const response = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: duena.token,
        body: { xml: '<uml:Model xmlns:uml="u" name="Incompleto">', mode: 'REPLACE', model: t01 },
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('xmi_invalido');
      expect(response.body.batch).toBeUndefined();
    });

    it('un rol de solo lectura no importa', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/xmi`, {
        token: lector.token,
        body: { xml, mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Importacion por imagen
  // -------------------------------------------------------------------------

  describe('importacion por imagen (RF-040 a RF-043)', () => {
    it('CA-042.1 — produce un candidato y no lo aplica', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        token: duena.token,
        body: { image: PNG, mediaType: 'image/png', mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.kind).toBe('BATCH');
      expect(respuesta.body.batch.origin).toBe('IMAGE');

      const pizarra = await api.request('GET', `/boards/${boardId}`, { token: duena.token });
      expect(pizarra.body.snapshot.canonicalJson).toEqual({ classes: [], relationships: [] });
    });

    it('lo que ya esta en la pizarra se omite con aviso en vez de bloquear la lectura', async () => {
      // El adaptador simulado lee Cliente(nombre) y Pedido(fecha). T01 ya tiene
      // Cliente con nombre: antes eso cortaba la importacion con una pregunta y
      // obligaba a repetir la lectura; ahora se conserva lo demas y se avisa.
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        token: duena.token,
        body: { image: PNG, mediaType: 'image/png', mode: 'ADD', model: t01 },
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.kind).toBe('BATCH');
      const tipos = respuesta.body.batch.commands.map((c: { type: string }) => c.type);
      expect(tipos).toEqual(['CREATE_CLASS', 'ADD_ATTRIBUTE', 'CREATE_RELATIONSHIP']);
      expect(respuesta.body.warnings).toEqual([
        expect.objectContaining({ element: 'Clase «Cliente»' }),
        expect.objectContaining({ element: 'Atributo «nombre» de «Cliente»' }),
      ]);
      expect(respuesta.body).not.toHaveProperty('skipped');
    });

    it('acepta una imagen del tamano de una foto de movil', async () => {
      // El limite de cuerpo de Fastify es un megabyte por defecto: sin subirlo,
      // esta ruta habria rechazado con un 413 cualquier fotografia real.
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        token: duena.token,
        body: {
          image: PNG.repeat(30_000).slice(0, 4_000_000),
          mediaType: 'image/png',
          mode: 'ADD',
          model: vacio,
        },
      });

      expect(respuesta.status).toBe(200);
    });

    it('rechaza una imagen que pasa del limite', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        token: duena.token,
        body: {
          image: 'A'.repeat(8_000_001),
          mediaType: 'image/png',
          mode: 'ADD',
          model: vacio,
        },
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error.code).toBe('validation_failed');
    });

    it('un rol de solo lectura no importa', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        token: lector.token,
        body: { image: PNG, mediaType: 'image/png', mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(403);
    });

    it('exige sesion', async () => {
      const respuesta = await api.request('POST', `/boards/${boardId}/import/image`, {
        body: { image: PNG, mediaType: 'image/png', mode: 'ADD', model: vacio },
      });

      expect(respuesta.status).toBe(401);
    });
  });

  it('el ida y vuelta por la API conserva el modelo', async () => {
    const exportado = await api.request('POST', `/boards/${boardId}/export/xmi`, {
      token: duena.token,
      body: { model: t01 },
    });

    const importado = parseXmi(String(exportado.body));

    expect(importado.classes.map((c) => c.name).sort()).toEqual(
      t01.classes.map((c) => c.displayName).sort(),
    );
  });
});
