import {
  hasErrors,
  severityOf,
  type BoardState,
  type Command,
  type CommandBatch,
  type CommandOf,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
  type ValidationCode,
  type ValidationIssue,
} from '@uml/contracts';
import { InvalidIdentifierError, normalizeName } from './naming.js';
import { validateModel } from './validate.js';

/**
 * Aplicador de comandos (plan maestro 4.7).
 *
 * Secuencia obligatoria:
 *   planificar → validar el lote completo → si hay un solo error no aplicar
 *   nada → si todo es valido aplicar dentro de una transaccion del documento
 *
 * Este modulo cubre los tres primeros pasos sobre el modelo canonico plano. La
 * transaccion del documento colaborativo es cosa de `@uml/yjs-adapter`, que
 * reutiliza exactamente esta validacion en lugar de reimplementarla (RA-05).
 *
 * La funcion es pura: recibe un estado y devuelve otro. No muta el que recibe,
 * de modo que un lote rechazado no deja rastro (RA-03).
 */

export type BatchOutcome =
  | {
      readonly applied: true;
      readonly state: BoardState;
      /**
       * Hallazgos del modelo resultante, errores incluidos.
       *
       * Un error aqui **no** significa que el lote fallara: significa que el
       * modelo no se puede generar todavia. Ver la nota de mas abajo.
       */
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly applied: false;
      /** Por que se rechazo. Contiene al menos un error de precondicion. */
      readonly issues: readonly ValidationIssue[];
    };

function issue(
  code: ValidationCode,
  message: string,
  elementIds: readonly string[],
  suggestion?: string,
): ValidationIssue {
  return {
    code,
    severity: severityOf(code),
    message,
    elementIds: [...elementIds],
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

/**
 * Aplica un lote entero o ninguno de sus comandos.
 *
 * **Que rechaza y que no.** El lote se rechaza cuando algun comando no se puede
 * ejecutar: apunta a una clase que no existe, repite un identificador, o su
 * nombre no produce ningun identificador valido. Eso es CA-032.2, y es lo que
 * significa "si un comando del lote es invalido no se aplica ninguno".
 *
 * Lo que **no** rechaza el lote son los errores del modelo resultante — dos
 * nombres que colapsan, una relacion muchos a muchos, una clase sin clave. Esos
 * bloquean la **generacion**, no la edicion:
 *
 *   - CA-017.1 los describe como "Error, bloquea la generacion".
 *   - CA-025.1 dice que el documento converge y el validador los marca "antes de
 *     permitir generar".
 *   - RM-01 dice que la herramienta *ofrece* crear la clase intermedia al
 *     detectar una N:M, no que impida dibujarla.
 *
 * La diferencia importa en la practica: bloquear la edicion le revierte al
 * usuario lo que acaba de escribir sin decirle nada util, y ademas dejaria
 * congelada cualquier pizarra que quedara invalida por una fusion concurrente
 * — incluido el cambio que la arreglaria. Marcarlo deja la pizarra viva y el
 * problema visible en el panel de validacion.
 *
 * @param state Estado actual de la pizarra. No se modifica.
 * @param batch Lote ya validado contra el esquema de contratos.
 */
export function applyBatch(state: BoardState, batch: CommandBatch): BatchOutcome {
  const planned = planBatch(state, batch);
  if (!planned.applied) return planned;
  return { ...planned, issues: validateModel(planned.state.semantic) };
}

/** Borrador puro para resolver operaciones dependientes; la validación global
 * se ejecuta al cerrar el lote con applyBatch, no tras cada paso intermedio. */
export function planBatch(state: BoardState, batch: CommandBatch): BatchOutcome {
  const draft = cloneState(state);
  const preconditionIssues: ValidationIssue[] = [];

  for (const command of batch.commands) {
    // Se sigue recorriendo el lote aunque uno falle, para reportar todo lo que
    // esta mal de una vez. Da igual que el borrador quede a medias: solo se usa
    // si no hubo ningun fallo.
    preconditionIssues.push(...applyCommand(draft, command));
  }

  if (hasErrors(preconditionIssues)) {
    return { applied: false, issues: preconditionIssues };
  }

  return { applied: true, state: draft, issues: [] };
}

function cloneState(state: BoardState): BoardState {
  return structuredClone(state) as BoardState;
}

// ---------------------------------------------------------------------------
// Un comando a la vez
// ---------------------------------------------------------------------------

/**
 * Aplica un comando sobre el borrador y devuelve sus fallos de precondicion.
 *
 * Devolver `[]` significa que el comando se aplico. Nunca lanza por un modelo
 * incoherente: eso es un hallazgo del validador, no una excepcion.
 */
function applyCommand(draft: BoardState, command: Command): ValidationIssue[] {
  switch (command.type) {
    case 'CREATE_CLASS':
      return createClass(draft, command);
    case 'RENAME_CLASS':
      return renameClass(draft, command);
    case 'DELETE_CLASS':
      return deleteClass(draft, command);
    case 'MOVE_CLASS':
      return moveClass(draft, command);
    case 'ADD_ATTRIBUTE':
      return addAttribute(draft, command);
    case 'UPDATE_ATTRIBUTE':
      return updateAttribute(draft, command);
    case 'DELETE_ATTRIBUTE':
      return deleteAttribute(draft, command);
    case 'CREATE_RELATIONSHIP':
      return createRelationship(draft, command);
    case 'UPDATE_RELATIONSHIP':
      return updateRelationship(draft, command);
    case 'DELETE_RELATIONSHIP':
      return deleteRelationship(draft, command);
    case 'CHANGE_MULTIPLICITY':
      return changeMultiplicity(draft, command);
  }
}

function createClass(draft: BoardState, command: CommandOf<'CREATE_CLASS'>): ValidationIssue[] {
  const { classId, displayName, position } = command.payload;

  if (findClass(draft, classId) !== undefined) {
    return [
      issue('DUPLICATE_ID', `Ya existe una clase con el identificador ${classId}.`, [classId]),
    ];
  }

  const names = deriveNames(displayName, 'CLASS');
  if ('issue' in names) return [names.issue(classId, 'La clase')];

  const umlClass: UmlClass = {
    id: classId,
    displayName,
    codeName: names.codeName,
    databaseName: names.databaseName,
    attributes: [],
  };

  draft.semantic.classes.push(umlClass);
  if (position !== undefined) {
    draft.layout.positions[classId] = position;
  }

  return [];
}

function renameClass(draft: BoardState, command: CommandOf<'RENAME_CLASS'>): ValidationIssue[] {
  const { classId, displayName } = command.payload;
  const umlClass = findClass(draft, classId);
  if (umlClass === undefined) return [unknownClass(classId)];

  const names = deriveNames(displayName, 'CLASS');
  if ('issue' in names) return [names.issue(classId, 'La clase')];

  // RA-04: el identificador no cambia, asi que ninguna relacion se rompe.
  umlClass.displayName = displayName;
  umlClass.codeName = names.codeName;
  umlClass.databaseName = names.databaseName;

  return [];
}

function deleteClass(draft: BoardState, command: CommandOf<'DELETE_CLASS'>): ValidationIssue[] {
  const { classId } = command.payload;
  if (findClass(draft, classId) === undefined) return [unknownClass(classId)];

  draft.semantic.classes = draft.semantic.classes.filter((c) => c.id !== classId);

  // Las relaciones que tocaban la clase se van con ella. Dejarlas produciria un
  // modelo que el validador rechazaria acto seguido por apuntar a una clase
  // inexistente, y obligaria al usuario a limpiar a mano lo que la herramienta
  // acaba de romper.
  draft.semantic.relationships = draft.semantic.relationships.filter(
    (rel) => rel.sourceClassId !== classId && rel.targetClassId !== classId,
  );

  delete draft.layout.positions[classId];
  delete draft.layout.sizes[classId];
  return [];
}

function moveClass(draft: BoardState, command: CommandOf<'MOVE_CLASS'>): ValidationIssue[] {
  const { classId, position, size } = command.payload;
  if (findClass(draft, classId) === undefined) return [unknownClass(classId)];

  // Solo layout: no tiene valor semantico y no puede invalidar el modelo.
  draft.layout.positions[classId] = position;

  // El tamano solo se toca cuando viene. Arrastrar emite el comando sin el, y
  // borrarlo entonces desharia el ajuste que alguien acaba de hacer a mano.
  if (size !== undefined) draft.layout.sizes[classId] = size;

  return [];
}

function addAttribute(draft: BoardState, command: CommandOf<'ADD_ATTRIBUTE'>): ValidationIssue[] {
  const { classId, attributeId, displayName, type } = command.payload;
  const umlClass = findClass(draft, classId);
  if (umlClass === undefined) return [unknownClass(classId)];

  if (umlClass.attributes.some((a) => a.id === attributeId)) {
    return [
      issue('DUPLICATE_ID', `Ya existe un atributo con el identificador ${attributeId}.`, [
        classId,
        attributeId,
      ]),
    ];
  }

  const names = deriveNames(displayName, 'ATTRIBUTE');
  if ('issue' in names) return [names.issue(attributeId, 'El atributo')];

  const attribute: UmlAttribute = {
    id: attributeId,
    displayName,
    codeName: names.codeName,
    databaseName: names.databaseName,
    type,
    primaryKey: command.payload.primaryKey ?? false,
    nullable: command.payload.nullable ?? true,
    unique: command.payload.unique ?? false,
  };

  umlClass.attributes.push(attribute);
  return [];
}

function updateAttribute(
  draft: BoardState,
  command: CommandOf<'UPDATE_ATTRIBUTE'>,
): ValidationIssue[] {
  const { classId, attributeId } = command.payload;
  const umlClass = findClass(draft, classId);
  if (umlClass === undefined) return [unknownClass(classId)];

  const attribute = umlClass.attributes.find((a) => a.id === attributeId);
  if (attribute === undefined) return [unknownAttribute(classId, attributeId)];

  if (command.payload.displayName !== undefined) {
    const names = deriveNames(command.payload.displayName, 'ATTRIBUTE');
    if ('issue' in names) return [names.issue(attributeId, 'El atributo')];

    attribute.displayName = command.payload.displayName;
    attribute.codeName = names.codeName;
    attribute.databaseName = names.databaseName;
  }

  if (command.payload.type !== undefined) attribute.type = command.payload.type;
  if (command.payload.primaryKey !== undefined) attribute.primaryKey = command.payload.primaryKey;
  if (command.payload.nullable !== undefined) attribute.nullable = command.payload.nullable;
  if (command.payload.unique !== undefined) attribute.unique = command.payload.unique;

  return [];
}

function deleteAttribute(
  draft: BoardState,
  command: CommandOf<'DELETE_ATTRIBUTE'>,
): ValidationIssue[] {
  const { classId, attributeId } = command.payload;
  const umlClass = findClass(draft, classId);
  if (umlClass === undefined) return [unknownClass(classId)];

  if (!umlClass.attributes.some((a) => a.id === attributeId)) {
    return [unknownAttribute(classId, attributeId)];
  }

  umlClass.attributes = umlClass.attributes.filter((a) => a.id !== attributeId);
  return [];
}

function createRelationship(
  draft: BoardState,
  command: CommandOf<'CREATE_RELATIONSHIP'>,
): ValidationIssue[] {
  const payload = command.payload;

  if (findRelationship(draft, payload.relationshipId) !== undefined) {
    return [
      issue(
        'DUPLICATE_ID',
        `Ya existe una relacion con el identificador ${payload.relationshipId}.`,
        [payload.relationshipId],
      ),
    ];
  }

  for (const classId of [payload.sourceClassId, payload.targetClassId]) {
    if (findClass(draft, classId) === undefined) return [unknownClass(classId)];
  }

  // Una generalizacion reflexiva nunca tiene sentido: una clase no puede ser
  // su propia superclase. Las asociaciones estructurales si pueden ser
  // recursivas (por ejemplo Empleado.jefe -> Empleado) y el generador las
  // traduce a una clave foranea que referencia la misma tabla.
  if (payload.sourceClassId === payload.targetClassId && payload.kind === 'GENERALIZATION') {
    return [
      issue(
        'SELF_RELATIONSHIP',
        'Una clase no puede generalizarse a si misma.',
        [payload.relationshipId, payload.sourceClassId],
        'Usa una asociacion recursiva si una instancia debe apuntar a otra de la misma clase.',
      ),
    ];
  }

  const relationship: UmlRelationship = {
    id: payload.relationshipId,
    ...(payload.kind === undefined ? {} : { kind: payload.kind }),
    sourceClassId: payload.sourceClassId,
    targetClassId: payload.targetClassId,
    sourceMultiplicity: payload.sourceMultiplicity,
    targetMultiplicity: payload.targetMultiplicity,
    ...(payload.sourceRoleName === undefined ? {} : { sourceRoleName: payload.sourceRoleName }),
    ...(payload.targetRoleName === undefined ? {} : { targetRoleName: payload.targetRoleName }),
  };

  draft.semantic.relationships.push(relationship);
  return [];
}

function updateRelationship(
  draft: BoardState,
  command: CommandOf<'UPDATE_RELATIONSHIP'>,
): ValidationIssue[] {
  const { relationshipId } = command.payload;
  const relationship = findRelationship(draft, relationshipId);
  if (relationship === undefined) return [unknownRelationship(relationshipId)];

  if (command.payload.kind !== undefined) {
    relationship.kind = command.payload.kind;
  }

  // `null` borra el rol; `undefined` lo deja como estaba. Sin esa distincion no
  // habria forma de quitar un rol ya asignado.
  if (command.payload.sourceRoleName === null) {
    delete relationship.sourceRoleName;
  } else if (command.payload.sourceRoleName !== undefined) {
    relationship.sourceRoleName = command.payload.sourceRoleName;
  }

  if (command.payload.targetRoleName === null) {
    delete relationship.targetRoleName;
  } else if (command.payload.targetRoleName !== undefined) {
    relationship.targetRoleName = command.payload.targetRoleName;
  }

  return [];
}

function deleteRelationship(
  draft: BoardState,
  command: CommandOf<'DELETE_RELATIONSHIP'>,
): ValidationIssue[] {
  const { relationshipId } = command.payload;
  if (findRelationship(draft, relationshipId) === undefined) {
    return [unknownRelationship(relationshipId)];
  }

  draft.semantic.relationships = draft.semantic.relationships.filter(
    (rel) => rel.id !== relationshipId,
  );
  return [];
}

function changeMultiplicity(
  draft: BoardState,
  command: CommandOf<'CHANGE_MULTIPLICITY'>,
): ValidationIssue[] {
  const { relationshipId } = command.payload;
  const relationship = findRelationship(draft, relationshipId);
  if (relationship === undefined) return [unknownRelationship(relationshipId)];

  if (command.payload.sourceMultiplicity !== undefined) {
    relationship.sourceMultiplicity = command.payload.sourceMultiplicity;
  }
  if (command.payload.targetMultiplicity !== undefined) {
    relationship.targetMultiplicity = command.payload.targetMultiplicity;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function findClass(draft: BoardState, classId: string): UmlClass | undefined {
  return draft.semantic.classes.find((c) => c.id === classId);
}

function findRelationship(draft: BoardState, relationshipId: string): UmlRelationship | undefined {
  return draft.semantic.relationships.find((rel) => rel.id === relationshipId);
}

function unknownClass(classId: string): ValidationIssue {
  return issue('UNKNOWN_CLASS', `No existe ninguna clase con el identificador ${classId}.`, [
    classId,
  ]);
}

function unknownAttribute(classId: string, attributeId: string): ValidationIssue {
  return issue(
    'UNKNOWN_ATTRIBUTE',
    `No existe ningun atributo con el identificador ${attributeId} en esa clase.`,
    [classId, attributeId],
  );
}

function unknownRelationship(relationshipId: string): ValidationIssue {
  return issue(
    'UNKNOWN_RELATIONSHIP',
    `No existe ninguna relacion con el identificador ${relationshipId}.`,
    [relationshipId],
  );
}

type DerivedNames =
  | { readonly codeName: string; readonly databaseName: string }
  | { readonly issue: (elementId: string, etiqueta: string) => ValidationIssue };

/**
 * Deriva los nombres tecnicos, convirtiendo el fallo en hallazgo.
 *
 * El aplicador no puede lanzar por un nombre que el usuario escribio: eso es
 * exactamente lo que el validador esta para reportar.
 */
function deriveNames(displayName: string, kind: 'CLASS' | 'ATTRIBUTE'): DerivedNames {
  try {
    const { codeName, databaseName } = normalizeName(displayName, kind);
    return { codeName, databaseName };
  } catch (error) {
    if (error instanceof InvalidIdentifierError) {
      const motivo =
        error.reason === 'EMPTY' ? 'no contiene ninguna letra ni digito' : 'empieza por un digito';
      return {
        issue: (elementId, etiqueta) =>
          issue(
            'INVALID_IDENTIFIER',
            `${etiqueta} "${displayName}" ${motivo}, asi que no produce un identificador valido.`,
            [elementId],
            'Empieza el nombre por una letra.',
          ),
      };
    }
    throw error;
  }
}
