import type { SemanticModel } from '@uml/contracts';

/**
 * Modelo sintetico del tamano que exige RNF-03.
 *
 * El banco T01-T07 existe para comprobar que el generador traduce **bien**: cada
 * modelo aisla una regla —clave compuesta, nombre reservado, muchos a muchos— y
 * por eso son pequenos, de tres a cinco clases. Ninguno se acerca a las treinta
 * clases, cien atributos y cuarenta relaciones que RNF-03 exige soportar con
 * fluidez, asi que el tamano nunca se habia probado.
 *
 * Este generador no sustituye al banco: no comprueba que la traduccion sea
 * correcta, solo que a ese tamano nada se cae ni tarda de mas.
 *
 * Solo produce el modelo **semantico**. Las posiciones viven en la capa de
 * disposicion, no aqui: el modelo canonico no sabe donde esta dibujada cada
 * clase, y quien necesite colocarlas las calcula.
 */
export interface LoadModelOptions {
  readonly classes?: number;
  readonly attributes?: number;
  readonly relationships?: number;
  /**
   * Semilla de los identificadores.
   *
   * Deterministas a proposito: un UUID aleatorio haria que la prueba generara
   * un modelo distinto en cada ejecucion, y un fallo intermitente seria
   * imposible de reproducir.
   */
  readonly seed?: string;
}

const TIPOS = ['String', 'Integer', 'Long', 'Decimal', 'Boolean', 'Date'] as const;

export function buildLoadModel(options: LoadModelOptions = {}): SemanticModel {
  const totalClases = options.classes ?? 30;
  const totalAtributos = options.attributes ?? 100;
  const totalRelaciones = options.relationships ?? 40;
  const seed = options.seed ?? 'carga';

  if (totalRelaciones > totalClases * (totalClases - 1)) {
    throw new Error('No caben tantas relaciones sin repetir el par de clases.');
  }

  const classes = Array.from({ length: totalClases }, (_, i) => ({
    id: idDeterminista(`${seed}:clase:${i}`),
    displayName: `Entidad ${i + 1}`,
    codeName: `Entidad${i + 1}`,
    databaseName: `entidad${i + 1}`,
    attributes: [] as SemanticModel['classes'][number]['attributes'][number][],
  }));

  // Los atributos se reparten entre las clases hasta llegar al total pedido: es
  // mas parecido a un diagrama real que cargar todos en una sola clase.
  for (let n = 0; n < totalAtributos; n += 1) {
    const clase = classes[n % totalClases];
    if (clase === undefined) continue;

    const indice = Math.floor(n / totalClases) + 1;
    clase.attributes.push({
      id: idDeterminista(`${seed}:attr:${n}`),
      displayName: `campo ${indice}`,
      codeName: `campo${indice}`,
      databaseName: `campo${indice}`,
      type: TIPOS[n % TIPOS.length] as (typeof TIPOS)[number],
      primaryKey: false,
      nullable: true,
      unique: false,
    });
  }

  // Uno a muchos entre clases distintas. El desplazamiento crece cada vuelta
  // para no repetir el mismo par, que seria un error del modelo y no carga.
  const relationships = Array.from({ length: totalRelaciones }, (_, i) => {
    const origen = i % totalClases;
    const salto = 1 + Math.floor(i / totalClases);
    return {
      id: idDeterminista(`${seed}:rel:${i}`),
      sourceClassId: classes[origen]?.id as string,
      targetClassId: classes[(origen + salto) % totalClases]?.id as string,
      sourceMultiplicity: '1' as const,
      targetMultiplicity: '0..*' as const,
    };
  });

  return { classes, relationships } as SemanticModel;
}

/**
 * Identificador con forma de UUID derivado del texto, sin dependencias.
 *
 * No necesita ser criptografico: solo estable entre ejecuciones y con la forma
 * que exige el esquema.
 */
function idDeterminista(texto: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }

  // `>>> 0` en cada paso: en JavaScript `^` devuelve un entero **con signo**, y
  // sin esto `toString(16)` mete un guion delante que invalida el UUID. La
  // primera version lo tenia y el esquema lo rechazo entero.
  const palabras = [h1, h2, (h1 ^ h2) >>> 0, Math.imul(h1, h2) >>> 0];
  const hex = palabras.map((valor) => valor.toString(16).padStart(8, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
