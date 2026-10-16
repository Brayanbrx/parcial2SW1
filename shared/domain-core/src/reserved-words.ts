/**
 * RTM-03: se validan tres listas.
 *
 * No se usan identificadores entre comillas: dejan la tabla sensible a
 * mayusculas para siempre y complican cualquier consulta manual. Se antepone
 * `app_` (o `app` en camelCase) y se avisa.
 */

/** Prefijo de escape. Uno solo, para que el resultado sea predecible. */
export const RESERVED_PREFIX = 'app';

/**
 * Palabras reservadas de Java (incluidas las literales y las de contexto que el
 * compilador rechaza como identificador).
 *
 * Solo pueden colisionar nombres de atributo: los nombres de clase se emiten en
 * PascalCase y todas las reservadas de Java son minusculas.
 */
export const JAVA_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'void',
  'volatile',
  'while',
  'true',
  'false',
  'null',
  '_',
]);

/**
 * Palabras reservadas de PostgreSQL que no pueden usarse como nombre de tabla o
 * columna sin comillas.
 *
 * Es la lista de reservadas del estandar tal como la aplica PostgreSQL, no el
 * catalogo completo de palabras clave: muchas de esas si son validas como
 * identificador y prefijarlas seria ruido.
 */
export const POSTGRES_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'authorization',
  'binary',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'collation',
  'column',
  'concurrently',
  'constraint',
  'create',
  'cross',
  'current_catalog',
  'current_date',
  'current_role',
  'current_schema',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'freeze',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'ilike',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'isnull',
  'join',
  'lateral',
  'leading',
  'left',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'natural',
  'not',
  'notnull',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'returning',
  'right',
  'select',
  'session_user',
  'similar',
  'some',
  'symmetric',
  'system_user',
  'table',
  'tablesample',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
]);

/**
 * Nombres que el generador emite por su cuenta. Una entidad del usuario que se
 * llame igual sobrescribiria un archivo del proyecto generado.
 */
export const GENERATOR_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'application',
  'applicationtests',
  'globalexceptionhandler',
  'apierror',
  'errorresponse',
  'notfoundexception',
  'openapiconfig',
]);

export function isJavaReserved(name: string): boolean {
  return JAVA_RESERVED_WORDS.has(name.toLowerCase());
}

export function isPostgresReserved(name: string): boolean {
  return POSTGRES_RESERVED_WORDS.has(name.toLowerCase());
}

export function isGeneratorReserved(name: string): boolean {
  return GENERATOR_RESERVED_NAMES.has(name.toLowerCase());
}
