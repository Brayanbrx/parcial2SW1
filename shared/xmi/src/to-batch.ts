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
  if (options.mode === 'REPLACE')
    for (const c of options.current.classes)
      add(
        { type: 'DELETE_CLASS', payload: { classId: c.id } },
        `Eliminar clase «${c.displayName}»`,
      );
  const classes = new Map<string, string>();
  for (const c of imported.classes) {
    const existing =
      options.mode === 'ADD'
        ? (options.current.classes.find((item) => item.id === c.xmiId) ??
          options.current.classes.find((item) => key(item.displayName) === key(c.name)))
        : undefined;
    const classId = existing?.id ?? allocate(c.xmiId, c.name);
    classes.set(c.name, classId);
    if (existing === undefined) {
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
    const sourceClassId = classes.get(r.sourceName),
      targetClassId = classes.get(r.targetName);
    if (sourceClassId === undefined || targetClassId === undefined) continue;
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
