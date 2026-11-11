import {
  UML_PRIMITIVE_TYPES,
  multiplicityBounds,
  type SemanticModel,
  type ValidationCode,
  type ValidationIssue,
} from '@uml/contracts';

/** Checks the supported UML class model without imposing database/Java restrictions. */
export function validateUmlModel(model: SemanticModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (message: string, ids: string[], code: ValidationCode = 'INVALID_UML_MODEL') => {
    issues.push({ code, severity: 'ERROR', scope: 'UML', message, elementIds: ids });
  };
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const types = new Set<string>([
    ...UML_PRIMITIVE_TYPES,
    ...model.classes.flatMap((c) => [c.displayName, c.codeName]),
  ]);
  const checkType = (type: string, ids: string[]) => {
    if (!types.has(type))
      add(
        `El tipo «${type}» no está definido. Crea una clase, enumeración o tipo de datos con ese nombre.`,
        ids,
      );
  };
  const ids = new Set<string>();
  const classifierNames = new Set<string>();
  const checkId = (id: string) => {
    if (ids.has(id)) add('Hay identificadores UML duplicados.', [id], 'DUPLICATE_ID');
    ids.add(id);
  };
  for (const c of model.classes) {
    checkId(c.id);
    if (classifierNames.has(c.displayName))
      add('Hay clasificadores con el mismo nombre en el mismo espacio de nombres.', [c.id]);
    classifierNames.add(c.displayName);
    if (!c.displayName.trim())
      add('El clasificador necesita un nombre.', [c.id], 'CLASS_WITHOUT_NAME');
    if (c.kind === 'ENUMERATION' && new Set(c.literals).size !== (c.literals?.length ?? 0))
      add('Los literales de una enumeración deben ser distintos.', [c.id]);
    if (c.kind !== 'ENUMERATION' && (c.literals?.length ?? 0) > 0)
      add('Los literales solo pertenecen a enumeraciones.', [c.id]);
    const memberNames = new Set<string>();
    for (const a of c.attributes) {
      checkId(a.id);
      if (memberNames.has(a.displayName))
        add('Un clasificador repite el nombre de un atributo.', [c.id, a.id]);
      memberNames.add(a.displayName);
      if (c.kind === 'INTERFACE' && (a.visibility ?? 'private') !== 'public')
        add('Los miembros de una interfaz deben ser públicos.', [c.id, a.id]);
      checkType(a.type, [c.id, a.id]);
      if (a.multiplicity !== undefined && multiplicityBounds(a.multiplicity) === null)
        add('La multiplicidad del atributo no es válida.', [c.id, a.id]);
    }
    const signatures = new Set<string>();
    for (const o of c.operations ?? []) {
      checkId(o.id);
      if (c.kind === 'INTERFACE' && o.visibility !== 'public')
        add('Las operaciones de una interfaz deben ser públicas.', [c.id, o.id]);
      if (o.returnMultiplicity !== undefined && multiplicityBounds(o.returnMultiplicity) === null)
        add('La multiplicidad del retorno no es válida.', [c.id, o.id]);
      if (o.isStatic && o.isAbstract)
        add('Una operación abstracta no puede ser estática.', [c.id, o.id]);
      if (o.isAbstract && !c.isAbstract && c.kind !== 'INTERFACE')
        add('Una clase con operaciones abstractas debe ser abstracta.', [c.id, o.id]);
      if (o.returnType !== undefined && o.returnType !== 'void')
        checkType(o.returnType, [c.id, o.id]);
      const parameterNames = new Set<string>();
      for (const p of o.parameters) {
        checkId(p.id);
        checkType(p.type, [c.id, o.id]);
        if (p.multiplicity !== undefined && multiplicityBounds(p.multiplicity) === null)
          add('La multiplicidad del parámetro no es válida.', [c.id, o.id]);
        if (parameterNames.has(p.name))
          add('Una operación repite el nombre de un parámetro.', [c.id, o.id]);
        parameterNames.add(p.name);
      }
      const signature = JSON.stringify([
        o.displayName,
        o.parameters.map((p) => [p.direction, p.type, p.multiplicity ?? '1']),
      ]);
      if (signatures.has(signature)) add('Hay operaciones con la misma firma.', [c.id, o.id]);
      signatures.add(signature);
    }
  }
  const parents = new Map<string, string[]>();
  for (const r of model.relationships) {
    checkId(r.id);
    const source = classes.get(r.sourceClassId);
    const target = classes.get(r.targetClassId);
    if (source === undefined || target === undefined) {
      add(
        'Una relación apunta a un clasificador que ya no existe.',
        [r.id, r.sourceClassId, r.targetClassId],
        'RELATIONSHIP_TO_MISSING_CLASS',
      );
      continue;
    }
    if (r.kind === 'GENERALIZATION') {
      if (r.sourceClassId === r.targetClassId)
        add(
          'Un clasificador no puede generalizarse a sí mismo.',
          [r.id, source.id],
          'SELF_GENERALIZATION',
        );
      if ((source.kind ?? 'CLASS') !== (target.kind ?? 'CLASS'))
        add(
          'La generalización conecta clasificadores de la misma clase de elemento; para implementar una interfaz usa Realización.',
          [r.id],
        );
      parents.set(source.id, [...(parents.get(source.id) ?? []), target.id]);
    } else if (r.kind === 'REALIZATION') {
      if (target.kind !== 'INTERFACE' || (source.kind ?? 'CLASS') !== 'CLASS')
        add('La realización de interfaz debe partir de una clase y apuntar a una interfaz.', [
          r.id,
        ]);
    } else if (r.kind !== 'DEPENDENCY') {
      for (const value of [r.sourceMultiplicity, r.targetMultiplicity])
        if (multiplicityBounds(value) === null)
          add(
            'La relación contiene una multiplicidad inválida.',
            [r.id],
            'UNSUPPORTED_MULTIPLICITY',
          );
      if (r.kind === 'COMPOSITION' && (multiplicityBounds(r.sourceMultiplicity)?.upper ?? 0) > 1)
        add('El extremo del todo en una composición tiene multiplicidad máxima 1.', [r.id]);
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (active.has(id)) {
      add('La generalización forma un ciclo.', path.slice(path.indexOf(id)), 'INHERITANCE_CYCLE');
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const parent of parents.get(id) ?? []) visit(parent, [...path, id]);
    active.delete(id);
    visited.add(id);
  };
  for (const id of classes.keys()) visit(id, []);
  return issues;
}
