import {
  RESERVED_PREFIX,
  isGeneratorReserved,
  isJavaReserved,
  isPostgresReserved,
} from './reserved-words.js';

/**
 * RTM-02 y RTM-03: derivacion de los nombres tecnicos.
 *
 * Secuencia obligatoria:
 *   nombre visual → normalizacion → validacion de identificador →
 *   deteccion de colision → nombre tecnico
 *
 * La deteccion de colision no vive aqui: necesita conocer a los hermanos y por
 * eso la hace el validador. Aqui termina en «nombre tecnico», que es justamente
 * el valor sobre el que la colision se comprueba. La unicidad se valida sobre
 * los nombres tecnicos, nunca sobre el visual: `Numero` y `Número` colapsan al
 * mismo identificador y eso es un error, no dos elementos distintos.
 */

export type NameKind = 'CLASS' | 'ATTRIBUTE';

export interface NormalizedName {
  readonly displayName: string;
  readonly codeName: string;
  readonly databaseName: string;
  /** El nombre visual no sobrevivio intacto a la normalizacion (aviso). */
  readonly wasNormalized: boolean;
  /** Se antepuso el prefijo de escape por chocar con una lista reservada (aviso). */
  readonly wasPrefixed: boolean;
  /** Que lista lo obligo. Vacio si no hubo prefijo. */
  readonly reservedIn: readonly ReservedList[];
}

export type ReservedList = 'JAVA' | 'POSTGRES' | 'GENERATOR';

/** El nombre visual no produce ningun identificador utilizable. */
export class InvalidIdentifierError extends Error {
  constructor(
    readonly displayName: string,
    readonly reason: 'EMPTY' | 'STARTS_WITH_DIGIT',
  ) {
    super(`El nombre «${displayName}» no produce un identificador valido: ${reason}`);
    this.name = 'InvalidIdentifierError';
  }
}

/**
 * Separa un nombre visual en palabras, quitando tildes y cualquier caracter que
 * no sirva en un identificador.
 *
 * `Número de Teléfono` → `['numero', 'de', 'telefono']`
 * `detalle_venta`      → `['detalle', 'venta']`
 * `IDCliente`          → `['id', 'cliente']`
 */
export function toWords(displayName: string): string[] {
  const sinTildes = displayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return (
    sinTildes
      // Un limite de palabra alli donde una minuscula o un digito precede a una
      // mayuscula: `numeroTelefono` y `IDCliente` se parten donde corresponde.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((palabra) => palabra.length > 0)
      .map((palabra) => palabra.toLowerCase())
  );
}

/**
 * Conectores que no aportan al identificador tecnico.
 *
 * RTM-02 lo exige con sus dos ejemplos: `Detalle de Venta` produce
 * `DetalleVenta`, no `DetalleDeVenta`, y `Número de Teléfono` produce
 * `numeroTelefono`, no `numeroDeTelefono`.
 *
 * La lista es corta a proposito. Cuanto mas se amplia, mas probable es que
 * mutile un nombre propio; con estas ocho se cubre la construccion habitual del
 * espanol sin inventar semantica.
 */
const CONNECTORS: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'al']);

/**
 * Quita conectores, pero nunca el primero.
 *
 * Proteger la primera palabra evita mutilar nombres que empiezan por conector
 * — «El Alto», «La Paz» — donde el conector si forma parte del nombre.
 */
function dropConnectors(words: readonly string[]): string[] {
  const conservadas = words.filter((palabra, indice) => indice === 0 || !CONNECTORS.has(palabra));
  // Si el nombre era solo conectores a partir del primero, se devuelve el primero.
  return conservadas.length > 0 ? conservadas : [...words];
}

function toPascalCase(words: readonly string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toCamelCase(words: readonly string[]): string {
  const [first, ...rest] = words;
  if (first === undefined) return '';
  return first + toPascalCase(rest);
}

function toSnakeCase(words: readonly string[]): string {
  return words.join('_');
}

/**
 * Deriva los tres nombres de RTM-02.
 *
 * Clases:   `Detalle de Venta`   → `DetalleVenta`   → `detalle_venta`
 * Atributos: `Número de Teléfono` → `numeroTelefono` → `numero_telefono`
 *
 * @throws {InvalidIdentifierError} si el nombre visual no produce identificador.
 */
export function normalizeName(displayName: string, kind: NameKind): NormalizedName {
  const crudas = toWords(displayName);

  if (crudas.length === 0) {
    throw new InvalidIdentifierError(displayName, 'EMPTY');
  }
  // Un identificador no puede empezar por digito en Java ni en PostgreSQL. No se
  // inventa un prefijo: renombrar es decision del usuario, no de la herramienta.
  if (/^[0-9]/.test(crudas[0] as string)) {
    throw new InvalidIdentifierError(displayName, 'STARTS_WITH_DIGIT');
  }

  const words = dropConnectors(crudas);

  // El nombre de codigo antes de cualquier escape. Sirve para distinguir «este
  // nombre cambio al normalizarlo» de «este nombre cambio porque estaba
  // reservado», que son dos avisos distintos y no deben salir los dos a la vez.
  const codeNameBase = kind === 'CLASS' ? toPascalCase(words) : toCamelCase(words);

  let codeName = codeNameBase;
  let databaseName = toSnakeCase(words);

  const reservedIn: ReservedList[] = [];

  // Cada nombre se escapa por su cuenta, contra las listas que le aplican.
  //
  // Prefijar los dos a la vez seria mas simetrico pero contradice RTM-08: el
  // recurso REST se deriva del nombre de codigo justamente para que el prefijo
  // `app_` no se filtre a las URL. La clase `Order` produce la tabla `app_order`
  // y la ruta `/api/order`, no `/api/app-order`.

  // Las reservadas de Java son todas minusculas, asi que solo pueden alcanzar a
  // un nombre de atributo. Un nombre de clase en PascalCase nunca colisiona.
  if (kind === 'ATTRIBUTE' && isJavaReserved(codeName)) {
    reservedIn.push('JAVA');
    codeName = toCamelCase([RESERVED_PREFIX, ...words]);
  }
  if (kind === 'CLASS' && isGeneratorReserved(codeName)) {
    reservedIn.push('GENERATOR');
    codeName = toPascalCase([RESERVED_PREFIX, ...words]);
  }
  if (isPostgresReserved(databaseName)) {
    reservedIn.push('POSTGRES');
    databaseName = toSnakeCase([RESERVED_PREFIX, ...words]);
  }

  return {
    displayName,
    codeName,
    databaseName,
    wasNormalized: displayName !== codeNameBase,
    wasPrefixed: reservedIn.length > 0,
    reservedIn,
  };
}

/**
 * RTM-08: el recurso REST es el nombre tecnico en kebab-case y singular.
 *
 * Se deriva del nombre de codigo y no del de base de datos, para que el prefijo
 * `app_` no se filtre a las URL: `Order` → `order`, no `app-order`.
 */
export function toResourcePath(codeName: string): string {
  return toWords(codeName).join('-');
}

/**
 * RTM-12: nombre de artefacto Maven. `Sistema de Ventas` → `sistema-ventas`.
 *
 * Se deriva del nombre de codigo ya normalizado y no del visual, para que los
 * conectores se caigan igual que en el resto de los identificadores.
 */
export function toArtifactId(displayName: string): string {
  return toWords(normalizeName(displayName, 'CLASS').codeName).join('-');
}

/** RTM-12: segmento de paquete Java. `Sistema de Ventas` → `sistemaventas`. */
export function toPackageSegment(displayName: string): string {
  const segment = toWords(normalizeName(displayName, 'CLASS').codeName).join('');

  // Al pasar a minusculas, `Class` vuelve a ser la palabra reservada `class`.
  // Un identificador valido como clase no es necesariamente valido como paquete.
  return isJavaReserved(segment) ? `${RESERVED_PREFIX}${segment}` : segment;
}
