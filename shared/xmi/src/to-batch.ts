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
          ...options.current.classes.flatMap((c) => [
            c.id,
            ...c.attributes.map((a) => a.id),
            ...(c.operations ?? []).flatMap((o) => [o.id, ...o.parameters.map((p) => p.id)]),
          ]),
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
  const mapped = imported.classes.map((c) => {
    const name = key(c.name);
    const uniqueName = namesInFile.get(name) === c;
    const existing =
      currentClasses.find((item) => item.id === c.xmiId) ??
      (uniqueName ? namesInBoard.get(name) : undefined);
    const classId = existing?.id ?? allocate(c.xmiId, c.name);
    if (c.xmiId !== null) classesById.set(c.xmiId, classesById.has(c.xmiId) ? null : classId);
    classesByName.set(c.name, classesByName.has(c.name) ? null : classId);
    return { c, existing, classId };
  });
  const resolvedNames = new Map(
    mapped.map(({ c, existing, classId }) => [classId, existing?.displayName ?? c.name]),
  );
  const classKinds = new Map(
    mapped.map(({ c, existing, classId }) => [
      classId,
      (existing ? existing.kind : c.kind) ?? 'CLASS',
    ]),
  );
  const linkedAssociationClasses = new Set(
    options.mode === 'ADD'
      ? options.current.relationships.flatMap((r) =>
          r.associationClassId === undefined ? [] : [r.associationClassId],
        )
      : [],
  );
  const resolveType = (type: string, typeId?: string) => {
    const classId = typeId === undefined ? undefined : classesById.get(typeId);
    return (classId ? resolvedNames.get(classId) : undefined) ?? type;
  };
  for (const { c, existing, classId } of mapped) {
    if (!existing) {
      add(
        {
          type: 'CREATE_CLASS',
          payload: {
            classId,
            displayName: c.name,
            ...pick(c, ['kind', 'isAbstract', 'literals']),
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
      const type = resolveType(a.type, a.typeXmiId);
      const present = existing?.attributes.find(
        (item) => item.id === a.xmiId || key(item.displayName) === key(a.name),
      );
      if (present !== undefined) {
        skipped.push({
          element: `${c.name}.${a.name}`,
          reason:
            present.type === type &&
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
            type,
            primaryKey: a.primaryKey,
            nullable: a.nullable,
            unique: a.unique,
            ...pick(a, [
              'visibility',
              'isStatic',
              'multiplicity',
              'defaultValue',
              'isDerived',
              'isReadOnly',
            ]),
          },
        },
        `Añadir «${a.name}» a «${c.name}»`,
      );
    }
    for (const { returnTypeXmiId, ...sourceOperation } of c.operations ?? []) {
      const operation = {
        ...sourceOperation,
        ...(sourceOperation.returnType === undefined
          ? {}
          : { returnType: resolveType(sourceOperation.returnType, returnTypeXmiId) }),
        parameters: sourceOperation.parameters.map(({ typeXmiId, ...parameter }) => ({
          ...parameter,
          type: resolveType(parameter.type, typeXmiId),
        })),
      };
      if (
        existing?.operations?.some(
          (o) =>
            o.id === operation.id ||
            (o.displayName === operation.displayName &&
              JSON.stringify(
                o.parameters.map((p) => [p.type, p.direction, p.multiplicity ?? '1']),
              ) ===
                JSON.stringify(
                  operation.parameters.map((p) => [p.type, p.direction, p.multiplicity ?? '1']),
                )),
        )
      ) {
        skipped.push({
          element: `${c.name}.${operation.displayName}`,
          reason: 'La operación ya existe; se conserva la versión de la pizarra.',
        });
        continue;
      }
      add(
        {
          type: 'ADD_OPERATION',
          payload: {
            classId,
            operation: {
              ...operation,
              id: allocate(operation.id, operation.displayName),
              parameters: operation.parameters.map((p) => ({
                ...p,
                id: allocate(p.id, `${operation.displayName}.${p.name}`),
              })),
            },
          },
        },
        `Añadir operación «${operation.displayName}» a «${c.name}»`,
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
    const associationClassId =
      r.associationClassXmiId === undefined ? undefined : classesById.get(r.associationClassXmiId);
    if (
      r.associationClassXmiId !== undefined &&
      (!associationClassId ||
        classKinds.get(associationClassId) !== 'CLASS' ||
        associationClassId === sourceClassId ||
        associationClassId === targetClassId ||
        (r.kind ?? 'ASSOCIATION') !== 'ASSOCIATION')
    ) {
      skipped.push({
        element: `${r.sourceName} → ${r.targetName}`,
        reason: 'Se omitió la asociación porque su clase no se pudo vincular.',
      });
      continue;
    }
    const value = {
      sourceClassId,
      targetClassId,
      ...(associationClassId ? { associationClassId } : {}),
      ...(r.kind === undefined ? {} : { kind: r.kind }),
      sourceMultiplicity: r.sourceMultiplicity,
      targetMultiplicity: r.targetMultiplicity,
      ...pick(r, ['name', 'sourceNavigability', 'targetNavigability']),
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
    if (associationClassId && linkedAssociationClasses.has(associationClassId)) {
      skipped.push({
        element: `${r.sourceName} → ${r.targetName}`,
        reason: 'Se conserva la asociación que ya está vinculada a la clase.',
      });
      continue;
    }
    if (associationClassId) linkedAssociationClasses.add(associationClassId);
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
  if (a.associationClassId !== b.associationClassId) return false;
  if ((a.name ?? '') !== (b.name ?? '')) return false;
  const ends = (reverse: boolean): boolean =>
    (reverse ? a.targetClassId : a.sourceClassId) === b.sourceClassId &&
    (reverse ? a.sourceClassId : a.targetClassId) === b.targetClassId &&
    (reverse ? a.targetRoleName : a.sourceRoleName) === b.sourceRoleName &&
    ((reverse ? a.targetNavigability : a.sourceNavigability) ?? 'unspecified') ===
      (b.sourceNavigability ?? 'unspecified') &&
    ((reverse ? a.sourceNavigability : a.targetNavigability) ?? 'unspecified') ===
      (b.targetNavigability ?? 'unspecified') &&
    (reverse ? a.sourceRoleName : a.targetRoleName) === b.targetRoleName &&
    (reverse ? a.targetMultiplicity : a.sourceMultiplicity) === b.sourceMultiplicity &&
    (reverse ? a.sourceMultiplicity : a.targetMultiplicity) === b.targetMultiplicity;
  return ends(false) || (kind === 'ASSOCIATION' && ends(true));
}

function pick<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  ) as Partial<Pick<T, K>>;
}
