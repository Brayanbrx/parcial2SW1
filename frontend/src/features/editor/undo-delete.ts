import type { BoardState, UmlAttribute, UmlRelationship, UmlClass } from '@uml/contracts';
import type { CommandBody } from './commands.js';

/**
 * Cómo devolver lo que un borrado acaba de quitar.
 *
 * No hay historial de deshacer: cada cambio es un lote auditado que ya llegó a
 * los demás. Deshacer un borrado es, entonces, otro lote con los comandos de
 * siempre que vuelve a crear lo eliminado con los MISMOS identificadores, en su
 * posición y con sus propiedades. Si alguien cambió el diagrama mientras tanto
 * de forma incompatible, el dominio rechaza el lote y no se aplica nada.
 */
export interface UndoDeletion {
  /** Lo que se le dice a la persona, por ejemplo «Clase «Cliente» eliminada». */
  readonly message: string;
  readonly commands: readonly CommandBody[];
  /** Lo que conviene seleccionar al recuperarlo; null para un atributo. */
  readonly selectId: string | null;
}

export function undoForDeletion(
  state: BoardState,
  commands: readonly CommandBody[],
): UndoDeletion | null {
  // La interfaz borra de a un elemento. Un lote mayor (importar, propuestas de
  // la IA) tiene su propia revisión antes de aplicarse.
  if (commands.length !== 1) return null;
  const [command] = commands;
  if (command === undefined) return null;
  const { classes, relationships } = state.semantic;

  if (command.type === 'DELETE_OPERATION') {
    const { classId, operationId } = command.payload as { classId: string; operationId: string };
    const operations = classes.find((c) => c.id === classId)?.operations ?? [];
    const index = operations.findIndex((o) => o.id === operationId);
    const operation = operations[index];
    const next = operations[index + 1]?.id;
    return operation === undefined
      ? null
      : {
          message: `Operación «${operation.displayName}» eliminada`,
          commands: [
            {
              type: 'ADD_OPERATION',
              payload: { classId, operation, ...(next ? { beforeOperationId: next } : {}) },
            },
          ],
          selectId: classId,
        };
  }

  if (command.type === 'DELETE_ATTRIBUTE') {
    const { classId, attributeId } = command.payload as { classId: string; attributeId: string };
    const umlClass = classes.find((item) => item.id === classId);
    const index = umlClass?.attributes.findIndex((item) => item.id === attributeId) ?? -1;
    const attribute = umlClass?.attributes[index];
    if (umlClass === undefined || attribute === undefined) return null;

    return {
      message: `Atributo «${attribute.displayName}» eliminado`,
      commands: [addAttribute(classId, attribute, umlClass.attributes[index + 1]?.id)],
      selectId: null,
    };
  }

  if (command.type === 'DELETE_RELATIONSHIP') {
    const { relationshipId } = command.payload as { relationshipId: string };
    const relationship = relationships.find((item) => item.id === relationshipId);
    if (relationship === undefined) return null;
    const name = (id: string) => classes.find((item) => item.id === id)?.displayName ?? '?';
    return {
      message: `Relación ${name(relationship.sourceClassId)} → ${name(relationship.targetClassId)} eliminada`,
      commands: [createRelationship(relationship)],
      selectId: relationship.id,
    };
  }

  if (command.type === 'DELETE_CLASS') {
    const { classId } = command.payload as { classId: string };
    const umlClass = classes.find((item) => item.id === classId);
    if (umlClass === undefined) return null;
    const position = state.layout.positions[classId];
    const size = state.layout.sizes[classId];
    // DELETE_CLASS también se lleva las relaciones de la clase.
    const linked = relationships.filter(
      (item) => item.sourceClassId === classId || item.targetClassId === classId,
    );
    const extra =
      linked.length === 0
        ? ''
        : ` con ${linked.length} ${linked.length === 1 ? 'relación' : 'relaciones'}`;
    return {
      message: `Clase «${umlClass.displayName}» eliminada${extra}`,
      commands: [
        {
          type: 'CREATE_CLASS',
          payload: {
            classId,
            displayName: umlClass.displayName,
            ...classifierProperties(umlClass),
            ...(position === undefined ? {} : { position }),
          },
        },
        ...(position !== undefined && size !== undefined
          ? [{ type: 'MOVE_CLASS', payload: { classId, position, size } } satisfies CommandBody]
          : []),
        ...umlClass.attributes.map((item) => addAttribute(classId, item)),
        ...(umlClass.operations ?? []).map((operation): CommandBody => ({
          type: 'ADD_OPERATION',
          payload: { classId, operation },
        })),
        ...linked.map(createRelationship),
        ...relationships
          .filter((item) => item.associationClassId === classId && !linked.includes(item))
          .map((item): CommandBody => ({
            type: 'UPDATE_RELATIONSHIP',
            payload: { relationshipId: item.id, associationClassId: classId },
          })),
      ],
      selectId: classId,
    };
  }

  return null;
}

function addAttribute(
  classId: string,
  attribute: UmlAttribute,
  beforeAttributeId?: string,
): CommandBody {
  return {
    type: 'ADD_ATTRIBUTE',
    payload: {
      classId,
      attributeId: attribute.id,
      displayName: attribute.displayName,
      type: attribute.type,
      primaryKey: attribute.primaryKey,
      nullable: attribute.nullable,
      unique: attribute.unique,
      ...Object.fromEntries(
        [
          'visibility',
          'isStatic',
          'multiplicity',
          'defaultValue',
          'isDerived',
          'isReadOnly',
        ].flatMap((key) => {
          const value = attribute[key as keyof UmlAttribute];
          return value === undefined ? [] : [[key, value]];
        }),
      ),
      ...(beforeAttributeId === undefined ? {} : { beforeAttributeId }),
    },
  };
}

function createRelationship(relationship: UmlRelationship): CommandBody {
  return {
    type: 'CREATE_RELATIONSHIP',
    payload: {
      relationshipId: relationship.id,
      ...(relationship.kind === undefined ? {} : { kind: relationship.kind }),
      sourceClassId: relationship.sourceClassId,
      targetClassId: relationship.targetClassId,
      sourceMultiplicity: relationship.sourceMultiplicity,
      targetMultiplicity: relationship.targetMultiplicity,
      ...Object.fromEntries(
        ['name', 'sourceNavigability', 'targetNavigability', 'associationClassId'].flatMap(
          (key) => {
            const value = relationship[key as keyof UmlRelationship];
            return value === undefined ? [] : [[key, value]];
          },
        ),
      ),
      ...(relationship.sourceRoleName === undefined
        ? {}
        : { sourceRoleName: relationship.sourceRoleName }),
      ...(relationship.targetRoleName === undefined
        ? {}
        : { targetRoleName: relationship.targetRoleName }),
    },
  };
}

function classifierProperties(c: UmlClass) {
  return Object.fromEntries(
    ['kind', 'isAbstract', 'literals'].flatMap((key) => {
      const value = c[key as keyof UmlClass];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}
