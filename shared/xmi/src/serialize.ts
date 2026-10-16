import {
  CONCEPTUAL_TYPES,
  type ConceptualType,
  type Multiplicity,
  type SemanticModel,
  type UmlAttribute,
  type UmlClass,
  type UmlRelationship,
  type Layout,
} from '@uml/contracts';

/**
 * Exportacion a XMI 2.1 (RF-050).
 *
 * El caso de uso del docente es abrir el diagrama en Enterprise Architect y
 * hacer alli el diagrama de secuencia sobre clases que ya existen. Por eso
 * exportar es lo que no se sacrifica si hay que recortar.
 *
 * **Que se emite y por que:**
 *
 * - UML 2.1 estandar, sin extensiones propietarias en la estructura. Un archivo
 *   que solo Enterprise Architect entiende no sirve para nada mas, y el estandar
 *   lo lee tambien cualquier otra herramienta.
 * - Los tipos conceptuales se declaran como `uml:PrimitiveType` dentro del
 *   modelo y los atributos los referencian. Es la forma estandar; poner el
 *   nombre del tipo como texto suelto obliga a la herramienta a adivinar.
 * - Las multiplicidades van como `lowerValue` y `upperValue` en los extremos de
 *   la asociacion, que es donde UML las define.
 * - Los identificadores son los nuestros, con un guion bajo delante. Un `xmi:id`
 *   es un ID de XML y no puede empezar por digito, cosa que un UUID hace la
 *   mitad de las veces. Conservarlos es lo que permite el ida y vuelta sin
 *   perder identidad (RF-053).
 *
 * **Lo que va en extensiones**, y por que hay dos:
 *
 * - `UMLFORGE AI`: la marca de atributo unico. UML no tiene forma estandar de
 *   expresar una restriccion de unicidad de columna; `isUnique` existe pero
 *   significa otra cosa —si la coleccion admite repetidos— y usarlo seria mentir
 *   en el archivo.
 * - `Enterprise Architect`: el tipo de cada atributo, repetido en su extensión.
 *   Esta extensión por sí sola no basta para activar el importador nativo de
 *   EA; la descarga de la app usa el perfil de enterprise-architect.ts.
 *
 * Las dos son aditivas: una herramienta que ignore las extensiones se queda con
 * la clase, el atributo, su tipo y su multiplicidad.
 */

export const XMI_ID_PREFIX = '_';

export interface SerializeOptions {
  /** Nombre del paquete que contiene el diagrama. */
  readonly modelName: string;
  /** Se escribe en la documentacion del archivo. */
  readonly exporterVersion?: string;
  readonly layout?: Layout;
}

export function serializeToXmi(model: SemanticModel, options: SerializeOptions): string {
  return serialize(model, options, false);
}

/** XMI 2.5.1 / UML 2.5.1, con los espacios de nombres publicados por OMG. */
export function serializeToXmi251(model: SemanticModel, options: SerializeOptions): string {
  return serialize(model, options, true);
}

function serialize(model: SemanticModel, options: SerializeOptions, modern: boolean): string {
  const idDeTipo = new Map<ConceptualType, string>(
    CONCEPTUAL_TYPES.map((tipo) => [tipo, `${XMI_ID_PREFIX}primitive_${tipo}`]),
  );

  const lineas: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    modern ? '<xmi:XMI' : '<xmi:XMI xmi:version="2.1"',
    `         xmlns:uml="${modern ? 'http://www.omg.org/spec/UML/20161101' : 'http://schema.omg.org/spec/UML/2.1'}"`,
    `         xmlns:xmi="${modern ? 'http://www.omg.org/spec/XMI/20131001' : 'http://schema.omg.org/spec/XMI/2.1'}">`,
    modern
      ? `  <xmi:documentation><exporter>UMLFORGE AI</exporter><exporterVersion>${escapar(options.exporterVersion ?? '1.0')}</exporterVersion></xmi:documentation>`
      : `  <xmi:Documentation exporter="UMLFORGE AI" exporterVersion="${escapar(options.exporterVersion ?? '1.0')}"/>`,
    `  <uml:Model xmi:type="uml:Model" xmi:id="${XMI_ID_PREFIX}model" name="${escapar(options.modelName)}" visibility="public">`,
  ];

  // Declaramos los tipos antes de las clases para facilitar la lectura.
  for (const tipo of CONCEPTUAL_TYPES) {
    lineas.push(
      `    <packagedElement xmi:type="uml:PrimitiveType" xmi:id="${idDeTipo.get(tipo) as string}" name="${tipo}"/>`,
    );
  }

  for (const umlClass of model.classes) {
    lineas.push(
      ...serializarClase(
        umlClass,
        idDeTipo,
        model.relationships.filter(
          (relationship) =>
            relationship.kind === 'GENERALIZATION' && relationship.sourceClassId === umlClass.id,
        ),
      ),
    );
  }

  for (const relationship of model.relationships) {
    if (relationship.kind === 'GENERALIZATION') continue;
    lineas.push(...serializarAsociacion(relationship));
  }

  lineas.push('  </uml:Model>');
  const extension = serializarExtension(model, options.layout);
  lineas.push(
    ...(modern
      ? extension.map((line) => line.replace(/(<\/?xmi:)Extension\b/g, '$1extension'))
      : extension),
  );
  if (!modern) lineas.push(...serializarExtensionEa(model));
  lineas.push('</xmi:XMI>');

  return lineas.join('\n') + '\n';
}

function serializarClase(
  umlClass: UmlClass,
  idDeTipo: ReadonlyMap<ConceptualType, string>,
  generalizations: readonly UmlRelationship[],
): readonly string[] {
  const lineas = [
    `    <packagedElement xmi:type="uml:Class" xmi:id="${xmiId(umlClass.id)}" name="${escapar(umlClass.displayName)}" visibility="public">`,
  ];

  for (const atributo of umlClass.attributes) {
    lineas.push(...serializarAtributo(atributo, idDeTipo));
  }

  for (const relationship of generalizations) {
    lineas.push(
      `      <generalization xmi:type="uml:Generalization" xmi:id="${xmiId(relationship.id)}" general="${xmiId(relationship.targetClassId)}"/>`,
    );
  }

  lineas.push('    </packagedElement>');
  return lineas;
}

function serializarAtributo(
  atributo: UmlAttribute,
  idDeTipo: ReadonlyMap<ConceptualType, string>,
): readonly string[] {
  // `isID` es UML estandar y significa exactamente "esta propiedad forma parte
  // de la identidad de la clase": es la clave primaria, sin inventar nada.
  const marcaDeClave = atributo.primaryKey ? ' isID="true"' : '';
  const idAtributo = xmiId(atributo.id);

  return [
    `      <ownedAttribute xmi:type="uml:Property" xmi:id="${idAtributo}" name="${escapar(atributo.displayName)}" visibility="private"${marcaDeClave}>`,
    `        <type xmi:idref="${idDeTipo.get(atributo.type) as string}"/>`,
    // Un atributo obligatorio tiene cardinalidad minima 1; uno opcional, 0.
    `        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="${idAtributo}_lower" value="${atributo.nullable ? '0' : '1'}"/>`,
    `        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${idAtributo}_upper" value="1"/>`,
    '      </ownedAttribute>',
  ];
}

function serializarAsociacion(relationship: UmlRelationship): readonly string[] {
  const id = xmiId(relationship.id);
  const extremoOrigen = `${id}_src`;
  const extremoDestino = `${id}_tgt`;

  return [
    `    <packagedElement xmi:type="uml:Association" xmi:id="${id}" visibility="public">`,
    `      <memberEnd xmi:idref="${extremoOrigen}"/>`,
    `      <memberEnd xmi:idref="${extremoDestino}"/>`,
    ...extremo({
      id: extremoOrigen,
      nombre: relationship.sourceRoleName ?? '',
      tipo: relationship.sourceClassId,
      asociacion: id,
      multiplicidad: relationship.sourceMultiplicity,
      ...(relationship.kind === 'COMPOSITION'
        ? { aggregation: 'composite' as const }
        : relationship.kind === 'AGGREGATION'
          ? { aggregation: 'shared' as const }
          : {}),
    }),
    ...extremo({
      id: extremoDestino,
      nombre: relationship.targetRoleName ?? '',
      tipo: relationship.targetClassId,
      asociacion: id,
      multiplicidad: relationship.targetMultiplicity,
    }),
    '    </packagedElement>',
  ];
}

function extremo(datos: {
  id: string;
  nombre: string;
  tipo: string;
  asociacion: string;
  multiplicidad: Multiplicity;
  aggregation?: 'shared' | 'composite';
}): readonly string[] {
  const { lower, upper } = limites(datos.multiplicidad);

  return [
    `      <ownedEnd xmi:type="uml:Property" xmi:id="${datos.id}" name="${escapar(datos.nombre)}" visibility="public" association="${datos.asociacion}"${datos.aggregation === undefined ? '' : ` aggregation="${datos.aggregation}"`}>`,
    `        <type xmi:idref="${xmiId(datos.tipo)}"/>`,
    `        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="${datos.id}_lower" value="${lower}"/>`,
    `        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${datos.id}_upper" value="${upper}"/>`,
    '      </ownedEnd>',
  ];
}

/** RM-04: las cuatro multiplicidades soportadas, en limites UML. */
export function limites(multiplicidad: Multiplicity): { lower: string; upper: string } {
  switch (multiplicidad) {
    case '1':
      return { lower: '1', upper: '1' };
    case '0..1':
      return { lower: '0', upper: '1' };
    case '0..*':
      return { lower: '0', upper: '*' };
    case '1..*':
      return { lower: '1', upper: '*' };
  }
}

/**
 * Lo que UML no sabe expresar.
 *
 * Solo la marca de unicidad. Va aparte y con nuestro nombre encima para que
 * quede claro que es nuestra, no una interpretacion del estandar.
 */
function serializarExtension(model: SemanticModel, layout?: Layout): readonly string[] {
  const unicos = model.classes.flatMap((umlClass) =>
    umlClass.attributes.filter((atributo) => atributo.unique).map((atributo) => atributo.id),
  );

  if (unicos.length === 0 && layout === undefined) return [];

  return [
    `  <xmi:Extension extender="${EXTENDER_PROPIO}">`,
    '    <uniqueAttributes>',
    ...unicos.map((id) => `      <attribute xmi:idref="${xmiId(id)}"/>`),
    '    </uniqueAttributes>',
    '    <layout>',
    ...model.classes.flatMap((c) => {
      const position = layout?.positions[c.id],
        size = layout?.sizes[c.id];
      return position === undefined
        ? []
        : [
            `      <node xmi:idref="${xmiId(c.id)}" x="${position.x}" y="${position.y}"${size === undefined ? '' : ` width="${size.width}" height="${size.height}"`}/>`,
          ];
    }),
    '    </layout>',
    '  </xmi:Extension>',
  ];
}

/** El nombre que Enterprise Architect pone en su propia extension. */
export const EXTENDER_EA = 'Enterprise Architect';
export const EXTENDER_PROPIO = 'UMLFORGE AI';

/**
 * El tipo de cada atributo, otra vez, en el formato nativo de Enterprise
 * Architect.
 *
 * Añade properties.type como respaldo a la referencia UML estándar. La prueba
 * real de importación mostró que EA puede ignorar la extensión si la cabecera
 * no activa su importador nativo. Para descargar un archivo dirigido a EA se
 * usa serializeToEnterpriseArchitect, que completa ese perfil.
 */
function serializarExtensionEa(model: SemanticModel): readonly string[] {
  if (model.classes.length === 0) return [];

  const lineas = [`  <xmi:Extension extender="${EXTENDER_EA}">`, '    <elements>'];

  for (const umlClass of model.classes) {
    lineas.push(
      `      <element xmi:idref="${xmiId(umlClass.id)}" xmi:type="uml:Class" name="${escapar(umlClass.displayName)}" scope="public">`,
      '        <attributes>',
    );

    for (const atributo of umlClass.attributes) {
      const { lower, upper } = atributo.nullable
        ? { lower: '0', upper: '1' }
        : { lower: '1', upper: '1' };

      lineas.push(
        `          <attribute xmi:idref="${xmiId(atributo.id)}" name="${escapar(atributo.displayName)}" scope="Private">`,
        `            <bounds lower="${lower}" upper="${upper}"/>`,
        `            <properties type="${atributo.type}" collection="false" duplicates="0" changeability="changeable"/>`,
        '          </attribute>',
      );
    }

    lineas.push('        </attributes>', '      </element>');
  }

  lineas.push('    </elements>', '  </xmi:Extension>');
  return lineas;
}

/**
 * Un `xmi:id` es un ID de XML: no puede empezar por digito, y un UUID lo hace
 * la mitad de las veces. El prefijo se quita al importar.
 */
export function xmiId(id: string): string {
  return `${XMI_ID_PREFIX}${id}`;
}

export function fromXmiId(id: string): string {
  if (/^EAID_[0-9a-f]{8}(?:_[0-9a-f]{4}){3}_[0-9a-f]{12}$/i.test(id)) {
    return id.slice(5).replaceAll('_', '-').toLowerCase();
  }
  return id.startsWith(XMI_ID_PREFIX) ? id.slice(XMI_ID_PREFIX.length) : id;
}

function escapar(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
