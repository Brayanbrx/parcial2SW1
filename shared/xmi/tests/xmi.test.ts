import type { SemanticModel } from '@uml/contracts';
import { fixture, VALID_FIXTURE_IDS } from '@uml/fixtures';
import { EXTENDER_PROPIO, XmiParseError, parseXmi, serializeToXmi, xmiToProposal } from '@uml/xmi';
import { describe, expect, it } from 'vitest';

/**
 * XMI: exportacion, importacion e ida y vuelta.
 *
 * El ida y vuelta sobre el banco entero es lo que impide que el serializador y
 * el parser se separen: cada uno se puede cambiar, pero no de forma que el otro
 * deje de entenderlo.
 *
 * Lo que **no** prueba nada de esto es que Enterprise Architect 15 abra el
 * archivo. Eso solo lo dice esa instalacion, con un archivo suyo delante.
 */

function exportar(model: SemanticModel, modelName = 'Prueba'): string {
  return serializeToXmi(model, { modelName });
}

describe('integridad XML antes de importar', () => {
  it('avisa al aproximar un intervalo finito y conserva que admite varios elementos', () => {
    const parsed = parseXmi(
      '<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model xmi:type="uml:Model" name="Rango"><packagedElement xmi:type="uml:Class" xmi:id="a" name="Equipo"/><packagedElement xmi:type="uml:Class" xmi:id="b" name="Persona"/><packagedElement xmi:type="uml:Association" xmi:id="r"><ownedEnd type="a"/><ownedEnd type="b"><lowerValue value="2"/><upperValue value="5"/></ownedEnd></packagedElement></uml:Model></xmi:XMI>',
    );
    expect(parsed.relationships[0]?.targetMultiplicity).toBe('1..*');
    expect(parsed.warnings).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('2..5') }),
    ]);
  });

  it.each([
    '<xmi:XMI xmlns:xmi="x" xmlns:uml="u"><uml:Model xmi:type="uml:Model" name="Prueba">',
    '<uml:Model xmlns:uml="u" name="Prueba"></uml:Otro>',
    '<uml:Model xmlns:uml="u" name="Prueba" name="Otro"/>',
  ])('rechaza el documento mal formado sin devolver un modelo parcial: %s', (xml) => {
    expect(() => parseXmi(xml)).toThrow(XmiParseError);
  });
});

describe('exportacion (RF-050)', () => {
  const t01 = fixture('T01').model;
  const xml = exportar(t01, 'Sistema de Ventas');

  it('emite un documento XMI 2.1 con el modelo dentro', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmi:version="2.1"');
    expect(xml).toContain('<uml:Model');
    expect(xml).toContain('name="Sistema de Ventas"');
  });

  it('declara los tipos como primitivos del modelo', () => {
    // Referenciar un tipo declarado es la forma estandar. Poner el nombre suelto
    // obliga a la herramienta que lo lea a adivinar.
    expect(xml).toContain('<packagedElement xmi:type="uml:PrimitiveType"');
    expect(xml).toContain('name="Decimal"');
  });

  it('marca la clave primaria con isID, que es UML estandar', () => {
    // `isID` significa exactamente "esta propiedad forma parte de la identidad
    // de la clase". No hay que inventar un estereotipo.
    expect(xml).toContain('isID="true"');
  });

  it('pone las multiplicidades en los extremos de la asociacion', () => {
    expect(xml).toContain('<packagedElement xmi:type="uml:Association"');
    expect(xml).toContain('<upperValue xmi:type="uml:LiteralUnlimitedNatural"');
    expect(xml).toContain('value="*"');
  });

  it('los identificadores XML no empiezan por digito', () => {
    // Un `xmi:id` es un ID de XML, y un UUID empieza por digito la mitad de las
    // veces. Sin el prefijo el archivo no es XML valido.
    for (const coincidencia of xml.matchAll(/xmi:id="([^"]+)"/g)) {
      expect(coincidencia[1]).toMatch(/^[A-Za-z_]/);
    }
  });

  it('escapa lo que rompe el XML', () => {
    const conAmpersand: SemanticModel = {
      classes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          displayName: 'Ventas & Compras <con> "comillas"',
          codeName: 'VentasCompras',
          databaseName: 'ventas_compras',
          attributes: [],
        },
      ],
      relationships: [],
    };

    const salida = exportar(conAmpersand);
    expect(salida).toContain('&amp;');
    expect(salida).toContain('&lt;');
    expect(salida).toContain('&quot;');
    expect(salida).not.toContain('& C');
  });

  it('lo que UML no sabe decir va en una extension identificada', () => {
    // La unicidad de columna no tiene forma estandar. `isUnique` existe pero
    // significa otra cosa, y usarlo seria mentir en el archivo.
    expect(xml).toContain(`<xmi:Extension extender="${EXTENDER_PROPIO}">`);
    expect(xml).toContain('<uniqueAttributes>');
  });

  it('RNF-05 — exportar dos veces produce lo mismo', () => {
    expect(exportar(t01, 'Sistema de Ventas')).toBe(xml);
  });

  it('conserva composicion, agregacion y generalizacion en notacion XMI estandar', () => {
    const classes: SemanticModel['classes'] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Pedido',
        codeName: 'Pedido',
        databaseName: 'pedido',
        attributes: [],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        displayName: 'Detalle',
        codeName: 'Detalle',
        databaseName: 'detalle',
        attributes: [],
      },
    ];
    const model: SemanticModel = {
      classes,
      relationships: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          kind: 'COMPOSITION',
          sourceClassId: classes[0]!.id,
          targetClassId: classes[1]!.id,
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          kind: 'AGGREGATION',
          sourceClassId: classes[0]!.id,
          targetClassId: classes[1]!.id,
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          kind: 'GENERALIZATION',
          sourceClassId: classes[1]!.id,
          targetClassId: classes[0]!.id,
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
        },
      ],
    };

    const specializedXml = exportar(model);
    expect(specializedXml).toContain('aggregation="composite"');
    expect(specializedXml).toContain('aggregation="shared"');
    expect(specializedXml).toContain('xmi:type="uml:Generalization"');

    const importado = parseXmi(specializedXml);
    expect(importado.warnings).toEqual([]);
    expect(importado.relationships.map((relationship) => relationship.kind).sort()).toEqual([
      'AGGREGATION',
      'COMPOSITION',
      'GENERALIZATION',
    ]);
  });
});

describe('ida y vuelta sobre el banco', () => {
  for (const fixtureId of VALID_FIXTURE_IDS) {
    it(`${fixtureId} sobrevive a exportar e importar`, () => {
      const original = fixture(fixtureId).model;
      const importado = parseXmi(exportar(original, fixture(fixtureId).title));

      expect(importado.warnings).toEqual([]);

      // Las clases, con sus atributos, su tipo y sus marcas.
      expect(importado.classes.map((c) => c.name).sort()).toEqual(
        original.classes.map((c) => c.displayName).sort(),
      );

      for (const umlClass of original.classes) {
        const traida = importado.classes.find((c) => c.name === umlClass.displayName);
        expect(traida?.attributes.map((a) => a.name)).toEqual(
          umlClass.attributes.map((a) => a.displayName),
        );

        for (const atributo of umlClass.attributes) {
          const suyo = traida?.attributes.find((a) => a.name === atributo.displayName);
          expect(suyo?.type).toBe(atributo.type);
          expect(suyo?.primaryKey).toBe(atributo.primaryKey);
          expect(suyo?.nullable).toBe(atributo.nullable);
          expect(suyo?.unique).toBe(atributo.unique);
        }
      }

      // Y las relaciones, con sus dos multiplicidades.
      expect(importado.relationships).toHaveLength(original.relationships.length);
    });
  }

  it('RF-053 — la identidad se conserva', () => {
    // Los identificadores son los nuestros con un prefijo, y el parser lo quita.
    // Es lo que permite reimportar sin que todo se duplique.
    const t01 = fixture('T01').model;
    const importado = parseXmi(exportar(t01));

    expect(importado.classes.map((c) => c.xmiId).sort()).toEqual(
      t01.classes.map((c) => c.id).sort(),
    );
  });

  it('conserva las multiplicidades en el sentido correcto', () => {
    const t01 = fixture('T01').model;
    const importado = parseXmi(exportar(t01));

    // En T01, Cliente 1 — 0..* Venta. Si los extremos se cruzaran, saldria
    // invertido y el generador pondria la clave foranea en la clase equivocada.
    const clienteVenta = importado.relationships.find(
      (rel) => rel.sourceName === 'Cliente' && rel.targetName === 'Venta',
    );

    expect(clienteVenta?.sourceMultiplicity).toBe('1');
    expect(clienteVenta?.targetMultiplicity).toBe('0..*');
  });
});

describe('importacion tolerante (RF-051)', () => {
  it('acepta el tipo escrito al estilo de Enterprise Architect', () => {
    // Es la forma que usa EA en sus exportaciones, y no es la estandar. Aceptar
    // las variantes de notacion cuesta poco y evita que el primer archivo real
    // no se pueda importar por una diferencia de escritura.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="EA_Model">
    <packagedElement xmi:type="uml:Class" xmi:id="EAID_CLI" name="Cliente">
      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_NOM" name="nombre">
        <type xmi:idref="EAJava_String"/>
      </ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_EDA" name="edad" type="int"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

    const importado = parseXmi(xml);

    expect(importado.classes).toHaveLength(1);
    expect(importado.classes[0]?.attributes.map((a) => a.type)).toEqual(['String', 'Integer']);
  });

  it('lee el tipo referenciado a la biblioteca de primitivos de UML', () => {
    // La forma que emite una herramienta cuando el tipo no lo declaro ella sino
    // la especificacion. Era el hueco por el que un archivo perfectamente valido
    // llegaba con **todos** los atributos sin tipo: el nombre esta detras de la
    // almohadilla y no lo miraba nadie, asi que todo entraba como String con un
    // aviso por atributo.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="Modelo">
    <packagedElement xmi:type="uml:Class" xmi:id="C1" name="Usuario">
      <ownedAttribute xmi:type="uml:Property" xmi:id="A1" name="correo">
        <type xmi:type="uml:PrimitiveType" href="http://schema.omg.org/spec/UML/2.1/uml.xml#String"/>
      </ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="A2" name="edad">
        <type xmi:type="uml:PrimitiveType" href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Integer"/>
      </ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="A3" name="saldo">
        <type xmi:type="uml:PrimitiveType" href="pathmap://UML_LIBRARIES/UMLPrimitiveTypes.library.uml#Real"/>
      </ownedAttribute>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

    const importado = parseXmi(xml);

    expect(importado.classes[0]?.attributes.map((atributo) => atributo.type)).toEqual([
      'String',
      'Integer',
      'Decimal',
    ]);
    // Y sin un aviso por atributo, que es lo que se veia en pantalla.
    expect(importado.warnings).toEqual([]);
  });

  it('encuentra el modelo aunque cuelgue de otro sitio', () => {
    const xml = `<?xml version="1.0"?>
<xmi:XMI xmlns:uml="u" xmlns:xmi="x">
  <envoltorio>
    <uml:Model xmi:type="uml:Model" name="Anidado">
      <packagedElement xmi:type="uml:Package" xmi:id="_pkg" name="Dominio">
        <packagedElement xmi:type="uml:Class" xmi:id="_c1" name="Cliente"/>
      </packagedElement>
    </uml:Model>
  </envoltorio>
</xmi:XMI>`;

    const importado = parseXmi(xml);

    expect(importado.modelName).toBe('Anidado');
    expect(importado.classes.map((c) => c.name)).toEqual(['Cliente']);
  });

  it('una sola clase se lee igual que varias', () => {
    // Sin esto, un diagrama de una clase se parsearia distinto que uno de dos.
    const una = parseXmi(
      exportar({
        classes: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            displayName: 'Sola',
            codeName: 'Sola',
            databaseName: 'sola',
            attributes: [],
          },
        ],
        relationships: [],
      }),
    );

    expect(una.classes).toHaveLength(1);
  });

  it('reporta lo que no entiende en lugar de descartarlo en silencio', () => {
    // Un modelo importado al que le faltan la mitad de los atributos sin decirlo
    // es peor que un error.
    const xml = `<?xml version="1.0"?>
<xmi:XMI xmlns:uml="u" xmlns:xmi="x">
  <uml:Model xmi:type="uml:Model" name="Raro">
    <packagedElement xmi:type="uml:Class" xmi:id="_c1" name="Cliente">
      <ownedAttribute xmi:type="uml:Property" xmi:id="_a1" name="foto" type="Blob"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="_a2"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

    const importado = parseXmi(xml);

    expect(importado.warnings).toHaveLength(2);
    expect(importado.warnings.map((w) => w.reason).join(' ')).toMatch(/tipo|sin nombre/i);
  });

  it('omite una asociacion con mas de dos extremos y lo dice (RM-02)', () => {
    const xml = `<?xml version="1.0"?>
<xmi:XMI xmlns:uml="u" xmlns:xmi="x">
  <uml:Model xmi:type="uml:Model" name="Ternaria">
    <packagedElement xmi:type="uml:Class" xmi:id="_a" name="A"/>
    <packagedElement xmi:type="uml:Class" xmi:id="_b" name="B"/>
    <packagedElement xmi:type="uml:Class" xmi:id="_c" name="C"/>
    <packagedElement xmi:type="uml:Association" xmi:id="_r">
      <ownedEnd xmi:type="uml:Property" xmi:id="_e1"><type xmi:idref="_a"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="_e2"><type xmi:idref="_b"/></ownedEnd>
      <ownedEnd xmi:type="uml:Property" xmi:id="_e3"><type xmi:idref="_c"/></ownedEnd>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

    const importado = parseXmi(xml);

    expect(importado.relationships).toHaveLength(0);
    expect(importado.warnings[0]?.reason).toMatch(/3 extremos/);
  });

  it('no confunde el extremo de una relacion con un atributo', () => {
    // Un `ownedAttribute` con `association` es el extremo de una relacion.
    // Tratarlo como atributo produciria una columna fantasma en la tabla.
    const xml = `<?xml version="1.0"?>
<xmi:XMI xmlns:uml="u" xmlns:xmi="x">
  <uml:Model xmi:type="uml:Model" name="Con extremos">
    <packagedElement xmi:type="uml:Class" xmi:id="_c1" name="Venta">
      <ownedAttribute xmi:type="uml:Property" xmi:id="_a1" name="total" type="Decimal"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="_a2" name="cliente" association="_r1"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

    expect(parseXmi(xml).classes[0]?.attributes.map((a) => a.name)).toEqual(['total']);
  });

  it('dice que pasa cuando el archivo no es lo que se esperaba', () => {
    expect(() => parseXmi('<html><body>no soy XMI</body></html>')).toThrow(XmiParseError);
    expect(() => parseXmi('<html>')).toThrow(XmiParseError);

    try {
      parseXmi('<otra-cosa/>');
    } catch (error) {
      // El mensaje sugiere la causa mas probable en lugar de decir solo "fallo".
      expect((error as Error).message).toMatch(/XMI 2\.1/);
    }
  });
});

describe('de importado a propuesta editable', () => {
  it('al fusionar nombres con distinta capitalización dirige los cambios a la clase existente', () => {
    const model = fixture('T01').model;
    const imported = parseXmi(exportar(model));
    const current = {
      ...model,
      classes: model.classes.map((c) => ({
        ...c,
        displayName: c.displayName.toUpperCase(),
        attributes: [],
      })),
      relationships: [],
    };
    const propuesta = xmiToProposal(imported, { mode: 'ADD', current });
    expect(propuesta.operations.some((op) => op.op === 'CREATE_CLASS')).toBe(false);
    for (const op of propuesta.operations) {
      for (const key of ['className', 'fromClass', 'toClass']) {
        if (typeof op[key] === 'string') expect(op[key]).toBe(op[key].toUpperCase());
      }
    }
  });

  it('conserva una segunda relación entre las mismas clases con otro rol', () => {
    const model = fixture('T07R').model;
    const current = {
      ...model,
      relationships: model.relationships.filter((r) => r.sourceRoleName !== 'envio'),
    };
    const propuesta = xmiToProposal(parseXmi(exportar(model)), { mode: 'ADD', current });
    expect(propuesta.operations.filter((op) => op.op === 'CREATE_RELATIONSHIP')).toEqual([
      expect.objectContaining({ fromRole: 'envio' }),
    ]);
  });

  it('deduplica una asociación invertida solo si conserva ambos extremos completos', () => {
    const model = fixture('T07R').model;
    const current = {
      ...model,
      relationships: model.relationships.map((r) => ({
        ...r,
        sourceClassId: r.targetClassId,
        targetClassId: r.sourceClassId,
        sourceMultiplicity: r.targetMultiplicity,
        targetMultiplicity: r.sourceMultiplicity,
        sourceRoleName: r.targetRoleName,
        targetRoleName: r.sourceRoleName,
      })),
    };
    // undefined se omite igual que en un documento serializado.
    const validCurrent = JSON.parse(JSON.stringify(current)) as SemanticModel;
    expect(
      xmiToProposal(parseXmi(exportar(model)), { mode: 'ADD', current: validCurrent }).operations,
    ).toHaveLength(0);
  });

  it('no confunde tipo, cardinalidad ni orientación de una composición', () => {
    const model = fixture('T07R').model;
    const relationship = model.relationships[0]!;
    const single = { ...model, relationships: [relationship] };
    for (const changed of [
      { ...relationship, sourceMultiplicity: '0..1' as const },
      { ...relationship, kind: 'COMPOSITION' as const },
    ]) {
      expect(
        xmiToProposal(parseXmi(exportar({ ...model, relationships: [changed] })), {
          mode: 'ADD',
          current: single,
        }).operations.filter((op) => op.op === 'CREATE_RELATIONSHIP'),
      ).toHaveLength(1);
    }
    const composition = { ...relationship, kind: 'COMPOSITION' as const };
    const reversed = {
      ...composition,
      sourceClassId: composition.targetClassId,
      targetClassId: composition.sourceClassId,
    };
    expect(
      xmiToProposal(parseXmi(exportar({ ...model, relationships: [reversed] })), {
        mode: 'ADD',
        current: { ...model, relationships: [composition] },
      }).operations.filter((op) => op.op === 'CREATE_RELATIONSHIP'),
    ).toHaveLength(1);
  });
  const importado = parseXmi(exportar(fixture('T05').model, 'Cuentas'));
  const vacio: SemanticModel = { classes: [], relationships: [] };

  it('produce operaciones por nombre, como el asistente', () => {
    // El mismo camino: vista previa, correccion, resolucion, validacion, lote.
    const propuesta = xmiToProposal(importado, { mode: 'ADD', current: vacio });

    expect(propuesta.operations.filter((op) => op.op === 'CREATE_CLASS')).toHaveLength(3);
    expect(propuesta.operations.some((op) => op.op === 'CREATE_RELATIONSHIP')).toBe(true);
    expect(JSON.stringify(propuesta)).not.toContain('classId');
  });

  it('RF-044 — en modo de reemplazo borra primero, en el mismo lote', () => {
    const propuesta = xmiToProposal(importado, { mode: 'REPLACE', current: fixture('T01').model });

    // RA-03: si algo del contenido nuevo fuera invalido no se aplica nada, y la
    // pizarra queda como estaba.
    expect(propuesta.operations.slice(0, 4).every((op) => op.op === 'DELETE_CLASS')).toBe(true);
  });

  it('en modo de anadir no recrea lo que ya existe', () => {
    // El usuario esperaba fusionar, no duplicar.
    const conCliente = fixture('T05').model;
    const propuesta = xmiToProposal(importado, { mode: 'ADD', current: conCliente });

    expect(propuesta.operations.filter((op) => op.op === 'CREATE_CLASS')).toHaveLength(0);
    expect(propuesta.operations.filter((op) => op.op === 'ADD_ATTRIBUTE')).toHaveLength(0);
    expect(propuesta.operations.filter((op) => op.op === 'CREATE_RELATIONSHIP')).toHaveLength(0);
    expect(propuesta.skipped?.length).toBeGreaterThan(0);
  });
});

/**
 * El tipo de cada atributo, escrito dos veces a propósito.
 *
 * Un diagrama nuestro abierto en Enterprise Architect 15 mostró los atributos
 * **sin tipo** —`email [0..1]` en lugar de `email: String [0..1]`—: EA no
 * resuelve la referencia a un `uml:PrimitiveType` que no ha creado él. El tipo
 * se emite ahora también en el formato nativo de EA, donde EA lo busca.
 */
describe('tipos de atributo para Enterprise Architect', () => {
  const xmi = exportar(fixture('T01').model, 'Ventas');

  it('la parte estandar sigue diciendo el tipo', () => {
    // Lo que se añadió es aditivo: quien lea solo UML no pierde nada.
    expect(xmi).toContain('<packagedElement xmi:type="uml:PrimitiveType"');
    expect(xmi).toContain('<type xmi:idref="_primitive_String"/>');
  });

  it('la extension de EA repite el tipo como texto', () => {
    expect(xmi).toContain('<xmi:Extension extender="Enterprise Architect">');
    expect(xmi).toContain('<properties type="String"');
    expect(xmi).toContain('<properties type="UUID"');
  });

  it('cada atributo aparece en la extension con su identificador', () => {
    const modelo = fixture('T01').model;
    const atributos = modelo.classes.flatMap((clase) => clase.attributes);

    for (const atributo of atributos) {
      expect(xmi).toContain(`<attribute xmi:idref="_${atributo.id}"`);
    }
  });

  it('las dos extensiones conviven sin pisarse', () => {
    // Antes se leia solo la primera extension del documento, asi que anadir la
    // de EA habria hecho desaparecer las marcas de unicidad segun el orden.
    const conUnicos = exportar(fixture('T02').model, 'Con unicos');
    const leido = parseXmi(conUnicos);
    const original = fixture('T02').model.classes.flatMap((c) =>
      c.attributes.filter((a) => a.unique),
    );

    expect(conUnicos).toContain(`extender="${EXTENDER_PROPIO}"`);
    expect(conUnicos).toContain('extender="Enterprise Architect"');

    const unicosLeidos = leido.classes.flatMap((c) => c.attributes.filter((a) => a.unique));
    expect(unicosLeidos).toHaveLength(original.length);
  });
});

/**
 * Importar un archivo con la forma que produce Enterprise Architect.
 *
 * EA referencia sus tipos con identificadores como `EAJava_String` que no
 * declara en ninguna parte, y guarda el tipo como texto en su extensión. Un
 * archivo así entraba con todo convertido a String y un aviso por atributo.
 */
describe('importar la forma nativa de Enterprise Architect', () => {
  const archivoEa = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1"',
    '         xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">',
    '  <uml:Model xmi:type="uml:Model" xmi:id="EAID_MODEL" name="EA Model">',
    '    <packagedElement xmi:type="uml:Class" xmi:id="EAID_CLI" name="Cliente">',
    '      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_A1" name="id">',
    '        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="L1" value="1"/>',
    '        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="U1" value="1"/>',
    '      </ownedAttribute>',
    '      <ownedAttribute xmi:type="uml:Property" xmi:id="EAID_A2" name="edad">',
    '        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="L2" value="0"/>',
    '        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="U2" value="1"/>',
    '      </ownedAttribute>',
    '    </packagedElement>',
    '  </uml:Model>',
    '  <xmi:Extension extender="Enterprise Architect" extenderID="6.5">',
    '    <elements>',
    '      <element xmi:idref="EAID_CLI" xmi:type="uml:Class" name="Cliente">',
    '        <attributes>',
    '          <attribute xmi:idref="EAID_A1" name="id">',
    '            <properties type="UUID" collection="false"/>',
    '          </attribute>',
    '          <attribute xmi:idref="EAID_A2" name="edad">',
    '            <properties type="Integer" collection="false"/>',
    '          </attribute>',
    '        </attributes>',
    '      </element>',
    '    </elements>',
    '  </xmi:Extension>',
    '</xmi:XMI>',
  ].join('\n');

  it('recupera los tipos de la extension en lugar de convertir todo a String', () => {
    const leido = parseXmi(archivoEa);
    const cliente = leido.classes[0];

    expect(cliente?.attributes.map((a) => [a.name, a.type])).toEqual([
      ['id', 'UUID'],
      ['edad', 'Integer'],
    ]);
  });

  it('y por tanto no avisa de tipos no reconocidos', () => {
    const leido = parseXmi(archivoEa);

    // Antes salia un aviso por atributo: el usuario los veia todos y no sabia
    // que hacer con ellos.
    expect(leido.warnings.filter((w) => w.reason.includes('No se reconocio el tipo'))).toEqual([]);
  });
});
