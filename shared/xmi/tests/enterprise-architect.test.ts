import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseXmi } from '@uml/xmi';

/**
 * Archivos reales exportados de Enterprise Architect 15.
 *
 * Esta prueba **se activa sola** en cuanto alguien deje un `.xmi` en
 * `fixtures/xmi/`. Mientras el directorio este vacio deja constancia de que la
 * verificacion sigue pendiente, en lugar de no existir y que nadie lo recuerde.
 *
 * Es la unica prueba del repositorio que depende de algo que no esta en el
 * repositorio, y esta escrita asi a proposito: la variante de XMI la decide la
 * instalacion del laboratorio, no el estandar teorico.
 */

const directorio = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'xmi',
);

function archivosReales(): readonly string[] {
  try {
    return readdirSync(directorio).filter((nombre) => /\.(xmi|xml)$/i.test(nombre));
  } catch {
    return [];
  }
}

const archivos = archivosReales();

describe('archivos reales de Enterprise Architect 15', () => {
  if (archivos.length === 0) {
    it.skip('pendiente: no hay ningun archivo exportado de la instalacion del laboratorio', () => {
      // Ver fixtures/xmi/README.md. Sin esto, RF-051 esta escrito pero no
      // verificado contra la herramienta que lo tiene que leer.
    });
    return;
  }

  for (const nombre of archivos) {
    describe(nombre, () => {
      const importado = parseXmi(readFileSync(join(directorio, nombre), 'utf8'));

      it('se lee sin lanzar', () => {
        expect(importado).toBeDefined();
      });

      it('trae al menos una clase', () => {
        // Un archivo que se parsea y no produce nada es peor que uno que falla:
        // parece que funciono.
        expect(importado.classes.length).toBeGreaterThan(0);
      });

      it('todas las clases tienen nombre', () => {
        expect(importado.classes.every((umlClass) => umlClass.name.trim().length > 0)).toBe(true);
      });

      it('deja constancia de lo que no supo traducir', () => {
        // No falla por tener avisos: falla si los hubiera y no se vieran. Aqui se
        // imprimen para que quien anada el archivo sepa que se perdio.
        for (const aviso of importado.warnings) {
          console.warn(`   ! ${nombre} — ${aviso.element}: ${aviso.reason}`);
        }
        expect(Array.isArray(importado.warnings)).toBe(true);
      });

      it('las relaciones apuntan a clases del propio archivo', () => {
        const nombres = new Set(importado.classes.map((umlClass) => umlClass.name));

        for (const relacion of importado.relationships) {
          expect(nombres.has(relacion.sourceName)).toBe(true);
          expect(nombres.has(relacion.targetName)).toBe(true);
        }
      });
    });
  }
});
