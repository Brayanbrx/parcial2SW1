import {
  SCHEMA_VERSION,
  emptyBoardState,
  type BoardState,
  type Layout,
  type Position,
  type Size,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
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
 * Los atributos si van en Y.Array, porque su orden se ve: es el orden en que
 * aparecen en la tarjeta y en el codigo generado. El CRDT garantiza que ese
 * orden converge igual en todas las replicas.
 */

export const CLASSES_KEY = 'classes';
export const RELATIONSHIPS_KEY = 'relationships';
export const LAYOUT_KEY = 'layout';
export const META_KEY = 'meta';
export const POSITIONS_KEY = 'positions';
export const ATTRIBUTES_KEY = 'attributes';

type YMapAny = Y.Map<unknown>;

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
    .map(([, value]) => readClass(value));

  const relationships = [...relationshipsMap(doc).entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([, value]) => readRelationship(value));

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

function readClass(node: YMapAny): UmlClass {
  const attributes = (node.get(ATTRIBUTES_KEY) as Y.Array<YMapAny> | undefined) ?? new Y.Array();

  return {
    id: node.get('id') as string,
    displayName: node.get('displayName') as string,
    codeName: node.get('codeName') as string,
    databaseName: node.get('databaseName') as string,
    attributes: attributes.toArray().map(readAttribute),
  };
}

function readAttribute(node: YMapAny): UmlAttribute {
  return {
    id: node.get('id') as string,
    displayName: node.get('displayName') as string,
    codeName: node.get('codeName') as string,
    databaseName: node.get('databaseName') as string,
    type: node.get('type') as UmlAttribute['type'],
    primaryKey: node.get('primaryKey') === true,
    nullable: node.get('nullable') === true,
    unique: node.get('unique') === true,
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

  const attributes = new Y.Array<YMapAny>();
  node.set(ATTRIBUTES_KEY, attributes);

  // La clase se inserta antes de llenar los atributos: Y.Array solo acepta
  // contenido una vez que su documento la conoce.
  target.set(umlClass.id, node);
  for (const attribute of umlClass.attributes) {
    attributes.push([attributeNode(attribute)]);
  }
}

/** La clase con sus tres nombres y ningun atributo. */
export function writeEmptyClass(target: Y.Map<YMapAny>, umlClass: UmlClass): void {
  writeClass(target, { ...umlClass, attributes: [] });
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

    const relationships = relationshipsMap(doc);
    for (const relationship of state.semantic.relationships) {
      writeRelationship(relationships, relationship);
    }

    for (const [classId, position] of Object.entries(state.layout.positions)) {
      setPosition(doc, classId, position, state.layout.sizes[classId]);
    }
  });
}
