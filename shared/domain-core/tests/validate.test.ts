import { describe, expect, it } from 'vitest';
import type { SemanticModel, UmlClass, UmlRelationship, ValidationCode } from '@uml/contracts';
import { normalizeName, validateModel } from '@uml/domain-core';

/**
 * CA-017.1 (errores que bloquean la generacion) y CA-017.2 (avisos que la
 * permiten).
 */

let contador = 0;
function id(): string {
  contador += 1;
  return `33333333-3333-4333-8333-${String(contador).padStart(12, '0')}`;
}

interface AtributoBreve {
  name: string;
  type?: UmlClass['attributes'][number]['type'];
  primaryKey?: boolean;
  unique?: boolean;
}

function clase(displayName: string, atributos: readonly AtributoBreve[] = []): UmlClass {
  const nombres = normalizeName(displayName, 'CLASS');

  return {
    id: id(),
    displayName,
    codeName: nombres.codeName,
    databaseName: nombres.databaseName,
    attributes: atributos.map((atributo) => {
      const derivados = normalizeName(atributo.name, 'ATTRIBUTE');
      return {
        id: id(),
        displayName: atributo.name,
        codeName: derivados.codeName,
        databaseName: derivados.databaseName,
        type: atributo.type ?? 'String',
        primaryKey: atributo.primaryKey ?? false,
        nullable: true,
        unique: atributo.unique ?? false,
      };
    }),
  };
}

function relacion(
  origen: UmlClass,
  destino: UmlClass,
  extremos: {
    from?: UmlRelationship['sourceMultiplicity'];
    to?: UmlRelationship['targetMultiplicity'];
    fromRole?: string;
    toRole?: string;
    kind?: UmlRelationship['kind'];
  } = {},
): UmlRelationship {
  return {
    id: id(),
    ...(extremos.kind === undefined ? {} : { kind: extremos.kind }),
    sourceClassId: origen.id,
    targetClassId: destino.id,
    sourceMultiplicity: extremos.from ?? '1',
    targetMultiplicity: extremos.to ?? '0..*',
    ...(extremos.fromRole === undefined ? {} : { sourceRoleName: extremos.fromRole }),
    ...(extremos.toRole === undefined ? {} : { targetRoleName: extremos.toRole }),
  };
}

function modelo(classes: UmlClass[], relationships: UmlRelationship[] = []): SemanticModel {
  return { classes, relationships };
}

function codigos(model: SemanticModel): ValidationCode[] {
  return validateModel(model).map((hallazgo) => hallazgo.code);
}

function errores(model: SemanticModel): ValidationCode[] {
  return validateModel(model)
    .filter((hallazgo) => hallazgo.severity === 'ERROR')
    .map((hallazgo) => hallazgo.code);
}

describe('CA-017.1 — errores que bloquean la generacion', () => {
  it('clase sin nombre', () => {
    const vacia: UmlClass = { ...clase('Temporal'), displayName: '  ' };
    expect(errores(modelo([vacia]))).toContain('CLASS_WITHOUT_NAME');
  });

  it('nombres duplicados tras normalizar', () => {
    // La unicidad se valida sobre los nombres tecnicos, nunca sobre el visual.
    const model = modelo([clase('Número'), clase('Numero')]);

    expect(errores(model)).toContain('DUPLICATE_CLASS_NAME');
  });

  it('reporta la colision una sola vez aunque choquen los dos nombres tecnicos', () => {
    const model = modelo([clase('Número'), clase('Numero')]);
    const colisiones = errores(model).filter((c) => c === 'DUPLICATE_CLASS_NAME');

    expect(colisiones).toHaveLength(1);
  });

  it('atributos duplicados dentro de una clase', () => {
    const model = modelo([clase('Cliente', [{ name: 'Número' }, { name: 'numero' }])]);

    expect(errores(model)).toContain('DUPLICATE_ATTRIBUTE_NAME');
  });

  it('tipo no soportado', () => {
    const cliente = clase('Cliente', [{ name: 'foto' }]);
    const atributo = cliente.attributes[0];
    if (atributo === undefined) throw new Error('montaje incorrecto');
    // Un tipo que el esquema no admite solo puede llegar desde una importacion.
    (atributo as { type: string }).type = 'Blob';

    expect(errores(modelo([cliente]))).toContain('UNSUPPORTED_TYPE');
  });

  it('relacion a clase inexistente', () => {
    const cliente = clase('Cliente');
    const fantasma = clase('Fantasma');
    const model = modelo([cliente], [relacion(cliente, fantasma)]);

    expect(errores(model)).toContain('RELATIONSHIP_TO_MISSING_CLASS');
  });

  it('varios candidatos a clave', () => {
    const model = modelo([clase('Cliente', [{ name: 'id' }, { name: 'clienteId' }])]);

    expect(errores(model)).toContain('MULTIPLE_PRIMARY_KEY_CANDIDATES');
  });

  it('clave compuesta', () => {
    const model = modelo([
      clase('Inscripcion', [
        { name: 'alumnoId', primaryKey: true },
        { name: 'materiaId', primaryKey: true },
      ]),
    ]);

    expect(errores(model)).toContain('COMPOSITE_PRIMARY_KEY');
  });

  it('dos relaciones entre el mismo par sin rol', () => {
    const cliente = clase('Cliente', [{ name: 'id', primaryKey: true }]);
    const venta = clase('Venta', [{ name: 'id', primaryKey: true }]);
    const model = modelo([cliente, venta], [relacion(cliente, venta), relacion(cliente, venta)]);

    expect(errores(model)).toContain('DUPLICATE_RELATIONSHIP_WITHOUT_ROLE');
  });

  it('muchos a muchos directo, con sugerencia de como modelarlo (RM-01)', () => {
    const alumno = clase('Alumno', [{ name: 'id', primaryKey: true }]);
    const materia = clase('Materia', [{ name: 'id', primaryKey: true }]);
    const model = modelo(
      [alumno, materia],
      [relacion(alumno, materia, { from: '0..*', to: '0..*' })],
    );

    const hallazgo = validateModel(model).find((h) => h.code === 'MANY_TO_MANY_RELATIONSHIP');

    expect(hallazgo?.severity).toBe('ERROR');
    expect(hallazgo?.suggestion).toMatch(/clase intermedia/);
  });
});

describe('CA-015.1 — dos relaciones con roles distintos son validas', () => {
  it('no marca error y produce campos distintos', () => {
    const cliente = clase('Cliente', [{ name: 'id', primaryKey: true }]);
    const venta = clase('Venta', [{ name: 'id', primaryKey: true }]);
    const model = modelo(
      [cliente, venta],
      [
        relacion(cliente, venta, { fromRole: 'facturacion' }),
        relacion(cliente, venta, { fromRole: 'envio' }),
      ],
    );

    expect(errores(model)).toHaveLength(0);
  });

  it('pero si los roles normalizan igual, si es error', () => {
    const cliente = clase('Cliente', [{ name: 'id', primaryKey: true }]);
    const venta = clase('Venta', [{ name: 'id', primaryKey: true }]);
    const model = modelo(
      [cliente, venta],
      [
        relacion(cliente, venta, { fromRole: 'facturacion' }),
        relacion(cliente, venta, { fromRole: 'Facturación' }),
      ],
    );

    expect(errores(model)).toContain('ROLE_NAME_COLLISION');
  });
});

describe('CA-017.2 — avisos que permiten generar', () => {
  it('clave inferida', () => {
    expect(codigos(modelo([clase('Cliente', [{ name: 'id' }])]))).toContain('PRIMARY_KEY_INFERRED');
  });

  it('clave autogenerada', () => {
    expect(codigos(modelo([clase('Cliente', [{ name: 'nombre' }])]))).toContain(
      'PRIMARY_KEY_GENERATED',
    );
  });

  it('nombre normalizado', () => {
    expect(codigos(modelo([clase('Detalle de Venta')]))).toContain('NAME_NORMALIZED');
  });

  it('nombre reservado con prefijo', () => {
    expect(codigos(modelo([clase('Order')]))).toContain('RESERVED_NAME_PREFIXED');
  });

  it('clase sin relaciones', () => {
    const model = modelo([clase('Cliente', [{ name: 'id', primaryKey: true }]), clase('Suelta')]);

    expect(codigos(model)).toContain('CLASS_WITHOUT_RELATIONSHIPS');
  });

  it('ninguno de ellos bloquea la generacion', () => {
    const model = modelo([
      clase('Order', [{ name: 'id' }]),
      clase('Detalle de Venta', [{ name: 'cantidad', type: 'Integer' }]),
    ]);

    expect(errores(model)).toHaveLength(0);
    expect(validateModel(model).length).toBeGreaterThan(0);
  });

  it('una sola clase suelta no se marca: no hay con quien relacionarla', () => {
    const model = modelo([clase('Cliente', [{ name: 'id', primaryKey: true }])]);

    expect(codigos(model)).not.toContain('CLASS_WITHOUT_RELATIONSHIPS');
  });
});

/**
 * RM-07 - la generalizacion.
 *
 * Se proyecta a tabla por clase unida por la clave primaria, y esa proyeccion
 * impone tres limites: una sola superclase, ningun ciclo y ningun miembro
 * repetido a lo largo de la cadena. Los tres son errores porque el codigo que
 * saldria de romperlos compila, y falla despues.
 */
describe('RM-07 - herencia', () => {
  const conClave = (nombre: string, extra: readonly AtributoBreve[] = []): UmlClass =>
    clase(nombre, [{ name: 'id', type: 'UUID', primaryKey: true }, ...extra]);

  const hereda = (subclase: UmlClass, superclase: UmlClass): UmlRelationship =>
    relacion(subclase, superclase, { kind: 'GENERALIZATION', from: '1', to: '1' });

  it('una jerarquia de tres niveles es valida', () => {
    const persona = conClave('Persona', [{ name: 'nombre' }]);
    const empleado = clase('Empleado', [{ name: 'salario', type: 'Decimal' }]);
    const docente = clase('Docente', [{ name: 'escalafon' }]);

    const model = modelo(
      [persona, empleado, docente],
      [hereda(empleado, persona), hereda(docente, empleado)],
    );

    expect(errores(model)).toEqual([]);
  });

  it('la subclase hereda la clave primaria de la raiz, y se avisa', () => {
    const persona = conClave('Persona');
    const empleado = clase('Empleado', [{ name: 'salario', type: 'Decimal' }]);
    const model = modelo([persona, empleado], [hereda(empleado, persona)]);

    const avisos = validateModel(model).filter((h) => h.code === 'PRIMARY_KEY_INHERITED');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.message).toContain('"Persona"');

    // Y no el que produciria una clase suelta sin clave.
    expect(codigos(model)).not.toContain('PRIMARY_KEY_GENERATED');
  });

  it('la clave que declara una subclase pasa a columna, y se dice cual', () => {
    const persona = conClave('Persona');
    const empleado = clase('Empleado', [{ name: 'legajo', primaryKey: true }]);
    const model = modelo([persona, empleado], [hereda(empleado, persona)]);

    const aviso = validateModel(model).find((h) => h.code === 'PRIMARY_KEY_INHERITED');
    expect(aviso?.message).toContain('"legajo"');
    expect(aviso?.suggestion).toContain('unico');
  });

  it('una clase no puede heredar de si misma', () => {
    const persona = conClave('Persona');
    const model = modelo([persona], [hereda(persona, persona)]);

    expect(errores(model)).toContain('SELF_GENERALIZATION');
  });

  it('una clase no puede tener dos superclases', () => {
    const persona = conClave('Persona');
    const cliente = conClave('Cliente');
    const empleado = clase('Empleado', [{ name: 'salario', type: 'Decimal' }]);

    const model = modelo(
      [persona, cliente, empleado],
      [hereda(empleado, persona), hereda(empleado, cliente)],
    );

    expect(errores(model)).toContain('MULTIPLE_INHERITANCE');
  });

  it('la herencia no puede cerrarse en circulo', () => {
    const a = conClave('Alfa');
    const b = clase('Beta', [{ name: 'x' }]);
    const c = clase('Gamma', [{ name: 'y' }]);

    const model = modelo([a, b, c], [hereda(a, b), hereda(b, c), hereda(c, a)]);
    const hallazgos = validateModel(model).filter((h) => h.code === 'INHERITANCE_CYCLE');

    // Un ciclo, no uno por cada clase que lo forma.
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.elementIds).toHaveLength(3);
  });

  it('la subclase no puede declarar un atributo que ya hereda', () => {
    const persona = conClave('Persona', [{ name: 'nombre' }]);
    const empleado = clase('Empleado', [{ name: 'nombre' }]);
    const model = modelo([persona, empleado], [hereda(empleado, persona)]);

    const hallazgo = validateModel(model).find((h) => h.code === 'INHERITED_MEMBER_COLLISION');
    expect(hallazgo?.severity).toBe('ERROR');
    expect(hallazgo?.message).toContain('"Persona"');
  });

  it('lo mismo cuando el choque es con una clave foranea heredada', () => {
    const persona = conClave('Persona');
    const empresa = conClave('Empresa');
    const empleado = clase('Empleado', [{ name: 'empresa' }]);

    // La clave foranea "empresa" la recibe Persona; Empleado la hereda, y su
    // atributo homonimo la taparia.
    const model = modelo(
      [persona, empresa, empleado],
      [relacion(empresa, persona), hereda(empleado, persona)],
    );

    expect(errores(model)).toContain('INHERITED_MEMBER_COLLISION');
  });

  it('dos hermanas pueden declarar el mismo atributo', () => {
    // No hay ocultamiento entre hermanas: cada una tiene su tabla.
    const persona = conClave('Persona');
    const empleado = clase('Empleado', [{ name: 'codigo' }]);
    const estudiante = clase('Estudiante', [{ name: 'codigo' }]);

    const model = modelo(
      [persona, empleado, estudiante],
      [hereda(empleado, persona), hereda(estudiante, persona)],
    );

    expect(errores(model)).toEqual([]);
  });

  it('las multiplicidades de una generalizacion no se leen como muchos a muchos', () => {
    const persona = conClave('Persona');
    const empleado = clase('Empleado', [{ name: 'salario', type: 'Decimal' }]);

    // El editor no las dibuja, asi que pueden quedar en cualquier valor.
    const model = modelo(
      [persona, empleado],
      [relacion(empleado, persona, { kind: 'GENERALIZATION', from: '0..*', to: '0..*' })],
    );

    expect(errores(model)).not.toContain('MANY_TO_MANY_RELATIONSHIP');
  });

  it('una generalizacion no emite campo, asi que no choca con una asociacion', () => {
    // Proyectada como clave foranea, esta generalizacion producia un campo
    // "persona" en Empleado que chocaba con el de la asociacion.
    const persona = conClave('Persona');
    const empleado = clase('Empleado', [{ name: 'salario', type: 'Decimal' }]);

    const model = modelo(
      [persona, empleado],
      [hereda(empleado, persona), relacion(persona, empleado, { toRole: 'suplente' })],
    );

    expect(errores(model)).toEqual([]);
  });
});
