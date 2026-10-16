import type { SemanticModel } from '@uml/contracts';

/** Solo preguntas completas y exactas. Cualquier matiz vuelve al LLM.
 * No interpreta órdenes, no hace resúmenes y no modifica la pizarra. */
export function answerFromModel(question: string, snapshot: SemanticModel): string | undefined {
  const q = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?!.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^cuantas clases (?:hay|tiene (?:el diagrama|la pizarra))$/.test(q)) {
    return `Hay ${snapshot.classes.length} clase(s) en la pizarra.`;
  }
  if (/^cuantas relaciones (?:hay|tiene (?:el diagrama|la pizarra))$/.test(q)) {
    return `Hay ${snapshot.relationships.length} relación(es) en la pizarra.`;
  }
  if (/^(?:que clases hay|lista las clases|cuales son las clases)$/.test(q)) {
    return snapshot.classes.length === 0
      ? 'La pizarra no tiene clases.'
      : `Clases: ${snapshot.classes.map((cls) => JSON.stringify(cls.displayName)).join(', ')}.`;
  }
  return undefined;
}
