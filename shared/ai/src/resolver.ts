import {
  type BatchOrigin,
  type BoardState,
  type Command,
  type CommandBatch,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
  type ValidationIssue,
} from '@uml/contracts';
import { applyBatch, planBatch, normalizeName, toWords } from '@uml/domain-core';
import type { AssistantOperation, BatchProposal } from './proposal.js';

/**
 * Resolucion estructural de una propuesta
 * La decision de preguntar no se toma con un umbral numerico de confianza:
 * los modelos estan mal calibrados y ese umbral produce falsos positivos y
 * negativos sin patron. Se toma consultando el estado del modelo:
 * 1. El objetivo resuelve a un unico elemento = Ejecutar
 * 2. Objetivo ambiguo                         = Preguntar cual
 * 3. Faltan operandos                         = Preguntar el faltante
 * 4. Destructivo de alcance amplio            = Confirmar antes
 */

/** Una operacion que el modo tolerante dejo fuera, y por que. */
export interface SkippedOperation {
  readonly element: string;
  readonly reason: string;
}

export type ResolutionOutcome =
  /** Todo resuelto. El lote esta listo para aplicarse. */
  | {
      readonly kind: 'BATCH';
      readonly batch: CommandBatch;
      readonly summary: readonly string[];
      /** Solo en modo tolerante: lo que se omitio para no cortar la lectura. */
      readonly skipped?: readonly SkippedOperation[];
    }
  /** Falta algo que solo el usuario puede decidir */
  | {
      readonly kind: 'QUESTION';
      readonly question: string;
      readonly options?: readonly string[];
      readonly skipped?: readonly SkippedOperation[];
    }
  /** Resuelto, pero destruye demasiado como para hacerlo sin preguntar */
  | {
      readonly kind: 'CONFIRMATION';
      readonly question: string;
      readonly batch: CommandBatch;
      readonly summary: readonly string[];
      readonly skipped?: readonly SkippedOperation[];
    }
  /** El lote resultante no se puede aplicar */
  | {
      readonly kind: 'REJECTED';
      readonly issues: readonly ValidationIssue[];
      readonly skipped?: readonly SkippedOperation[];
    };

export interface ResolveOptions {
  readonly proposal: BatchProposal;
  readonly model: SemanticModel;
  readonly actorId: string;
  readonly origin: BatchOrigin;
  /**
   * Omite lo que no se pueda resolver en vez de detenerse en la primera duda.
   */
  readonly tolerante?: boolean;
  /** Inyectable para que las pruebas sean deterministas. */
  readonly newId?: () => string;
  readonly now?: () => Date;
}

/**
 * Cuantos elementos hay que borrar para que la operacion se considere de alcance
 * amplio y pase por confirmacion
 * Borrar una clase con todo lo que cuelga de ella es distinto de borrar un
 * atributo: lo primero puede deshacer media hora de trabajo de otra persona
 */
const DESTRUCTIVE_THRESHOLD = 1;

export function resolveProposal(options: ResolveOptions): ResolutionOutcome {
  const { proposal, model } = options;
  const tolerante = options.tolerante === true;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const issuedAt = (options.now ?? (() => new Date()))().toISOString();
  const skipped: SkippedOperation[] = [];
  const conOmitidos = <T extends ResolutionOutcome>(outcome: T): T =>
    tolerante ? { ...outcome, skipped } : outcome;

  if (proposal.needsClarification !== undefined) {
    // Con operaciones delante, la duda del modelo es una nota sobre lo que
    // transcribio, no un motivo para tirar la transcripcion. Se entrega como
    // aviso junto al candidato; sin operaciones, sigue siendo una pregunta.
    if (!tolerante || proposal.operations.length === 0) {
      return conOmitidos({ kind: 'QUESTION', question: proposal.needsClarification });
    }
    skipped.push({ element: 'la lectura', reason: proposal.needsClarification });
  }

  if (proposal.operations.length === 0) {
    return conOmitidos({
      kind: 'QUESTION',
      question: 'No entendi que cambio hacer en la pizarra. ¿Puedes decirlo de otra forma?',
    });
  }

  const commands: Command[] = [];
  const summary: string[] = [];
  let preview: BoardState = {
    schemaVersion: '1.0.0',
    semantic: model,
    layout: { positions: {}, sizes: {} },
  };
  let destruccion = 0;

  for (const operation of proposal.operations) {
    const resultado = resolveOperation({
      operation,
      model: preview.semantic,
      newId,
      issuedAt,
      actorId: options.actorId,
      origin: options.origin,
      tolerante,
    });

    if (resultado.kind === 'QUESTION') {
      if (!tolerante) return resultado;
      skipped.push({ element: describirOperacion(operation), reason: resultado.question });
      continue;
    }

    const planned = planBatch(preview, {
      batchId: 'preview',
      origin: options.origin,
      actorId: options.actorId,
      issuedAt,
      commands: resultado.commands,
    });
    if (!planned.applied) {
      if (!tolerante) return { kind: 'REJECTED', issues: planned.issues };
      skipped.push({
        element: describirOperacion(operation),
        reason: planned.issues.map((issue) => issue.message).join(' '),
      });
      continue;
    }
    preview = planned.state;

    commands.push(...resultado.commands);
    summary.push(resultado.summary);
    destruccion += resultado.destroys;
  }

  if (commands.length === 0) {
    // Todo se omitio: no hay candidato que ensenar. Se dice por que en vez de
    // devolver un lote vacio con aspecto de exito.
    return conOmitidos({
      kind: 'QUESTION',
      question:
        'Ninguna de las operaciones leidas se pudo preparar. ' +
        skipped
          .slice(0, 3)
          .map((omitida) => `${omitida.element}: ${omitida.reason}`)
          .join(' '),
    });
  }

  const batch: CommandBatch = {
    batchId: newId(),
    origin: options.origin,
    actorId: options.actorId,
    issuedAt,
    commands,
  };

  // Se comprueba antes de devolverlo: el asistente aplica los mismos comandos con
  // las mismas reglas que la interfaz (RF-033).
  const outcome = applyBatch(
    { schemaVersion: '1.0.0', semantic: model, layout: { positions: {}, sizes: {} } },
    batch,
  );
  if (!outcome.applied) {
    return conOmitidos({ kind: 'REJECTED', issues: outcome.issues });
  }

  if (destruccion > DESTRUCTIVE_THRESHOLD) {
    return conOmitidos({
      kind: 'CONFIRMATION',
      question: `Esto elimina ${destruccion} elementos. ¿Confirmas?`,
      batch,
      summary,
    });
  }

  return conOmitidos({ kind: 'BATCH', batch, summary });
}

/** Como se nombra una operacion omitida en el aviso que la sustituye. */
function describirOperacion(operation: AssistantOperation): string {
  switch (operation.op) {
    case 'CREATE_CLASS':
    case 'RENAME_CLASS':
    case 'DELETE_CLASS':
      return `Clase «${operation.className}»`;
    case 'ADD_ATTRIBUTE':
    case 'UPDATE_ATTRIBUTE':
    case 'DELETE_ATTRIBUTE':
      return `Atributo «${operation.attributeName}» de «${operation.className}»`;
    case 'CREATE_RELATIONSHIP':
    case 'CHANGE_MULTIPLICITY':
    case 'DELETE_RELATIONSHIP':
      return `Relacion «${operation.fromClass}» — «${operation.toClass}»`;
  }
}

// ---------------------------------------------------------------------------
// Una operacion a la vez
// ---------------------------------------------------------------------------

interface OperationContext {
  readonly operation: AssistantOperation;
  readonly model: SemanticModel;
  readonly newId: () => string;
  readonly issuedAt: string;
  readonly actorId: string;
  readonly origin: BatchOrigin;
  readonly tolerante: boolean;
}

type OperationOutcome =
  | { kind: 'COMMANDS'; commands: Command[]; summary: string; destroys: number }
  | { kind: 'QUESTION'; question: string; options?: readonly string[] };

function resolveOperation(context: OperationContext): OperationOutcome {
  const { operation, model } = context;

  switch (operation.op) {
    case 'CREATE_CLASS': {
      const existente = findClasses(model, operation.className, context.origin);
      if (existente.length > 0) {
        return {
          kind: 'QUESTION',
          question: context.tolerante
            ? `Ya existe «${existente[0]?.displayName}» en la pizarra; se conserva la que hay y sus atributos nuevos se anaden a ella.`
            : `Ya existe una clase que se llama «${existente[0]?.displayName}». ¿Querias otra cosa?`,
        };
      }

      const classId = context.newId();

      return {
        kind: 'COMMANDS',
        commands: [command(context, 'CREATE_CLASS', { classId, displayName: operation.className })],
        summary: `Crear la clase «${operation.className}»`,
        destroys: 0,
      };
    }

    case 'RENAME_CLASS': {
      const objetivo = resolveClass(context, operation.className);
      if (objetivo.kind === 'QUESTION') return objetivo;

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'RENAME_CLASS', {
            classId: objetivo.classId,
            displayName: operation.newName,
          }),
        ],
        summary: `Renombrar «${operation.className}» a «${operation.newName}»`,
        destroys: 0,
      };
    }

    case 'DELETE_CLASS': {
      const objetivo = resolveClass(context, operation.className);
      if (objetivo.kind === 'QUESTION') return objetivo;

      // Borrar una clase se lleva sus atributos y sus relaciones. Cuenta todo lo
      // que desaparece, no la clase sola.
      const umlClass = model.classes.find((item) => item.id === objetivo.classId);
      const relacionadas = model.relationships.filter(
        (rel) => rel.sourceClassId === objetivo.classId || rel.targetClassId === objetivo.classId,
      );
      const arrastre = 1 + (umlClass?.attributes.length ?? 0) + relacionadas.length;

      return {
        kind: 'COMMANDS',
        commands: [command(context, 'DELETE_CLASS', { classId: objetivo.classId })],
        summary:
          `Eliminar «${operation.className}»` +
          (arrastre > 1 ? ` y ${arrastre - 1} elemento(s) que dependen de ella` : ''),
        destroys: arrastre,
      };
    }

    case 'ADD_ATTRIBUTE': {
      const objetivo = resolveClass(context, operation.className);
      if (objetivo.kind === 'QUESTION') return objetivo;

      const yaEsta = findAttribute(
        model,
        objetivo.classId,
        operation.attributeName,
        context.origin,
      );
      if (yaEsta !== undefined) {
        return {
          kind: 'QUESTION',
          question: context.tolerante
            ? `«${operation.className}» ya tiene «${yaEsta.displayName}»; no se duplica.`
            : `«${operation.className}» ya tiene un atributo «${yaEsta.displayName}». ¿Lo cambio en lugar de anadirlo?`,
        };
      }

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'ADD_ATTRIBUTE', {
            classId: objetivo.classId,
            attributeId: context.newId(),
            displayName: operation.attributeName,
            type: operation.type,
            ...(operation.primaryKey === undefined ? {} : { primaryKey: operation.primaryKey }),
            ...(operation.required === undefined ? {} : { nullable: !operation.required }),
            ...(operation.unique === undefined ? {} : { unique: operation.unique }),
          }),
        ],
        summary: `Anadir «${operation.attributeName}» (${operation.type}) a «${operation.className}»`,
        destroys: 0,
      };
    }

    case 'UPDATE_ATTRIBUTE': {
      const objetivo = resolveClass(context, operation.className);
      if (objetivo.kind === 'QUESTION') return objetivo;

      const atributo = findAttribute(model, objetivo.classId, operation.attributeName);
      if (atributo === undefined) {
        return {
          kind: 'QUESTION',
          question: `«${operation.className}» no tiene ningun atributo «${operation.attributeName}». ¿Cual querias cambiar?`,
          options: atributosDe(model, objetivo.classId),
        };
      }

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'UPDATE_ATTRIBUTE', {
            classId: objetivo.classId,
            attributeId: atributo.id,
            ...(operation.newName === undefined ? {} : { displayName: operation.newName }),
            ...(operation.type === undefined ? {} : { type: operation.type }),
            ...(operation.primaryKey === undefined ? {} : { primaryKey: operation.primaryKey }),
            ...(operation.required === undefined ? {} : { nullable: !operation.required }),
            ...(operation.unique === undefined ? {} : { unique: operation.unique }),
          }),
        ],
        summary: `Modificar «${atributo.displayName}» de «${operation.className}»`,
        destroys: 0,
      };
    }

    case 'DELETE_ATTRIBUTE': {
      const objetivo = resolveClass(context, operation.className);
      if (objetivo.kind === 'QUESTION') return objetivo;

      const atributo = findAttribute(model, objetivo.classId, operation.attributeName);
      if (atributo === undefined) {
        return {
          kind: 'QUESTION',
          question: `«${operation.className}» no tiene ningun atributo «${operation.attributeName}».`,
          options: atributosDe(model, objetivo.classId),
        };
      }

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'DELETE_ATTRIBUTE', {
            classId: objetivo.classId,
            attributeId: atributo.id,
          }),
        ],
        summary: `Eliminar «${atributo.displayName}» de «${operation.className}»`,
        destroys: 1,
      };
    }

    case 'CREATE_RELATIONSHIP': {
      const origen = resolveClass(context, operation.fromClass);
      if (origen.kind === 'QUESTION') return origen;
      const destino = resolveClass(context, operation.toClass);
      if (destino.kind === 'QUESTION') return destino;

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'CREATE_RELATIONSHIP', {
            relationshipId: context.newId(),
            ...(operation.kind === undefined ? {} : { kind: operation.kind }),
            sourceClassId: origen.classId,
            targetClassId: destino.classId,
            sourceMultiplicity: operation.fromMultiplicity,
            targetMultiplicity: operation.toMultiplicity,
            ...(operation.fromRole === undefined ? {} : { sourceRoleName: operation.fromRole }),
            ...(operation.toRole === undefined ? {} : { targetRoleName: operation.toRole }),
          }),
        ],
        // Una generalizacion se resume con palabras: sus multiplicidades no
        // significan nada, y «1 — 1» leido en la confirmacion parece otra cosa.
        summary:
          operation.kind === 'GENERALIZATION'
            ? `«${operation.fromClass}» hereda de «${operation.toClass}»`
            : `Relacionar «${operation.fromClass}» ${operation.fromMultiplicity} — ` +
              `${operation.toMultiplicity} «${operation.toClass}»`,
        destroys: 0,
      };
    }

    case 'CHANGE_MULTIPLICITY': {
      const relacion = resolveRelationship(
        context,
        operation.fromClass,
        operation.toClass,
        operation.fromRole,
        operation.toRole,
      );
      if (relacion.kind === 'QUESTION') return relacion;

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'CHANGE_MULTIPLICITY', {
            relationshipId: relacion.relationship.id,
            ...(operation.fromMultiplicity === undefined
              ? {}
              : {
                  [relacion.reversed ? 'targetMultiplicity' : 'sourceMultiplicity']:
                    operation.fromMultiplicity,
                }),
            ...(operation.toMultiplicity === undefined
              ? {}
              : {
                  [relacion.reversed ? 'sourceMultiplicity' : 'targetMultiplicity']:
                    operation.toMultiplicity,
                }),
          }),
        ],
        summary: `Cambiar la multiplicidad entre «${operation.fromClass}» y «${operation.toClass}»`,
        destroys: 0,
      };
    }

    case 'DELETE_RELATIONSHIP': {
      const relacion = resolveRelationship(
        context,
        operation.fromClass,
        operation.toClass,
        operation.fromRole,
        operation.toRole,
      );
      if (relacion.kind === 'QUESTION') return relacion;

      return {
        kind: 'COMMANDS',
        commands: [
          command(context, 'DELETE_RELATIONSHIP', { relationshipId: relacion.relationship.id }),
        ],
        summary: `Eliminar la relacion entre «${operation.fromClass}» y «${operation.toClass}»`,
        destroys: 1,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Busqueda por nombre
// ---------------------------------------------------------------------------
/**
 * Compara por nombre tecnico y no por la cadena literal
 * "detalle de venta", "Detalle de Venta" y "DetalleVenta" son el mismo elemento
 * para quien habla. Comparar literalmente obligaria al usuario a dictar el
 * nombre exacto, que es justo lo que un asistente por voz no puede pedir.
 */
function claveNombre(nombre: string): string {
  try {
    return normalizeName(nombre, 'CLASS').codeName.toLowerCase();
  } catch {
    return toWords(nombre).join('').toLowerCase();
  }
}

function findClasses(
  model: SemanticModel,
  nombre: string,
  origin?: BatchOrigin,
): readonly UmlClass[] {
  // El parser XMI ya distingue las clases por identidad y conserva sus nombres.
  // Normalizar aquí fusionaría objetivos distintos antes de poder corregirlos
  // en el candidato (por ejemplo Detalle de Venta y detalle venta).
  if (origin === 'XMI') {
    return model.classes.filter((umlClass) => umlClass.displayName === nombre);
  }
  const clave = claveNombre(nombre);
  return model.classes.filter((umlClass) => claveNombre(umlClass.displayName) === clave);
}

type ClassResolution =
  | { kind: 'CLASS'; classId: string }
  | { kind: 'QUESTION'; question: string; options?: readonly string[] };

function resolveClass(context: OperationContext, nombre: string): ClassResolution {
  const candidatas = findClasses(context.model, nombre, context.origin);

  if (candidatas.length === 1) {
    return { kind: 'CLASS', classId: (candidatas[0] as UmlClass).id };
  }

  if (candidatas.length === 0) {
    return {
      kind: 'QUESTION',
      question: `No encuentro ninguna clase «${nombre}» en esta pizarra.`,
      options: context.model.classes.map((umlClass) => umlClass.displayName),
    };
  }

  // Mas de una clase con el mismo nombre tecnico: la pizarra ya es invalida, y
  // adivinar cual seria peor que preguntar.
  return {
    kind: 'QUESTION',
    question: `Hay ${candidatas.length} clases que se llaman «${nombre}». ¿Cual?`,
    options: candidatas.map((umlClass) => umlClass.displayName),
  };
}

function findAttribute(
  model: SemanticModel,
  classId: string,
  nombre: string,
  origin?: BatchOrigin,
): UmlAttribute | undefined {
  const clave = claveNombre(nombre);
  return model.classes
    .find((umlClass) => umlClass.id === classId)
    ?.attributes.find((atributo) =>
      origin === 'XMI'
        ? atributo.displayName === nombre
        : claveNombre(atributo.displayName) === clave,
    );
}

function atributosDe(model: SemanticModel, classId: string): readonly string[] {
  return (
    model.classes
      .find((umlClass) => umlClass.id === classId)
      ?.attributes.map((atributo) => atributo.displayName) ?? []
  );
}

type RelationshipResolution =
  | { kind: 'RELATIONSHIP'; relationship: UmlRelationship; reversed: boolean }
  | { kind: 'QUESTION'; question: string; options?: readonly string[] };

function resolveRelationship(
  context: OperationContext,
  desde: string,
  hasta: string,
  fromRole?: string,
  toRole?: string,
): RelationshipResolution {
  const origen = resolveClass(context, desde);
  if (origen.kind === 'QUESTION') return origen;
  const destino = resolveClass(context, hasta);
  if (destino.kind === 'QUESTION') return destino;

  const candidatas = context.model.relationships.flatMap((rel) => {
    const forward = rel.sourceClassId === origen.classId && rel.targetClassId === destino.classId;
    const backward = rel.sourceClassId === destino.classId && rel.targetClassId === origen.classId;
    if (!forward && !backward) return [];
    const reversed = !forward;
    const sourceRole = reversed ? rel.targetRoleName : rel.sourceRoleName;
    const targetRole = reversed ? rel.sourceRoleName : rel.targetRoleName;
    if (fromRole !== undefined && claveNombre(fromRole) !== claveNombre(sourceRole ?? ''))
      return [];
    if (toRole !== undefined && claveNombre(toRole) !== claveNombre(targetRole ?? '')) return [];
    return [{ relationship: rel, reversed }];
  });

  if (candidatas.length === 1) {
    return { kind: 'RELATIONSHIP', ...candidatas[0]! };
  }

  if (candidatas.length === 0) {
    return {
      kind: 'QUESTION',
      question: `No hay ninguna relacion entre «${desde}» y «${hasta}».`,
    };
  }

  // Dos relaciones entre el mismo par: la desambigua el rol, que es justamente
  // para lo que existe (RTM-05).
  return {
    kind: 'QUESTION',
    question: `Hay ${candidatas.length} relaciones entre «${desde}» y «${hasta}». ¿Cual, por su rol?`,
    options: candidatas.map(
      ({ relationship: rel, reversed }) =>
        `${desde}: ${(reversed ? rel.targetRoleName : rel.sourceRoleName) ?? 'sin rol'}; ${hasta}: ${(reversed ? rel.sourceRoleName : rel.targetRoleName) ?? 'sin rol'}`,
    ),
  };
}

function command<T extends Command['type']>(
  context: OperationContext,
  type: T,
  payload: Extract<Command, { type: T }>['payload'],
): Command {
  return {
    commandId: context.newId(),
    type,
    payload,
    origin: context.origin,
    actorId: context.actorId,
    issuedAt: context.issuedAt,
  } as Command;
}
