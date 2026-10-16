import { describe, expect, it } from 'vitest';
import type { ConceptualType, UmlClass } from '@uml/contracts';
import { isConventionalIdName, resolvePrimaryKey } from '@uml/domain-core';
import { normalizeName } from '@uml/domain-core';

/** RTM-04: los cuatro caminos de la resolucion de clave primaria. */

let contador = 0;
function id(): string {
  contador += 1;
  return `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
}

function clase(
  displayName: string,
  atributos: readonly {
    name: string;
    type?: ConceptualType;
    primaryKey?: boolean;
  }[],
): UmlClass {
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
        unique: false,
      };
    }),
  };
}

describe('resolucion de clave primaria (RTM-04)', () => {
  it('1. usa el atributo marcado', () => {
    const resolucion = resolvePrimaryKey(
      clase('Cliente', [
        { name: 'codigoCliente', primaryKey: true },
        { name: 'id', type: 'UUID' },
      ]),
    );

    expect(resolucion.kind).toBe('DECLARED');
    if (resolucion.kind !== 'DECLARED') throw new Error('rama imposible');
    // Gana lo marcado aunque exista un candidato por convencion.
    expect(resolucion.attribute.codeName).toBe('codigoCliente');
  });

  it('2. promueve el unico candidato por convencion', () => {
    const resolucion = resolvePrimaryKey(clase('Cliente', [{ name: 'id' }, { name: 'nombre' }]));

    expect(resolucion.kind).toBe('INFERRED');
  });

  it('2. acepta las tres formas de la convencion', () => {
    expect(isConventionalIdName('id', 'Cliente')).toBe(true);
    expect(isConventionalIdName('idCliente', 'Cliente')).toBe(true);
    expect(isConventionalIdName('clienteId', 'Cliente')).toBe(true);
    expect(isConventionalIdName('IDCliente', 'Cliente')).toBe(true);
  });

  it('2. no promueve identificadores de negocio', () => {
    // La inferencia es deliberadamente estrecha: `ci`, `nit` y `codigoCliente`
    // son identificadores de negocio, no necesariamente claves tecnicas. La
    // herramienta no inventa semantica.
    expect(isConventionalIdName('ci', 'Cliente')).toBe(false);
    expect(isConventionalIdName('nit', 'Cliente')).toBe(false);
    expect(isConventionalIdName('codigoCliente', 'Cliente')).toBe(false);
    expect(isConventionalIdName('idProducto', 'Cliente')).toBe(false);
  });

  it('3. con dos candidatos no elige: es el usuario quien decide', () => {
    const resolucion = resolvePrimaryKey(clase('Cliente', [{ name: 'id' }, { name: 'clienteId' }]));

    expect(resolucion.kind).toBe('AMBIGUOUS');
  });

  it('4. sin ningun candidato, genera', () => {
    const resolucion = resolvePrimaryKey(clase('Cliente', [{ name: 'nombre' }]));

    expect(resolucion.kind).toBe('GENERATED');
  });

  it('rechaza la clave compuesta (RM-03)', () => {
    const resolucion = resolvePrimaryKey(
      clase('Inscripcion', [
        { name: 'alumnoId', primaryKey: true },
        { name: 'materiaId', primaryKey: true },
      ]),
    );

    expect(resolucion.kind).toBe('COMPOSITE');
  });
});
