/**
 * Informe del banco de regresion: que encuentra el validador en cada modelo.
 *
 * No es una prueba, es una herramienta de diagnostico. Sirve para ver de un
 * vistazo el efecto de un cambio en el normalizador o en el validador sobre los
 * siete modelos, antes de mirar que prueba fallo y por que.
 *
 *   npm run bank:report
 */
import { validateModel } from '@uml/domain-core';
import { FIXTURES } from './index.js';

let totalErrores = 0;

for (const item of FIXTURES) {
  const hallazgos = validateModel(item.model);
  const errores = hallazgos.filter((h) => h.severity === 'ERROR');
  totalErrores += errores.length;

  console.warn(
    `\n${item.id} — ${item.title}` +
      `\n   ${item.model.classes.length} clases · ${item.model.relationships.length} relaciones` +
      ` · ${errores.length} error(es) · ${hallazgos.length - errores.length} aviso(s)`,
  );

  for (const hallazgo of hallazgos) {
    const marca = hallazgo.severity === 'ERROR' ? 'x' : '!';
    console.warn(`   ${marca} ${hallazgo.code}: ${hallazgo.message}`);
  }
}

console.warn(`\nTotal de errores en el banco: ${totalErrores} (se espera 1, el de T07)\n`);
