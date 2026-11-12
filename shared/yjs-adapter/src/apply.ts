import type {
  Command,
  CommandBatch,
  SemanticModel,
  UmlClass,
  UmlRelationship,
  ValidationIssue,
} from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import type * as Y from 'yjs';
import {
  appendAttribute,
  attributesArray,
  bindMemberType,
  classesMap,
  deleteOperation,
  deletePosition,
  ensureAttributeRanks,
  findAttributeIndex,
  forgetMemberType,
  indexUmlTypes,
  preserveClassTypeReferences,
  rememberTypeName,
  readBoardState,
  relationshipsMap,
  setPosition,
  writeAttributeOrder,
  writeEmptyClass,
  writeRelationship,
  operationsMap,
  writeOperation,
  CLASSIFIER_FIELDS,
  MEMBER_FIELDS,
  RELATIONSHIP_FIELDS,
  metaMap,
  writeOperationParameters,
  type UmlTypeIndex,
} from './document.js';

/**
 * Aplicador de lotes sobre el documento colaborativo.
 *
 * La secuencia es la de 4.7: planificar, validar el lote completo, y si todo es
 * valido aplicar dentro de una unica transaccion del documento. La transaccion
 * agrupa el cambio para que produzca una sola actualizacion a los demas
 * participantes; no se usa como mecanismo de deshacer, porque la validacion ya
 * ocurrio antes.
 *
 * Este modulo NO reimplementa las reglas. Llama a `applyBatch` de
 * `@uml/domain-core`, que valida y calcula el estado resultante, y despues
 * escribe en el documento **los valores que ese resultado contiene** — nombres
 * tecnicos incluidos. Lo unico que vive aqui es donde va cada cosa en el arbol
 * Yjs (RA-05).
 *
 * La prueba `equivalencia.test.ts` comprueba que la proyeccion del documento
 * coincide con el estado que devolvio el dominio. Si algun dia divergen, falla
 * ahi y no en la defensa.
 */

export type DocumentBatchOutcome =
  | { readonly applied: true; readonly issues: readonly ValidationIssue[] }
  | { readonly applied: false; readonly issues: readonly ValidationIssue[] };

/** Marca de origen de la transaccion, para distinguir lo local de lo remoto. */
export const LOCAL_ORIGIN = 'uml-local';

export function applyBatchToDocument(
  doc: Y.Doc,
  batch: CommandBatch,
  origin: unknown = LOCAL_ORIGIN,
): DocumentBatchOutcome {
  const previous = readBoardState(doc);
  const outcome = applyBatch(previous, batch);

  // RA-03: si algun comando no se puede ejecutar, no se escribe nada. Los
  // errores del modelo resultante si se escriben y quedan marcados: bloquean la
  // generacion, no la edicion.
  if (!outcome.applied) {
    return { applied: false, issues: outcome.issues };
  }

  const types = indexUmlTypes(outcome.state.semantic.classes);
  doc.transact(() => {
    removeCompetingAssociationClassLinks(doc, previous.semantic.relationships);
    if (metaMap(doc).get('schemaVersion') !== outcome.state.schemaVersion)
      metaMap(doc).set('schemaVersion', outcome.state.schemaVersion);
    for (const command of batch.commands) {
      writeCommand(doc, command, outcome.state.semantic, types);
    }
    writeAttributeMoves(doc, batch.commands, outcome.state.semantic);
  }, origin);

  return { applied: true, issues: outcome.issues };
}

function removeCompetingAssociationClassLinks(
  doc: Y.Doc,
  relationships: readonly UmlRelationship[],
): void {
  const owners = new Map<string, string>();
  for (const relationship of relationships) {
    if (relationship.associationClassId !== undefined)
      owners.set(relationship.associationClassId, relationship.id);
  }
  if (owners.size === 0) return;

  // Limpiar los vínculos descartados antes de que un comando quite el vínculo activo.
  for (const [id, node] of relationshipsMap(doc)) {
    const classId = node.get('associationClassId');
    const owner = typeof classId === 'string' ? owners.get(classId) : undefined;
    if (owner !== undefined && owner !== id) node.delete('associationClassId');
  }
}

function writeAttributeMoves(doc: Y.Doc, commands: readonly Command[], model: SemanticModel): void {
  const movedByClass = new Map<string, Set<string>>();
  for (const command of commands) {
    if (command.type !== 'ADD_ATTRIBUTE' && command.type !== 'UPDATE_ATTRIBUTE') continue;
    const { classId, attributeId, beforeAttributeId } = command.payload;
    if (beforeAttributeId === undefined || beforeAttributeId === attributeId) continue;
    const moved = movedByClass.get(classId) ?? new Set<string>();
    moved.add(attributeId);
    movedByClass.set(classId, moved);
  }
  for (const [classId, moved] of movedByClass) {
    const node = classesMap(doc).get(classId);
    const umlClass = findClass(model, classId);
    if (node !== undefined && umlClass !== undefined) {
      writeAttributeOrder(node, umlClass.attributes, moved);
    }
  }
}

/**
 * Escribe en el documento el efecto de un comando.
 *
 * `resultado` es el modelo que ya calculo el dominio: de ahi salen los nombres
 * tecnicos, los valores por defecto y todo lo derivado.
 *
 * Los comandos se reproducen en orden hacia ese resultado, cada uno escribiendo
 * solo lo suyo. Por eso un elemento puede no estar en `resultado`: significa que
 * un comando posterior del mismo lote lo elimino, y entonces no hay nada que
 * escribir. Esos casos se saltan en lugar de fallar.
 */
function writeCommand(
  doc: Y.Doc,
  command: Command,
  resultado: SemanticModel,
  types: UmlTypeIndex,
): void {
  switch (command.type) {
    case 'CREATE_CLASS': {
      const umlClass = findClass(resultado, command.payload.classId);
      if (umlClass === undefined) return;

      // Sin atributos: los que tenga en el resultado los anaden los comandos
      // `ADD_ATTRIBUTE` que vengan detras. Escribirlos aqui los duplicaria.
      writeEmptyClass(classesMap(doc), umlClass);
      if (command.payload.position !== undefined) {
        setPosition(doc, umlClass.id, command.payload.position);
      }
      return;
    }

    case 'RENAME_CLASS': {
      const umlClass = findClass(resultado, command.payload.classId);
      if (umlClass === undefined) return;

      const node = classesMap(doc).get(umlClass.id);
      if (node === undefined) return;

      preserveClassTypeReferences(doc, umlClass.id);
      node.set('displayName', umlClass.displayName);
      rememberTypeName(doc, umlClass.id, umlClass.displayName);
      node.set('codeName', umlClass.codeName);
      node.set('databaseName', umlClass.databaseName);
      return;
    }

    case 'UPDATE_CLASS': {
      const target = findClass(resultado, command.payload.classId);
      const node = classesMap(doc).get(command.payload.classId);
      if (target === undefined || node === undefined) return;
      if (command.payload.kind !== undefined && node.get('kind') !== target.kind) {
        const activeLinks = new Set(
          resultado.relationships
            .filter((r) => r.associationClassId === target.id)
            .map((r) => r.id),
        );
        for (const [id, relationship] of relationshipsMap(doc))
          if (relationship.get('associationClassId') === target.id && !activeLinks.has(id))
            relationship.delete('associationClassId');
      }
      for (const field of CLASSIFIER_FIELDS)
        if (command.payload[field] !== undefined) node.set(field, target[field]);
      return;
    }

    case 'ADD_OPERATION': {
      const target = findClass(resultado, command.payload.classId);
      const operation = target?.operations?.find((o) => o.id === command.payload.operation.id);
      if (operation !== undefined) {
        writeOperation(
          doc,
          command.payload.classId,
          operation,
          command.payload.beforeOperationId,
          types,
        );
        classesMap(doc).get(command.payload.classId)?.set('hasOperations', true);
      }
      return;
    }

    case 'UPDATE_OPERATION': {
      const operation = findClass(resultado, command.payload.classId)?.operations?.find(
        (o) => o.id === command.payload.operationId,
      );
      const node = operationsMap(doc).get(command.payload.operationId);
      if (operation === undefined || node === undefined) return;
      for (const field of Object.keys(
        command.payload.changes,
      ) as (keyof typeof command.payload.changes)[]) {
        if (field === 'parameters') {
          writeOperationParameters(
            node,
            operation.parameters,
            types,
            command.payload.autoParameterId,
          );
          continue;
        }
        const value = operation[field];
        if (value !== undefined) node.set(field, structuredClone(value));
        if (field === 'returnType') bindMemberType(doc, operation.id, operation.returnType, types);
      }
      return;
    }

    case 'DELETE_OPERATION':
      deleteOperation(doc, command.payload.operationId);
      return;

    case 'DELETE_CLASS': {
      const { classId } = command.payload;
      const classifier = classesMap(doc).get(classId);
      if (classifier) {
        rememberTypeName(doc, classId, classifier.get('displayName'));
        for (const attribute of attributesArray(classifier).toArray())
          forgetMemberType(doc, attribute.get('id') as string);
      }
      classesMap(doc).delete(classId);
      deletePosition(doc, classId);
      for (const [id, operation] of operationsMap(doc))
        if (operation.get('classId') === classId) deleteOperation(doc, id);

      // Las relaciones que tocaban la clase se van con ella. Se toman del
      // resultado del dominio: las que ya no estan ahi son las que sobran.
      const supervivientes = new Map(resultado.relationships.map((item) => [item.id, item]));
      const relationships = relationshipsMap(doc);
      for (const [id, node] of relationships) {
        const relationship = supervivientes.get(id);
        if (relationship === undefined) relationships.delete(id);
        else if (
          node.get('associationClassId') === classId &&
          relationship.associationClassId !== classId
        )
          node.delete('associationClassId');
      }
      return;
    }

    case 'MOVE_CLASS':
      setPosition(doc, command.payload.classId, command.payload.position, command.payload.size);
      return;

    case 'ADD_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      const attribute = findClass(resultado, command.payload.classId)?.attributes.find(
        (item) => item.id === command.payload.attributeId,
      );
      if (attribute !== undefined) {
        appendAttribute(node, attribute);
        bindMemberType(doc, attribute.id, attribute.type, types);
      }
      return;
    }

    case 'UPDATE_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      const indice = findAttributeIndex(node, command.payload.attributeId);
      if (indice < 0) return;

      const attributes = findClass(resultado, command.payload.classId)?.attributes;
      const attribute = attributes?.find((item) => item.id === command.payload.attributeId);
      if (attributes === undefined || attribute === undefined) return;

      // Se actualizan los campos del nodo existente en lugar de reemplazarlo:
      // sustituirlo lo moveria al final y perderia el orden que el usuario ve.
      const target = attributesArray(node).get(indice);
      // Escribir también valores sin cambios crea conflictos Yjs artificiales:
      // renombrar no debe competir con quien modifica el tipo o la nulabilidad.
      if (command.payload.displayName !== undefined) {
        for (const field of ['displayName', 'codeName', 'databaseName'] as const) {
          target.set(field, attribute[field]);
        }
      }
      for (const field of ['type', 'primaryKey', 'nullable', 'unique', ...MEMBER_FIELDS] as const) {
        if (command.payload[field] !== undefined) target.set(field, attribute[field]);
      }
      if (command.payload.type !== undefined)
        bindMemberType(doc, attribute.id, attribute.type, types);
      return;
    }

    case 'DELETE_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      ensureAttributeRanks(node);
      const attributes = attributesArray(node);
      const entries = attributes.toArray();
      for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index]?.get('id') === command.payload.attributeId) attributes.delete(index, 1);
      }
      forgetMemberType(doc, command.payload.attributeId);
      return;
    }

    case 'CREATE_RELATIONSHIP': {
      const relationship = findRelationship(resultado, command.payload.relationshipId);
      if (relationship === undefined) return;

      writeRelationship(relationshipsMap(doc), relationship);
      return;
    }

    case 'UPDATE_RELATIONSHIP':
    case 'CHANGE_MULTIPLICITY': {
      const relationship = findRelationship(resultado, command.payload.relationshipId);
      if (relationship === undefined) return;

      const node = relationshipsMap(doc).get(relationship.id);
      if (node === undefined) return;

      if (command.type === 'UPDATE_RELATIONSHIP') {
        // Un vínculo invalidado por la fusión no debe reaparecer al volver a Asociación.
        if (command.payload.kind !== undefined && relationship.associationClassId === undefined)
          node.delete('associationClassId');
        for (const field of [
          'kind',
          'sourceRoleName',
          'targetRoleName',
          ...RELATIONSHIP_FIELDS,
        ] as const) {
          if (command.payload[field] === undefined) continue;
          const value = relationship[field];
          if (value === undefined) node.delete(field);
          else node.set(field, value);
        }
      } else {
        for (const field of ['sourceMultiplicity', 'targetMultiplicity'] as const) {
          if (command.payload[field] !== undefined) node.set(field, relationship[field]);
        }
      }
      return;
    }

    case 'DELETE_RELATIONSHIP':
      relationshipsMap(doc).delete(command.payload.relationshipId);
      return;
  }
}

// Ausente significa que un comando posterior del mismo lote lo elimino.

function findClass(model: SemanticModel, classId: string): UmlClass | undefined {
  return model.classes.find((item) => item.id === classId);
}

function findRelationship(
  model: SemanticModel,
  relationshipId: string,
): UmlRelationship | undefined {
  return model.relationships.find((item) => item.id === relationshipId);
}
