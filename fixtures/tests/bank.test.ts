import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIXTURES,
  GENERABLE_FIXTURE_IDS,
  VALID_FIXTURE_IDS,
  fixture,
  fixtureFileName,
  serializeFixture,
} from '@uml/fixtures';
import { validateModel } from '@uml/domain-core';
import { semanticModelSchema } from '@uml/contracts';

/**
 * Banco de regresion (plan maestro 15.2).
 *
 * Esta prueba es la que sostiene todo lo que venga despues: si el banco deja de
 * decir la verdad sobre si mismo, el generador de la fase 2 se estara probando
 * contra modelos que no son los que cree.
 */

const directorioUml = join(dirname(fileURLToPath(import.meta.url)), '..', 'uml');

describe('banco de regresion', () => {
  it('contiene los siete modelos del plan, la variante generable de T07 y la jerarquia', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual([
      'T01',
      'T02',
      'T03',
      'T04',
      'T05',
      'T06',
      'T07',
      'T07R',
      'T08',
    ]);
  });

  it('T07 queda fuera del banco de generacion, y T07R dentro', () => {
    // T07 existe para que el validador lo rechace: no puede llegar al generador
    // por construccion. T07R lleva las mismas construcciones hostiles con la
    // colision resuelta, para verlas compilar de verdad.
    expect(GENERABLE_FIXTURE_IDS).not.toContain('T07');
    expect(GENERABLE_FIXTURE_IDS).toContain('T07R');
  });

  it('todos cumplen el esquema del modelo canonico', () => {
    for (const item of FIXTURES) {
      expect(() => semanticModelSchema.parse(item.model)).not.toThrow();
    }
  });

  it('los identificadores son deterministas entre ejecuciones', () => {
    // RNF-05: mismo snapshot, mismo resultado. Sin esto el banco produciria un
    // diff en cada emision y nadie podria revisar un cambio real.
    expect(fixture('T01').model.classes[0]?.id).toBe(FIXTURES[0]?.model.classes[0]?.id);
    expect(fixture('T01').model.classes[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('ningun identificador se repite dentro de un modelo', () => {
    for (const item of FIXTURES) {
      const ids = [
        ...item.model.classes.map((c) => c.id),
        ...item.model.classes.flatMap((c) => c.attributes.map((a) => a.id)),
        ...item.model.relationships.map((r) => r.id),
      ];

      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('T01 a T06 son modelos validos', () => {
  for (const fixtureId of VALID_FIXTURE_IDS) {
    it(`${fixtureId} no produce ningun error`, () => {
      const errores = validateModel(fixture(fixtureId).model).filter(
        (hallazgo) => hallazgo.severity === 'ERROR',
      );

      // El mensaje del fallo tiene que decir que esta mal, no solo cuantos hay.
      expect(errores.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
    });
  }

  it('T01 modela la relacion muchos a muchos con entidad intermedia (RM-01)', () => {
    const t01 = fixture('T01').model;
    const intermedia = t01.classes.find((c) => c.codeName === 'DetalleVenta');

    expect(intermedia).toBeDefined();
    // Dos relaciones N:1 entran en ella, una desde Venta y otra desde Producto.
    const entrantes = t01.relationships.filter((r) => r.targetClassId === intermedia?.id);
    expect(entrantes).toHaveLength(2);
  });

  it('T04 apila varias claves foraneas sobre la misma entidad', () => {
    const t04 = fixture('T04').model;
    const asignacion = t04.classes.find((c) => c.codeName === 'Asignacion');
    const entrantes = t04.relationships.filter((r) => r.targetClassId === asignacion?.id);

    expect(entrantes).toHaveLength(2);
  });

  it('T05 encadena tres niveles de dependencia', () => {
    const t05 = fixture('T05').model;

    expect(t05.classes.map((c) => c.codeName)).toEqual(['Cliente', 'Cuenta', 'Movimiento']);
    expect(t05.relationships).toHaveLength(2);
  });
});

/**
 * T07 no es un modelo valido y no pretende serlo. Su razon de ser es que el
 * validador encuentre exactamente esto y nada mas.
 */
describe('T07 — modelo hostil', () => {
  const hallazgos = validateModel(fixture('T07').model);
  const codigos = (severidad: 'ERROR' | 'WARNING'): string[] =>
    hallazgos.filter((h) => h.severity === severidad).map((h) => h.code);

  it('produce exactamente un error: la colision al normalizar', () => {
    expect(codigos('ERROR')).toEqual(['DUPLICATE_CLASS_NAME']);
  });

  it('la clase reservada en PostgreSQL se escapa solo en la tabla', () => {
    const order = fixture('T07').model.classes.find((c) => c.displayName === 'Order');

    expect(order?.codeName).toBe('Order');
    expect(order?.databaseName).toBe('app_order');
    expect(codigos('WARNING')).toContain('RESERVED_NAME_PREFIXED');
  });

  it('el atributo reservado en Java se escapa solo en el codigo', () => {
    const order = fixture('T07').model.classes.find((c) => c.displayName === 'Order');
    const atributo = order?.attributes.find((a) => a.displayName === 'class');

    expect(atributo?.codeName).toBe('appClass');
    // `class` no es reservada en PostgreSQL: prefijar la columna seria ruido.
    expect(atributo?.databaseName).toBe('class');
  });

  it('el nombre con tildes y espacios se normaliza', () => {
    const cuenta = fixture('T07').model.classes.find((c) => c.displayName === 'Número de Cuenta');

    expect(cuenta?.codeName).toBe('NumeroCuenta');
    expect(cuenta?.databaseName).toBe('numero_cuenta');
  });

  it('la clase sin clave primaria produce aviso, no error', () => {
    expect(codigos('WARNING')).toContain('PRIMARY_KEY_GENERATED');
  });

  it('las dos relaciones con roles distintos no producen error (CA-015.1)', () => {
    expect(codigos('ERROR')).not.toContain('DUPLICATE_RELATIONSHIP_WITHOUT_ROLE');
    expect(codigos('ERROR')).not.toContain('ROLE_NAME_COLLISION');
  });

  it('contiene la multiplicidad opcional y el atributo unico', () => {
    const t07 = fixture('T07').model;

    expect(t07.relationships.some((r) => r.targetMultiplicity === '0..1')).toBe(true);
    expect(t07.classes.some((c) => c.attributes.some((a) => a.unique))).toBe(true);
  });
});

describe('T07R — el modelo hostil, ya generable', () => {
  it('no produce ningun error', () => {
    const errores = validateModel(fixture('T07R').model).filter((h) => h.severity === 'ERROR');

    expect(errores.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it('conserva todo lo que hace hostil a T07', () => {
    const t07r = fixture('T07R').model;

    // La reservada de PostgreSQL, escapada solo en la tabla.
    const order = t07r.classes.find((c) => c.displayName === 'Order');
    expect(order?.databaseName).toBe('app_order');
    expect(order?.codeName).toBe('Order');

    // La reservada de Java, escapada solo en el codigo.
    expect(order?.attributes.find((a) => a.displayName === 'class')?.codeName).toBe('appClass');

    // El nombre con tildes, la clase sin clave, la multiplicidad opcional y el
    // atributo unico siguen ahi.
    expect(t07r.classes.some((c) => c.codeName === 'NumeroCuenta')).toBe(true);
    expect(
      t07r.classes.some((c) => !c.attributes.some((a) => a.primaryKey) && c.attributes.length > 0),
    ).toBe(true);
    expect(t07r.relationships.some((r) => r.targetMultiplicity === '0..1')).toBe(true);
    expect(t07r.classes.some((c) => c.attributes.some((a) => a.unique))).toBe(true);

    // Y las dos relaciones entre el mismo par con roles distintos (CA-015.1).
    const conRol = t07r.relationships.filter((r) => r.sourceRoleName !== undefined);
    expect(conRol).toHaveLength(2);
    expect(new Set(conRol.map((r) => r.sourceRoleName)).size).toBe(2);
  });
});

/**
 * T08 es el unico modelo del banco con herencia, y la herencia es lo unico que
 * no se prueba sola: una clave foranea que falta rompe la compilacion, pero una
 * jerarquia mal proyectada compila igual y guarda las filas en otra tabla.
 */
describe('T08 — la jerarquia', () => {
  const t08 = fixture('T08').model;
  const clase = (codeName: string) => t08.classes.find((c) => c.codeName === codeName);
  const hallazgos = validateModel(t08);

  it('no produce ningun error', () => {
    const errores = hallazgos.filter((h) => h.severity === 'ERROR');
    expect(errores.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it('encadena tres niveles: Docente hereda de Empleado, que hereda de Persona', () => {
    const generalizaciones = t08.relationships.filter((r) => r.kind === 'GENERALIZATION');
    expect(generalizaciones).toHaveLength(3);

    const de = (subclase: string): string | undefined => {
      const relacion = generalizaciones.find((r) => r.sourceClassId === clase(subclase)?.id);
      return t08.classes.find((c) => c.id === relacion?.targetClassId)?.codeName;
    };

    expect(de('Empleado')).toBe('Persona');
    expect(de('Docente')).toBe('Empleado');
    expect(de('Estudiante')).toBe('Persona');
  });

  it('las subclases no declaran clave propia: la heredan de la raiz', () => {
    for (const codeName of ['Empleado', 'Docente', 'Estudiante']) {
      expect(clase(codeName)?.attributes.some((a) => a.primaryKey)).toBe(false);
    }

    // Y se avisa, porque de otro modo no habria forma de saber de donde sale la
    // clave de una clase que no la declara.
    const avisos = hallazgos.filter((h) => h.code === 'PRIMARY_KEY_INHERITED');
    expect(avisos).toHaveLength(3);
    expect(avisos.every((h) => h.message.includes('"Persona"'))).toBe(true);
  });

  it('una clave foranea apunta a la superclase y otra a una subclase', () => {
    const asociaciones = t08.relationships.filter((r) => r.kind !== 'GENERALIZATION');

    // Departamento → Empleado: la clave la recibe Empleado y Docente la hereda.
    expect(
      asociaciones.some(
        (r) =>
          r.sourceClassId === clase('Departamento')?.id &&
          r.targetClassId === clase('Empleado')?.id,
      ),
    ).toBe(true);

    // Docente → Materia: la clave foranea referencia la tabla de la hoja.
    expect(
      asociaciones.some(
        (r) => r.sourceClassId === clase('Docente')?.id && r.targetClassId === clase('Materia')?.id,
      ),
    ).toBe(true);
  });
});

describe('los JSON versionados estan al dia', () => {
  for (const item of FIXTURES) {
    it(`${item.id}.json coincide con las definiciones`, () => {
      const versionado = readFileSync(join(directorioUml, fixtureFileName(item.id)), 'utf8');

      // Los JSON son derivados, no fuente. Si esta prueba falla es porque alguien
      // edito el JSON a mano o cambio las definiciones sin volver a emitir:
      //   npm run fixtures:emit
      expect(versionado.replace(/\r\n/g, '\n')).toBe(serializeFixture(item));
    });
  }
});
