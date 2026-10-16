import type { SemanticModel } from '@uml/contracts';
import type { XmiImport } from './parse.js';

/**
 * De lo importado a una propuesta editable.
 *
 * Las operaciones se expresan **por nombre**, igual que las que produce el
 * asistente: asi la importacion recorre exactamente el mismo camino —vista
 * previa, correccion, resolucion, validacion, lote— y no hay una segunda via
 * con sus propias reglas (RA-01).
 *
 * El tipo se declara aqui en lugar de importarlo de `@uml/ai` porque este
 * paquete no debe depender de la capa de IA: XMI no tiene nada que ver con un
 * proveedor de modelos.
 */

export interface ImportOperation {
  readonly op: string;
  readonly [clave: string]: unknown;
}

export interface ImportProposal {
  readonly operations: readonly ImportOperation[];
  readonly rationale?: string;
  /** Elementos conservados porque ya existian en modo ADD. */
  readonly skipped?: readonly { element: string; reason: string }[];
}

export type ImportMode =
  /** Anade lo importado a lo que ya hay (RF-044). */
  | 'ADD'
  /** Sustituye el contenido: primero borra lo que hay. */
  | 'REPLACE';

export interface ToProposalOptions {
  readonly mode: ImportMode;
  /** Lo que hay ahora en la pizarra. Necesario para el modo de reemplazo. */
  readonly current: SemanticModel;
}

export function xmiToProposal(imported: XmiImport, options: ToProposalOptions): ImportProposal {
  const operations: ImportOperation[] = [];
  const skipped: { element: string; reason: string }[] = [];

  if (options.mode === 'REPLACE') {
    // Borrar primero y en el mismo lote: si algo del contenido nuevo fuera
    // invalido, no se aplica nada y la pizarra queda como estaba (RA-03).
    for (const umlClass of options.current.classes) {
      operations.push({ op: 'DELETE_CLASS', className: umlClass.displayName });
    }
  }

  // Los nombres que ya existen no se vuelven a crear en modo de anadir: crear
  // una clase que ya esta produciria una colision, y el usuario esperaba
  // fusionar, no duplicar.
  const existentes = new Map(
    options.mode === 'ADD'
      ? options.current.classes.map((umlClass) => [clave(umlClass.displayName), umlClass] as const)
      : [],
  );

  for (const umlClass of imported.classes) {
    const existente = existentes.get(clave(umlClass.name));
    if (existente === undefined) {
      operations.push({ op: 'CREATE_CLASS', className: umlClass.name });
    }

    for (const atributo of umlClass.attributes) {
      const atributoExistente = existente?.attributes.find(
        (item) => clave(item.displayName) === clave(atributo.name),
      );
      if (atributoExistente !== undefined) {
        skipped.push({
          element: `${umlClass.name}.${atributo.name}`,
          reason:
            atributoExistente.type === atributo.type &&
            atributoExistente.primaryKey === atributo.primaryKey &&
            atributoExistente.nullable === atributo.nullable &&
            atributoExistente.unique === atributo.unique
              ? 'Ya existe con la misma definicion; se conserva sin duplicarlo.'
              : 'Ya existe con otra definicion; se conserva la version de la pizarra. Usa “Reemplazar” si el archivo debe mandar.',
        });
        continue;
      }

      operations.push({
        op: 'ADD_ATTRIBUTE',
        className: existente?.displayName ?? umlClass.name,
        attributeName: atributo.name,
        type: atributo.type,
        ...(atributo.primaryKey ? { primaryKey: true } : {}),
        ...(atributo.nullable ? {} : { required: true }),
        ...(atributo.unique ? { unique: true } : {}),
      });
    }
  }

  for (const relacion of imported.relationships) {
    const origen = options.current.classes.find(
      (umlClass) => clave(umlClass.displayName) === clave(relacion.sourceName),
    );
    const destino = options.current.classes.find(
      (umlClass) => clave(umlClass.displayName) === clave(relacion.targetName),
    );
    const yaExiste =
      options.mode === 'ADD' &&
      origen !== undefined &&
      destino !== undefined &&
      options.current.relationships.some((actual) => {
        const kind = relacion.kind ?? 'ASSOCIATION';
        if ((actual.kind ?? 'ASSOCIATION') !== kind) return false;
        const forward = actual.sourceClassId === origen.id && actual.targetClassId === destino.id;
        const backward =
          kind === 'ASSOCIATION' &&
          actual.sourceClassId === destino.id &&
          actual.targetClassId === origen.id;
        const sameEnds = (reversed: boolean): boolean =>
          mismoRol(
            reversed ? actual.targetRoleName : actual.sourceRoleName,
            relacion.sourceRole,
            origen.displayName,
          ) &&
          mismoRol(
            reversed ? actual.sourceRoleName : actual.targetRoleName,
            relacion.targetRole,
            destino.displayName,
          ) &&
          (reversed ? actual.targetMultiplicity : actual.sourceMultiplicity) ===
            relacion.sourceMultiplicity &&
          (reversed ? actual.sourceMultiplicity : actual.targetMultiplicity) ===
            relacion.targetMultiplicity;
        return (forward && sameEnds(false)) || (backward && sameEnds(true));
      });

    if (yaExiste) {
      skipped.push({
        element: `${relacion.sourceName} — ${relacion.targetName}`,
        reason: 'La relacion ya existe; se conserva sin duplicarla.',
      });
      continue;
    }

    operations.push({
      op: 'CREATE_RELATIONSHIP',
      ...(relacion.kind === undefined ? {} : { kind: relacion.kind }),
      fromClass:
        options.mode === 'ADD' ? (origen?.displayName ?? relacion.sourceName) : relacion.sourceName,
      toClass:
        options.mode === 'ADD'
          ? (destino?.displayName ?? relacion.targetName)
          : relacion.targetName,
      fromMultiplicity: relacion.sourceMultiplicity,
      toMultiplicity: relacion.targetMultiplicity,
      ...(relacion.sourceRole === null ? {} : { fromRole: relacion.sourceRole }),
      ...(relacion.targetRole === null ? {} : { toRole: relacion.targetRole }),
    });
  }

  const resumen =
    `${imported.classes.length} clase(s) y ${imported.relationships.length} relacion(es)` +
    (options.mode === 'REPLACE' ? ', sustituyendo el contenido actual' : '');

  return { operations, rationale: resumen, ...(skipped.length === 0 ? {} : { skipped }) };
}

function clave(nombre: string): string {
  return nombre.trim().toLocaleLowerCase('es');
}

function mismoRol(actual: string | undefined, importado: string | null, clase: string): boolean {
  // El exportador XMI escribe este nombre cuando el extremo no tiene rol.
  // Reconocerlo evita duplicar relaciones al reimportar nuestra propia salida.
  const predeterminado = clase.charAt(0).toLowerCase() + clase.slice(1);
  return (actual ?? predeterminado) === (importado ?? predeterminado);
}
