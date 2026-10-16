import {
  emptyBoardState,
  type BoardState,
  type ConceptualType,
  type Multiplicity,
  type RelationshipKind,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
} from '@uml/contracts';
import { normalizeName } from '@uml/domain-core';

/**
 * Constructor de modelos del banco de regresion.
 *
 * Los modelos se declaran en `definitions.ts` con nombres visuales, y aqui se
 * derivan los nombres tecnicos con el mismo normalizador que usa la plataforma.
 * Escribirlos a mano en el JSON garantizaria que en algun momento el banco pruebe
 * una normalizacion distinta de la real.
 *
 * Los identificadores son deterministas: dependen solo del nombre del modelo y
 * del elemento. Regenerar el banco no produce un diff (RNF-05).
 */

export interface AttributeSpec {
  readonly name: string;
  readonly type: ConceptualType;
  readonly primaryKey?: boolean;
  /** Por defecto los atributos son opcionales, como en el modelo canonico. */
  readonly required?: boolean;
  readonly unique?: boolean;
}

export interface RelationshipSpec {
  /**
   * Ausente significa asociacion, igual que en el modelo canonico.
   *
   * En una generalizacion `from` es la subclase y `to` la superclase, y las dos
   * multiplicidades se declaran por uniformidad aunque no signifiquen nada.
   */
  readonly kind?: RelationshipKind;
  readonly from: string;
  readonly fromMultiplicity: Multiplicity;
  readonly to: string;
  readonly toMultiplicity: Multiplicity;
  /** Rol del extremo origen. Nombra el campo cuando el destino es propietario. */
  readonly fromRole?: string;
  readonly toRole?: string;
}

export interface ClassSpec {
  readonly name: string;
  readonly attributes: readonly AttributeSpec[];
}

export interface FixtureSpec {
  readonly id: string;
  readonly title: string;
  /** Que cubre este modelo del banco (seccion 15.2 del plan maestro). */
  readonly coverage: string;
  readonly classes: readonly ClassSpec[];
  readonly relationships: readonly RelationshipSpec[];
}

export interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly coverage: string;
  readonly model: SemanticModel;
  readonly boardState: BoardState;
}

// ---------------------------------------------------------------------------
// Identificadores deterministas
// ---------------------------------------------------------------------------

/**
 * UUID derivado de una ruta estable, sin depender de `node:crypto`.
 *
 * No es criptografico y no pretende serlo: solo tiene que ser estable entre
 * ejecuciones y entre maquinas, para que el banco no produzca diffs espurios y
 * para que un fallo del generador se pueda reproducir citando un identificador.
 */
export function deterministicId(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const bytes: number[] = [];
  let estado = hash === 0 ? 0x9e3779b9 : hash;
  while (bytes.length < 16) {
    estado ^= estado << 13;
    estado >>>= 0;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    estado >>>= 0;
    bytes.push(
      estado & 0xff,
      (estado >>> 8) & 0xff,
      (estado >>> 16) & 0xff,
      (estado >>> 24) & 0xff,
    );
  }

  // Version 5 y variante RFC 4122, para que el identificador pase la validacion
  // de formato del esquema.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = bytes.slice(0, 16).map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Construccion
// ---------------------------------------------------------------------------

export function buildFixture(spec: FixtureSpec): Fixture {
  const classIdOf = (className: string): string => deterministicId(`${spec.id}/class/${className}`);

  const classes: UmlClass[] = spec.classes.map((classSpec) => {
    const names = normalizeName(classSpec.name, 'CLASS');

    return {
      id: classIdOf(classSpec.name),
      displayName: classSpec.name,
      codeName: names.codeName,
      databaseName: names.databaseName,
      attributes: classSpec.attributes.map((attributeSpec) =>
        buildAttribute(spec.id, classSpec.name, attributeSpec),
      ),
    };
  });

  const relationships: UmlRelationship[] = spec.relationships.map((rel, indice) => ({
    id: deterministicId(`${spec.id}/rel/${indice}/${rel.from}-${rel.to}`),
    ...(rel.kind === undefined ? {} : { kind: rel.kind }),
    sourceClassId: classIdOf(rel.from),
    targetClassId: classIdOf(rel.to),
    sourceMultiplicity: rel.fromMultiplicity,
    targetMultiplicity: rel.toMultiplicity,
    ...(rel.fromRole === undefined ? {} : { sourceRoleName: rel.fromRole }),
    ...(rel.toRole === undefined ? {} : { targetRoleName: rel.toRole }),
  }));

  const model: SemanticModel = { classes, relationships };

  // Layout en rejilla. No tiene valor semantico; existe para que abrir un fixture
  // en el editor no amontone todas las clases en el origen.
  const boardState: BoardState = {
    ...emptyBoardState(),
    semantic: model,
    layout: {
      positions: Object.fromEntries(
        classes.map((umlClass, indice) => [
          umlClass.id,
          { x: (indice % 4) * 320, y: Math.floor(indice / 4) * 260 },
        ]),
      ),
      // El banco no fija tamanos: cada tarjeta se dibuja con el alto que le
      // corresponde por sus atributos.
      sizes: {},
    },
  };

  return { id: spec.id, title: spec.title, coverage: spec.coverage, model, boardState };
}

function buildAttribute(fixtureId: string, className: string, spec: AttributeSpec): UmlAttribute {
  const names = normalizeName(spec.name, 'ATTRIBUTE');

  return {
    id: deterministicId(`${fixtureId}/attr/${className}/${spec.name}`),
    displayName: spec.name,
    codeName: names.codeName,
    databaseName: names.databaseName,
    type: spec.type,
    primaryKey: spec.primaryKey ?? false,
    // Una clave primaria nunca es nula, se declare o no.
    nullable: spec.primaryKey === true ? false : !(spec.required ?? false),
    unique: spec.unique ?? false,
  };
}
