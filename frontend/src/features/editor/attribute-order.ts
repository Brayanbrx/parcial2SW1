import { CONCEPTUAL_TYPES, type ConceptualType, type UmlClass } from '@uml/contracts';
import type { CommandBody } from './commands.js';

/**
 * Mueve el atributo antes de un vecino, o al final, sin reescribir sus campos.
 */
export function reorderAttributes(umlClass: UmlClass, from: number, to: number): CommandBody[] {
  const attributes = umlClass.attributes;
  const attribute = attributes[from];
  if (from === to || attribute === undefined || attributes[to] === undefined) return [];
  return [
    {
      type: 'UPDATE_ATTRIBUTE',
      payload: {
        classId: umlClass.id,
        attributeId: attribute.id,
        beforeAttributeId: attributes[to + (to > from ? 1 : 0)]?.id ?? null,
      },
    },
  ];
}

export interface AttributeText {
  readonly name: string;
  /** null si no se escribió tipo: se conserva el actual o se usa String. */
  readonly type: ConceptualType | null;
  /** Se escribió un tipo que el modelo no reconoce. */
  readonly unknownType: string | null;
}

/** Lee lo que se escribe sobre el diagrama, en notación UML: `nombre: Tipo`. */
export function parseAttributeText(text: string): AttributeText | null {
  const limpio = text.trim().replace(/^[-+#~]\s*/, '');
  const separador = limpio.indexOf(':');
  const name = (separador < 0 ? limpio : limpio.slice(0, separador)).trim();
  if (name === '') return null;
  const tipoEscrito = separador < 0 ? '' : limpio.slice(separador + 1).trim();
  if (tipoEscrito === '') return { name, type: null, unknownType: null };
  const type =
    CONCEPTUAL_TYPES.find((tipo) => tipo.toLowerCase() === tipoEscrito.toLowerCase()) ?? null;
  return { name, type, unknownType: type === null ? tipoEscrito : null };
}
