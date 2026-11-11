import { VISIBILITY_SYMBOLS } from './vocabulary.js';
import type { UmlAttribute, UmlOperation } from './model.js';

export function attributeNotation(attribute: UmlAttribute): string {
  const multiplicity = attribute.multiplicity ?? (attribute.nullable ? '0..1' : '1');
  return `${VISIBILITY_SYMBOLS[attribute.visibility ?? 'private']} ${attribute.isDerived ? '/' : ''}${attribute.displayName}: ${attribute.type} [${multiplicity}]${attribute.defaultValue ? ` = ${attribute.defaultValue}` : ''}${attribute.isReadOnly ? ' {readOnly}' : ''}`;
}

export function operationNotation(operation: UmlOperation): string {
  const parameters = operation.parameters
    .map(
      (p) =>
        `${p.direction === 'in' ? '' : `${p.direction} `}${p.name}: ${p.type}${p.multiplicity && p.multiplicity !== '1' ? ` [${p.multiplicity}]` : ''}${p.defaultValue ? ` = ${p.defaultValue}` : ''}`,
    )
    .join(', ');
  const result =
    operation.returnType && operation.returnType !== 'void'
      ? `: ${operation.returnType}${operation.returnMultiplicity && operation.returnMultiplicity !== '1' ? ` [${operation.returnMultiplicity}]` : ''}`
      : '';
  return `${VISIBILITY_SYMBOLS[operation.visibility]} ${operation.displayName}(${parameters})${result}`;
}
