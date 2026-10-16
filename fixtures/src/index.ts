/**
 * @uml/fixtures
 *
 * Banco de regresion T01-T07 (plan maestro 15.2), disponible como datos en
 * memoria. No lee del sistema de archivos: las pruebas del nucleo de dominio lo
 * importan sin romper RNF-15.
 *
 * Los archivos JSON de `fixtures/uml/` se emiten desde estos mismos datos con
 * `npm run fixtures:emit` y sirven para inspeccion humana y como entrada del
 * generador. Una prueba comprueba que no se hayan desincronizado.
 */
import { buildFixture, type Fixture } from './build.js';
import { FIXTURE_SPECS } from './definitions.js';

export * from './build.js';
export { buildLoadModel, type LoadModelOptions } from './load.js';
export { serializeFixture } from './serialize.js';
export { FIXTURE_SPECS, VALID_FIXTURE_IDS, GENERABLE_FIXTURE_IDS } from './definitions.js';

export const FIXTURES: readonly Fixture[] = FIXTURE_SPECS.map(buildFixture);

const porId = new Map(FIXTURES.map((fixture) => [fixture.id, fixture]));

export function fixture(id: string): Fixture {
  const encontrado = porId.get(id);
  if (encontrado === undefined) {
    throw new Error(
      `No existe el modelo ${id} en el banco. Disponibles: ${[...porId.keys()].join(', ')}`,
    );
  }
  return encontrado;
}

/** Nombre del archivo JSON emitido para un modelo del banco. */
export function fixtureFileName(fixtureId: string): string {
  return `${fixtureId}.json`;
}
