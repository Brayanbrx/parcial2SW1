import type { UmlAttribute, UmlClass } from '@uml/contracts';
import { toWords } from './naming.js';

/**
 * RTM-04: resolucion de la clave primaria.
 *
 *   1. Atributo marcado como clave           → usarlo
 *   2. Un solo candidato por convencion      → promoverlo + aviso
 *   3. Dos o mas candidatos                  → error, el usuario elige
 *   4. Ninguno                               → generar id : UUID + aviso
 *
 * La inferencia es deliberadamente estrecha. `ci`, `nit` y `codigoCliente` no se
 * promueven: son identificadores de negocio, no necesariamente claves tecnicas.
 * La herramienta no inventa semantica.
 *
 * Vive en el nucleo de dominio y no en el generador porque el validador necesita
 * el mismo resultado para emitir sus avisos y su error, y una segunda
 * implementacion terminaria discrepando (RA-05).
 */

export type PrimaryKeyResolution =
  /** Habia un atributo marcado. Se usa tal cual. */
  | { readonly kind: 'DECLARED'; readonly attribute: UmlAttribute }
  /** Un unico candidato por convencion. Se promueve y se avisa. */
  | { readonly kind: 'INFERRED'; readonly attribute: UmlAttribute }
  /** Ninguno. El generador emitira `id : UUID` y se avisa. */
  | { readonly kind: 'GENERATED' }
  /** Mas de un candidato por convencion. Error: elige el usuario. */
  | { readonly kind: 'AMBIGUOUS'; readonly candidates: readonly UmlAttribute[] }
  /** Mas de un atributo marcado. Error: RM-03 no admite claves compuestas. */
  | { readonly kind: 'COMPOSITE'; readonly declared: readonly UmlAttribute[] };

/**
 * Convenciones aceptadas: `id`, `id<Clase>` y `<clase>Id`.
 *
 * Se comparan sobre las palabras normalizadas, no sobre la cadena literal, para
 * que `IDCliente`, `id_cliente` e `idCliente` cuenten como el mismo candidato.
 */
export function isConventionalIdName(attributeCodeName: string, classCodeName: string): boolean {
  const attribute = toWords(attributeCodeName);
  const klass = toWords(classCodeName);

  if (attribute.length === 1 && attribute[0] === 'id') return true;
  if (attribute.length !== klass.length + 1) return false;

  const idPrimero = attribute[0] === 'id' && arraysEqual(attribute.slice(1), klass);
  const idUltimo =
    attribute[attribute.length - 1] === 'id' && arraysEqual(attribute.slice(0, -1), klass);

  return idPrimero || idUltimo;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

export function resolvePrimaryKey(umlClass: UmlClass): PrimaryKeyResolution {
  const declared = umlClass.attributes.filter((attribute) => attribute.primaryKey);

  if (declared.length > 1) {
    return { kind: 'COMPOSITE', declared };
  }
  if (declared.length === 1) {
    return { kind: 'DECLARED', attribute: declared[0] as UmlAttribute };
  }

  const candidates = umlClass.attributes.filter((attribute) =>
    isConventionalIdName(attribute.codeName, umlClass.codeName),
  );

  if (candidates.length > 1) {
    return { kind: 'AMBIGUOUS', candidates };
  }
  if (candidates.length === 1) {
    return { kind: 'INFERRED', attribute: candidates[0] as UmlAttribute };
  }

  return { kind: 'GENERATED' };
}
