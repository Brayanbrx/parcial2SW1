/**
 * Emite el banco de regresion a `fixtures/uml/*.json`.
 *
 * Los JSON son derivados, no fuente: se editan las definiciones y se vuelve a
 * emitir. Una prueba comprueba que lo versionado coincide con lo que produce
 * este script, para que nadie edite el JSON a mano y el banco pruebe una cosa
 * distinta de la que dice probar.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, fixtureFileName } from './index.js';
import { serializeFixture } from './serialize.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '..', 'uml');

mkdirSync(destino, { recursive: true });

for (const item of FIXTURES) {
  const ruta = join(destino, fixtureFileName(item.id));
  writeFileSync(ruta, serializeFixture(item), 'utf8');
  console.warn(`emitido ${item.id} → ${ruta}`);
}
