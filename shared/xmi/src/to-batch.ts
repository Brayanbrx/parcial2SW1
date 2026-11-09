import {
  commandBatchSchema,
  idSchema,
  type Command,
  type CommandBatch,
  type SemanticModel,
  type UmlRelationship,
} from '@uml/contracts';
import type { XmiImport, XmiWarning } from './parse.js';
import type { ImportMode } from './to-proposal.js';

/** XMI ya trae identidades: se materializan comandos del mismo dominio sin
 * pasar por la búsqueda aproximada por nombres del asistente. */
export function xmiToBatch(
  imported: XmiImport,
  options: { current: SemanticModel; mode: ImportMode; actorId: string },
) {
  const commands: Command[] = [];
  const summary: string[] = [];
  const skipped: XmiWarning[] = [];
  const issuedAt = new Date().toISOString();
  const occupied = new Set<string>(
    options.mode === 'ADD'
      ? [
          ...options.current.classes.flatMap((c) => [c.id, ...c.attributes.map((a) => a.id)]),
          ...options.current.relationships.map((r) => r.id),
        ]
      : [],
  );
  const allocate = (source: string | null, name: string): string => {
    const valid = idSchema.safeParse(source);
    const preferred = valid.success ? valid.data : null;
    const id = preferred !== null && !occupied.has(preferred) ? preferred : crypto.randomUUID();
    if (preferred !== null && occupied.has(preferred))
      skipped.push({
        element: name,
        reason:
          'El identificador del archivo ya corresponde a otro elemento; se asignó uno nuevo para conservar ambos.',
      });
    occupied.add(id);
    return id;
  };
  const add = (body: Pick<Command, 'type' | 'payload'>, text: string): void => {
    commands.push({
      ...body,
      commandId: crypto.randomUUID(),
      origin: 'XMI',
      actorId: options.actorId,
      issuedAt,
    } as Command);
    summary.push(text);
  };
  if (options.mode === 'REPLACE' && imported.classes.length > 0)
    for (const c of options.current.classes)
      add(
        { type: 'DELETE_CLASS', payload: { classId: c.id } },
        `Eliminar clase «${c.displayName}»`,
      );
  const currentClasses = options.mode === 'ADD' ? options.current.classes : [];
  const namesInBoard = uniqueByName(currentClasses, (item) => item.displayName);
  const namesInFile = uniqueByName(imported.classes, (item) => item.name);
  const classesById = new Map<string, string | null>();
  const classesByName = new Map<string, string | null>();
  for (const c of imported.classes) {
    const name = key(c.name);
    const uniqueName = namesInFile.get(name) === c;
    const existing =
      currentClasses.find((item) => item.id === c.xmiId) ??
      (uniqueName ? namesInBoard.get(name) : undefined);
    const classId = existing?.id ?? allocate(c.xmiId, c.name);
    if (c.xmiId !== null) classesById.set(c.xmiId, classesById.has(c.xmiId) ? null : classId);
    classesByName.set(c.name, classesByName.has(c.name) ? null : classId);
    if (!existing) {
      add(
        {
          type: 'CREATE_CLASS',
          payload: {
            classId,
            displayName: c.name,
            ...(c.position === undefined ? {} : { position: c.position }),
          },
        },
        `Crear clase «${c.name}»`,
      );
      if (c.position !== undefined && c.size !== undefined)
        add(
          { type: 'MOVE_CLASS', payload: { classId, position: c.position, size: c.size } },
          `Restaurar tamaño de «${c.name}»`,
        );
    } else if (existing.displayName !== c.name)
      skipped.push({
        element: c.name,
        reason: `Se conserva la clase existente «${existing.displayName}» con la misma identidad.`,
      });
    for (const a of c.attributes) {
      const present = existing?.attributes.find(
        (item) => item.id === a.xmiId || key(item.displayName) === key(a.name),
      );
      if (present !== undefined) {
        skipped.push({
          element: `${c.name}.${a.name}`,
          reason:
            present.type === a.type &&
            present.primaryKey === a.primaryKey &&
            present.nullable === a.nullable &&
            present.unique === a.unique &&
            present.displayName === a.name
              ? 'Ya existe con la misma definición; se conserva.'
              : 'Ya existe con otra definición; se conserva la versión de la pizarra. Usa Reemplazar para adoptar el archivo.',
        });
        continue;
      }
      add(
        {
          type: 'ADD_ATTRIBUTE',
          payload: {
            classId,
            attributeId: allocate(a.xmiId, `${c.name}.${a.name}`),
            displayName: a.name,
            type: a.type,
            primaryKey: a.primaryKey,
            nullable: a.nullable,
            unique: a.unique,
          },
        },
        `Añadir «${a.name}» a «${c.name}»`,
      );
    }
  }
  for (const r of imported.relationships) {
    const sourceClassId =
      r.sourceXmiId === undefined
        ? classesByName.get(r.sourceName)
        : classesById.get(r.sourceXmiId);
    const targetClassId =
      r.targetXmiId === undefined
        ? classesByName.get(r.targetName)
        : classesById.get(r.targetXmiId);
    if (!sourceClassId || !targetClassId) {
      skipped.push({
        element: `${r.sourceName} → ${r.targetName}`,
        reason: 'Se omitió la relación porque no se pudieron identificar ambos extremos.',
      });
      continue;
    }
    const value = {
      sourceClassId,
      targetClassId,
      ...(r.kind === undefined ? {} : { kind: r.kind }),
      sourceMultiplicity: r.sourceMultiplicity,
      targetMultiplicity: r.targetMultiplicity,
      ...(r.sourceRole === null ? {} : { sourceRoleName: r.sourceRole }),
      ...(r.targetRole === null ? {} : { targetRoleName: r.targetRole }),
    };
    const existing =
      options.mode === 'ADD'
        ? options.current.relationships.find(
            (actual) => actual.id === r.xmiId || equivalent(actual, value),
          )
        : undefined;
    if (existing !== undefined) {
      skipped.push({
        element: `${r.sourceName} → ${r.targetName}`,
        reason: equivalent(existing, value)
          ? 'La relación ya existe; se conserva sin duplicarla.'
          : 'La relación tiene la misma identidad y otra definición; se conserva la versión de la pizarra. Usa Reemplazar para adoptar el archivo.',
      });
      continue;
    }
    add(
      {
        type: 'CREATE_RELATIONSHIP',
        payload: {
          relationshipId: allocate(r.xmiId, `${r.sourceName} → ${r.targetName}`),
          ...value,
        },
      },
      `Relacionar «${r.sourceName}» y «${r.targetName}»`,
    );
  }
  const batch: CommandBatch = {
    batchId: crypto.randomUUID(),
    origin: 'XMI',
    actorId: options.actorId,
    issuedAt,
    commands,
  };
  if (commands.length > 0) commandBatchSchema.parse(batch);
  return {
    batch,
    summary,
    skipped,
    rationale: `${imported.classes.length} clase(s) y ${imported.relationships.length} relación(es)`,
  };
}

function key(name: string): string {
  return name.trim().toLocaleLowerCase('es');
}

function uniqueByName<T>(items: readonly T[], nameOf: (item: T) => string): Map<string, T | null> {
  const result = new Map<string, T | null>();
  for (const item of items) {
    const name = key(nameOf(item));
    result.set(name, result.has(name) ? null : item);
  }
  return result;
}
function equivalent(a: UmlRelationship, b: Omit<UmlRelationship, 'id'>): boolean {
  const kind = a.kind ?? 'ASSOCIATION';
  if (kind !== (b.kind ?? 'ASSOCIATION')) return false;
  const ends = (reverse: boolean): boolean =>
    (reverse ? a.targetClassId : a.sourceClassId) === b.sourceClassId &&
    (reverse ? a.sourceClassId : a.targetClassId) === b.targetClassId &&
    (reverse ? a.targetRoleName : a.sourceRoleName) === b.sourceRoleName &&
    (reverse ? a.sourceRoleName : a.targetRoleName) === b.targetRoleName &&
    (reverse ? a.targetMultiplicity : a.sourceMultiplicity) === b.sourceMultiplicity &&
    (reverse ? a.sourceMultiplicity : a.targetMultiplicity) === b.targetMultiplicity;
  return ends(false) || (kind === 'ASSOCIATION' && ends(true));
}
