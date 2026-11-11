import type { Command, SemanticModel, ValidationIssue } from '@uml/contracts';
import { normalizeName } from '@uml/domain-core';

type Fields = Record<string, unknown>;
type Expectation = { fields: Fields | null; classId?: string };

function isSemanticCommand(command: Command): boolean {
  if (command.type === 'MOVE_CLASS') return false;
  if (command.type === 'UPDATE_ATTRIBUTE' && command.payload.beforeAttributeId !== undefined) {
    const {
      classId: _classId,
      attributeId: _attributeId,
      beforeAttributeId: _before,
      ...fields
    } = command.payload;
    return Object.values(fields).some((value) => value !== undefined);
  }
  return true;
}

export const isSemanticBatch = (commands: readonly Command[]) => commands.some(isSemanticCommand);

/** Identidad del hallazgo independiente de su redacción y del orden del validador. */
export const reviewIssueKey = (issue: ValidationIssue) =>
  JSON.stringify([issue.code, [...new Set(issue.elementIds)].sort()]);

/** Compara el efecto FINAL del lote, no su timestamp ni solo la existencia del ID.
 * Los mapas acumulan escrituras por campo: la última operación del mismo lote gana. */
export function hasBatchEvidence(model: SemanticModel, commands: readonly Command[]): boolean {
  if (!isSemanticBatch(commands)) return false;
  const classes = new Map<string, Expectation>();
  const attributes = new Map<string, Expectation>();
  const operations = new Map<string, Expectation>();
  const relationships = new Map<string, Expectation>();
  const put = (
    map: Map<string, Expectation>,
    id: string,
    fields: Fields | null,
    reset = false,
    classId?: string,
  ) => {
    map.set(id, {
      fields: fields === null ? null : { ...(reset ? {} : map.get(id)?.fields), ...fields },
      ...(classId ? { classId } : {}),
    });
  };
  const names = (displayName: string, kind: 'CLASS' | 'ATTRIBUTE') => {
    const { codeName, databaseName } = normalizeName(displayName, kind);
    return { displayName, codeName, databaseName };
  };
  try {
    for (const command of commands) {
      switch (command.type) {
        case 'MOVE_CLASS':
          break;
        case 'CREATE_CLASS':
        case 'RENAME_CLASS':
          put(
            classes,
            command.payload.classId,
            names(command.payload.displayName, 'CLASS'),
            command.type === 'CREATE_CLASS',
          );
          if (command.type === 'CREATE_CLASS')
            put(classes, command.payload.classId, {
              kind: command.payload.kind,
              isAbstract: command.payload.isAbstract,
              literals: command.payload.literals,
            });
          break;
        case 'UPDATE_CLASS': {
          const { classId, ...fields } = command.payload;
          put(classes, classId, fields);
          break;
        }
        case 'ADD_OPERATION':
          put(
            operations,
            command.payload.operation.id,
            { ...command.payload.operation },
            true,
            command.payload.classId,
          );
          break;
        case 'UPDATE_OPERATION':
          put(
            operations,
            command.payload.operationId,
            command.payload.changes,
            false,
            command.payload.classId,
          );
          break;
        case 'DELETE_OPERATION':
          put(operations, command.payload.operationId, null, true, command.payload.classId);
          break;
        case 'DELETE_CLASS': {
          const id = command.payload.classId;
          put(classes, id, null);
          for (const [key, value] of attributes)
            if (value.classId === id) put(attributes, key, null, true, id);
          for (const [key, value] of operations)
            if (value.classId === id) put(operations, key, null, true, id);
          for (const [key, value] of relationships) {
            const actual = model.relationships.find((r) => r.id === key);
            if (
              (value.fields?.['sourceClassId'] ?? actual?.sourceClassId) === id ||
              (value.fields?.['targetClassId'] ?? actual?.targetClassId) === id
            )
              put(relationships, key, null);
          }
          break;
        }
        case 'ADD_ATTRIBUTE': {
          const p = command.payload;
          put(
            attributes,
            p.attributeId,
            {
              ...names(p.displayName, 'ATTRIBUTE'),
              type: p.type,
              primaryKey: p.primaryKey ?? false,
              nullable: p.nullable ?? true,
              unique: p.unique ?? false,
              visibility: p.visibility,
              isStatic: p.isStatic,
              multiplicity: p.multiplicity,
              defaultValue: p.defaultValue,
              isDerived: p.isDerived,
              isReadOnly: p.isReadOnly,
            },
            true,
            p.classId,
          );
          break;
        }
        case 'UPDATE_ATTRIBUTE': {
          if (!isSemanticCommand(command)) break;
          const {
            attributeId,
            classId,
            displayName,
            beforeAttributeId: _before,
            ...fields
          } = command.payload;
          put(
            attributes,
            attributeId,
            { ...fields, ...(displayName === undefined ? {} : names(displayName, 'ATTRIBUTE')) },
            false,
            classId,
          );
          break;
        }
        case 'DELETE_ATTRIBUTE':
          put(attributes, command.payload.attributeId, null, true, command.payload.classId);
          break;
        case 'CREATE_RELATIONSHIP': {
          const { relationshipId, ...fields } = command.payload;
          put(
            relationships,
            relationshipId,
            {
              ...fields,
              kind: fields.kind ?? 'ASSOCIATION',
              sourceRoleName: fields.sourceRoleName ?? null,
              targetRoleName: fields.targetRoleName ?? null,
            },
            true,
          );
          break;
        }
        case 'UPDATE_RELATIONSHIP':
        case 'CHANGE_MULTIPLICITY': {
          const { relationshipId, ...fields } = command.payload;
          put(relationships, relationshipId, fields);
          break;
        }
        case 'DELETE_RELATIONSHIP':
          put(relationships, command.payload.relationshipId, null);
      }
    }
  } catch {
    return false; // Un nombre no aplicable no constituye evidencia.
  }
  const matches = (actual: Fields | undefined, expected: Fields | null) =>
    expected === null
      ? !actual
      : !!actual &&
        Object.entries(expected).every(
          ([key, value]) =>
            value === undefined ||
            JSON.stringify(
              key === 'kind' ? (actual[key] ?? 'ASSOCIATION') : (actual[key] ?? null),
            ) === JSON.stringify(value),
        );
  return (
    [...classes].every(([id, e]) =>
      matches(
        model.classes.find((c) => c.id === id),
        e.fields,
      ),
    ) &&
    [...attributes].every(([id, e]) =>
      matches(
        model.classes.find((c) => c.id === e.classId)?.attributes.find((a) => a.id === id),
        e.fields,
      ),
    ) &&
    [...operations].every(([id, e]) =>
      matches(
        model.classes.find((c) => c.id === e.classId)?.operations?.find((o) => o.id === id),
        e.fields,
      ),
    ) &&
    [...relationships].every(([id, e]) =>
      matches(
        model.relationships.find((r) => r.id === id),
        e.fields,
      ),
    )
  );
}

/** IDs realmente editados; los extremos de una relación nueva no fueron editados. */
export function touchedElements(commands: readonly Command[]): Set<string> {
  return new Set(
    commands.flatMap((command) => {
      if (!isSemanticCommand(command)) return [];
      const p = command.payload;
      if ('relationshipId' in p) return [p.relationshipId];
      if ('attributeId' in p) return [p.classId, p.attributeId];
      if ('operationId' in p) return [p.classId, p.operationId];
      if ('operation' in p) return [p.classId, p.operation.id];
      return [p.classId];
    }),
  );
}

/** Plantilla P0 sin LLM: no resuelve ejercicios proactivamente en ningún modo. */
export function reviewText(issues: readonly ValidationIssue[], hintsOnly: boolean): string {
  const hints: Partial<Record<ValidationIssue['code'], string>> = {
    MANY_TO_MANY_RELATIONSHIP: '¿Qué concepto podría representar el vínculo y sus datos propios?',
    INHERITANCE_CYCLE: '¿Puedes recorrer la jerarquía sin regresar al punto de partida?',
    DUPLICATE_CLASS_NAME:
      '¿Las clases representan conceptos distintos y sus nombres los diferencian?',
    DUPLICATE_ATTRIBUTE_NAME: '¿Estos atributos representan el mismo dato o conceptos distintos?',
  };
  return [
    'Revisión automática: detecté errores nuevos en el modelo persistido.',
    ...issues
      .slice(0, 8)
      .map(
        (issue) =>
          `[${issue.code}] ${issue.message}\n${hintsOnly ? 'Pista: ' + (hints[issue.code] ?? 'Revisa la regla del modelo y los elementos señalados; puedes pedir orientación en Preguntar.') : 'Alternativa: ' + (issue.suggestion ?? 'Revisa los elementos implicados y solicita una revisión para analizar la regla.')}`,
      ),
    ...(issues.length > 8
      ? [`Hay ${issues.length - 8} errores nuevos adicionales; consulta el panel de validación.`]
      : []),
    'No he modificado el diagrama. Las advertencias siguen disponibles en Validación.',
  ].join('\n\n');
}
