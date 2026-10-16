import type {
  Command,
  CommandBatch,
  SemanticModel,
  UmlAttribute,
  UmlClass,
  UmlRelationship,
  ValidationIssue,
} from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import type * as Y from 'yjs';
import {
  attributeNode,
  attributesArray,
  classesMap,
  deletePosition,
  findAttributeIndex,
  readBoardState,
  relationshipsMap,
  setPosition,
  writeEmptyClass,
  writeRelationship,
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
  const outcome = applyBatch(readBoardState(doc), batch);

  // RA-03: si algun comando no se puede ejecutar, no se escribe nada. Los
  // errores del modelo resultante si se escriben y quedan marcados: bloquean la
  // generacion, no la edicion.
  if (!outcome.applied) {
    return { applied: false, issues: outcome.issues };
  }

  doc.transact(() => {
    for (const command of batch.commands) {
      writeCommand(doc, command, outcome.state.semantic);
    }
  }, origin);

  return { applied: true, issues: outcome.issues };
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
function writeCommand(doc: Y.Doc, command: Command, resultado: SemanticModel): void {
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

      // RA-04: el identificador no cambia, asi que ninguna relacion se rompe.
      node.set('displayName', umlClass.displayName);
      node.set('codeName', umlClass.codeName);
      node.set('databaseName', umlClass.databaseName);
      return;
    }

    case 'DELETE_CLASS': {
      const { classId } = command.payload;
      classesMap(doc).delete(classId);
      deletePosition(doc, classId);

      // Las relaciones que tocaban la clase se van con ella. Se toman del
      // resultado del dominio: las que ya no estan ahi son las que sobran.
      const supervivientes = new Set(resultado.relationships.map((item) => item.id));
      for (const relationshipId of [...relationshipsMap(doc).keys()]) {
        if (!supervivientes.has(relationshipId)) relationshipsMap(doc).delete(relationshipId);
      }
      return;
    }

    case 'MOVE_CLASS':
      setPosition(doc, command.payload.classId, command.payload.position, command.payload.size);
      return;

    case 'ADD_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      const attribute = findAttribute(
        resultado,
        command.payload.classId,
        command.payload.attributeId,
      );
      if (attribute === undefined) return;

      attributesArray(node).push([attributeNode(attribute)]);
      return;
    }

    case 'UPDATE_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      const indice = findAttributeIndex(node, command.payload.attributeId);
      if (indice < 0) return;

      const attribute = findAttribute(
        resultado,
        command.payload.classId,
        command.payload.attributeId,
      );
      if (attribute === undefined) return;

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
      for (const field of ['type', 'primaryKey', 'nullable', 'unique'] as const) {
        if (command.payload[field] !== undefined) target.set(field, attribute[field]);
      }
      return;
    }

    case 'DELETE_ATTRIBUTE': {
      const node = classesMap(doc).get(command.payload.classId);
      if (node === undefined) return;

      const indice = findAttributeIndex(node, command.payload.attributeId);
      if (indice >= 0) attributesArray(node).delete(indice, 1);
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
        for (const field of ['kind', 'sourceRoleName', 'targetRoleName'] as const) {
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

function findAttribute(
  model: SemanticModel,
  classId: string,
  attributeId: string,
): UmlAttribute | undefined {
  return findClass(model, classId)?.attributes.find((item) => item.id === attributeId);
}

function findRelationship(
  model: SemanticModel,
  relationshipId: string,
): UmlRelationship | undefined {
  return model.relationships.find((item) => item.id === relationshipId);
}
