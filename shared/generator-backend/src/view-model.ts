import type { GenerationIr, IrAttribute, IrEntity, IrRelationship } from '@uml/generation-ir';

interface TemplateField {
  readonly fieldName: string;
  readonly javaType: string;
  readonly getterName: string;
  readonly setterName: string;
}

interface AttributeView extends TemplateField {
  readonly columnAnnotation: string;
  readonly primaryKey: boolean;
}

interface RelationshipView extends TemplateField {
  readonly associationAnnotation: string;
  readonly joinColumnAnnotation: string;
  readonly targetClassName: string;
  readonly targetGetterName: string;
  readonly repositoryFieldName: string;
  readonly finderMethodName: string;
  readonly queryParameterName: string;
  readonly queryJavaType: string;
  readonly serviceFinderMethodName: string;
  readonly optional: boolean;
}

interface DtoFieldView {
  readonly javaType: string;
  readonly fieldName: string;
  readonly annotations: readonly string[];
  readonly last: boolean;
}

interface DependencyView {
  readonly type: string;
  readonly fieldName: string;
  readonly last: boolean;
}

export interface EntityTemplateView {
  readonly project: GenerationIr['project'];
  readonly entity: IrEntity;
  readonly entityType: string;
  readonly jpa: { entity: string; table: string; id: string; column: string };
  /**
   * Lo que la clase Java escribe entre sus llaves.
   *
   * Todo lo demas —DTO, servicio, controlador— trabaja con el conjunto
   * efectivo, que incluye lo heredado. La clase, no: un campo heredado que se
   * vuelve a declarar tapa al de arriba y duplica la columna.
   */
  readonly declaredAttributes: readonly AttributeView[];
  readonly declaredRelationships: readonly RelationshipView[];
  /** `@Inheritance(...)` en la raiz, `extends` y `@PrimaryKeyJoinColumn` en la subclase. */
  readonly inheritanceAnnotation: string | null;
  readonly primaryKeyJoinAnnotation: string | null;
  readonly entityImports: readonly string[];
  readonly dtoImports: readonly string[];
  readonly repositoryImports: readonly string[];
  readonly serviceImports: readonly string[];
  readonly controllerImports: readonly string[];
  readonly attributes: readonly AttributeView[];
  readonly nonPrimaryAttributes: readonly AttributeView[];
  readonly relationships: readonly RelationshipView[];
  readonly dtoFields: readonly DtoFieldView[];
  readonly dependencies: readonly DependencyView[];
  readonly primaryKey: TemplateField & { readonly uuid: boolean };
  readonly dtoValues: readonly { readonly expression: string; readonly last: boolean }[];
}

export function createProjectView(ir: GenerationIr): object {
  return { project: ir.project, irVersion: ir.irVersion, snapshotVersion: ir.snapshotVersion };
}

export function createEntityView(ir: GenerationIr, entity: IrEntity): EntityTemplateView {
  // Un import de JPA puede ocultar un tipo del modelo usado en el mismo archivo.
  const modelTypes = new Set([
    entity.className,
    entity.superClassName,
    ...entity.declaredRelationships.map((relationship) => relationship.targetClassName),
  ]);
  const jpaName = (name: string): string =>
    modelTypes.has(name) ? `jakarta.persistence.${name}` : name;

  const toAttributeView = (attribute: IrAttribute): AttributeView => ({
    fieldName: attribute.fieldName,
    javaType: attribute.javaType,
    getterName: `get${upperFirst(attribute.fieldName)}`,
    setterName: `set${upperFirst(attribute.fieldName)}`,
    columnAnnotation: columnAnnotation(attribute, jpaName('Column')),
    primaryKey: attribute.primaryKey,
  });

  const declaredAttributes = entity.declaredAttributes.map((attribute) => {
    const view = toAttributeView(attribute);
    if (attribute.javaImport !== null) {
      return modelTypes.has(view.javaType) ? { ...view, javaType: attribute.javaImport } : view;
    }
    // Los tipos de java.lang también quedan ocultos por clases del mismo paquete.
    return ir.entities.some((item) => item.className === view.javaType)
      ? { ...view, javaType: `java.lang.${view.javaType}` }
      : view;
  });

  const attributes: AttributeView[] = entity.attributes.map(toAttributeView);

  const relationships: RelationshipView[] = entity.relationships.map((relationship) => ({
    fieldName: relationship.fieldName,
    javaType: relationship.targetClassName,
    getterName: `get${upperFirst(relationship.fieldName)}`,
    setterName: `set${upperFirst(relationship.fieldName)}`,
    associationAnnotation:
      relationship.kind === 'MANY_TO_ONE'
        ? `@${jpaName('ManyToOne')}(fetch = ${jpaName('FetchType')}.LAZY, optional = ${String(relationship.optional)})`
        : `@${jpaName('OneToOne')}(fetch = ${jpaName('FetchType')}.LAZY, optional = ${String(relationship.optional)})`,
    joinColumnAnnotation: joinColumnAnnotation(relationship, jpaName('JoinColumn')),
    targetClassName: relationship.targetClassName,
    targetGetterName: `get${upperFirst(relationship.targetPrimaryKeyFieldName)}`,
    repositoryFieldName: lowerFirst(relationship.targetRepositoryName),
    finderMethodName: relationship.finderMethodName,
    queryParameterName: relationship.queryParameterName,
    queryJavaType: relationship.targetPrimaryKeyJavaType,
    serviceFinderMethodName: `findBy${upperFirst(relationship.queryParameterName)}`,
    optional: relationship.optional,
  }));

  const dtoFieldsWithoutLast = [
    ...entity.attributes.map((attribute) => ({
      javaType: attribute.javaType,
      fieldName: attribute.fieldName,
      annotations: validationAnnotations(attribute),
    })),
    ...entity.relationships.map((relationship) => ({
      javaType: relationship.targetPrimaryKeyJavaType,
      fieldName: relationship.queryParameterName,
      annotations: relationship.optional ? [] : ['@NotNull'],
    })),
  ];
  const dtoFields = withLast(dtoFieldsWithoutLast);

  const targetDependencies = new Map<string, Omit<DependencyView, 'last'>>();
  for (const relationship of entity.relationships) {
    targetDependencies.set(relationship.targetRepositoryName, {
      type: relationship.targetRepositoryName,
      fieldName: lowerFirst(relationship.targetRepositoryName),
    });
  }
  const dependencies = withLast([
    { type: entity.repositoryName, fieldName: 'repository' },
    ...[...targetDependencies.values()].sort((left, right) =>
      left.type.localeCompare(right.type, 'en'),
    ),
  ]);

  const dtoValues = withLast([
    ...attributes.map((attribute) => ({ expression: `entity.${attribute.getterName}()` })),
    ...relationships.map((relationship) => ({
      expression: relationship.optional
        ? `entity.${relationship.getterName}() == null ? null : entity.${relationship.getterName}().${relationship.targetGetterName}()`
        : `entity.${relationship.getterName}().${relationship.targetGetterName}()`,
    })),
  ]);

  const declaredFieldNames = new Set(
    entity.declaredRelationships.map((relationship) => relationship.fieldName),
  );
  const modelImport = `${entityPackagePlaceholder()}.model.${entity.className}`;
  const repositoryTypeImports = repositoryImports(entity);
  const serviceTypeImports = serviceImports(entity);
  const qualifyEntity =
    entity.className === 'IllegalArgumentException' ||
    entity.className === entity.primaryKey.javaType ||
    entity.relationships.some(
      (relationship) => relationship.targetPrimaryKeyJavaType === entity.className,
    ) ||
    [...repositoryTypeImports, ...serviceTypeImports].some(
      (name) => name !== modelImport && name.endsWith(`.${entity.className}`),
    );

  return {
    project: ir.project,
    entity,
    entityType: qualifyEntity
      ? `${ir.project.packageName}.model.${entity.className}`
      : entity.className,
    jpa: {
      entity: jpaName('Entity'),
      table: jpaName('Table'),
      id: jpaName('Id'),
      column: jpaName('Column'),
    },
    declaredAttributes,
    declaredRelationships: relationships.filter((view) => declaredFieldNames.has(view.fieldName)),
    // La estrategia unida es la unica que conserva las columnas de la subclase
    // en su propia tabla y una fila por objeto: la tabla hija comparte la clave
    // primaria de la madre y la fila completa se lee uniendo las dos.
    inheritanceAnnotation: entity.inheritanceRoot
      ? `@${jpaName('Inheritance')}(strategy = ${jpaName('InheritanceType')}.JOINED)`
      : null,
    primaryKeyJoinAnnotation:
      entity.superClassName === null
        ? null
        : `@${jpaName('PrimaryKeyJoinColumn')}(name = "${entity.primaryKey.columnName}")`,
    entityImports: entityImports(entity).filter((name) => !modelTypes.has(name.split('.').at(-1)!)),
    dtoImports: dtoImports(entity),
    repositoryImports: qualifyEntity
      ? repositoryTypeImports.filter((name) => name !== modelImport)
      : repositoryTypeImports,
    serviceImports: qualifyEntity
      ? serviceTypeImports.filter((name) => name !== modelImport)
      : serviceTypeImports,
    controllerImports: controllerImports(entity),
    attributes,
    nonPrimaryAttributes: attributes.filter((attribute) => !attribute.primaryKey),
    relationships,
    dtoFields,
    dependencies,
    primaryKey: {
      fieldName: entity.primaryKey.fieldName,
      javaType: entity.primaryKey.javaType,
      getterName: `get${upperFirst(entity.primaryKey.fieldName)}`,
      setterName: `set${upperFirst(entity.primaryKey.fieldName)}`,
      uuid: entity.primaryKey.conceptualType === 'UUID',
    },
    dtoValues,
  };
}

function columnAnnotation(attribute: IrAttribute, annotation: string): string {
  const options = [
    `name = "${attribute.columnName}"`,
    `nullable = ${String(attribute.nullable)}`,
    ...(attribute.primaryKey ? ['updatable = false'] : []),
    ...(attribute.unique ? ['unique = true'] : []),
    ...(attribute.length === null ? [] : [`length = ${attribute.length}`]),
    ...(attribute.precision === null ? [] : [`precision = ${attribute.precision}`]),
    ...(attribute.scale === null ? [] : [`scale = ${attribute.scale}`]),
  ];
  return `@${annotation}(${options.join(', ')})`;
}

function joinColumnAnnotation(relationship: IrRelationship, annotation: string): string {
  const options = [
    `name = "${relationship.columnName}"`,
    `nullable = ${String(relationship.optional)}`,
    ...(relationship.unique ? ['unique = true'] : []),
  ];
  return `@${annotation}(${options.join(', ')})`;
}

function validationAnnotations(attribute: IrAttribute): string[] {
  if (attribute.primaryKey) return [];
  const annotations: string[] = [];
  if (!attribute.nullable) {
    annotations.push(attribute.conceptualType === 'String' ? '@NotBlank' : '@NotNull');
  }
  if (attribute.length !== null) annotations.push(`@Size(max = ${attribute.length})`);
  if (attribute.precision !== null && attribute.scale !== null)
    annotations.push(
      `@Digits(integer = ${attribute.precision - attribute.scale}, fraction = ${attribute.scale})`,
    );
  return annotations;
}

/**
 * Lo que importa la clase de entidad, por lo que **declara**.
 *
 * Una subclase que solo anade dos columnas no importa `Id` ni `ManyToOne`: los
 * hereda. Importar de mas no rompe la compilacion, pero deja una clase que
 * miente sobre lo que hace, y quien la lea buscara una clave primaria que no
 * esta ahi.
 */
function entityImports(entity: IrEntity): string[] {
  const imports = new Set(['jakarta.persistence.Entity', 'jakarta.persistence.Table']);
  addScalarImports(imports, entity.declaredAttributes);

  if (entity.declaredAttributes.length > 0) imports.add('jakarta.persistence.Column');
  if (entity.declaredAttributes.some((item) => item.primaryKey)) {
    imports.add('jakarta.persistence.Id');
  }
  if (entity.inheritanceRoot) {
    imports.add('jakarta.persistence.Inheritance');
    imports.add('jakarta.persistence.InheritanceType');
  }
  if (entity.superClassName !== null) imports.add('jakarta.persistence.PrimaryKeyJoinColumn');

  if (entity.declaredRelationships.length > 0) {
    imports.add('jakarta.persistence.FetchType');
    imports.add('jakarta.persistence.JoinColumn');
  }
  if (entity.declaredRelationships.some((item) => item.kind === 'MANY_TO_ONE')) {
    imports.add('jakarta.persistence.ManyToOne');
  }
  if (entity.declaredRelationships.some((item) => item.kind === 'ONE_TO_ONE')) {
    imports.add('jakarta.persistence.OneToOne');
  }
  return sorted(imports);
}

function dtoImports(entity: IrEntity): string[] {
  const imports = new Set<string>();
  addScalarImports(imports, entity.attributes);
  for (const relationship of entity.relationships) {
    if (relationship.targetPrimaryKeyJavaImport !== null) {
      imports.add(relationship.targetPrimaryKeyJavaImport);
    }
  }
  if (
    entity.attributes.some(
      (item) => !item.primaryKey && !item.nullable && item.conceptualType !== 'String',
    ) ||
    entity.relationships.some((item) => !item.optional)
  ) {
    imports.add('jakarta.validation.constraints.NotNull');
  }
  if (
    entity.attributes.some(
      (item) => !item.primaryKey && !item.nullable && item.conceptualType === 'String',
    )
  ) {
    imports.add('jakarta.validation.constraints.NotBlank');
  }
  if (entity.attributes.some((item) => item.length !== null)) {
    imports.add('jakarta.validation.constraints.Size');
  }
  if (entity.attributes.some((item) => item.precision !== null && item.scale !== null))
    imports.add('jakarta.validation.constraints.Digits');
  return sorted(imports);
}

function repositoryImports(entity: IrEntity): string[] {
  const imports = new Set([
    `${entityPackagePlaceholder()}.model.${entity.className}`,
    'org.springframework.data.jpa.repository.JpaRepository',
  ]);
  if (entity.primaryKey.javaImport !== null) imports.add(entity.primaryKey.javaImport);
  if (entity.relationships.length > 0) imports.add('java.util.List');
  for (const relationship of entity.relationships) {
    if (relationship.targetPrimaryKeyJavaImport !== null) {
      imports.add(relationship.targetPrimaryKeyJavaImport);
    }
  }
  return sorted(imports);
}

function serviceImports(entity: IrEntity): string[] {
  const imports = new Set([
    `${entityPackagePlaceholder()}.dto.${entity.dtoName}`,
    `${entityPackagePlaceholder()}.exception.ResourceNotFoundException`,
    `${entityPackagePlaceholder()}.model.${entity.className}`,
    `${entityPackagePlaceholder()}.repository.${entity.repositoryName}`,
    'java.util.List',
    'org.springframework.stereotype.Service',
    'org.springframework.transaction.annotation.Transactional',
  ]);
  if (entity.primaryKey.javaImport !== null) imports.add(entity.primaryKey.javaImport);
  if (entity.primaryKey.conceptualType === 'UUID') imports.add('java.util.UUID');
  for (const relationship of entity.relationships) {
    imports.add(`${entityPackagePlaceholder()}.repository.${relationship.targetRepositoryName}`);
    if (relationship.targetPrimaryKeyJavaImport !== null) {
      imports.add(relationship.targetPrimaryKeyJavaImport);
    }
  }
  return sorted(imports);
}

function controllerImports(entity: IrEntity): string[] {
  const imports = new Set([
    `${entityPackagePlaceholder()}.dto.${entity.dtoName}`,
    `${entityPackagePlaceholder()}.service.${entity.serviceName}`,
    'jakarta.validation.Valid',
    'java.util.List',
    'org.springframework.http.HttpStatus',
    'org.springframework.http.ResponseEntity',
    'org.springframework.web.bind.annotation.DeleteMapping',
    'org.springframework.web.bind.annotation.GetMapping',
    'org.springframework.web.bind.annotation.PathVariable',
    'org.springframework.web.bind.annotation.PostMapping',
    'org.springframework.web.bind.annotation.PutMapping',
    'org.springframework.web.bind.annotation.RequestBody',
    'org.springframework.web.bind.annotation.RequestMapping',
    'org.springframework.web.bind.annotation.RestController',
  ]);
  if (entity.relationships.length > 0) {
    imports.add('org.springframework.web.bind.annotation.RequestParam');
  }
  if (entity.primaryKey.javaImport !== null) imports.add(entity.primaryKey.javaImport);
  for (const relationship of entity.relationships) {
    if (relationship.targetPrimaryKeyJavaImport !== null) {
      imports.add(relationship.targetPrimaryKeyJavaImport);
    }
  }
  return sorted(imports);
}

/** El generador sustituye este marcador por el paquete real al finalizar la vista. */
export function resolvePackageImports(view: EntityTemplateView): EntityTemplateView {
  const replace = (imports: readonly string[]): string[] =>
    imports.map((item) => item.replace(entityPackagePlaceholder(), view.project.packageName));
  return {
    ...view,
    repositoryImports: replace(view.repositoryImports),
    serviceImports: replace(view.serviceImports),
    controllerImports: replace(view.controllerImports),
  };
}

function addScalarImports(imports: Set<string>, attributes: readonly IrAttribute[]): void {
  for (const attribute of attributes) {
    if (attribute.javaImport !== null) imports.add(attribute.javaImport);
  }
}

function entityPackagePlaceholder(): string {
  return '__PACKAGE__';
}

function withLast<T>(items: readonly T[]): Array<T & { readonly last: boolean }> {
  return items.map((item, index) => ({ ...item, last: index === items.length - 1 }));
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
