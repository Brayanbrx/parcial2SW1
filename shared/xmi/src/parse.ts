import {
  CONCEPTUAL_TYPES,
  type ConceptualType,
  type Multiplicity,
  type RelationshipKind,
  type Position,
  type Size,
  MIN_CLASS_WIDTH,
  MIN_CLASS_HEIGHT,
} from '@uml/contracts';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fromXmiId } from './serialize.js';

/**
 * Importacion de XMI (RF-051 y RF-052).
 *
 * **Lo que este parser sabe y lo que no.**
 *
 * Lee XMI 2.1 con UML 2.x, que es lo que exporta Enterprise Architect 15 y lo
 * que emite nuestro propio serializador. La muestra real de la instalación
 * está en fixtures/xmi/architect-practica1.xmi; contiene tipos en extensiones
 * y extremos de asociaciones tanto en la asociación como en sus clases.
 *
 * De ahi tres decisiones:
 *
 * 1. Acepta el tipo de un atributo escrito de las tres formas que se ven en la
 *    practica: referencia a un `PrimitiveType`, atributo `type` con el nombre, o
 *    un identificador al estilo `EAJava_String`.
 * 2. Lo que no entiende lo **reporta**, no lo descarta en silencio. Un modelo
 *    importado al que le faltan la mitad de los atributos sin decirlo es peor
 *    que un error.
 * 3. Nunca aplica nada: produce un candidato que pasa por vista previa y
 *    correccion, igual que la importacion por fotografia (CA-042.1).
 *
 * El resultado se valida contra las reglas del dominio antes de aplicarse
 * (RF-052), como cualquier otro lote.
 */

export interface XmiAttribute {
  readonly xmiId: string | null;
  readonly name: string;
  readonly type: ConceptualType;
  readonly primaryKey: boolean;
  readonly nullable: boolean;
  readonly unique: boolean;
}

export interface XmiClass {
  readonly xmiId: string | null;
  readonly name: string;
  readonly attributes: readonly XmiAttribute[];
  readonly position?: Position;
  readonly size?: Size;
}

export interface XmiRelationship {
  readonly xmiId: string | null;
  readonly kind?: RelationshipKind;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourceMultiplicity: Multiplicity;
  readonly targetMultiplicity: Multiplicity;
  readonly sourceRole: string | null;
  readonly targetRole: string | null;
}

/** Lo que el parser no supo traducir, para que el usuario lo vea. */
export interface XmiWarning {
  readonly element: string;
  readonly reason: string;
}

export interface XmiImport {
  readonly modelName: string | null;
  readonly classes: readonly XmiClass[];
  readonly relationships: readonly XmiRelationship[];
  readonly warnings: readonly XmiWarning[];
}

export class XmiParseError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'XmiParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Un solo elemento y una lista de uno tienen que llegar igual: sin esto, un
  // diagrama con una sola clase se parsearia distinto que uno con dos.
  isArray: (nombre) =>
    [
      'packagedElement',
      'ownedAttribute',
      'ownedEnd',
      'memberEnd',
      'attribute',
      'generalization',
    ].includes(nombre),
  parseAttributeValue: false,
  trimValues: true,
});

type Nodo = Record<string, unknown>;

export function parseXmi(xml: string): XmiImport {
  // El parser tolera documentos truncados si no se pide validación explícita.
  // Un modelo parcial nunca debe convertirse en un candidato de reemplazo.
  if (XMLValidator.validate(xml) !== true) {
    throw new XmiParseError('El archivo no es XML valido: está incompleto o mal formado.');
  }
  let documento: Nodo;
  try {
    documento = parser.parse(xml) as Nodo;
  } catch (error) {
    throw new XmiParseError('El archivo no es XML valido.', { cause: error });
  }

  const raiz = buscarModelo(documento);
  if (raiz === undefined) {
    throw new XmiParseError(
      'No se encontro ningun modelo UML en el archivo. ' +
        '¿Se exporto como XMI 2.1 o 2.5.1 y no como el formato nativo de la herramienta?',
    );
  }

  const warnings: XmiWarning[] = [];
  const extensiones = buscarExtensiones(documento);
  const geometria = leerGeometria(extensiones);
  const elementos = normalizarClasesAsociativas(recolectar(raiz), extensiones, warnings);

  const primitivos = new Map<string, ConceptualType>();
  const tiposDeclarados = [
    ...elementos,
    ...buscarExtensiones(documento).flatMap((extension) =>
      recolectar((extension['primitivetypes'] as Nodo | undefined) ?? {}),
    ),
  ];
  for (const elemento of tiposDeclarados) {
    if (tipoXmi(elemento) !== 'uml:PrimitiveType') continue;
    const id = texto(elemento['@xmi:id']);
    const nombre = texto(elemento['@name']);
    if (id !== null && nombre !== null) {
      const conceptual = tipoConceptual(nombre);
      if (conceptual !== null) primitivos.set(id, conceptual);
    }
  }

  const unicos = leerUnicos(documento);
  const claves = leerMarcaAtributos(extensiones, 'umlforge.primaryKey');
  for (const id of leerMarcaAtributos(extensiones, 'umlforge.unique')) unicos.add(id);
  // Los tipos que EA guarda en su extension, por identificador de atributo.
  const tiposDeExtension = leerTiposDeExtension(documento);

  const classes: XmiClass[] = [];
  const porId = new Map<string, string>();
  const proxies = new Set(
    buscarExtensiones(documento).flatMap((extension) =>
      comoLista((extension['elements'] as Nodo | undefined)?.['element'])
        .filter((element) => tipoXmi(element) === 'uml:ProxyConnector')
        .map((element) => texto(element['@xmi:idref'])),
    ),
  );

  for (const elemento of elementos) {
    if (tipoXmi(elemento) !== 'uml:Class') continue;
    if (proxies.has(texto(elemento['@xmi:id']))) {
      warnings.push({
        element: texto(elemento['@name']) ?? 'conector auxiliar',
        reason:
          'Se omitió un ProxyConnector gráfico de Enterprise Architect; no es una clase de datos.',
      });
      continue;
    }

    const nombre = texto(elemento['@name']);
    if (nombre === null) {
      warnings.push({ element: 'clase', reason: 'Una clase no tiene nombre y se omitio.' });
      continue;
    }

    const id = texto(elemento['@xmi:id']);
    if (id !== null) porId.set(id, nombre);

    classes.push({
      xmiId: id === null ? null : fromXmiId(id),
      name: nombre,
      attributes: leerAtributos(
        elemento,
        nombre,
        primitivos,
        unicos,
        claves,
        tiposDeExtension,
        warnings,
      ),
      ...(id === null ? {} : (geometria.get(id) ?? {})),
    });
  }

  const relationships = [
    ...leerAsociaciones(elementos, porId, warnings, extensiones),
    ...leerGeneralizaciones(elementos, porId, warnings),
  ];

  const paquetes = comoLista(raiz['packagedElement']).filter(
    (item) => tipoXmi(item) === 'uml:Package',
  );
  return {
    modelName:
      texto(raiz['@name']) === 'EA_Model' && paquetes.length === 1
        ? texto(paquetes[0]?.['@name'])
        : texto(raiz['@name']),
    classes,
    relationships,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

function leerGeometria(
  extensions: readonly Nodo[],
): Map<string, { position: Position; size?: Size }> {
  const result = new Map<string, { position: Position; size?: Size }>();
  const put = (id: string | null, x: number, y: number, w: number, h: number): void => {
    if (id === null || result.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    result.set(id, {
      position: { x, y },
      ...(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
        ? { size: { width: Math.max(MIN_CLASS_WIDTH, w), height: Math.max(MIN_CLASS_HEIGHT, h) } }
        : {}),
    });
  };
  // La geometría nativa tiene prioridad: refleja también ediciones realizadas en EA.
  for (const extension of extensions)
    for (const diagram of comoLista((extension['diagrams'] as Nodo | undefined)?.['diagram'])) {
      const props = diagram['properties'] as Nodo | undefined;
      const dx = Number(props?.['@umlforgeOffsetX'] ?? 0),
        dy = Number(props?.['@umlforgeOffsetY'] ?? 0);
      for (const node of comoLista((diagram['elements'] as Nodo | undefined)?.['element'])) {
        const geometry = texto(node['@geometry']);
        if (geometry === null || !geometry.includes('Left=')) continue;
        const values = Object.fromEntries(
          geometry
            .split(';')
            .filter(Boolean)
            .map((pair) => pair.split('=')),
        );
        const x = Number(values['Left']),
          y = Number(values['Top']);
        put(
          texto(node['@subject']),
          x - dx,
          y - dy,
          Number(values['Right']) - x,
          Number(values['Bottom']) - y,
        );
      }
    }
  for (const extension of extensions)
    for (const node of comoLista((extension['layout'] as Nodo | undefined)?.['node'])) {
      put(
        texto(node['@xmi:idref']),
        Number(node['@x']),
        Number(node['@y']),
        Number(node['@width']),
        Number(node['@height']),
      );
    }
  return result;
}

/**
 * Busca el `uml:Model` sin depender de la ruta exacta.
 *
 * Distintas herramientas lo cuelgan de sitios distintos —bajo `xmi:XMI`, en la
 * raiz, dentro de otro paquete— y fijar una ruta seria apostar por una de ellas.
 */
function buscarModelo(nodo: unknown): Nodo | undefined {
  if (typeof nodo !== 'object' || nodo === null) return undefined;

  for (const [clave, valor] of Object.entries(nodo as Nodo)) {
    if (clave === 'uml:Model' || clave === 'Model') {
      return (Array.isArray(valor) ? valor[0] : valor) as Nodo;
    }

    for (const hijo of Array.isArray(valor) ? valor : [valor]) {
      const encontrado = buscarModelo(hijo);
      if (encontrado !== undefined) return encontrado;
    }
  }
  return undefined;
}

/** Todos los `packagedElement` del arbol, a cualquier profundidad. */
function recolectar(nodo: Nodo): readonly Nodo[] {
  const encontrados: Nodo[] = [];
  const pendientes: Nodo[] = [nodo];

  while (pendientes.length > 0) {
    const actual = pendientes.pop() as Nodo;
    const hijos = actual['packagedElement'];

    for (const hijo of Array.isArray(hijos) ? hijos : hijos === undefined ? [] : [hijos]) {
      const elemento = hijo as Nodo;
      encontrados.push(elemento);
      pendientes.push(elemento);
    }
  }

  return encontrados;
}

function leerAtributos(
  clase: Nodo,
  nombreClase: string,
  primitivos: ReadonlyMap<string, ConceptualType>,
  unicos: ReadonlySet<string>,
  claves: ReadonlySet<string>,
  tiposDeExtension: ReadonlyMap<string, ConceptualType>,
  warnings: XmiWarning[],
): readonly XmiAttribute[] {
  const crudos = clase['ownedAttribute'];
  const lista = Array.isArray(crudos) ? crudos : crudos === undefined ? [] : [crudos];
  const atributos: XmiAttribute[] = [];

  for (const crudo of lista) {
    const nodo = crudo as Nodo;

    // Un `ownedAttribute` con `association` es el extremo de una relacion, no un
    // atributo de datos. Tratarlo como atributo produciria una columna fantasma.
    if (nodo['@association'] !== undefined) continue;

    const nombre = texto(nodo['@name']);
    if (nombre === null) {
      warnings.push({
        element: nombreClase,
        reason: 'Un atributo sin nombre se omitio.',
      });
      continue;
    }

    const id = texto(nodo['@xmi:id']);

    // La extension va despues del estandar, no antes: si la parte UML dice el
    // tipo, esa manda. La extension solo rescata lo que el estandar no resolvio.
    const tipo =
      resolverTipo(nodo, primitivos) ?? (id === null ? null : (tiposDeExtension.get(id) ?? null));

    if (tipo === null) {
      warnings.push({
        element: `${nombreClase}.${nombre}`,
        reason: `No se reconocio el tipo; se importa como String. Tipos soportados: ${CONCEPTUAL_TYPES.join(', ')}.`,
      });
    }

    atributos.push({
      xmiId: id === null ? null : fromXmiId(id),
      name: nombre,
      type: tipo ?? 'String',
      primaryKey: texto(nodo['@isID']) === 'true' || (id !== null && claves.has(id)),
      nullable: minimo(nodo) === 0,
      unique: id !== null && unicos.has(id),
    });
  }

  return atributos;
}

/**
 * El tipo, escrito de las tres formas que se ven en la practica.
 *
 * Aceptar las tres cuesta veinte lineas y evita que el primer archivo real que
 * llegue no se pueda importar por una diferencia de notacion.
 */
function resolverTipo(
  nodo: Nodo,
  primitivos: ReadonlyMap<string, ConceptualType>,
): ConceptualType | null {
  // 1. Referencia a un tipo declarado en el modelo.
  const referencia = nodo['type'] as Nodo | undefined;
  const idref = referencia === undefined ? null : texto(referencia['@xmi:idref']);
  if (idref !== null) {
    const declarado = primitivos.get(idref);
    if (declarado !== undefined) return declarado;

    // 2. Estilo `EAJava_String`, `EAnone_int`: el tipo va en el propio nombre.
    const sufijo = idref.split('_').at(-1);
    if (sufijo !== undefined) {
      const conceptual = tipoConceptual(sufijo);
      if (conceptual !== null) return conceptual;
    }
  }

  // 3. Referencia externa a la biblioteca de primitivos de UML:
  //    `<type href="http://schema.omg.org/spec/UML/2.1/uml.xml#String"/>`.
  //
  // Es lo que emite una herramienta cuando el tipo no lo declaro ella sino la
  // especificacion, y era el hueco por el que un archivo perfectamente valido
  // llegaba con **todos** los atributos sin tipo: el nombre esta ahi, detras de
  // la almohadilla, y no lo miraba nadie.
  const href = referencia === undefined ? null : texto(referencia['@href']);
  if (href !== null) {
    const nombre = href.split('#').at(-1);
    if (nombre !== undefined) {
      const conceptual = tipoConceptual(nombre);
      if (conceptual !== null) return conceptual;
    }
  }

  // 4. Atributo `type`: puede llevar el nombre del tipo o una referencia a uno
  // declarado. Se prueban los dos, que cuesta una linea.
  const literal = texto(nodo['@type']);
  if (literal === null) return null;

  return primitivos.get(literal) ?? tipoConceptual(literal);
}

function leerAsociaciones(
  elementos: readonly Nodo[],
  nombrePorId: ReadonlyMap<string, string>,
  warnings: XmiWarning[],
  extensiones: readonly Nodo[],
): readonly XmiRelationship[] {
  const relaciones: XmiRelationship[] = [];
  // EA puede guardar un memberEnd como ownedAttribute de la clase opuesta.
  // Resolverlo por ID evita perder composiciones y asociaciones navegables.
  const extremosPorId = indexarExtremos(elementos);
  const conectores = extensiones.flatMap((extension) =>
    comoLista((extension['connectors'] as Nodo | undefined)?.['connector']),
  );

  for (const elemento of elementos) {
    if (tipoXmi(elemento) !== 'uml:Association') continue;

    const miembros = comoLista(elemento['memberEnd']);
    const conector = conectores.find((c) => c['@xmi:idref'] === elemento['@xmi:id']);
    const lista = extremosDe(elemento, extremosPorId).map((extremo) => {
      // EA guarda el diamante en source/target.type de su extensión. Su
      // ownedEnd puede llevar aggregation en el extremo opuesto.
      const id = idDeExtremo(extremo);
      const nativo = [conector?.['source'], conector?.['target']].find(
        (end) => end !== undefined && (end as Nodo)['@xmi:idref'] === id,
      ) as Nodo | undefined;
      const aggregation = texto((nativo?.['type'] as Nodo | undefined)?.['@aggregation']);
      return aggregation === null ? extremo : { ...extremo, '@aggregation': aggregation };
    });

    if (lista.length !== 2 || (miembros.length > 0 && miembros.length !== 2)) {
      // RM-02: una relacion une dos clases. Tres o mas participantes se modelan
      // como entidad, y una asociacion con un solo extremo propio suele venir de
      // una herramienta que guarda el otro dentro de la clase.
      warnings.push({
        element: 'asociacion',
        reason:
          lista.length < 2
            ? 'Una asociacion no declara sus dos extremos y se omitio.'
            : `Una asociacion con ${lista.length} extremos se omitio: solo se soportan relaciones entre dos clases.`,
      });
      continue;
    }

    const nativeSource = texto((conector?.['source'] as Nodo | undefined)?.['@xmi:idref']);
    const nativeTarget = texto((conector?.['target'] as Nodo | undefined)?.['@xmi:idref']);
    // memberEnd en EA enumera destino antes de origen. La extensión define la
    // orientación; en autorrelaciones los IDs src/dst distinguen sus extremos.
    const sourceIndex =
      nativeSource === null
        ? -1
        : lista.findIndex((end) =>
            nativeSource === nativeTarget
              ? /^EAID_src/i.test(texto(end['@xmi:id']) ?? '')
              : idDeExtremo(end) === nativeSource,
          );
    const [primero, segundo] = (sourceIndex === 1 ? [lista[1], lista[0]] : lista) as [Nodo, Nodo];
    const aggregateIndex = [primero, segundo].findIndex((item) => {
      const aggregation = texto(item['@aggregation']);
      return aggregation === 'shared' || aggregation === 'composite';
    });
    // Nuestro modelo coloca el todo en el origen, que es tambien donde se
    // dibuja el diamante. Algunos exportadores escriben ese extremo segundo.
    const [origen, destino] = aggregateIndex === 1 ? [segundo, primero] : [primero, segundo];
    const nombreOrigen = nombreDeExtremo(origen, nombrePorId);
    const nombreDestino = nombreDeExtremo(destino, nombrePorId);

    if (nombreOrigen === null || nombreDestino === null) {
      warnings.push({
        element: 'asociacion',
        reason: 'Una asociacion apunta a una clase que no esta en el archivo y se omitio.',
      });
      continue;
    }

    const id = texto(elemento['@xmi:id']);
    const aggregation = texto(origen['@aggregation']);
    const kind: RelationshipKind | undefined =
      aggregation === 'composite'
        ? 'COMPOSITION'
        : aggregation === 'shared'
          ? 'AGGREGATION'
          : undefined;

    // Cada extremo conserva la multiplicidad de la clase que referencia.
    relaciones.push({
      xmiId: id === null ? null : fromXmiId(id),
      ...(kind === undefined ? {} : { kind }),
      sourceName: nombreOrigen,
      targetName: nombreDestino,
      sourceMultiplicity: multiplicidad(
        origen,
        warnings,
        `${nombreOrigen} → ${nombreDestino}: origen`,
      ),
      targetMultiplicity: multiplicidad(
        destino,
        warnings,
        `${nombreOrigen} → ${nombreDestino}: destino`,
      ),
      sourceRole: texto(origen['@name']),
      targetRole: texto(destino['@name']),
    });
  }

  return relaciones;
}

function leerGeneralizaciones(
  elementos: readonly Nodo[],
  nombrePorId: ReadonlyMap<string, string>,
  warnings: XmiWarning[],
): readonly XmiRelationship[] {
  const relaciones: XmiRelationship[] = [];

  for (const clase of elementos) {
    if (tipoXmi(clase) !== 'uml:Class') continue;
    const sourceName = texto(clase['@name']);
    if (sourceName === null) continue;

    for (const generalization of comoLista(clase['generalization'])) {
      const targetId = texto(generalization['@general']);
      const targetName = targetId === null ? undefined : nombrePorId.get(targetId);
      if (targetName === undefined) {
        warnings.push({
          element: sourceName,
          reason:
            'Una generalizacion apunta a una superclase que no esta en el archivo y se omitio.',
        });
        continue;
      }

      const id = texto(generalization['@xmi:id']);
      relaciones.push({
        xmiId: id === null ? null : fromXmiId(id),
        kind: 'GENERALIZATION',
        sourceName,
        targetName,
        sourceMultiplicity: '1',
        targetMultiplicity: '1',
        sourceRole: null,
        targetRole: null,
      });
    }
  }

  return relaciones;
}

function nombreDeExtremo(extremo: Nodo, nombrePorId: ReadonlyMap<string, string>): string | null {
  const referencia = extremo['type'] as Nodo | undefined;
  const idref = referencia === undefined ? null : texto(referencia['@xmi:idref']);
  if (idref !== null) return nombrePorId.get(idref) ?? null;

  const literal = texto(extremo['@type']);
  return literal === null ? null : (nombrePorId.get(literal) ?? literal);
}

function indexarExtremos(elementos: readonly Nodo[]): ReadonlyMap<string, Nodo> {
  const extremos = new Map<string, Nodo>();
  for (const elemento of elementos) {
    for (const end of [
      ...comoLista(elemento['ownedEnd']),
      ...comoLista(elemento['ownedAttribute']),
    ]) {
      const id = texto(end['@xmi:id']);
      if (id !== null) extremos.set(id, end);
    }
  }
  return extremos;
}

function extremosDe(elemento: Nodo, extremos: ReadonlyMap<string, Nodo>): readonly Nodo[] {
  const miembros = comoLista(elemento['memberEnd']);
  return miembros.length > 0
    ? miembros
        .map((m) => extremos.get(texto(m['@xmi:idref']) ?? ''))
        .filter((e): e is Nodo => e !== undefined)
    : comoLista(elemento['ownedEnd']);
}

function idDeExtremo(extremo: Nodo): string | null {
  return texto((extremo['type'] as Nodo | undefined)?.['@xmi:idref']) ?? texto(extremo['@type']);
}

/** Reifica la asociación como entidad con dos enlaces, antes de resolver nombres.
 * EA puede conectar la AssociationClass a dos ProxyConnector que señalan la
 * asociación real en classifier. No son participantes del dominio.
 */
function normalizarClasesAsociativas(
  elementos: readonly Nodo[],
  extensiones: readonly Nodo[],
  warnings: XmiWarning[],
): readonly Nodo[] {
  if (!elementos.some((e) => tipoXmi(e) === 'uml:AssociationClass')) return elementos;
  const extremos = indexarExtremos(elementos);
  const porId = new Map(elementos.map((e) => [texto(e['@xmi:id']), e]));
  const detalles = extensiones.flatMap((e) =>
    comoLista((e['elements'] as Nodo | undefined)?.['element']),
  );
  const proxies = new Map(
    detalles
      .filter((e) => tipoXmi(e) === 'uml:ProxyConnector')
      .map((e) => [texto(e['@xmi:idref']), texto(e['@classifier'])]),
  );
  const omitidos = new Set<Nodo>();
  const convertidos = new Map<Nodo, Nodo>();
  const enlaces: Nodo[] = [];

  for (const clase of elementos.filter((e) => tipoXmi(e) === 'uml:AssociationClass')) {
    const id = texto(clase['@xmi:id']);
    const nombre = texto(clase['@name']) ?? 'clase asociativa';
    // Incluso si el enlace es inválido, conservar la clase y sus atributos.
    convertidos.set(clase, { ...clase, '@xmi:type': 'uml:Class' });
    let base = clase;
    const propios = extremosDe(clase, extremos);
    const referencias = propios.map((e) => proxies.get(idDeExtremo(e)));
    if (
      propios.length === 2 &&
      referencias[0] !== null &&
      referencias[0] !== undefined &&
      referencias[0] === referencias[1]
    ) {
      base = porId.get(referencias[0]) ?? clase;
    }
    const participantes = extremosDe(base, extremos);
    if (
      id === null ||
      participantes.length !== 2 ||
      (comoLista(base['memberEnd']).length > 0 && comoLista(base['memberEnd']).length !== 2) ||
      participantes.some((e) => {
        const participante = porId.get(idDeExtremo(e));
        return (
          participante === undefined ||
          proxies.has(idDeExtremo(e)) ||
          !['uml:Class', 'uml:AssociationClass'].includes(tipoXmi(participante) ?? '')
        );
      })
    ) {
      warnings.push({
        element: nombre,
        reason:
          'Se conservaron los atributos de la clase asociativa, pero no se pudieron resolver sus dos participantes. Revisa sus enlaces.',
      });
      continue;
    }
    if (base !== clase) omitidos.add(base);
    for (const [index, participante] of participantes.entries()) {
      const opuesto = participantes[1 - index]!;
      const endId = `${id}_participant_${index}`;
      enlaces.push({
        '@xmi:type': 'uml:Association',
        '@xmi:id': endId,
        ownedEnd: [
          {
            ...participante,
            '@xmi:id': `${endId}_entity`,
            '@association': endId,
            '@aggregation': 'none',
            lowerValue: { '@value': '1' },
            upperValue: { '@value': '1' },
          },
          {
            '@xmi:type': 'uml:Property',
            '@xmi:id': `${endId}_link`,
            '@association': endId,
            type: { '@xmi:idref': id },
            lowerValue: opuesto['lowerValue'],
            upperValue: opuesto['upperValue'],
            // Dos participantes de la misma clase necesitan roles distintos.
            ...(idDeExtremo(participante) === idDeExtremo(opuesto)
              ? { '@name': `${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}${index + 1}` }
              : {}),
          },
        ],
      });
    }
    warnings.push({
      element: nombre,
      reason:
        'La clase asociativa se convirtió en una entidad intermedia con sus atributos y dos relaciones a sus participantes.',
    });
  }

  // No fusionar clases por nombre: EA permite una clase vacía homónima aparte.
  // Solo omitirla si no tiene contenido ni referencias semánticas entrantes.
  const referenciados = new Set<string>();
  const visitar = (valor: unknown): void => {
    if (valor === null || typeof valor !== 'object') return;
    for (const [key, child] of Object.entries(valor)) {
      if (['@xmi:idref', '@type', '@general'].includes(key) && typeof child === 'string')
        referenciados.add(child);
      else visitar(child);
    }
  };
  elementos.forEach(visitar);
  for (const clase of elementos) {
    if (tipoXmi(clase) !== 'uml:Class' || referenciados.has(texto(clase['@xmi:id']) ?? ''))
      continue;
    if (
      Object.keys(clase).some(
        (key) => !['@xmi:type', '@xmi:id', '@name', '@visibility'].includes(key),
      )
    )
      continue;
    const detalle = detalles.find((e) => e['@xmi:idref'] === clase['@xmi:id']);
    if (['links', 'attributes', 'operations'].some((key) => typeof detalle?.[key] === 'object'))
      continue;
    if (![...convertidos.keys()].some((c) => c['@name'] === clase['@name'])) continue;
    omitidos.add(clase);
    warnings.push({
      element: texto(clase['@name']) ?? 'clase',
      reason:
        'Se omitió una clase homónima vacía y sin enlaces; se conserva la clase asociativa con sus atributos.',
    });
  }
  // Si hay un homónimo con contenido, mantener ambas identidades y distinguir
  // sus nombres para la propuesta, que referencia clases por nombre.
  const usados = new Set<string>();
  const nombres = new Set(elementos.map((e) => texto(e['@name'])?.toLowerCase()));
  return [
    ...elementos
      .filter((e) => !omitidos.has(e))
      .map((e) => {
        const node = convertidos.get(e) ?? e;
        const nombre = texto(node['@name']);
        if (tipoXmi(node) !== 'uml:Class' || nombre === null || proxies.has(texto(node['@xmi:id'])))
          return node;
        if (!usados.has(nombre.toLowerCase())) {
          usados.add(nombre.toLowerCase());
          return node;
        }
        let index = 2;
        while (nombres.has(`${nombre}_${index}`.toLowerCase())) index++;
        const nuevo = `${nombre}_${index}`;
        nombres.add(nuevo.toLowerCase());
        usados.add(nuevo.toLowerCase());
        warnings.push({
          element: nombre,
          reason: `Se conservó otra clase con el mismo nombre como ${nuevo} para no fusionar sus datos.`,
        });
        return { ...node, '@name': nuevo };
      }),
    ...enlaces,
  ];
}

function leerUnicos(documento: Nodo): Set<string> {
  const unicos = new Set<string>();

  for (const extension of buscarExtensiones(documento)) {
    const bloque = extension['uniqueAttributes'] as Nodo | undefined;
    if (bloque === undefined) continue;

    for (const crudo of comoLista(bloque['attribute'])) {
      const id = texto(crudo['@xmi:idref']);
      if (id !== null) unicos.add(id);
    }
  }

  return unicos;
}

/** Los tagged values nativos sobreviven al intercambio por EA, incluso cuando
 * se descarta la extensión propia de la aplicación. */
function leerMarcaAtributos(extensiones: readonly Nodo[], nombre: string): Set<string> {
  const ids = new Set<string>();
  for (const extension of extensiones) {
    if (texto(extension['@extender']) !== 'Enterprise Architect') continue;
    for (const element of comoLista((extension['elements'] as Nodo | undefined)?.['element'])) {
      for (const attr of comoLista((element['attributes'] as Nodo | undefined)?.['attribute'])) {
        const id = texto(attr['@xmi:idref']) ?? texto(attr['@xmi:id']);
        const tags = comoLista((attr['tags'] as Nodo | undefined)?.['tag']);
        if (
          id !== null &&
          tags.some((tag) => texto(tag['@name']) === nombre && texto(tag['@value']) === 'true')
        )
          ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Todas las extensiones del documento, no la primera.
 *
 * Un archivo puede traer varias: la nuestra con las marcas de unicidad y la de
 * Enterprise Architect con los tipos. Quedarse con la primera hacia que el
 * significado dependiera del orden en que aparecen, que es una forma silenciosa
 * de perder datos.
 */
function buscarExtensiones(nodo: unknown, encontradas: Nodo[] = []): readonly Nodo[] {
  if (typeof nodo !== 'object' || nodo === null) return encontradas;

  for (const [clave, valor] of Object.entries(nodo as Nodo)) {
    if (['xmi:Extension', 'Extension', 'xmi:extension', 'extension'].includes(clave)) {
      for (const item of Array.isArray(valor) ? valor : [valor]) {
        encontradas.push(item as Nodo);
      }
      continue;
    }
    for (const hijo of Array.isArray(valor) ? valor : [valor]) {
      buscarExtensiones(hijo, encontradas);
    }
  }
  return encontradas;
}

/**
 * Tipos de atributo declarados en la extension de Enterprise Architect.
 *
 * EA guarda ahi el tipo como texto —`<properties type="String"/>`— ademas de la
 * referencia estandar. Leerlo es lo que permite importar un archivo exportado
 * por EA con los tipos puestos, en lugar de convertirlo todo a String y avisar.
 */
function leerTiposDeExtension(documento: Nodo): ReadonlyMap<string, ConceptualType> {
  const tipos = new Map<string, ConceptualType>();

  for (const extension of buscarExtensiones(documento)) {
    for (const elemento of comoLista((extension['elements'] as Nodo | undefined)?.['element'])) {
      for (const atributo of comoLista(
        (elemento['attributes'] as Nodo | undefined)?.['attribute'],
      )) {
        const id = texto(atributo['@xmi:idref']) ?? texto(atributo['@xmi:id']);
        const propiedades = atributo['properties'] as Nodo | undefined;
        const nombre = propiedades === undefined ? null : texto(propiedades['@type']);
        if (id === null || nombre === null) continue;

        const conceptual = tipoConceptual(nombre);
        if (conceptual !== null) tipos.set(id, conceptual);
      }
    }
  }

  return tipos;
}

function comoLista(valor: unknown): readonly Nodo[] {
  if (valor === undefined || valor === null) return [];
  return (Array.isArray(valor) ? valor : [valor]) as Nodo[];
}

// ---------------------------------------------------------------------------
// Lectura de valores
// ---------------------------------------------------------------------------

function tipoXmi(nodo: Nodo): string | null {
  return texto(nodo['@xmi:type']) ?? texto(nodo['@type']);
}

function multiplicidad(extremo: Nodo, warnings: XmiWarning[], element: string): Multiplicity {
  const inferior = minimo(extremo);
  const lower = valorLimite(extremo['lowerValue']) ?? '1';
  const upper = valorLimite(extremo['upperValue']) ?? '1';
  const muchos = maximo(extremo) === '*' || Number(upper) > 1;
  const result: Multiplicity = muchos
    ? inferior === 0
      ? '0..*'
      : '1..*'
    : inferior === 0
      ? '0..1'
      : '1';
  if (!['0', '1'].includes(lower) || !['1', '*', '-1'].includes(upper)) {
    warnings.push({
      element,
      reason: `La multiplicidad ${lower}..${upper} no se representa exactamente. Se importa como ${result}; revisa este extremo antes de aplicar.`,
    });
  }
  return result;
}

function minimo(nodo: Nodo): number {
  const valor = valorLimite(nodo['lowerValue']);
  // Sin `lowerValue` explicito, UML asume 1. Es lo que hace la mayoria de
  // herramientas al exportar un atributo obligatorio.
  return valor === null ? 1 : Number(valor) === 0 ? 0 : 1;
}

function maximo(nodo: Nodo): string {
  const valor = valorLimite(nodo['upperValue']);
  if (valor === null) return '1';
  return valor === '*' || valor === '-1' ? '*' : '1';
}

function valorLimite(nodo: unknown): string | null {
  if (typeof nodo !== 'object' || nodo === null) return null;
  return texto((nodo as Nodo)['@value']);
}

function tipoConceptual(nombre: string): ConceptualType | null {
  const buscado = nombre.trim().toLowerCase();

  const directo = CONCEPTUAL_TYPES.find((tipo) => tipo.toLowerCase() === buscado);
  if (directo !== undefined) return directo;

  // Nombres que las herramientas usan para lo mismo. La lista es corta a
  // proposito: adivinar de mas produce un modelo que parece correcto y no lo es.
  //
  // `real` y `unlimitednatural` estan porque son **primitivos de la propia
  // especificacion UML**: es lo que hay detras de un `href` a `uml.xml`, asi que
  // no son una adivinanza sino la otra mitad de esa notacion.
  const equivalencias: Record<string, ConceptualType> = {
    real: 'Decimal',
    unlimitednatural: 'Integer',
    int: 'Integer',
    integer: 'Integer',
    bigint: 'Long',
    long: 'Long',
    varchar: 'String',
    text: 'String',
    char: 'String',
    double: 'Decimal',
    float: 'Decimal',
    decimal: 'Decimal',
    numeric: 'Decimal',
    money: 'Decimal',
    bool: 'Boolean',
    boolean: 'Boolean',
    date: 'Date',
    datetime: 'DateTime',
    timestamp: 'DateTime',
    uuid: 'UUID',
    guid: 'UUID',
  };

  return equivalencias[buscado] ?? null;
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio;
}
