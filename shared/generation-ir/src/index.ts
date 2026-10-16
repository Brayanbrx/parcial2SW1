import {
  hasErrors,
  semanticModelSchema,
  type ConceptualType,
  type Multiplicity,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
  type ValidationIssue,
} from '@uml/contracts';
import {
  buildInheritanceGraph,
  inTopologicalOrder,
  isJavaReserved,
  isStructuralRelationship,
  normalizeName,
  owningClassId,
  ownerIsTargetEnd,
  referencedClassId,
  resolvePrimaryKey,
  toArtifactId,
  toPackageSegment,
  toResourcePath,
  validateModel,
  type InheritanceGraph,
} from '@uml/domain-core';

/** Version del formato intermedio. Cambiarla invalida artefactos cacheados. */
export const GENERATION_IR_VERSION = '1.0.0' as const;

export const JAVA_TYPE_BY_CONCEPTUAL_TYPE = {
  String: { type: 'String', postgresType: 'VARCHAR(255)' },
  Integer: { type: 'Integer', postgresType: 'INTEGER' },
  Long: { type: 'Long', postgresType: 'BIGINT' },
  Decimal: { type: 'BigDecimal', postgresType: 'NUMERIC(19,2)', import: 'java.math.BigDecimal' },
  Boolean: { type: 'Boolean', postgresType: 'BOOLEAN' },
  Date: { type: 'LocalDate', postgresType: 'DATE', import: 'java.time.LocalDate' },
  DateTime: {
    type: 'LocalDateTime',
    postgresType: 'TIMESTAMP',
    import: 'java.time.LocalDateTime',
  },
  UUID: { type: 'UUID', postgresType: 'UUID', import: 'java.util.UUID' },
} as const satisfies Record<
  ConceptualType,
  { readonly type: string; readonly postgresType: string; readonly import?: string }
>;

export interface GenerationInput {
  readonly projectName: string;
  readonly snapshotVersion: number;
  readonly model: SemanticModel;
  /** Prefijo institucional configurable para no codificarlo en las plantillas. */
  readonly basePackage?: string;
}

export interface IrProject {
  readonly displayName: string;
  readonly artifactId: string;
  readonly groupId: string;
  readonly packageName: string;
  readonly packagePath: string;
  readonly applicationClassName: string;
  readonly databaseName: string;
}

export interface IrAttribute {
  readonly sourceAttributeId: string | null;
  readonly displayName: string;
  readonly fieldName: string;
  readonly columnName: string;
  readonly conceptualType: ConceptualType;
  readonly javaType: string;
  readonly postgresType: string;
  readonly javaImport: string | null;
  readonly primaryKey: boolean;
  readonly generated: boolean;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly length: number | null;
  readonly precision: number | null;
  readonly scale: number | null;
}

export type IrRelationshipKind = 'MANY_TO_ONE' | 'ONE_TO_ONE';

export interface IrRelationship {
  readonly sourceRelationshipId: string;
  readonly kind: IrRelationshipKind;
  readonly fieldName: string;
  readonly columnName: string;
  readonly optional: boolean;
  readonly unique: boolean;
  readonly targetEntityId: string;
  readonly targetClassName: string;
  readonly targetRepositoryName: string;
  readonly targetPrimaryKeyFieldName: string;
  readonly targetPrimaryKeyJavaType: string;
  readonly targetPrimaryKeyJavaImport: string | null;
  readonly finderMethodName: string;
  readonly queryParameterName: string;
}

export interface IrEntity {
  readonly sourceClassId: string;
  readonly displayName: string;
  readonly className: string;
  readonly variableName: string;
  readonly tableName: string;
  readonly resourcePath: string;
  readonly repositoryName: string;
  readonly serviceName: string;
  readonly controllerName: string;
  readonly dtoName: string;
  /**
   * La clave efectiva. En una subclase es la de su raiz, porque la tabla hija se
   * une a la madre por esa misma clave.
   */
  readonly primaryKey: IrAttribute;
  /**
   * Todo lo que la entidad tiene, heredado incluido y en ese orden.
   *
   * Es lo que ven el DTO, el servicio y la capa Dart: quien crea un estudiante
   * por la API tiene que poder mandar tambien el nombre que vive en persona.
   */
  readonly attributes: readonly IrAttribute[];
  readonly relationships: readonly IrRelationship[];
  /**
   * Lo que la clase Java declara de su puno y letra.
   *
   * En una raiz coincide con lo anterior. En una subclase es la diferencia:
   * volver a declarar un campo heredado lo taparia y duplicaria la columna.
   */
  readonly declaredAttributes: readonly IrAttribute[];
  readonly declaredRelationships: readonly IrRelationship[];
  /** Clase de la que extiende, o `null` si no hereda de nadie. */
  readonly superClassName: string | null;
  readonly superEntityId: string | null;
  /** Cabeza de una jerarquia: no hereda y alguien hereda de ella. */
  readonly inheritanceRoot: boolean;
}

export interface GenerationIr {
  readonly irVersion: typeof GENERATION_IR_VERSION;
  readonly snapshotVersion: number;
  readonly project: IrProject;
  readonly entities: readonly IrEntity[];
}

export class InvalidGenerationModelError extends Error {
  public constructor(public readonly issues: readonly ValidationIssue[]) {
    const count = issues.filter((item) => item.severity === 'ERROR').length;
    super(`El modelo no se puede generar: contiene ${count} error(es).`);
    this.name = 'InvalidGenerationModelError';
  }
}

/**
 * Traduce un snapshot semantico a la representacion intermedia (RA-08 y RA-13).
 *
 * Zod crea una copia del modelo al analizarlo. Por eso cualquier cambio que
 * llegue desde la pizarra despues de entrar a esta funcion no puede alterar la
 * generacion en curso.
 */
export function buildGenerationIr(input: GenerationInput): GenerationIr {
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1) {
    throw new Error('snapshotVersion debe ser un entero positivo.');
  }

  const projectName = input.projectName.trim();
  if (projectName.length === 0) throw new Error('projectName no puede estar vacio.');

  const basePackage = input.basePackage ?? 'bo.edu.sw1';
  if (!isJavaPackage(basePackage)) {
    throw new Error(`El paquete base "${basePackage}" no es un paquete Java valido.`);
  }

  const snapshot = semanticModelSchema.parse(input.model);
  const issues = validateModel(snapshot);
  if (hasErrors(issues)) throw new InvalidGenerationModelError(issues);

  const classesById = new Map(snapshot.classes.map((umlClass) => [umlClass.id, umlClass]));
  const inheritance = buildInheritanceGraph(snapshot);
  const mutableEntities = new Map<string, MutableIrEntity>();

  // De arriba abajo: una subclase hereda la clave primaria de su superclase, y
  // para copiarla hay que haberla resuelto antes.
  for (const umlClass of inTopologicalOrder(snapshot, inheritance)) {
    const superEntity = superEntityOf(umlClass, inheritance, mutableEntities);
    const declaredAttributes = buildAttributes(umlClass, superEntity !== undefined);
    const attributes =
      superEntity === undefined
        ? declaredAttributes
        : [...superEntity.attributes, ...declaredAttributes];

    const primaryKey = attributes.find((attribute) => attribute.primaryKey);
    if (primaryKey === undefined) {
      throw new Error(`No se pudo resolver la clave primaria de "${umlClass.displayName}".`);
    }

    mutableEntities.set(umlClass.id, {
      sourceClassId: umlClass.id,
      displayName: umlClass.displayName,
      className: umlClass.codeName,
      variableName: lowerFirst(umlClass.codeName),
      tableName: umlClass.databaseName,
      resourcePath: toResourcePath(umlClass.codeName),
      repositoryName: `${umlClass.codeName}Repository`,
      serviceName: `${umlClass.codeName}Service`,
      controllerName: `${umlClass.codeName}Controller`,
      dtoName: `${umlClass.codeName}DTO`,
      primaryKey,
      attributes,
      declaredAttributes,
      relationships: [],
      declaredRelationships: [],
      superClassName: superEntity?.className ?? null,
      superEntityId: superEntity?.sourceClassId ?? null,
      inheritanceRoot:
        superEntity === undefined && (inheritance.subclassesById.get(umlClass.id) ?? []).length > 0,
    });
  }

  for (const relationship of snapshot.relationships) {
    // La generalizacion no produce clave foranea: produce la jerarquia que ya
    // se resolvio arriba.
    if (!isStructuralRelationship(relationship)) continue;
    addRelationship(relationship, classesById, mutableEntities);
  }

  // Segunda pasada por el mismo orden: las relaciones efectivas de una subclase
  // son las de su superclase mas las suyas.
  for (const umlClass of inTopologicalOrder(snapshot, inheritance)) {
    const entity = mutableEntities.get(umlClass.id);
    if (entity === undefined) continue;

    const superEntity = superEntityOf(umlClass, inheritance, mutableEntities);
    if (superEntity === undefined) continue;

    entity.relationships.unshift(...superEntity.relationships);

    const repetido = entity.relationships
      .map((item) => item.fieldName)
      .find((fieldName, indice, todos) => todos.indexOf(fieldName) !== indice);

    if (repetido !== undefined) {
      // Lo bloquea INHERITED_MEMBER_COLLISION. La defensa esta porque el campo
      // duplicado no rompe la generacion: rompe el arranque de la aplicacion ya
      // generada, con un error de Hibernate que no menciona el diagrama.
      throw new Error(
        `"${umlClass.displayName}" declara el campo "${repetido}", que ya hereda de ` +
          `"${superEntity.displayName}".`,
      );
    }
  }

  const entities = [...mutableEntities.values()]
    .sort((left, right) => left.className.localeCompare(right.className, 'en'))
    .map<IrEntity>((entity) => ({
      ...entity,
      attributes: Object.freeze([...entity.attributes]),
      declaredAttributes: Object.freeze([...entity.declaredAttributes]),
      relationships: Object.freeze([...entity.relationships].sort(byFieldName)),
      declaredRelationships: Object.freeze([...entity.declaredRelationships].sort(byFieldName)),
    }));

  const artifactId = toArtifactId(projectName);
  const packageSegment = toPackageSegment(projectName);
  const applicationClassName = `${normalizeName(projectName, 'CLASS').codeName}Application`;

  return deepFreeze({
    irVersion: GENERATION_IR_VERSION,
    snapshotVersion: input.snapshotVersion,
    project: {
      displayName: projectName,
      artifactId,
      groupId: basePackage,
      packageName: `${basePackage}.${packageSegment}`,
      packagePath: `${basePackage}.${packageSegment}`.replaceAll('.', '/'),
      applicationClassName,
      databaseName: artifactId.replaceAll('-', '_'),
    },
    entities,
  });
}

interface MutableIrEntity extends Omit<
  IrEntity,
  'attributes' | 'relationships' | 'declaredRelationships'
> {
  readonly attributes: IrAttribute[];
  /** Efectivas: las heredadas se anteponen en la segunda pasada. */
  readonly relationships: IrRelationship[];
  readonly declaredRelationships: IrRelationship[];
}

function byFieldName(left: IrRelationship, right: IrRelationship): number {
  return left.fieldName.localeCompare(right.fieldName, 'en');
}

/**
 * La entidad de la superclase, ya construida.
 *
 * Que falte solo es posible con un ciclo de herencia, y el validador lo bloquea
 * antes de llegar aqui. La defensa existe para que un cambio futuro del
 * validador no produzca en su lugar una entidad sin clave primaria.
 */
function superEntityOf(
  umlClass: UmlClass,
  inheritance: InheritanceGraph,
  entitiesById: ReadonlyMap<string, MutableIrEntity>,
): MutableIrEntity | undefined {
  const superclassId = inheritance.superclassById.get(umlClass.id);
  if (superclassId === undefined) return undefined;

  const superEntity = entitiesById.get(superclassId);
  if (superEntity === undefined) {
    throw new Error(
      `La superclase de "${umlClass.displayName}" no se pudo resolver: la herencia forma un ciclo.`,
    );
  }
  return superEntity;
}

/**
 * Los atributos que declara la clase.
 *
 * Una subclase no resuelve clave: la hereda, y por eso ninguno de sus atributos
 * sale marcado como clave primaria ni se le genera un `id` propio. Declararlo
 * pondria un segundo `@Id` en una jerarquia que ya tiene el suyo.
 */
function buildAttributes(umlClass: UmlClass, heredaClave: boolean): IrAttribute[] {
  if (heredaClave) {
    return umlClass.attributes.map((attribute) => toIrAttribute(attribute, false));
  }

  const resolution = resolvePrimaryKey(umlClass);
  if (resolution.kind === 'AMBIGUOUS' || resolution.kind === 'COMPOSITE') {
    // El validador debe haberlo impedido antes. Esta defensa mantiene la IR
    // segura aunque cambie el validador en el futuro.
    throw new Error(`La clave primaria de "${umlClass.displayName}" es ambigua.`);
  }

  const primaryKeyId = resolution.kind === 'GENERATED' ? null : resolution.attribute.id;
  const attributes = umlClass.attributes.map((attribute) =>
    toIrAttribute(attribute, attribute.id === primaryKeyId),
  );

  if (resolution.kind === 'GENERATED') {
    attributes.unshift({
      sourceAttributeId: null,
      displayName: 'id',
      fieldName: 'id',
      columnName: 'id',
      conceptualType: 'UUID',
      javaType: 'UUID',
      postgresType: 'UUID',
      javaImport: 'java.util.UUID',
      primaryKey: true,
      generated: true,
      nullable: false,
      unique: false,
      length: null,
      precision: null,
      scale: null,
    });
  }

  return attributes.sort((left, right) => Number(right.primaryKey) - Number(left.primaryKey));
}

function toIrAttribute(attribute: UmlAttribute, primaryKey: boolean): IrAttribute {
  const mapping = JAVA_TYPE_BY_CONCEPTUAL_TYPE[attribute.type];
  return {
    sourceAttributeId: attribute.id,
    displayName: attribute.displayName,
    fieldName: attribute.codeName,
    columnName: attribute.databaseName,
    conceptualType: attribute.type,
    javaType: mapping.type,
    postgresType: mapping.postgresType,
    javaImport: 'import' in mapping ? mapping.import : null,
    primaryKey,
    generated: false,
    nullable: primaryKey ? false : attribute.nullable,
    unique: attribute.unique,
    length: attribute.type === 'String' ? 255 : null,
    precision: attribute.type === 'Decimal' ? 19 : null,
    scale: attribute.type === 'Decimal' ? 2 : null,
  };
}

function addRelationship(
  relationship: UmlRelationship,
  classesById: ReadonlyMap<string, UmlClass>,
  entitiesById: ReadonlyMap<string, MutableIrEntity>,
): void {
  const ownerId = owningClassId(relationship);
  const targetId = referencedClassId(relationship);
  const owner = entitiesById.get(ownerId);
  const target = entitiesById.get(targetId);
  const targetClass = classesById.get(targetId);
  if (owner === undefined || target === undefined || targetClass === undefined) {
    throw new Error(`La relacion ${relationship.id} referencia una clase inexistente.`);
  }

  // En una autorrelacion los ids de ambos extremos son iguales. La
  // cardinalidad, no la identidad de la clase, determina el lado propietario.
  const ownerAtTarget = ownerIsTargetEnd(relationship);
  const role = roleForReferencedEnd(relationship, ownerAtTarget);
  const names =
    role === undefined
      ? { codeName: lowerFirst(targetClass.codeName), databaseName: targetClass.databaseName }
      : normalizeName(role, 'ATTRIBUTE');

  if (
    owner.attributes.some((attribute) => attribute.fieldName === names.codeName) ||
    owner.declaredRelationships.some((item) => item.fieldName === names.codeName)
  ) {
    throw new Error(
      `La relacion ${relationship.id} produce el campo duplicado "${names.codeName}" en ${owner.className}.`,
    );
  }

  const referencedMultiplicity = ownerAtTarget
    ? relationship.sourceMultiplicity
    : relationship.targetMultiplicity;
  const ownerMultiplicity = ownerAtTarget
    ? relationship.targetMultiplicity
    : relationship.sourceMultiplicity;
  const kind: IrRelationshipKind = isMany(ownerMultiplicity) ? 'MANY_TO_ONE' : 'ONE_TO_ONE';
  const optional = referencedMultiplicity === '0..1';

  const irRelationship: IrRelationship = {
    sourceRelationshipId: relationship.id,
    kind,
    fieldName: names.codeName,
    columnName: `${names.databaseName}_id`,
    optional,
    unique: kind === 'ONE_TO_ONE',
    targetEntityId: target.sourceClassId,
    targetClassName: target.className,
    targetRepositoryName: target.repositoryName,
    targetPrimaryKeyFieldName: target.primaryKey.fieldName,
    targetPrimaryKeyJavaType: target.primaryKey.javaType,
    targetPrimaryKeyJavaImport: target.primaryKey.javaImport,
    finderMethodName: `findBy${upperFirst(names.codeName)}_${upperFirst(target.primaryKey.fieldName)}`,
    queryParameterName: `${names.codeName}Id`,
  };

  owner.declaredRelationships.push(irRelationship);
  owner.relationships.push(irRelationship);
}

function roleForReferencedEnd(
  relationship: UmlRelationship,
  ownerAtTarget: boolean,
): string | undefined {
  return ownerAtTarget ? relationship.sourceRoleName : relationship.targetRoleName;
}

function isMany(multiplicity: Multiplicity): boolean {
  return multiplicity === '0..*' || multiplicity === '1..*';
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isJavaPackage(value: string): boolean {
  return value
    .split('.')
    .every((segment) => /^[a-z_][a-z0-9_]*$/.test(segment) && !isJavaReserved(segment));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
