import { createHash } from 'node:crypto';
import type { ConceptualType, Layout, SemanticModel, UmlRelationship } from '@uml/contracts';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { serializeToXmi, xmiId, type SerializeOptions } from './serialize.js';

/** Perfil obtenido de fixtures/xmi/architect-practica1.xmi, exportado por EA.
 * Reutiliza la estructura semántica del serializador UML y añade el empaquetado,
 * tipos y diagrama nativos; no cambia nulabilidad, claves ni relaciones.
 */
export interface EnterpriseArchitectOptions extends SerializeOptions {
  readonly boardId?: string;
  readonly layout?: Layout;
}

type XmlElement = { [key: string]: string | XmlElement | XmlElement[] };

const EA_TYPES: Readonly<Record<ConceptualType, string>> = {
  String: 'string',
  Integer: 'int',
  Long: 'long',
  Decimal: 'decimal',
  Boolean: 'boolean',
  Date: 'date',
  DateTime: 'datetime',
  UUID: 'UUID',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
});

export function serializeToEnterpriseArchitect(
  model: SemanticModel,
  options: EnterpriseArchitectOptions,
): string {
  const document = parser.parse(serializeToXmi(model, options)) as XmlElement;
  const root = document['xmi:XMI'] as XmlElement;
  // EA selecciona el importador nativo con esta cabecera. Usar el nombre de la
  // app aquí hace que ignore los tipos y el diagrama de xmi:Extension.
  // Recomendación del equipo de Sparx: forums/smf/index.php?topic=39006.0
  // 6.5 identifica el formato de intercambio; no la versión instalada de EA.
  root['xmi:Documentation'] = {
    '@exporter': 'Enterprise Architect',
    '@exporterVersion': '6.5',
  };
  const umlModel = root['uml:Model'] as XmlElement;
  const elements = list(umlModel['packagedElement']);
  const primitiveTypes = elements.filter((element) => element['@xmi:type'] === 'uml:PrimitiveType');
  const members = elements.filter((element) => element['@xmi:type'] !== 'uml:PrimitiveType');
  const references = new Map<string, string>();

  for (const element of [
    ...model.classes,
    ...model.classes.flatMap((c) => c.attributes),
    ...model.relationships,
  ]) {
    references.set(xmiId(element.id), eaId(element.id));
  }
  for (const relationship of model.relationships) {
    const base = eaId(relationship.id).slice('EAID_'.length);
    references.set(`${xmiId(relationship.id)}_src`, `EAID_src${base}`);
    references.set(`${xmiId(relationship.id)}_tgt`, `EAID_dst${base}`);
  }
  for (const primitive of primitiveTypes) {
    const name = EA_TYPES[primitive['@name'] as ConceptualType];
    references.set(primitive['@xmi:id'] as string, `EAJava_${name}`);
    primitive['@name'] = name;
    primitive['@visibility'] = 'public';
    if (name === 'int')
      primitive['generalization'] = {
        '@xmi:type': 'uml:Generalization',
        '@xmi:id': 'EAJava_int_General',
        general: { '@href': 'http://schema.omg.org/spec/UML/2.1/uml.xml#Integer' },
      };
  }
  rewriteReferences(document, references);
  // EA interpreta el primer memberEnd como destino y el segundo como origen.
  // El orden de ownedEnd y sus propiedades sigue siendo origen/destino.
  for (const member of members) {
    if (member['@xmi:type'] === 'uml:Association') {
      member['memberEnd'] = list(member['memberEnd']).reverse();
    }
  }

  const key = options.boardId ?? options.modelName;
  const packageId = `EAPK_${stableGuid(`package:${key}`)}`;
  const diagramId = `EAID_${stableGuid(`diagram:${key}`)}`;
  delete umlModel['@xmi:id'];
  umlModel['@name'] = 'EA_Model';
  umlModel['packagedElement'] = {
    '@xmi:type': 'uml:Package',
    '@xmi:id': packageId,
    '@name': options.modelName,
    '@visibility': 'public',
    packagedElement: members,
  };

  const extensions = list(root['xmi:Extension']);
  const extension = extensions.find((item) => item['@extender'] === 'Enterprise Architect') ?? {
    '@extender': 'Enterprise Architect',
  };
  // EA 15 procesa el primer bloque de extensión. El bloque nativo debe ir
  // antes de los metadatos propios para que importe diagrama y propiedades.
  root['xmi:Extension'] = [extension, ...extensions.filter((item) => item !== extension)];
  extension['@extenderID'] = '6.5';
  const classExtensions = members.filter((element) => element['@xmi:type'] === 'uml:Class');
  extension['elements'] = {
    element: [
      {
        '@xmi:idref': packageId,
        '@xmi:type': 'uml:Package',
        '@name': options.modelName,
        properties: { '@sType': 'Package', '@scope': 'public' },
      },
    ],
  };
  for (const element of classExtensions) {
    const umlClass = model.classes.find((candidate) => eaId(candidate.id) === element['@xmi:id']);
    if (umlClass === undefined) continue;
    const classElement: XmlElement = {
      '@xmi:idref': element['@xmi:id'] as string,
      '@xmi:type': 'uml:Class',
      '@name': element['@name'] as string,
      '@scope': 'public',
      model: { '@package': packageId, '@ea_eleType': 'element' },
      properties: {
        '@sType': 'Class',
        '@scope': 'public',
        '@isAbstract': 'false',
        '@isActive': 'false',
      },
      code: { '@gentype': 'Java' },
      style: {
        '@appearance': 'BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;BorderStyle=0;',
      },
    };
    const nativeAttributes: XmlElement[] = [];
    for (const [index, attribute] of umlClass.attributes.entries()) {
      const properties: XmlElement = {
        '@type': EA_TYPES[attribute.type],
        '@collection': 'false',
        '@static': '0',
        '@duplicates': '0',
        '@changeability': 'changeable',
      };
      const id = eaId(attribute.id);
      nativeAttributes.push({
        '@xmi:idref': id,
        '@name': attribute.displayName,
        '@scope': 'Private',
        initial: '',
        documentation: '',
        model: { '@ea_guid': `{${id.slice(5).replaceAll('_', '-')}}` },
        properties,
        coords: { '@ordered': '0' },
        containment: { '@containment': 'Not Specified', '@position': String(index) },
        bounds: {
          '@lower': attribute.nullable ? '0' : '1',
          '@upper': '1',
        },
        tags: {
          tag: [
            {
              '@xmi:id': `EAID_${stableGuid(`pk:${attribute.id}`)}`,
              '@name': 'umlforge.primaryKey',
              '@value': String(attribute.primaryKey),
              '@modelElement': id,
            },
            {
              '@xmi:id': `EAID_${stableGuid(`unique:${attribute.id}`)}`,
              '@name': 'umlforge.unique',
              '@value': String(attribute.unique),
              '@modelElement': id,
            },
          ],
        },
      });
    }
    classElement['attributes'] = { attribute: nativeAttributes };
    ((extension['elements'] as XmlElement)['element'] as XmlElement[]).push(classElement);
  }
  extension['connectors'] = {
    connector: model.relationships.map((relationship) => connector(relationship, model)),
  };
  extension['primitivetypes'] = {
    packagedElement: {
      '@xmi:type': 'uml:Package',
      '@xmi:id': 'EAPrimitiveTypesPackage',
      '@name': 'EA_PrimitiveTypes_Package',
      '@visibility': 'public',
      packagedElement: {
        '@xmi:type': 'uml:Package',
        '@xmi:id': 'EAJavaTypesPackage',
        '@name': 'EA_Java_Types_Package',
        '@visibility': 'public',
        packagedElement: primitiveTypes,
      },
    },
  };
  extension['diagrams'] = { diagram: diagram(model, options, packageId, diagramId) };
  // La cabecera sirve de selector de compatibilidad. Conservamos explícito
  // el productor real del archivo, sin alterar el bloque nativo de EA.
  return (builder.build(document) as string).replace(
    '<xmi:XMI',
    '<!-- Generado por UMLFORGE AI; perfil de compatibilidad Enterprise Architect XMI 2.1. -->\n<xmi:XMI',
  );
}

/** EA utiliza EAID_UUID y EAPK_UUID. Los UUID del dominio se conservan. */
function eaId(id: string): string {
  return `EAID_${id.replaceAll('-', '_').toUpperCase()}`;
}

function stableGuid(key: string): string {
  const hex = createHash('sha256').update(`plataforma-uml:${key}`).digest('hex').toUpperCase();
  return `${hex.slice(0, 8)}_${hex.slice(8, 12)}_8${hex.slice(13, 16)}_A${hex.slice(17, 20)}_${hex.slice(20, 32)}`;
}

function list(value: XmlElement[string] | undefined): XmlElement[] {
  return value === undefined || typeof value === 'string'
    ? []
    : Array.isArray(value)
      ? value
      : [value];
}

function rewriteReferences(node: XmlElement, references: ReadonlyMap<string, string>): void {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (['@xmi:id', '@xmi:idref', '@general', '@association', '@type'].includes(key)) {
        node[key] = references.get(value) ?? value;
      }
    } else {
      for (const child of list(value)) rewriteReferences(child, references);
    }
  }
  if (node['@xmi:type'] === 'uml:LiteralUnlimitedNatural') {
    // EA escribe -1 para ilimitado, y LiteralInteger para límites finitos.
    if (node['@value'] === '*') node['@value'] = '-1';
    else node['@xmi:type'] = 'uml:LiteralInteger';
  }
}

function connector(relationship: UmlRelationship, model: SemanticModel): XmlElement {
  const isGeneralization = relationship.kind === 'GENERALIZATION';
  const aggregation =
    relationship.kind === 'COMPOSITION'
      ? 'composite'
      : relationship.kind === 'AGGREGATION'
        ? 'shared'
        : 'none';
  const end = (source: boolean): XmlElement => {
    const classId = source ? relationship.sourceClassId : relationship.targetClassId;
    const role = source ? relationship.sourceRoleName : relationship.targetRoleName;
    return {
      '@xmi:idref': eaId(classId),
      model: {
        '@type': 'Class',
        '@name': model.classes.find((c) => c.id === classId)?.displayName ?? '',
      },
      role: {
        '@visibility': 'Public',
        '@targetScope': 'instance',
        ...(role === undefined ? {} : { '@name': role }),
      },
      type: {
        ...(isGeneralization
          ? {}
          : {
              '@multiplicity': source
                ? relationship.sourceMultiplicity
                : relationship.targetMultiplicity,
            }),
        '@aggregation': source ? aggregation : 'none',
        '@containment': 'Unspecified',
      },
      modifiers: { '@isOrdered': 'false', '@changeable': 'none', '@isNavigable': 'false' },
    };
  };
  return {
    '@xmi:idref': eaId(relationship.id),
    source: end(true),
    target: end(false),
    properties: {
      '@ea_type': isGeneralization
        ? 'Generalization'
        : aggregation === 'none'
          ? 'Association'
          : 'Aggregation',
      ...(aggregation === 'none'
        ? {}
        : { '@subtype': aggregation === 'composite' ? 'Strong' : 'Weak' }),
      '@direction': isGeneralization ? 'Source -> Destination' : 'Unspecified',
    },
    appearance: { '@linemode': '3', '@linecolor': '-1', '@linewidth': '0' },
    ...(isGeneralization
      ? {}
      : {
          labels: {
            '@lb': relationship.sourceMultiplicity,
            '@rb': relationship.targetMultiplicity,
          },
        }),
  };
}

function diagram(
  model: SemanticModel,
  options: EnterpriseArchitectOptions,
  packageId: string,
  diagramId: string,
): XmlElement {
  const columns = Math.max(1, Math.ceil(Math.sqrt(model.classes.length)));
  const rowHeight = Math.max(180, ...model.classes.map((c) => 100 + c.attributes.length * 20));
  const nodes = model.classes.map((c, index) => ({
    id: c.id,
    index,
    position: options.layout?.positions[c.id] ?? {
      x: 20 + (index % columns) * 340,
      y: 20 + Math.floor(index / columns) * rowHeight,
    },
    size: options.layout?.sizes[c.id] ?? {
      width: Math.max(
        240,
        ...c.attributes.map((a) => (a.displayName.length + a.type.length + 4) * 7),
      ),
      height: Math.max(80, 50 + c.attributes.length * 20),
    },
  }));
  // EA no admite posiciones negativas en las cajas del diagrama. Se traslada
  // todo el conjunto conservando las distancias relativas del lienzo.
  const dx = 20 - Math.min(20, ...nodes.map((node) => node.position.x));
  const dy = 20 - Math.min(20, ...nodes.map((node) => node.position.y));
  const duid = new Map(
    nodes.map((node) => [node.id, (node.index + 1).toString(16).padStart(8, '0').toUpperCase()]),
  );
  return {
    '@xmi:id': diagramId,
    model: { '@package': packageId, '@owner': packageId },
    properties: {
      '@name': options.modelName,
      '@type': 'Logical',
      '@umlforgeOffsetX': String(dx),
      '@umlforgeOffsetY': String(dy),
    },
    // Valores de detalle de la muestra real, con nombres sin prefijo de paquete.
    style1: {
      '@value':
        'ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Zoom=100;VisibleAttributeDetail=0;HideAtts=0;HideOps=0;HideParents=0;ConnectorNotation=UML 2.1;SuppressBrackets=0;',
    },
    style2: {
      '@value':
        'HideQuals=1;VisibleAttributeDetail=0;TConnectorNotation=UML 2.1;SuppressBrackets=0;Theme=:119;',
    },
    elements: {
      element: [
        ...nodes.map((node) => {
          const left = Math.round(node.position.x + dx),
            top = Math.round(node.position.y + dy);
          return {
            '@geometry': `Left=${left};Top=${top};Right=${left + Math.round(node.size.width)};Bottom=${top + Math.round(node.size.height)};`,
            '@subject': eaId(node.id),
            '@seqno': String(node.index + 1),
            '@style': `DUID=${duid.get(node.id) as string};`,
          };
        }),
        ...model.relationships.map((r) => ({
          '@geometry': 'SX=0;SY=0;EX=0;EY=0;Path=;',
          '@subject': eaId(r.id),
          '@style': `Mode=3;SOID=${duid.get(r.sourceClassId) as string};EOID=${duid.get(r.targetClassId) as string};Color=-1;LWidth=0;Hidden=0;`,
        })),
      ],
    },
  };
}
