import {
  SCHEMA_VERSION,
  UML_PRIMITIVE_TYPES,
  emptyBoardState,
  type BoardState,
  type Layout,
  type Position,
  type Size,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
  type UmlOperation,
  type UmlParameter,
} from '@uml/contracts';
import * as Y from 'yjs';

/**
 * Forma del documento colaborativo.
 *
 *   classes        Y.Map<classId, Y.Map>          cada clase, con Y.Array de atributos
 *   relationships  Y.Map<relationshipId, Y.Map>
 *   layout         Y.Map con `positions`: Y.Map<classId, Y.Map{x,y}>
 *   meta           Y.Map con la version del esquema (RA-09)
 *
 * Las colecciones se indexan por identificador y no por posicion. Es lo que hace
 * que dos usuarios creando clases a la vez no se pisen: dos inserciones en la
 * misma posicion de un array habria que desempatarlas, mientras que dos claves
 * distintas de un mapa conviven sin ambiguedad.
 *
 * Los atributos viven en Y.Array. El orden explícito se guarda aparte para que
 * mover una fila no sustituya su nodo ni compita con cambios a sus campos.
 */

export const CLASSES_KEY = 'classes';
export const RELATIONSHIPS_KEY = 'relationships';
export const LAYOUT_KEY = 'layout';
export const META_KEY = 'meta';
export const OPERATIONS_KEY = 'operations';
export const CLASSIFIER_FIELDS = ['kind', 'isAbstract', 'literals'] as const;
export const MEMBER_FIELDS = [
  'visibility',
  'isStatic',
  'multiplicity',
  'defaultValue',
  'isDerived',
  'isReadOnly',
] as const;
export const RELATIONSHIP_FIELDS = [
  'name',
  'sourceNavigability',
  'targetNavigability',
  'associationClassId',
] as const;
export const POSITIONS_KEY = 'positions';
export const ATTRIBUTES_KEY = 'attributes';
const LEGACY_ATTRIBUTE_ORDER_KEY = 'attributeOrder';
const INITIAL_ATTRIBUTE_RANK_KEY = 'initialOrderRank';
const ATTRIBUTE_RANK_KEY = 'orderRank';
const TYPE_BINDINGS_KEY = 'typeBindings';
const TYPE_NAMES_KEY = 'typeDisplayNames';

type YMapAny = Y.Map<unknown>;
type ClassType = { classId: string; displayName: string };
type TypeBinding = ClassType & { name: string };
export type UmlTypeIndex = ReadonlyMap<string, ClassType | null>;

function typeBindings(doc: Y.Doc): Y.Map<TypeBinding> {
  return doc.getMap<TypeBinding>(TYPE_BINDINGS_KEY);
}

export function indexUmlTypes(classes: readonly UmlClass[]): UmlTypeIndex {
  const types = new Map<string, ClassType | null>();
  for (const { id, displayName, codeName } of classes) {
    for (const name of new Set([displayName, codeName])) {
      if (name === 'void' || UML_PRIMITIVE_TYPES.includes(name)) continue;
      types.set(name, types.has(name) ? null : { classId: id, displayName });
    }
  }
  return types;
}

export function bindMemberType(
  doc: Y.Doc,
  id: string,
  name: string | undefined,
  types: UmlTypeIndex,
): void {
  const bindings = typeBindings(doc);
  const target = name === undefined ? null : types.get(name);
  if (target && name !== undefined) {
    const previous = bindings.get(id);
    if (previous?.name !== name || previous.classId !== target.classId)
      bindings.set(id, { ...target, name });
  } else {
    bindings.delete(id);
  }
}

export function forgetMemberType(doc: Y.Doc, id: string): void {
  typeBindings(doc).delete(id);
}

export function rememberTypeName(doc: Y.Doc, id: string, name: unknown): void {
  if (typeof name !== 'string') return;
  const names = doc.getMap<string>(TYPE_NAMES_KEY);
  if (names.get(id) !== name) names.set(id, name);
}

function memberType<T extends string | undefined>(doc: Y.Doc | null, id: string, raw: T): T {
  if (!doc || raw === undefined) return raw;
  const binding = typeBindings(doc).get(id);
  if (binding?.name !== raw) return raw;
  const classifiers = classesMap(doc);
  const live = classifiers.get(binding.classId);
  const displayName =
    live?.get('displayName') ?? doc.getMap<string>(TYPE_NAMES_KEY).get(binding.classId);
  const name =
    typeof displayName === 'string' && displayName !== binding.displayName ? displayName : raw;
  if (
    !live &&
    [...classifiers.values()].some(
      (classifier) => classifier.get('displayName') === name || classifier.get('codeName') === name,
    )
  ) {
    return `${name.slice(0, 160)} · tipo eliminado (${binding.classId.slice(0, 8)})` as T;
  }
  return name as T;
}

function visitMemberTypes(model: SemanticModel, visit: (id: string, type?: string) => void): void {
  for (const classifier of model.classes) {
    for (const attribute of classifier.attributes) visit(attribute.id, attribute.type);
    for (const operation of classifier.operations ?? []) {
      visit(operation.id, operation.returnType);
      for (const parameter of operation.parameters) visit(parameter.id, parameter.type);
    }
  }
}

/** Los documentos anteriores guardaban nombres. Vincularlos antes de renombrar
 * evita reescribir los campos que otro participante puede estar editando. */
export function preserveClassTypeReferences(doc: Y.Doc, classId: string): void {
  const model = readSemanticModel(doc);
  const types = indexUmlTypes(model.classes);
  visitMemberTypes(model, (id, type) => {
    if (type === undefined || types.get(type)?.classId !== classId) return;
    const binding = typeBindings(doc).get(id);
    if (!binding || memberType(doc, id, binding.name) !== type)
      bindMemberType(doc, id, type, types);
  });
}

export function operationsMap(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap<YMapAny>(OPERATIONS_KEY);
}

export function writeOperation(
  doc: Y.Doc,
  classId: string,
  operation: UmlOperation,
  beforeOperationId?: string,
  types?: UmlTypeIndex,
): void {
  const node = new Y.Map<unknown>();
  for (const [field, value] of Object.entries(operation))
    if (value !== undefined && field !== 'parameters') node.set(field, structuredClone(value));
  node.set('parameters', new Y.Map<YMapAny>());
  node.set('classId', classId);
  const existing = [...operationsMap(doc).values()]
    .filter((item) => item.get('classId') === classId)
    .sort((a, b) => compareIds(a.get('orderRank') as string, b.get('orderRank') as string));
  const before = existing.findIndex((item) => item.get('id') === beforeOperationId);
  const index = before < 0 ? existing.length : before;
  node.set(
    'orderRank',
    rankBetween(
      existing[index - 1]?.get('orderRank') as string | undefined,
      existing[index]?.get('orderRank') as string | undefined,
      operation.id,
    ),
  );
  operationsMap(doc).set(operation.id, node);
  if (types) bindMemberType(doc, operation.id, operation.returnType, types);
  writeOperationParameters(node, operation.parameters, types);
}

export function deleteOperation(doc: Y.Doc, id: string): void {
  const operations = operationsMap(doc);
  const operation = operations.get(id);
  if (operation) {
    for (const parameter of readOperationParameters(operation)) forgetMemberType(doc, parameter.id);
    forgetMemberType(doc, id);
    operations.delete(id);
  }
}

function parameterNodes(node: YMapAny): YMapAny[] {
  const parameters = node.get('parameters');
  if (!(parameters instanceof Y.Map)) return [];
  return [...(parameters as Y.Map<YMapAny>).values()].sort((a, b) =>
    compareIds(a.get('orderRank') as string, b.get('orderRank') as string),
  );
}

export function readOperationParameters(node: YMapAny): UmlParameter[] {
  const legacy = node.get('parameters');
  if (Array.isArray(legacy))
    return (legacy as UmlParameter[]).map((p) => ({
      ...structuredClone(p),
      type: memberType(node.doc, p.id, p.type),
    }));
  const entries = parameterNodes(node).map((p) => {
    const { orderRank: _rank, autoName, ...fields } = p.toJSON();
    const parameter = fields as UmlParameter;
    return { parameter, autoName: autoName === true };
  });
  const reserved = new Set(entries.map(({ parameter }) => parameter.name));
  const used = new Set(
    entries.filter(({ autoName }) => !autoName).map(({ parameter }) => parameter.name),
  );
  let next = 1;
  return entries.map(({ parameter, autoName }) => {
    let name = parameter.name;
    // Desempata en el mismo orden de parámetros en todas las réplicas.
    // Los nombres escritos por una persona se conservan, incluso si chocan.
    if (autoName && used.has(name)) {
      while (reserved.has(`parametro${next}`) || used.has(`parametro${next}`)) next++;
      name = `parametro${next++}`;
    }
    used.add(name);
    return { ...parameter, name, type: memberType(node.doc, parameter.id, parameter.type) };
  });
}

/** Only changed parameter fields are written, so independent edits merge. */
export function writeOperationParameters(
  node: YMapAny,
  parameters: readonly UmlParameter[],
  types?: UmlTypeIndex,
  autoParameterId?: string,
): void {
  const doc = node.doc;
  const previous = new Map(readOperationParameters(node).map((p) => [p.id, p]));
  const wanted = new Set(parameters.map((p) => p.id));
  if (doc)
    for (const parameter of previous.values())
      if (!wanted.has(parameter.id)) forgetMemberType(doc, parameter.id);
  let target = node.get('parameters') as Y.Map<YMapAny>;
  if (!(target instanceof Y.Map)) {
    target = new Y.Map<YMapAny>();
    node.set('parameters', target);
  }
  for (const id of [...target.keys()]) if (!wanted.has(id)) target.delete(id);
  let lower: string | undefined;
  for (const [index, parameter] of parameters.entries()) {
    let item = target.get(parameter.id);
    if (item === undefined) {
      item = new Y.Map<unknown>();
      target.set(parameter.id, item);
      if (parameter.id === autoParameterId) item.set('autoName', true);
    }
    const currentRank = item.get('orderRank') as string | undefined;
    if (currentRank === undefined || (lower !== undefined && currentRank <= lower)) {
      const next = parameters
        .slice(index + 1)
        .map((p) => target.get(p.id)?.get('orderRank') as string | undefined)
        .find((rank) => rank !== undefined && (lower === undefined || rank > lower));
      item.set('orderRank', rankBetween(lower, next, parameter.id));
    }
    lower = item.get('orderRank') as string;
    for (const key of [...item.keys()])
      if (key !== 'orderRank' && key !== 'autoName' && !(key in parameter)) item.delete(key);
    for (const [key, value] of Object.entries(parameter)) {
      if (key === 'type') {
        if (
          memberType(doc, parameter.id, item.get('type') as string | undefined) !== parameter.type
        ) {
          item.set('type', parameter.type);
          if (doc && types) bindMemberType(doc, parameter.id, parameter.type, types);
        }
      } else if (key === 'name' && item.has('name')) {
        if (previous.get(parameter.id)?.name !== parameter.name) {
          item.set('name', parameter.name);
          item.delete('autoName');
        }
      } else if (value !== undefined && item.get(key) !== value) item.set(key, value);
    }
  }
}

function optionalFields<K extends string>(
  node: YMapAny,
  keys: readonly K[],
): Partial<Record<K, unknown>> {
  return Object.fromEntries(
    keys.filter((key) => node.has(key)).map((key) => [key, node.get(key)]),
  ) as Partial<Record<K, unknown>>;
}

export function classesMap(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap<YMapAny>(CLASSES_KEY);
}

export function relationshipsMap(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap<YMapAny>(RELATIONSHIPS_KEY);
}

export function layoutMap(doc: Y.Doc): YMapAny {
  return doc.getMap<unknown>(LAYOUT_KEY);
}

export function metaMap(doc: Y.Doc): YMapAny {
  return doc.getMap<unknown>(META_KEY);
}

/**
 * Las posiciones tal como estan, sin crearlas.
 *
 * Leer no puede escribir. Si la lectura creara el mapa, proyectar el estado
 * emitiria una actualizacion a todos los participantes y un lote de cuatro
 * comandos llegaria como dos mensajes en lugar de uno.
 */
function readPositions(doc: Y.Doc): Y.Map<YMapAny> | undefined {
  return layoutMap(doc).get(POSITIONS_KEY) as Y.Map<YMapAny> | undefined;
}

/** Las posiciones, creandolas si hace falta. Solo desde una escritura. */
function ensurePositions(doc: Y.Doc): Y.Map<YMapAny> {
  const existente = readPositions(doc);
  if (existente !== undefined) return existente;

  const positions = new Y.Map<YMapAny>();
  layoutMap(doc).set(POSITIONS_KEY, positions);
  return positions;
}

// ---------------------------------------------------------------------------
// Proyeccion: documento → modelo canonico
// ---------------------------------------------------------------------------

/**
 * El editor visual siempre es una proyeccion del documento, nunca la fuente de
 * verdad (plan maestro 4.5).
 *
 * Clases y relaciones salen ordenadas por identificador. El orden visual lo da
 * el layout, asi que aqui lo unico que importa es que la proyeccion sea
 * identica en todas las replicas y entre ejecuciones: de eso depende que el
 * mismo snapshot produzca el mismo codigo (RNF-05).
 */
export function readBoardState(doc: Y.Doc): BoardState {
  return {
    schemaVersion: (metaMap(doc).get('schemaVersion') as string | undefined) ?? SCHEMA_VERSION,
    semantic: readSemanticModel(doc),
    layout: readLayout(doc),
  };
}

export function readSemanticModel(doc: Y.Doc): SemanticModel {
  const classes = [...classesMap(doc).entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([, value]) => readClass(value, doc));
  const classIds = new Set(classes.filter((c) => (c.kind ?? 'CLASS') === 'CLASS').map((c) => c.id));
  const linkedClasses = new Set<string>();

  const relationships = [...relationshipsMap(doc).entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([, value]) => {
      const relationship = readRelationship(value);
      const id = relationship.associationClassId;
      if (id === undefined) return relationship;
      // El orden por ID hace que todas las réplicas elijan el mismo vínculo válido.
      if (
        (relationship.kind ?? 'ASSOCIATION') !== 'ASSOCIATION' ||
        !classIds.has(id) ||
        linkedClasses.has(id)
      ) {
        delete relationship.associationClassId;
      } else {
        linkedClasses.add(id);
      }
      return relationship;
    });

  return { classes, relationships };
}

function readLayout(doc: Y.Doc): Layout {
  const positions: Record<string, Position> = {};
  const sizes: Record<string, Size> = {};

  for (const [classId, value] of readPositions(doc)?.entries() ?? []) {
    positions[classId] = { x: Number(value.get('x')), y: Number(value.get('y')) };

    // El tamano vive en el mismo nodo que la posicion: asi borrar una clase se
    // lleva las dos cosas de una vez, y un documento anterior a este cambio
    // simplemente no trae `w` ni `h`.
    const width = value.get('w');
    const height = value.get('h');
    if (typeof width === 'number' && typeof height === 'number') {
      sizes[classId] = { width, height };
    }
  }

  const viewport = layoutMap(doc).get('viewport') as (Position & { zoom: number }) | undefined;

  return { positions, sizes, ...(viewport === undefined ? {} : { viewport }) };
}

function readClass(node: YMapAny, doc: Y.Doc): UmlClass {
  const operations = [...operationsMap(doc).values()]
    .filter((operation) => operation.get('classId') === node.get('id'))
    .sort(
      (a, b) =>
        compareIds(a.get('orderRank') as string, b.get('orderRank') as string) ||
        compareIds(a.get('id') as string, b.get('id') as string),
    )
    .map((operation) => {
      const { classId: _classId, orderRank: _order, ...fields } = operation.toJSON();
      const { returnType, ...other } = fields as UmlOperation;
      return {
        ...other,
        ...(returnType === undefined ? {} : { returnType: memberType(doc, other.id, returnType) }),
        parameters: readOperationParameters(operation),
      };
    });
  return {
    id: node.get('id') as string,
    displayName: node.get('displayName') as string,
    codeName: node.get('codeName') as string,
    databaseName: node.get('databaseName') as string,
    attributes: orderedAttributes(node).map(({ attribute }) => readAttribute(attribute, doc)),
    ...(optionalFields(node, CLASSIFIER_FIELDS) as Pick<
      UmlClass,
      (typeof CLASSIFIER_FIELDS)[number]
    >),
    ...(operations.length > 0 || node.get('hasOperations') === true ? { operations } : {}),
  };
}

function readAttribute(node: YMapAny, doc: Y.Doc): UmlAttribute {
  const id = node.get('id') as string;
  return {
    id,
    displayName: node.get('displayName') as string,
    codeName: node.get('codeName') as string,
    databaseName: node.get('databaseName') as string,
    type: memberType(doc, id, node.get('type') as UmlAttribute['type']),
    primaryKey: node.get('primaryKey') === true,
    nullable: node.get('nullable') === true,
    unique: node.get('unique') === true,
    ...(optionalFields(node, MEMBER_FIELDS) as Pick<UmlAttribute, (typeof MEMBER_FIELDS)[number]>),
  };
}

function readRelationship(node: YMapAny): UmlRelationship {
  const kind = node.get('kind') as UmlRelationship['kind'];
  const sourceRoleName = node.get('sourceRoleName') as string | undefined;
  const targetRoleName = node.get('targetRoleName') as string | undefined;

  return {
    id: node.get('id') as string,
    ...(kind === undefined ? {} : { kind }),
    sourceClassId: node.get('sourceClassId') as string,
    targetClassId: node.get('targetClassId') as string,
    sourceMultiplicity: node.get('sourceMultiplicity') as UmlRelationship['sourceMultiplicity'],
    targetMultiplicity: node.get('targetMultiplicity') as UmlRelationship['targetMultiplicity'],
    ...(sourceRoleName === undefined ? {} : { sourceRoleName }),
    ...(targetRoleName === undefined ? {} : { targetRoleName }),
    ...(optionalFields(node, RELATIONSHIP_FIELDS) as Pick<
      UmlRelationship,
      (typeof RELATIONSHIP_FIELDS)[number]
    >),
  };
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Escritura de nodos
// ---------------------------------------------------------------------------

/**
 * Escribe una clase completa, con sus atributos.
 *
 * Solo para sembrar un documento. El comando `CREATE_CLASS` usa
 * `writeEmptyClass`, porque una clase recien creada no tiene atributos todavia:
 * los anaden los comandos `ADD_ATTRIBUTE` que vengan detras en el mismo lote.
 */
export function writeClass(target: Y.Map<YMapAny>, umlClass: UmlClass): void {
  const node = new Y.Map<unknown>();
  node.set('id', umlClass.id);
  node.set('displayName', umlClass.displayName);
  node.set('codeName', umlClass.codeName);
  node.set('databaseName', umlClass.databaseName);
  for (const field of CLASSIFIER_FIELDS)
    if (umlClass[field] !== undefined) node.set(field, umlClass[field]);
  if (umlClass.operations !== undefined) node.set('hasOperations', true);

  const attributes = new Y.Array<YMapAny>();
  node.set(ATTRIBUTES_KEY, attributes);

  // La clase se inserta antes de llenar los atributos: Y.Array solo acepta
  // contenido una vez que su documento la conoce.
  target.set(umlClass.id, node);
  if (target.doc !== null) {
    rememberTypeName(target.doc, umlClass.id, umlClass.displayName);
    for (const operation of umlClass.operations ?? [])
      writeOperation(target.doc, umlClass.id, operation);
  }
  for (const attribute of umlClass.attributes) {
    attributes.push([attributeNode(attribute)]);
  }
}

/** La clase con sus tres nombres y ningun atributo. */
export function writeEmptyClass(target: Y.Map<YMapAny>, umlClass: UmlClass): void {
  writeClass(target, { ...umlClass, attributes: [], operations: undefined });
}

export function attributeNode(attribute: UmlAttribute): YMapAny {
  const node = new Y.Map<unknown>();
  applyAttributeFields(node, attribute);
  return node;
}

export function applyAttributeFields(node: YMapAny, attribute: UmlAttribute): void {
  node.set('id', attribute.id);
  node.set('displayName', attribute.displayName);
  node.set('codeName', attribute.codeName);
  node.set('databaseName', attribute.databaseName);
  node.set('type', attribute.type);
  node.set('primaryKey', attribute.primaryKey);
  node.set('nullable', attribute.nullable);
  node.set('unique', attribute.unique);
  for (const field of MEMBER_FIELDS)
    if (attribute[field] !== undefined) node.set(field, attribute[field]);
}

export function writeRelationship(target: Y.Map<YMapAny>, relationship: UmlRelationship): void {
  const node = new Y.Map<unknown>();
  applyRelationshipFields(node, relationship);
  target.set(relationship.id, node);
}

export function applyRelationshipFields(node: YMapAny, relationship: UmlRelationship): void {
  node.set('id', relationship.id);
  if (relationship.kind === undefined) node.delete('kind');
  else node.set('kind', relationship.kind);
  node.set('sourceClassId', relationship.sourceClassId);
  node.set('targetClassId', relationship.targetClassId);
  node.set('sourceMultiplicity', relationship.sourceMultiplicity);
  node.set('targetMultiplicity', relationship.targetMultiplicity);
  for (const field of RELATIONSHIP_FIELDS)
    if (relationship[field] !== undefined) node.set(field, relationship[field]);

  // `delete` y no `set(undefined)`: un rol ausente no debe aparecer en la
  // proyeccion como una clave con valor indefinido.
  if (relationship.sourceRoleName === undefined) node.delete('sourceRoleName');
  else node.set('sourceRoleName', relationship.sourceRoleName);

  if (relationship.targetRoleName === undefined) node.delete('targetRoleName');
  else node.set('targetRoleName', relationship.targetRoleName);
}

export function setPosition(doc: Y.Doc, classId: string, position: Position, size?: Size): void {
  const positions = ensurePositions(doc);
  let node = positions.get(classId);

  if (node === undefined) {
    node = new Y.Map<unknown>();
    positions.set(classId, node);
  }
  node.set('x', position.x);
  node.set('y', position.y);

  // Sin tamano no se borra el que hubiera: arrastrar no puede deshacer un
  // ajuste manual de ancho.
  if (size !== undefined) {
    node.set('w', size.width);
    node.set('h', size.height);
  }
}

export function deletePosition(doc: Y.Doc, classId: string): void {
  readPositions(doc)?.delete(classId);
}

export function findAttributeIndex(node: YMapAny, attributeId: string): number {
  const attributes = node.get(ATTRIBUTES_KEY) as Y.Array<YMapAny> | undefined;
  if (attributes === undefined) return -1;

  return attributes.toArray().findIndex((item) => item.get('id') === attributeId);
}

export function attributesArray(node: YMapAny): Y.Array<YMapAny> {
  return node.get(ATTRIBUTES_KEY) as Y.Array<YMapAny>;
}

type OrderedAttribute = { id: string; attribute: YMapAny; rank?: string };

function orderedAttributes(node: YMapAny): OrderedAttribute[] {
  const attributes = new Map<string, YMapAny>();
  for (const attribute of attributesArray(node)?.toArray() ?? []) {
    const id = attribute.get('id') as string;
    // Las versiones anteriores podían insertar dos nodos para un mismo ID.
    if (!attributes.has(id)) attributes.set(id, attribute);
  }

  const ranked: (OrderedAttribute & { rank: string })[] = [];
  for (const [id, attribute] of attributes) {
    const rank = attribute.get(ATTRIBUTE_RANK_KEY) ?? attribute.get(INITIAL_ATTRIBUTE_RANK_KEY);
    if (typeof rank !== 'string') continue;
    ranked.push({ id, attribute, rank });
    attributes.delete(id);
  }
  ranked.sort((left, right) => compareIds(left.rank, right.rank) || compareIds(left.id, right.id));

  const ordered: OrderedAttribute[] = ranked;
  const legacyOrder = node.get(LEGACY_ATTRIBUTE_ORDER_KEY);
  const fallbackOrder = Array.isArray(legacyOrder)
    ? [...legacyOrder, ...attributes.keys()]
    : attributes.keys();
  for (const id of fallbackOrder) {
    const attribute = attributes.get(id);
    if (attribute === undefined) continue;
    ordered.push({ id, attribute });
    attributes.delete(id);
  }
  return ordered;
}

// Cada posición cabe entre dos claves lexicográficas. El ID distingue las
// inserciones concurrentes en el mismo hueco sin renumerar las demás filas.
const rankDigits = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function rankBetween(lower: string | undefined, upper: string | undefined, id: string): string {
  let prefix = '';
  for (let index = 0; ; index++) {
    const left = rankDigits.indexOf(lower?.[index] ?? '-');
    const right =
      upper === undefined ? rankDigits.length - 1 : rankDigits.indexOf(upper[index] ?? '-');
    if (right - left > 1) {
      const digit = rankDigits[Math.floor((left + right) / 2)];
      return `${prefix}${digit}${id}V`;
    }
    prefix += rankDigits[left];
    if (left < right) upper = undefined;
  }
}

export function ensureAttributeRanks(node: YMapAny) {
  let previous: string | undefined;
  return orderedAttributes(node).map((entry) => {
    const rank = entry.rank ?? rankBetween(previous, undefined, entry.id);
    // La posición inicial se guarda aparte del movimiento de una fila.
    if (entry.rank === undefined) entry.attribute.set(INITIAL_ATTRIBUTE_RANK_KEY, rank);
    previous = rank;
    return { ...entry, rank };
  });
}

export function appendAttribute(node: YMapAny, attribute: UmlAttribute): void {
  const item = attributeNode(attribute);
  const legacyOrder = node.get(LEGACY_ATTRIBUTE_ORDER_KEY);
  if (Array.isArray(legacyOrder) && legacyOrder.includes(attribute.id)) {
    // Un ID restaurado no debe heredar su posición antigua si se añade al final.
    const previous = ensureAttributeRanks(node).at(-1);
    item.set(ATTRIBUTE_RANK_KEY, rankBetween(previous?.rank, undefined, attribute.id));
  }
  attributesArray(node).push([item]);
}

export function writeAttributeOrder(
  node: YMapAny,
  attributes: readonly UmlAttribute[],
  movedIds: ReadonlySet<string>,
): void {
  const ranked = new Map(ensureAttributeRanks(node).map((entry) => [entry.id, entry]));
  const ordered = attributes.flatMap(({ id }) => {
    const entry = ranked.get(id);
    return entry === undefined ? [] : [entry];
  });
  let lower: string | undefined;
  let nextFixed = 0;
  for (const [index, entry] of ordered.entries()) {
    if (!movedIds.has(entry.id)) {
      lower = entry.rank;
      continue;
    }
    if (nextFixed <= index) {
      nextFixed = index + 1;
      while (nextFixed < ordered.length && movedIds.has(ordered[nextFixed]!.id)) nextFixed++;
    }
    lower = rankBetween(lower, ordered[nextFixed]?.rank, entry.id);
    entry.attribute.set(ATTRIBUTE_RANK_KEY, lower);
  }
}

/**
 * Escribe un estado completo sobre un documento vacio.
 *
 * Solo para sembrar: importacion desde XMI o desde imagen, y montaje de
 * pruebas. Nunca para sincronizar — sustituir el documento entero descartaria
 * las ediciones concurrentes y produciria una actualizacion del tamano del
 * modelo en lugar de un delta (RA-02).
 */
export function seedDocument(doc: Y.Doc, state: BoardState = emptyBoardState()): void {
  doc.transact(() => {
    metaMap(doc).set('schemaVersion', state.schemaVersion);

    const classes = classesMap(doc);
    for (const umlClass of state.semantic.classes) writeClass(classes, umlClass);
    const types = indexUmlTypes(state.semantic.classes);
    visitMemberTypes(state.semantic, (id, type) => bindMemberType(doc, id, type, types));

    const relationships = relationshipsMap(doc);
    for (const relationship of state.semantic.relationships) {
      writeRelationship(relationships, relationship);
    }

    for (const [classId, position] of Object.entries(state.layout.positions)) {
      setPosition(doc, classId, position, state.layout.sizes[classId]);
    }
  });
}
