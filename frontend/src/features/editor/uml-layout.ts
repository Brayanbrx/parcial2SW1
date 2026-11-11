import { attributeNotation, operationNotation, type UmlClass } from '@uml/contracts';

/** Default dimensions keep all compartments visible, including long operation signatures. */
export function classifierSize(c: UmlClass): { width: number; height: number } {
  const operations = c.operations ?? [];
  const literals = c.literals ?? [];
  const lines = [
    c.displayName,
    ...c.attributes.map(attributeNotation),
    ...operations.map(operationNotation),
    ...literals,
  ];
  return {
    width: Math.max(240, Math.min(760, Math.max(...lines.map((line) => line.length)) * 7 + 32)),
    height: Math.max(
      80,
      44 +
        (c.kind && c.kind !== 'CLASS' ? 24 : 0) +
        (c.attributes.length + operations.length + literals.length) * 22 +
        (operations.length ? 12 : 0) +
        (c.kind === 'ENUMERATION' ? 12 : 0),
    ),
  };
}
