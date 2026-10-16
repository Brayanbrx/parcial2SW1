import type { CommandBatch, SemanticModel, ValidationIssue } from '@uml/contracts';

/** Compara los objetos afectados con los que la persona revisó. El layout y
 * las clases ajenas al lote pueden cambiar sin invalidar la propuesta. */
export function validateProposalPreconditions(
  batch: CommandBatch,
  expected: SemanticModel,
  current: SemanticModel,
  scope: 'AFFECTED' | 'MODEL' = 'AFFECTED',
): ValidationIssue[] {
  const classes = new Set<string>();
  const relationships = new Set<string>();
  const deletedClasses = new Set<string>();
  // Reemplazar requiere revisar el modelo completo, también clases nuevas que
  // todavía no existían cuando se prepararon los comandos de borrado.
  if (scope === 'MODEL') {
    for (const model of [expected, current]) {
      model.classes.forEach((c) => classes.add(c.id));
      model.relationships.forEach((r) => relationships.add(r.id));
    }
  }
  for (const command of batch.commands) {
    const payload = command.payload;
    if ('classId' in payload) classes.add(payload.classId);
    if ('sourceClassId' in payload) classes.add(payload.sourceClassId);
    if ('targetClassId' in payload) classes.add(payload.targetClassId);
    if ('relationshipId' in payload) relationships.add(payload.relationshipId);
    if (command.type === 'DELETE_CLASS') deletedClasses.add(command.payload.classId);
  }
  // DELETE_CLASS borra también las relaciones, incluidas las recién añadidas.
  for (const model of [expected, current]) {
    for (const relationship of model.relationships) {
      if (
        deletedClasses.has(relationship.sourceClassId) ||
        deletedClasses.has(relationship.targetClassId)
      ) {
        relationships.add(relationship.id);
      }
      if (relationships.has(relationship.id)) {
        classes.add(relationship.sourceClassId);
        classes.add(relationship.targetClassId);
      }
    }
  }
  const changed = [
    ...[...classes].filter(
      (id) =>
        !same(
          expected.classes.find((c) => c.id === id),
          current.classes.find((c) => c.id === id),
        ),
    ),
    ...[...relationships].filter(
      (id) =>
        !same(
          expected.relationships.find((r) => r.id === id),
          current.relationships.find((r) => r.id === id),
        ),
    ),
  ];
  return changed.length === 0
    ? []
    : [
        {
          code: 'STALE_PROPOSAL',
          severity: 'ERROR',
          elementIds: changed,
          message:
            'Los elementos de esta propuesta cambiaron desde que se preparó. Vuelve a enviar la instrucción y revisa la propuesta nueva antes de aplicarla.',
        },
      ];
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
}
