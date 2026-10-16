import {
  CONCEPTUAL_TYPES,
  MULTIPLICITIES,
  isCollectionMultiplicity,
  severityOf,
  type SemanticModel,
  type UmlClass,
  type UmlRelationship,
  type ValidationCode,
  type ValidationIssue,
} from '@uml/contracts';
import { InvalidIdentifierError, normalizeName, toWords } from './naming.js';
import { resolvePrimaryKey } from './primary-key.js';
import {
  ancestorsOf,
  buildInheritanceGraph,
  isStructuralRelationship,
  rootOf,
  type InheritanceGraph,
} from './inheritance.js';

/**
 * Validador del modelo canonico (RF-017, CA-017.1 y CA-017.2).
 *
 * Se ejecuta igual en el navegador y en el servidor (RA-05) y no depende de nada
 * externo (RNF-15).
 *
 * Cuando encuentra una construccion no soportada la identifica y sugiere como
 * modelarla: cada exclusion esta declarada, no omitida.
 */

interface IssueInput {
  readonly code: ValidationCode;
  readonly message: string;
  readonly elementIds: readonly string[];
  /** `undefined` explicito para que quien la calcula pueda no tenerla. */
  readonly suggestion?: string | undefined;
}

function issue(input: IssueInput): ValidationIssue {
  return {
    code: input.code,
    severity: severityOf(input.code),
    message: input.message,
    elementIds: [...input.elementIds],
    ...(input.suggestion === undefined ? {} : { suggestion: input.suggestion }),
  };
}

export function validateModel(model: SemanticModel): ValidationIssue[] {
  // El grafo de herencia se construye una vez y lo comparten las tres partes
  // que dependen de el: la clave primaria de una subclase, los miembros que
  // hereda y las relaciones que no debe volver a emitir.
  const inheritance = buildInheritanceGraph(model);

  return [
    ...validateClasses(model, inheritance),
    ...validateClassNameCollisions(model),
    ...validateInheritance(model, inheritance),
    ...validateRelationships(model),
    ...validateOrphanClasses(model),
  ];
}

// ---------------------------------------------------------------------------
// Clases: nombre, atributos, tipos y clave primaria
// ---------------------------------------------------------------------------

function validateClasses(model: SemanticModel, inheritance: InheritanceGraph): ValidationIssue[] {
  const porId = new Map(model.classes.map((umlClass) => [umlClass.id, umlClass]));

  return model.classes.flatMap((umlClass) => {
    const raizId = rootOf(inheritance, umlClass.id);
    const raiz = raizId === umlClass.id ? undefined : porId.get(raizId);

    return [
      ...validateClassName(umlClass),
      ...validateAttributes(umlClass),
      ...validatePrimaryKey(umlClass, raiz),
    ];
  });
}

function validateClassName(umlClass: UmlClass): ValidationIssue[] {
  if (umlClass.displayName.trim().length === 0) {
    return [
      issue({
        code: 'CLASS_WITHOUT_NAME',
        message: 'Hay una clase sin nombre.',
        elementIds: [umlClass.id],
        suggestion: 'Dale un nombre antes de generar.',
      }),
    ];
  }
  return normalizationIssues(umlClass.displayName, 'CLASS', umlClass.id, 'La clase');
}

function validateAttributes(umlClass: UmlClass): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const attribute of umlClass.attributes) {
    issues.push(
      ...normalizationIssues(attribute.displayName, 'ATTRIBUTE', attribute.id, 'El atributo'),
    );

    if (!(CONCEPTUAL_TYPES as readonly string[]).includes(attribute.type)) {
      issues.push(
        issue({
          code: 'UNSUPPORTED_TYPE',
          message:
            `El atributo "${attribute.displayName}" de "${umlClass.displayName}" usa el tipo ` +
            `"${String(attribute.type)}", que no esta soportado.`,
          elementIds: [umlClass.id, attribute.id],
          suggestion: `Tipos soportados: ${CONCEPTUAL_TYPES.join(', ')}.`,
        }),
      );
    }
  }

  issues.push(...validateAttributeNameCollisions(umlClass));
  return issues;
}

/**
 * RTM-02: la unicidad se valida sobre los nombres tecnicos, nunca sobre el
 * visual. "Numero" y "Número" colapsan al mismo identificador: es error.
 */
function validateAttributeNameCollisions(umlClass: UmlClass): ValidationIssue[] {
  return findTechnicalNameCollisions(
    umlClass.attributes.map((a) => ({ id: a.id, names: [a.codeName, a.databaseName] })),
  ).map(({ technicalName, ids }) =>
    issue({
      code: 'DUPLICATE_ATTRIBUTE_NAME',
      message:
        `"${umlClass.displayName}" tiene ${ids.length} atributos que producen el mismo ` +
        `nombre tecnico "${technicalName}".`,
      elementIds: [umlClass.id, ...ids],
      suggestion: 'Renombra uno de ellos: dos columnas no pueden llamarse igual.',
    }),
  );
}

function validateClassNameCollisions(model: SemanticModel): ValidationIssue[] {
  return findTechnicalNameCollisions(
    model.classes.map((c) => ({ id: c.id, names: [c.codeName, c.databaseName] })),
  ).map(({ technicalName, ids }) => {
    const nombres = ids
      .map((id) => model.classes.find((c) => c.id === id)?.displayName ?? id)
      .map((nombre) => `"${nombre}"`)
      .join(' y ');

    return issue({
      code: 'DUPLICATE_CLASS_NAME',
      message: `${nombres} producen el mismo nombre tecnico "${technicalName}".`,
      elementIds: ids,
      suggestion:
        'Los nombres se comparan sin tildes, sin espacios, sin conectores y sin distinguir ' +
        'mayusculas. Renombra una de las clases.',
    });
  });
}

/**
 * Agrupa por nombre tecnico y devuelve solo los grupos con mas de un elemento.
 *
 * Un mismo par de elementos suele chocar a la vez en el nombre de codigo y en el
 * de base de datos. Se reporta una sola vez por grupo de elementos: dos avisos
 * identicos para el mismo problema no ayudan a nadie a arreglarlo.
 */
function findTechnicalNameCollisions(
  elementos: readonly { id: string; names: readonly string[] }[],
): { technicalName: string; ids: string[] }[] {
  const agrupados = new Map<string, string[]>();

  for (const elemento of elementos) {
    for (const nombre of elemento.names) {
      const clave = nombre.toLowerCase();
      const existentes = agrupados.get(clave) ?? [];
      if (!existentes.includes(elemento.id)) existentes.push(elemento.id);
      agrupados.set(clave, existentes);
    }
  }

  const vistos = new Set<string>();
  const colisiones: { technicalName: string; ids: string[] }[] = [];

  for (const [technicalName, ids] of agrupados) {
    if (ids.length < 2) continue;

    const firma = [...ids].sort().join(',');
    if (vistos.has(firma)) continue;
    vistos.add(firma);

    colisiones.push({ technicalName, ids });
  }

  return colisiones;
}

function normalizationIssues(
  displayName: string,
  kind: 'CLASS' | 'ATTRIBUTE',
  elementId: string,
  etiqueta: string,
): ValidationIssue[] {
  let normalized;
  try {
    normalized = normalizeName(displayName, kind);
  } catch (error) {
    if (error instanceof InvalidIdentifierError) {
      const motivo =
        error.reason === 'EMPTY' ? 'no contiene ninguna letra ni digito' : 'empieza por un digito';
      return [
        issue({
          code: 'INVALID_IDENTIFIER',
          message: `${etiqueta} "${displayName}" ${motivo}, asi que no produce un identificador valido.`,
          elementIds: [elementId],
          suggestion: 'Empieza el nombre por una letra.',
        }),
      ];
    }
    throw error;
  }

  const issues: ValidationIssue[] = [];

  if (normalized.wasNormalized) {
    issues.push(
      issue({
        code: 'NAME_NORMALIZED',
        message:
          `${etiqueta} "${displayName}" se emitira como "${normalized.codeName}" / ` +
          `"${normalized.databaseName}".`,
        elementIds: [elementId],
      }),
    );
  }

  if (normalized.wasPrefixed) {
    const listas = normalized.reservedIn
      .map((lista) => ({ JAVA: 'Java', POSTGRES: 'PostgreSQL', GENERATOR: 'el generador' })[lista])
      .join(' y ');

    issues.push(
      issue({
        code: 'RESERVED_NAME_PREFIXED',
        message:
          `${etiqueta} "${displayName}" choca con una palabra reservada de ${listas}; ` +
          `se emitira como "${normalized.codeName}" / "${normalized.databaseName}".`,
        elementIds: [elementId],
      }),
    );
  }

  return issues;
}

/**
 * RTM-04, y la excepcion que introduce la herencia.
 *
 * Una subclase **no** resuelve su propia clave: la hereda de la raiz de su
 * jerarquia, porque la tabla hija se une a la madre por esa misma clave. Lo que
 * la subclase hubiera declarado como clave se emite como una columna mas, y eso
 * hay que decirlo: es la unica decision de la proyeccion que cambia el
 * significado de algo que el usuario marco a mano.
 */
function validatePrimaryKey(umlClass: UmlClass, raiz: UmlClass | undefined): ValidationIssue[] {
  const resolution = resolvePrimaryKey(umlClass);

  if (raiz !== undefined) {
    const declarada =
      resolution.kind === 'DECLARED' || resolution.kind === 'INFERRED'
        ? resolution.attribute
        : undefined;

    return [
      issue({
        code: 'PRIMARY_KEY_INHERITED',
        message:
          `"${umlClass.displayName}" hereda la clave primaria de "${raiz.displayName}"` +
          (declarada === undefined
            ? '.'
            : `; su atributo "${declarada.displayName}" se emitira como una columna mas.`),
        elementIds: declarada === undefined ? [umlClass.id] : [umlClass.id, declarada.id],
        suggestion:
          declarada === undefined
            ? undefined
            : `Marca "${declarada.displayName}" como unico si tiene que seguir identificando la fila.`,
      }),
    ];
  }

  switch (resolution.kind) {
    case 'DECLARED':
      return [];

    case 'INFERRED':
      return [
        issue({
          code: 'PRIMARY_KEY_INFERRED',
          message:
            `"${umlClass.displayName}" no declara clave primaria; se usara ` +
            `"${resolution.attribute.displayName}" por convencion de nombre.`,
          elementIds: [umlClass.id, resolution.attribute.id],
        }),
      ];

    case 'GENERATED':
      return [
        issue({
          code: 'PRIMARY_KEY_GENERATED',
          message: `"${umlClass.displayName}" no tiene clave primaria; se generara "id : UUID".`,
          elementIds: [umlClass.id],
        }),
      ];

    case 'AMBIGUOUS':
      return [
        issue({
          code: 'MULTIPLE_PRIMARY_KEY_CANDIDATES',
          message:
            `"${umlClass.displayName}" tiene varios atributos que parecen clave primaria: ` +
            resolution.candidates.map((a) => `"${a.displayName}"`).join(', ') +
            '.',
          elementIds: [umlClass.id, ...resolution.candidates.map((a) => a.id)],
          suggestion: 'Marca explicitamente cual es la clave primaria.',
        }),
      ];

    case 'COMPOSITE':
      return [
        issue({
          code: 'COMPOSITE_PRIMARY_KEY',
          message:
            `"${umlClass.displayName}" marca ${resolution.declared.length} atributos como clave ` +
            'primaria. Las claves compuestas no estan soportadas (RM-03).',
          elementIds: [umlClass.id, ...resolution.declared.map((a) => a.id)],
          suggestion:
            'Deja una sola clave primaria y marca las demas como unicas, o anade una clave ' +
            'tecnica y convierte el par en una restriccion de unicidad.',
        }),
      ];
  }
}

// ---------------------------------------------------------------------------
// Herencia
// ---------------------------------------------------------------------------

/**
 * RM-07: la generalizacion se proyecta a tabla por clase, unida por la clave.
 *
 * `Estudiante` extiende `Persona`, la tabla `estudiante` comparte la clave
 * primaria de `persona` y la fila completa se lee uniendo las dos. Eso impone
 * tres limites que vienen de Java y de la propia union, no del gusto de nadie:
 * una sola superclase, ningun ciclo y ningun miembro repetido a lo largo de la
 * cadena.
 *
 * Cada uno se denuncia con la construccion equivalente que si se puede modelar,
 * porque una jerarquia que no cabe casi siempre es una asociacion disfrazada.
 */
function validateInheritance(
  model: SemanticModel,
  inheritance: InheritanceGraph,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const classesById = new Map(model.classes.map((umlClass) => [umlClass.id, umlClass]));
  const nombre = (classId: string): string =>
    classesById.get(classId)?.displayName ?? 'una clase borrada';

  for (const relationship of inheritance.selfGeneralizations) {
    issues.push(
      issue({
        code: 'SELF_GENERALIZATION',
        message: `"${nombre(relationship.sourceClassId)}" se generaliza a si misma.`,
        elementIds: [relationship.id, relationship.sourceClassId],
        suggestion:
          'Una clase no puede ser su propia superclase. Si lo que querias es que una fila ' +
          'apunte a otra de la misma clase —un empleado y su jefe—, usa una asociacion con rol.',
      }),
    );
  }

  for (const [subclaseId, relaciones] of inheritance.multipleInheritance) {
    const superclases = relaciones.map((rel) => `"${nombre(rel.targetClassId)}"`).join(', ');

    issues.push(
      issue({
        code: 'MULTIPLE_INHERITANCE',
        message:
          `"${nombre(subclaseId)}" hereda de ${String(relaciones.length)} clases: ${superclases}. ` +
          'Solo se admite una superclase.',
        elementIds: [subclaseId, ...relaciones.map((rel) => rel.id)],
        suggestion:
          'Deja una sola generalizacion y convierte las demas en asociaciones, o reune lo comun ' +
          'en una unica superclase.',
      }),
    );
  }

  for (const ciclo of inheritance.cycles) {
    const recorrido = [...ciclo, ciclo[0] as string].map(nombre).join(' → ');

    issues.push(
      issue({
        code: 'INHERITANCE_CYCLE',
        message: `La herencia forma un ciclo: ${recorrido}.`,
        elementIds: [...ciclo],
        suggestion:
          'Rompe el ciclo: en una jerarquia siempre hay una clase que no hereda de nadie.',
      }),
    );
  }

  issues.push(...validateInheritedMemberCollisions(model, inheritance, classesById));
  return issues;
}

/**
 * Un miembro declarado que tapa a otro que ya venia de arriba.
 *
 * En Java el campo de la subclase esconde al de la superclase y en la base de
 * datos las dos tablas acaban con la misma columna: el codigo compila, la
 * aplicacion arranca y los datos se escriben en la tabla equivocada. Es el
 * unico fallo de esta lista que no se nota hasta que ya hay filas dentro, asi
 * que bloquea la generacion.
 *
 * Se comparan atributos y campos de clave foranea en el mismo espacio de
 * nombres, porque en la clase generada lo son.
 */
function validateInheritedMemberCollisions(
  model: SemanticModel,
  inheritance: InheritanceGraph,
  classesById: ReadonlyMap<string, UmlClass>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const porClasePropietaria = relationshipsByOwner(model);

  const miembrosDe = (classId: string): { clave: string; id: string; etiqueta: string }[] => {
    const umlClass = classesById.get(classId);
    if (umlClass === undefined) return [];

    return [
      ...umlClass.attributes.map((atributo) => ({
        clave: toWords(atributo.codeName).join('_'),
        id: atributo.id,
        etiqueta: `el atributo "${atributo.displayName}"`,
      })),
      ...(porClasePropietaria.get(classId) ?? []).flatMap((relationship) => {
        const campo = fieldNameFor(relationship, classesById);
        if (campo === undefined) return [];
        return [
          {
            clave: campo,
            id: relationship.id,
            etiqueta: `la clave foranea "${campo}"`,
          },
        ];
      }),
    ];
  };

  for (const umlClass of model.classes) {
    const ancestros = ancestorsOf(inheritance, umlClass.id);
    if (ancestros.length === 0) continue;

    const heredados = new Map<string, { id: string; etiqueta: string; claseId: string }>();
    // De la raiz hacia abajo: si dos ancestros ya chocaban entre ellos, el
    // hallazgo es de ellos y el mas cercano es el que esta tapando aqui.
    for (const ancestroId of [...ancestros].reverse()) {
      for (const miembro of miembrosDe(ancestroId)) {
        heredados.set(miembro.clave, { ...miembro, claseId: ancestroId });
      }
    }

    for (const propio of miembrosDe(umlClass.id)) {
      const heredado = heredados.get(propio.clave);
      if (heredado === undefined) continue;

      issues.push(
        issue({
          code: 'INHERITED_MEMBER_COLLISION',
          message:
            `"${umlClass.displayName}" declara ${propio.etiqueta}, que ya hereda de ` +
            `"${classesById.get(heredado.claseId)?.displayName ?? heredado.claseId}".`,
          elementIds: [umlClass.id, propio.id, heredado.id],
          suggestion:
            'Quitalo de la subclase —ya lo tiene por herencia— o renombra uno de los dos.',
        }),
      );
    }
  }

  return issues;
}

/**
 * Las relaciones agrupadas por la clase que recibe su clave foranea.
 *
 * Las generalizaciones quedan fuera: no producen ningun campo.
 */
function relationshipsByOwner(model: SemanticModel): Map<string, UmlRelationship[]> {
  const porClasePropietaria = new Map<string, UmlRelationship[]>();

  for (const relationship of model.relationships) {
    if (!isStructuralRelationship(relationship)) continue;

    const owner = owningClassId(relationship);
    const existentes = porClasePropietaria.get(owner) ?? [];
    existentes.push(relationship);
    porClasePropietaria.set(owner, existentes);
  }

  return porClasePropietaria;
}

// ---------------------------------------------------------------------------
// Relaciones
// ---------------------------------------------------------------------------

function validateRelationships(model: SemanticModel): ValidationIssue[] {
  const porId = new Map(model.classes.map((c) => [c.id, c]));

  return [
    ...model.relationships.flatMap((rel) => validateRelationship(rel, porId)),
    ...validateRelationshipFieldCollisions(model, porId),
  ];
}

function validateRelationship(
  relationship: UmlRelationship,
  classesById: ReadonlyMap<string, UmlClass>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const extremos = [
    ['origen', relationship.sourceClassId],
    ['destino', relationship.targetClassId],
  ] as const;

  for (const [extremo, classId] of extremos) {
    if (!classesById.has(classId)) {
      issues.push(
        issue({
          code: 'RELATIONSHIP_TO_MISSING_CLASS',
          message: `Una relacion apunta a una clase de ${extremo} que ya no existe.`,
          elementIds: [relationship.id, classId],
          suggestion: 'Elimina la relacion o vuelve a crear la clase.',
        }),
      );
    }
  }

  for (const multiplicidad of [relationship.sourceMultiplicity, relationship.targetMultiplicity]) {
    if (!(MULTIPLICITIES as readonly string[]).includes(multiplicidad)) {
      issues.push(
        issue({
          code: 'UNSUPPORTED_MULTIPLICITY',
          message: `La multiplicidad "${String(multiplicidad)}" no esta soportada.`,
          elementIds: [relationship.id],
          suggestion: `Multiplicidades soportadas: ${MULTIPLICITIES.join(', ')}.`,
        }),
      );
    }
  }

  // RM-01: la N:M no llega al generador. La herramienta ofrece crear la clase
  // intermedia al detectarla, pero mientras siga ahi bloquea la generacion.
  //
  // Una generalizacion queda fuera: sus multiplicidades no significan nada —el
  // editor ni siquiera las dibuja— y leerlas como una N:M bloquearia la
  // generacion de una jerarquia perfectamente valida.
  if (
    isStructuralRelationship(relationship) &&
    isCollectionMultiplicity(relationship.sourceMultiplicity) &&
    isCollectionMultiplicity(relationship.targetMultiplicity)
  ) {
    const origen = classesById.get(relationship.sourceClassId)?.displayName ?? 'origen';
    const destino = classesById.get(relationship.targetClassId)?.displayName ?? 'destino';

    issues.push(
      issue({
        code: 'MANY_TO_MANY_RELATIONSHIP',
        message: `La relacion entre "${origen}" y "${destino}" es muchos a muchos.`,
        elementIds: [relationship.id, relationship.sourceClassId, relationship.targetClassId],
        suggestion:
          `Crea una clase intermedia con dos relaciones N:1, una hacia "${origen}" y otra hacia ` +
          `"${destino}". Ahi es donde viven los atributos propios de la asociacion.`,
      }),
    );
  }

  return issues;
}

/**
 * RTM-05: si no hay rol, el nombre del campo se deriva del nombre tecnico de la
 * clase referenciada. Dos relaciones entre el mismo par sin rol producirian
 * campos colisionantes.
 *
 * Con rol tambien puede haber colision, si los dos roles normalizan igual.
 */
function validateRelationshipFieldCollisions(
  model: SemanticModel,
  classesById: ReadonlyMap<string, UmlClass>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Se agrupa por la clase que recibira la clave foranea, que es donde el campo
  // se emite y por tanto donde puede colisionar. Las generalizaciones no emiten
  // ningun campo, asi que no pueden chocar con nada: lo suyo lo revisa
  // `validateInheritance`.
  const porClasePropietaria = relationshipsByOwner(model);

  for (const [ownerId, relaciones] of porClasePropietaria) {
    if (relaciones.length < 2) continue;

    const porCampo = new Map<string, UmlRelationship[]>();

    for (const relationship of relaciones) {
      const campo = fieldNameFor(relationship, classesById);
      if (campo === undefined) continue;
      const existentes = porCampo.get(campo) ?? [];
      existentes.push(relationship);
      porCampo.set(campo, existentes);
    }

    for (const [campo, chocantes] of porCampo) {
      if (chocantes.length < 2) continue;

      const sinRol = chocantes.every((rel) => roleFor(rel) === undefined);
      const owner = classesById.get(ownerId)?.displayName ?? ownerId;

      issues.push(
        issue({
          code: sinRol ? 'DUPLICATE_RELATIONSHIP_WITHOUT_ROLE' : 'ROLE_NAME_COLLISION',
          message: sinRol
            ? `"${owner}" tiene ${chocantes.length} relaciones sin rol hacia la misma clase; ` +
              `todas producirian el campo "${campo}".`
            : `"${owner}" tiene ${chocantes.length} relaciones cuyos roles producen el mismo ` +
              `campo "${campo}".`,
          elementIds: [ownerId, ...chocantes.map((rel) => rel.id)],
          suggestion: sinRol
            ? 'Dale un nombre de rol distinto a cada relacion, por ejemplo "facturacion" y "envio".'
            : 'Cambia uno de los nombres de rol.',
        }),
      );
    }
  }

  return issues;
}

/**
 * RTM-05 y RTM-07: que clase recibe la clave foranea.
 *
 * En 1:N la recibe el lado "muchos". En 1:1 la recibe el destino; la eleccion es
 * arbitraria y lo que importa es que sea invariable.
 *
 * Solo tiene sentido para una relacion estructural. Una generalizacion no
 * produce clave foranea sino una tabla unida por la clave primaria, asi que
 * quien recorra relaciones filtra antes con `isStructuralRelationship`.
 */
export function owningClassId(relationship: UmlRelationship): string {
  return ownerIsTargetEnd(relationship) ? relationship.targetClassId : relationship.sourceClassId;
}

/** El extremo opuesto al propietario: la clase a la que apunta la clave foranea. */
export function referencedClassId(relationship: UmlRelationship): string {
  return owningClassId(relationship) === relationship.targetClassId
    ? relationship.sourceClassId
    : relationship.targetClassId;
}

/** El rol que nombra el campo, si lo hay: el del extremo referenciado. */
function roleFor(relationship: UmlRelationship): string | undefined {
  return ownerIsTargetEnd(relationship) ? relationship.sourceRoleName : relationship.targetRoleName;
}

/**
 * Extremo que recibe la clave foranea.
 *
 * No se puede deducir comparando ids: en una asociacion recursiva origen y
 * destino son la misma clase. Las multiplicidades conservan la direccion de
 * los extremos incluso en ese caso.
 */
export function ownerIsTargetEnd(relationship: UmlRelationship): boolean {
  const origenEsColeccion = isCollectionMultiplicity(relationship.sourceMultiplicity);
  const destinoEsColeccion = isCollectionMultiplicity(relationship.targetMultiplicity);

  if (destinoEsColeccion && !origenEsColeccion) return true;
  if (origenEsColeccion && !destinoEsColeccion) return false;
  return true;
}

/** RTM-05: si hay rol se usa el rol; si no, se deriva de la clase referenciada. */
function fieldNameFor(
  relationship: UmlRelationship,
  classesById: ReadonlyMap<string, UmlClass>,
): string | undefined {
  const rol = roleFor(relationship);
  if (rol !== undefined) return toWords(rol).join('_');

  const referenciada = classesById.get(referencedClassId(relationship));
  if (referenciada === undefined) return undefined;
  return toWords(referenciada.codeName).join('_');
}

// ---------------------------------------------------------------------------
// Clases sueltas
// ---------------------------------------------------------------------------

function validateOrphanClasses(model: SemanticModel): ValidationIssue[] {
  if (model.classes.length < 2) return [];

  const conectadas = new Set(
    model.relationships.flatMap((rel) => [rel.sourceClassId, rel.targetClassId]),
  );

  return model.classes
    .filter((umlClass) => !conectadas.has(umlClass.id))
    .map((umlClass) =>
      issue({
        code: 'CLASS_WITHOUT_RELATIONSHIPS',
        message: `"${umlClass.displayName}" no participa en ninguna relacion.`,
        elementIds: [umlClass.id],
      }),
    );
}
