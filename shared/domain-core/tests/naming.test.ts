import { describe, expect, it } from 'vitest';
import {
  InvalidIdentifierError,
  normalizeName,
  toArtifactId,
  toPackageSegment,
  toResourcePath,
  toWords,
} from '@uml/domain-core';

/**
 * RTM-02 y RTM-03.
 *
 * Los casos marcados «(plan maestro)» son literalmente los ejemplos del
 * documento. Si alguno de ellos falla, el generador emitira nombres distintos de
 * los que la especificacion promete.
 */
describe('normalizacion de nombres (RTM-02)', () => {
  it('deriva los tres nombres de una clase — ejemplo del plan maestro', () => {
    const nombres = normalizeName('Detalle de Venta', 'CLASS');

    expect(nombres.displayName).toBe('Detalle de Venta');
    expect(nombres.codeName).toBe('DetalleVenta');
    expect(nombres.databaseName).toBe('detalle_venta');
  });

  it('deriva los tres nombres de un atributo — ejemplo del plan maestro', () => {
    const nombres = normalizeName('Número de Teléfono', 'ATTRIBUTE');

    expect(nombres.codeName).toBe('numeroTelefono');
    expect(nombres.databaseName).toBe('numero_telefono');
  });

  it('quita las tildes sin perder la letra', () => {
    expect(normalizeName('código', 'ATTRIBUTE').codeName).toBe('codigo');
    expect(normalizeName('Año', 'ATTRIBUTE').codeName).toBe('ano');
  });

  it('conserva un conector cuando es la primera palabra', () => {
    // «El Alto» es un nombre propio: mutilarlo a «Alto» seria peor que dejarlo.
    expect(normalizeName('El Alto', 'CLASS').codeName).toBe('ElAlto');
  });

  it('acepta un nombre ya escrito en camelCase sin duplicar palabras', () => {
    expect(normalizeName('numeroTelefono', 'ATTRIBUTE').codeName).toBe('numeroTelefono');
    expect(normalizeName('numero_telefono', 'ATTRIBUTE').codeName).toBe('numeroTelefono');
  });

  it('marca cuando el nombre visual no sobrevivio intacto', () => {
    expect(normalizeName('Detalle de Venta', 'CLASS').wasNormalized).toBe(true);
    expect(normalizeName('Cliente', 'CLASS').wasNormalized).toBe(false);
  });

  it('rechaza un nombre que no produce identificador', () => {
    expect(() => normalizeName('   ', 'CLASS')).toThrow(InvalidIdentifierError);
    expect(() => normalizeName('***', 'CLASS')).toThrow(InvalidIdentifierError);
    expect(() => normalizeName('2Venta', 'CLASS')).toThrow(InvalidIdentifierError);
  });

  it('separa palabras por mayuscula, guion bajo y espacio por igual', () => {
    expect(toWords('IDCliente')).toEqual(['id', 'cliente']);
    expect(toWords('precio_unitario')).toEqual(['precio', 'unitario']);
    expect(toWords('Detalle De Venta')).toEqual(['detalle', 'de', 'venta']);
  });
});

describe('palabras reservadas (RTM-03)', () => {
  it('antepone el prefijo al nombre de tabla reservado en PostgreSQL', () => {
    const nombres = normalizeName('Order', 'CLASS');

    expect(nombres.databaseName).toBe('app_order');
    expect(nombres.wasPrefixed).toBe(true);
    expect(nombres.reservedIn).toContain('POSTGRES');
  });

  it('no contamina el nombre de codigo por una reservada de PostgreSQL', () => {
    // RTM-08 depende de esto: el recurso REST se deriva del nombre de codigo
    // justamente para que el prefijo de la tabla no se filtre a las URL.
    expect(normalizeName('Order', 'CLASS').codeName).toBe('Order');
    expect(toResourcePath(normalizeName('Order', 'CLASS').codeName)).toBe('order');
  });

  it('antepone el prefijo al nombre de codigo reservado en Java', () => {
    const nombres = normalizeName('class', 'ATTRIBUTE');

    expect(nombres.codeName).toBe('appClass');
    expect(nombres.reservedIn).toContain('JAVA');
  });

  it('no marca como normalizado un nombre que solo cambio por el escape', () => {
    // «class» produciria «class»: lo unico que lo cambia es la lista reservada.
    // Emitir los dos avisos para el mismo hecho es ruido.
    const nombres = normalizeName('class', 'ATTRIBUTE');

    expect(nombres.wasPrefixed).toBe(true);
    expect(nombres.wasNormalized).toBe(false);
  });

  it('protege los nombres que el propio generador emite', () => {
    const nombres = normalizeName('Application', 'CLASS');

    expect(nombres.codeName).toBe('AppApplication');
    expect(nombres.reservedIn).toContain('GENERATOR');
  });

  it('una clase nunca choca con una reservada de Java', () => {
    // Todas las reservadas de Java son minusculas y las clases van en PascalCase.
    expect(normalizeName('class', 'CLASS').reservedIn).not.toContain('JAVA');
  });
});

describe('derivaciones para el generador (RTM-08 y RTM-12)', () => {
  it('produce el recurso REST en kebab-case y singular', () => {
    expect(toResourcePath('Cliente')).toBe('cliente');
    expect(toResourcePath('DetalleVenta')).toBe('detalle-venta');
  });

  it('produce artefacto y paquete desde el nombre del proyecto', () => {
    // Ejemplo literal de RTM-12: el conector se cae tambien aqui.
    expect(toArtifactId('Sistema de Ventas')).toBe('sistema-ventas');
    expect(toPackageSegment('Sistema de Ventas')).toBe('sistemaventas');
  });

  it('escapa palabras reservadas usadas como segmento de paquete', () => {
    expect(toPackageSegment('class')).toBe('appclass');
  });
});
