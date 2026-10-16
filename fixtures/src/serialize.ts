import { SCHEMA_VERSION } from '@uml/contracts';
import type { Fixture } from './build.js';

/**
 * Serializacion canonica de un modelo del banco.
 *
 * Una sola funcion produce el texto, y tanto el emisor como la prueba de
 * sincronia la usan. Si el formato cambia, las dos cambian a la vez.
 */
export function serializeFixture(item: Fixture): string {
  return (
    JSON.stringify(
      {
        $schema: 'https://plataforma-uml.local/schemas/board-state.json',
        schemaVersion: SCHEMA_VERSION,
        id: item.id,
        title: item.title,
        coverage: item.coverage,
        semantic: item.model,
        layout: item.boardState.layout,
      },
      null,
      2,
    ) + '\n'
  );
}
