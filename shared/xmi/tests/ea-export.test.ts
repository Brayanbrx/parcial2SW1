import { readFileSync } from 'node:fs';
import { CONCEPTUAL_TYPES, type SemanticModel } from '@uml/contracts';
import { fixture, VALID_FIXTURE_IDS } from '@uml/fixtures';
import {
  EXTENDER_PROPIO,
  parseXmi,
  serializeToEnterpriseArchitect,
  serializeToXmi,
} from '@uml/xmi';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';

const real = new TextDecoder('windows-1252').decode(
  readFileSync(new URL('../../../fixtures/xmi/architect-practica1.xmi', import.meta.url)),
);
const legacy = readFileSync(new URL('./fixtures/app-ejemplo-legacy.xmi', import.meta.url), 'utf8');
const previousExport = readFileSync(
  new URL('./fixtures/app-ea-header-legacy.xmi', import.meta.url),
  'utf8',
);
const returnedByEa = new TextDecoder('windows-1252').decode(
  readFileSync(new URL('./fixtures/ea-roundtrip-missing-types.xmi', import.meta.url)),
);
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  isArray: (name) =>
    ['packagedElement', 'element', 'attribute', 'ownedAttribute', 'xmi:Extension'].includes(name),
});
type Node = { [key: string]: string | Node | Node[] };
function tree(xml: string): Node {
  return (xmlParser.parse(xml) as Node)['xmi:XMI'] as Node;
}
function ea(root: Node): Node {
  return (root['xmi:Extension'] as Node[]).find((n) => n['@extender'] === 'Enterprise Architect')!;
}
function dataTypes(root: Node): Node[] {
  const primitives = ea(root)['primitivetypes'] as Node;
  const outer = (primitives['packagedElement'] as Node[])[0]!;
  return (outer['packagedElement'] as Node[])[0]!['packagedElement'] as Node[];
}

describe('perfil de exportación de Enterprise Architect basado en la muestra real', () => {
  it('activa el importador nativo con la cabecera de EA, aunque cambie la versión de la app', () => {
    const xml = serializeToEnterpriseArchitect(fixture('T01').model, {
      modelName: 'Ejemplo',
      exporterVersion: '99.0',
    });
    expect(tree(xml)['xmi:Documentation']).toEqual(tree(real)['xmi:Documentation']);
    expect((tree(xml)['xmi:Extension'] as Node[])[0]?.['@extender']).toBe('Enterprise Architect');
    const packageNode = (tree(xml)['uml:Model'] as Node)['packagedElement'] as Node[];
    const associations = (packageNode[0]?.['packagedElement'] as Node[]).filter(
      (n) => n['@xmi:type'] === 'uml:Association',
    );
    for (const association of associations) {
      const ends = association['ownedEnd'] as Node[];
      const members = association['memberEnd'] as Node[];
      expect(members[0]?.['@xmi:idref']).toBe(ends[1]?.['@xmi:id']);
      expect(members[1]?.['@xmi:idref']).toBe(ends[0]?.['@xmi:id']);
    }
    expect(xml).toContain(`Generado por ${EXTENDER_PROPIO}`);
    // Este perfil es específico de EA; el serializador genérico conserva su productor.
    expect(
      tree(serializeToXmi(fixture('T01').model, { modelName: 'Ejemplo' }))['xmi:Documentation'],
    ).toEqual({ '@exporter': EXTENDER_PROPIO, '@exporterVersion': '1.0' });
  });

  it('recupera claves y unicidad desde los tagged values nativos de EA', () => {
    const base = fixture('T01').model;
    const model = {
      ...base,
      classes: base.classes.map((c) => ({
        ...c,
        attributes: c.attributes.map((a, i) => ({ ...a, unique: i === 0 })),
      })),
    };
    const xml = serializeToEnterpriseArchitect(model, { modelName: 'Tags' })
      .replace(/ isID="true"/g, '')
      .replace(/<xmi:Extension extender="UMLFORGE AI"[\s\S]*?<\/xmi:Extension>/g, '');
    const actual = parseXmi(xml).classes.flatMap((c) => c.attributes);
    const expected = model.classes.flatMap((c) => c.attributes);
    for (const attr of expected) {
      expect(actual.find((a) => a.xmiId === attr.id)).toMatchObject({
        primaryKey: attr.primaryKey,
        unique: attr.unique,
      });
    }
  });

  it('conserva extremos y roles de asociaciones, diamantes y autorrelaciones en el perfil EA', () => {
    const base = fixture('T01').model;
    const model: SemanticModel = {
      ...base,
      relationships: (
        ['ASSOCIATION', 'COMPOSITION', 'AGGREGATION', 'GENERALIZATION', 'ASSOCIATION'] as const
      ).map((kind, i) => ({
        id: `99999999-2222-4222-8222-${String(i).padStart(12, '0')}`,
        kind,
        sourceClassId: base.classes[0]!.id,
        targetClassId: base.classes[i === 4 ? 0 : 1]!.id,
        sourceMultiplicity: '1',
        targetMultiplicity: kind === 'GENERALIZATION' ? '1' : '0..*',
        ...(kind === 'GENERALIZATION'
          ? {}
          : { sourceRoleName: `origen${i}`, targetRoleName: `destino${i}` }),
      })),
    };
    const actual = parseXmi(serializeToEnterpriseArchitect(model, { modelName: 'Relaciones' }));
    const expected = parseXmi(serializeToXmi(model, { modelName: 'Relaciones' }));
    expect(actual.relationships).toEqual(expected.relationships);
  });

  it('detecta la pérdida real de los 44 tipos al volver de EA; no confunde el fallback String con éxito', () => {
    const original = parseXmi(previousExport);
    const returned = parseXmi(returnedByEa);
    expect(original.warnings).toEqual([]);
    expect(original.classes.flatMap((c) => c.attributes)).toHaveLength(44);
    expect(returned.classes.flatMap((c) => c.attributes)).toHaveLength(44);
    expect(returned.warnings.filter((w) => w.reason.includes('tipo'))).toHaveLength(44);
    // Evidencia cruda: faltan tanto las referencias UML como properties.type.
    expect(returnedByEa).not.toMatch(/<type xmi:idref="EAJava_/);
    expect(returnedByEa).not.toMatch(/<properties type="/);
    // La muestra se exporto antes del cambio de marca y esta emparejada con el
    // archivo que devolvio Enterprise Architect: regenerarla romperia el par.
    // Lo que importa aqui es que salio de esta herramienta, no como se llamaba.
    expect((tree(previousExport)['xmi:Documentation'] as Node)['@exporter']).toBe('Plataforma UML');
  });

  for (const id of VALID_FIXTURE_IDS) {
    it(`${id}: conserva modelo, tipos, marcas, extremos e identidad en ida y vuelta`, () => {
      const model = fixture(id).model;
      const xml = serializeToEnterpriseArchitect(model, { modelName: fixture(id).title });
      expect(XMLValidator.validate(xml)).toBe(true);
      const parsed = parseXmi(xml);
      expect(parsed.classes.every((c) => c.position !== undefined && c.size !== undefined)).toBe(
        true,
      );
      expect({
        ...parsed,
        classes: parsed.classes.map(
          ({ position: _position, size: _size, ...semantic }) => semantic,
        ),
      }).toEqual(parseXmi(serializeToXmi(model, { modelName: fixture(id).title })));
      // El importador nativo lee el orden de atributos en containment.position.
      for (const cls of (ea(tree(xml))['elements'] as Node)['element'] as Node[]) {
        if (cls['@xmi:type'] !== 'uml:Class') continue;
        const attributes = (cls['attributes'] as Node)['attribute'] as Node[] | undefined;
        for (const [index, attr] of (attributes ?? []).entries()) {
          expect((attr['containment'] as Node)['@position']).toBe(String(index));
          expect((attr['properties'] as Node)['@type']).toBeTruthy();
        }
      }
      // Cada referencia semántica o visual debe resolver a una declaración.
      const ids = [...xml.matchAll(/xmi:id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const reference of xml.matchAll(
        /(?:xmi:idref|subject|package|owner|general|association)="([^"]+)"/g,
      ))
        expect(ids).toContain(reference[1]);
    });
  }

  it('declara los tipos en la misma jerarquía y con las referencias de la muestra de EA', () => {
    const types = dataTypes(tree(real));
    const generated = dataTypes(
      tree(serializeToEnterpriseArchitect(fixture('T01').model, { modelName: 'Ejemplo' })),
    );
    for (const actual of types) {
      expect(generated).toContainEqual(
        expect.objectContaining({
          '@xmi:type': actual['@xmi:type'],
          '@xmi:id': actual['@xmi:id'],
          '@name': actual['@name'],
        }),
      );
    }
  });

  it('mantiene los ocho tipos conceptuales, incluidos Decimal, DateTime y UUID', () => {
    const base = fixture('T01').model.classes[0]!;
    const model: SemanticModel = {
      classes: [
        {
          ...base,
          attributes: CONCEPTUAL_TYPES.map((type, index) => ({
            ...base.attributes[0]!,
            id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
            displayName: `dato${index}`,
            type,
            nullable: index % 2 === 0,
          })),
        },
      ],
      relationships: [],
    };
    expect(
      parseXmi(
        serializeToEnterpriseArchitect(model, { modelName: 'Tipos' }),
      ).classes[0]?.attributes.map((a) => a.type),
    ).toEqual(CONCEPTUAL_TYPES);
  });

  it('exporta posiciones, tamaños y opciones de detalle en un diagrama Logical como EA', () => {
    const model = fixture('T01').model;
    const id = model.classes[0]!.id;
    const options = {
      modelName: 'Diagrama',
      boardId: '22222222-2222-4222-8222-222222222222',
      layout: {
        positions: { [id]: { x: 123, y: 456 } },
        sizes: { [id]: { width: 300, height: 200 } },
      },
    };
    const xml = serializeToEnterpriseArchitect(model, options);
    expect(xml).toContain('Left=123;Top=456;Right=423;Bottom=656;');
    expect(xml).toContain('VisibleAttributeDetail=0;');
    expect(xml).toContain('type="Logical"');
    expect(xml).toContain('name="Diagrama"');
    expect(serializeToEnterpriseArchitect(model, options)).toBe(xml);
    const other = serializeToEnterpriseArchitect(model, {
      ...options,
      boardId: '33333333-3333-4333-8333-333333333333',
    });
    expect(other.match(/<diagram xmi:id="([^"]+)"/)?.[1]).not.toBe(
      xml.match(/<diagram xmi:id="([^"]+)"/)?.[1],
    );
  });

  it('admite el modelo vacío y escapa nombres sin romper el XML', () => {
    const xml = serializeToEnterpriseArchitect(
      { classes: [], relationships: [] },
      { modelName: 'Árbol & "Ventas" <2026>' },
    );
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parseXmi(xml).modelName).toBe('Árbol & "Ventas" <2026>');
    expect(parseXmi(xml).classes).toEqual([]);
  });

  it('la muestra de la app contiene 11 clases, 44 atributos y 12 relaciones; sus tipos no están vacíos', () => {
    const imported = parseXmi(legacy);
    expect(imported.classes).toHaveLength(11);
    expect(imported.classes.flatMap((c) => c.attributes)).toHaveLength(44);
    expect(imported.relationships).toHaveLength(12);
    expect(imported.warnings).toEqual([]);
  });

  it('resuelve un memberEnd guardado como ownedAttribute, sin convertirlo en atributo de datos', () => {
    const xml = `<xmi:XMI xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1"><uml:Model name="Navegable">
      <packagedElement xmi:type="uml:Class" xmi:id="A" name="Pedido"><ownedAttribute xmi:type="uml:Property" xmi:id="endB" association="rel"><type xmi:idref="B"/><lowerValue value="0"/><upperValue value="-1"/></ownedAttribute></packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="B" name="Detalle"/>
      <packagedElement xmi:type="uml:Association" xmi:id="rel"><memberEnd xmi:idref="endB"/><memberEnd xmi:idref="endA"/><ownedEnd xmi:type="uml:Property" xmi:id="endA" aggregation="composite"><type xmi:idref="A"/></ownedEnd></packagedElement>
    </uml:Model></xmi:XMI>`;
    const imported = parseXmi(xml);
    expect(imported.warnings).toEqual([]);
    expect(imported.classes.flatMap((c) => c.attributes)).toEqual([]);
    expect(imported.relationships).toEqual([
      expect.objectContaining({
        kind: 'COMPOSITION',
        sourceName: 'Pedido',
        targetName: 'Detalle',
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
      }),
    ]);
  });
});
