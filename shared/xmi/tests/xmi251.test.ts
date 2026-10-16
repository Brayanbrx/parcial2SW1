import { expect, it } from 'vitest';
import { fixture } from '@uml/fixtures';
import { parseXmi, serializeToXmi251 } from '@uml/xmi';
import { XMLParser } from 'fast-xml-parser';

it('usa el vocabulario de metadatos del esquema OMG XMI 2.5.1', () => {
  // https://www.omg.org/spec/XMI/20131001/XMI.xsd:
  // La versión se identifica por el namespace, no por xmi:version.
  // documentation usa propiedades hijas y extension empieza con minúscula.
  const xml = serializeToXmi251(fixture('T01').model, { modelName: 'Ventas & compras' });
  const root = new XMLParser({ ignoreAttributes: false }).parse(xml)['xmi:XMI'];
  expect(root['@_xmlns:xmi']).toBe('http://www.omg.org/spec/XMI/20131001');
  expect(root['@_xmlns:uml']).toBe('http://www.omg.org/spec/UML/20161101');
  expect(root['@_xmi:version']).toBeUndefined();
  expect(root['xmi:documentation'].exporter).toBe('UMLFORGE AI');
  expect(root['xmi:extension']['@_extender']).toBe('UMLFORGE AI');
  expect(root['xmi:Documentation']).toBeUndefined();
  expect(root['xmi:Extension']).toBeUndefined();
  expect(parseXmi(xml).modelName).toBe('Ventas & compras');
});

it('lee un modelo UML 2.5.1 sin extensiones de la aplicación', () => {
  const imported =
    parseXmi(`<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20161101">
    <uml:Model xmi:id="model" name="Externo">
      <packagedElement xmi:type="uml:Class" xmi:id="customer" name="Cliente">
        <ownedAttribute xmi:type="uml:Property" xmi:id="name" name="nombre">
          <type href="http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi#String"/>
          <lowerValue xmi:type="uml:LiteralInteger" value="1"/>
          <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
        </ownedAttribute>
      </packagedElement>
    </uml:Model>
  </xmi:XMI>`);
  expect(imported.warnings).toEqual([]);
  expect(imported.classes[0]?.attributes[0]).toMatchObject({
    name: 'nombre',
    type: 'String',
    nullable: false,
  });
});
