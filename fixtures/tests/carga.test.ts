import { semanticModelSchema } from '@uml/contracts';
import { validateModel } from '@uml/domain-core';
import { buildLoadModel } from '@uml/fixtures';
import { buildGenerationIr } from '@uml/generation-ir';
import { generateSpringProject } from '@uml/generator-backend';
import { applyBatchToDocument, readBoardState } from '@uml/yjs-adapter';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * El tamaño que exige RNF-03, que hasta ahora nadie había probado.
 *
 * El banco T01–T07 comprueba que la traducción es **correcta**, y por eso sus
 * modelos son pequeños: cada uno aísla una regla. El más grande tiene 5 clases y
 * 15 atributos. RNF-03 exige soportar **30 clases, 100 atributos y 40
 * relaciones** con fluidez, y RNF-07 generar en menos de diez segundos — dos
 * requisitos que no tenían ninguna medición detrás.
 *
 * Esto no sustituye al banco: no comprueba que el código generado sea correcto,
 * solo que a ese tamaño nada se rompe ni tarda de más.
 *
 * **Los presupuestos son holgados a propósito.** Las mediciones reales están un
 * orden de magnitud por debajo; los números de aquí son para que un cambio que
 * multiplique el coste por veinte se note, no para medir esta máquina. Una
 * prueba de rendimiento ajustada al milisegundo falla en la máquina de otro y
 * acaba desactivada.
 */
describe('carga: el tamano que exige RNF-03', () => {
  const model = buildLoadModel();

  it('el modelo sintetico tiene el tamano que dice RNF-03', () => {
    const atributos = model.classes.reduce((total, clase) => total + clase.attributes.length, 0);

    expect(model.classes).toHaveLength(30);
    expect(atributos).toBe(100);
    expect(model.relationships).toHaveLength(40);

    // Y es un modelo legal, no un montón de datos con la forma aproximada.
    expect(() => semanticModelSchema.parse(model)).not.toThrow();
  });

  it('es determinista: dos construcciones dan el mismo modelo', () => {
    // Un identificador aleatorio haría que un fallo intermitente fuera
    // imposible de reproducir.
    expect(buildLoadModel()).toEqual(buildLoadModel());
  });

  it('el validador no encuentra errores, solo avisos', () => {
    const issues = validateModel(model);

    // 30 claves primarias generadas y 130 nombres normalizados: avisos, que
    // permiten generar. Un error aquí significaría que el generador de carga
    // produce un modelo inválido y la medición no valdría nada.
    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('RNF-07 — genera el backend muy por debajo de diez segundos', async () => {
    const inicio = performance.now();

    const ir = buildGenerationIr({ model, snapshotVersion: 1, projectName: 'Carga' });
    const spring = await generateSpringProject(ir);

    const transcurrido = performance.now() - inicio;

    expect(ir.entities).toHaveLength(30);
    // Cinco archivos por entidad más los del proyecto: si esto cayera, el
    // generador estaría saltándose entidades en silencio.
    expect(spring.files.length).toBeGreaterThan(150);
    expect(spring.zip.byteLength).toBeGreaterThan(20_000);

    expect(transcurrido).toBeLessThan(10_000);
  }, 30_000);

  it('RNF-05 — dos generaciones del mismo modelo dan los mismos bytes', async () => {
    const ir = buildGenerationIr({ model, snapshotVersion: 1, projectName: 'Carga' });

    const una = await generateSpringProject(ir);
    const otra = await generateSpringProject(ir);

    // Es lo que permite no almacenar los artefactos (ADR-018): si alguien mete
    // una fecha o un identificador aleatorio en una plantilla, esto lo detecta.
    expect(una.zip.equals(otra.zip)).toBe(true);
  }, 30_000);

  it('RNF-03 — el camino que corre en cada tecla del editor aguanta el tamano', () => {
    const doc = new Y.Doc();
    const inicio = performance.now();

    // El modelo canonico no lleva posiciones —viven en la capa de disposicion—,
    // asi que se colocan en rejilla al crear cada clase, como hace el editor.
    for (const [indice, clase] of model.classes.entries()) {
      const applied = applyBatchToDocument(doc, {
        batchId: idDeLote(clase.id),
        origin: 'GUI',
        actorId: ACTOR,
        issuedAt: '2026-09-23T10:00:00.000Z',
        commands: [
          {
            type: 'CREATE_CLASS',
            commandId: idDeLote(`cmd:${clase.id}`),
            origin: 'GUI',
            actorId: ACTOR,
            issuedAt: '2026-09-23T10:00:00.000Z',
            payload: {
              classId: clase.id,
              displayName: clase.displayName,
              position: { x: (indice % 6) * 300, y: Math.floor(indice / 6) * 240 },
            },
          },
        ],
      });

      expect(applied.applied).toBe(true);
    }

    const trasAplicar = performance.now();
    const proyeccion = readBoardState(doc);
    const trasProyectar = performance.now();

    expect(proyeccion.semantic.classes).toHaveLength(30);

    // Aplicar y proyectar es lo que ocurre entre pulsar una tecla y ver el
    // cambio. Con treinta clases tiene que seguir siendo imperceptible.
    expect(trasAplicar - inicio).toBeLessThan(2000);
    expect(trasProyectar - trasAplicar).toBeLessThan(500);
  });

  it('RNF-03 — validar el modelo completo es imperceptible', () => {
    const inicio = performance.now();
    validateModel(model);
    const transcurrido = performance.now() - inicio;

    // El editor revalida en cada cambio del modelo: si esto creciera, escribir
    // en el inspector se volvería pegajoso mucho antes de que nadie sospeche
    // del validador.
    expect(transcurrido).toBeLessThan(500);
  });
});

const ACTOR = '00000000-0000-4000-8000-000000000001';

function idDeLote(semilla: string): string {
  // Un identificador estable derivado del de la clase: la prueba no necesita
  // aleatoriedad y no debe introducirla.
  const hex = semilla
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(32, '0')
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
