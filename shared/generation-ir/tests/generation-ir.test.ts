import { describe, expect, it } from 'vitest';
import type { SemanticModel } from '@uml/contracts';
import { fixture } from '@uml/fixtures';
import {
  buildGenerationIr,
  InvalidGenerationModelError,
  JAVA_TYPE_BY_CONCEPTUAL_TYPE,
} from '@uml/generation-ir';

describe('representacion intermedia de generacion', () => {
  it('rechaza palabras reservadas de Java en el paquete base', () => {
    expect(() =>
      buildGenerationIr({
        projectName: 'Ventas',
        snapshotVersion: 1,
        model: fixture('T01').model,
        basePackage: 'bo.class.demo',
      }),
    ).toThrow(/paquete Java valido/i);
  });

  it('deriva metadatos deterministas del proyecto (RTM-12)', () => {
    const ir = buildGenerationIr({
      projectName: 'Sistema de Ventas',
      snapshotVersion: 7,
      model: fixture('T01').model,
    });

    expect(ir.project).toMatchObject({
      displayName: 'Sistema de Ventas',
      artifactId: 'sistema-ventas',
      groupId: 'bo.edu.sw1',
      packageName: 'bo.edu.sw1.sistemaventas',
      packagePath: 'bo/edu/sw1/sistemaventas',
      applicationClassName: 'SistemaVentasApplication',
      databaseName: 'sistema_ventas',
    });
    expect(ir.snapshotVersion).toBe(7);
  });

  it('traduce tipos y restricciones de columnas (RTM-01 y RTM-06)', () => {
    const ir = t01Ir();
    const producto = entity(ir, 'Producto');
    const precio = producto.attributes.find((attribute) => attribute.fieldName === 'precio');
    const nombre = producto.attributes.find((attribute) => attribute.fieldName === 'nombre');

    expect(precio).toMatchObject({
      javaType: 'BigDecimal',
      postgresType: 'NUMERIC(19,2)',
      precision: 19,
      scale: 2,
      nullable: false,
    });
    expect(nombre).toMatchObject({ javaType: 'String', length: 255, nullable: false });
    expect(JAVA_TYPE_BY_CONCEPTUAL_TYPE.UUID).toMatchObject({
      type: 'UUID',
      postgresType: 'UUID',
    });
  });

  it('genera solo el lado propietario y sus finders (RTM-05)', () => {
    const ir = t01Ir();
    const cliente = entity(ir, 'Cliente');
    const venta = entity(ir, 'Venta');
    const detalle = entity(ir, 'DetalleVenta');

    expect(cliente.relationships).toHaveLength(0);
    expect(venta.relationships).toEqual([
      expect.objectContaining({
        kind: 'MANY_TO_ONE',
        fieldName: 'cliente',
        columnName: 'cliente_id',
        optional: false,
        finderMethodName: 'findByCliente_Id',
        queryParameterName: 'clienteId',
      }),
    ]);
    expect(detalle.relationships.map((item) => item.fieldName)).toEqual(['producto', 'venta']);
  });

  it('toma una copia del snapshot y congela la IR (RA-08)', () => {
    const model = structuredClone(fixture('T01').model);
    const ir = buildGenerationIr({ projectName: 'Ventas', snapshotVersion: 1, model });
    model.classes[0]!.displayName = 'Cambio concurrente';

    expect(entity(ir, 'Cliente').displayName).toBe('Cliente');
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.entities)).toBe(true);
  });

  it('genera una clave UUID cuando la clase no declara ninguna (RTM-04)', () => {
    const model: SemanticModel = {
      classes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          displayName: 'Nota',
          codeName: 'Nota',
          databaseName: 'nota',
          attributes: [],
        },
      ],
      relationships: [],
    };

    const nota = entity(
      buildGenerationIr({ projectName: 'Notas', snapshotVersion: 1, model }),
      'Nota',
    );
    expect(nota.primaryKey).toMatchObject({
      fieldName: 'id',
      conceptualType: 'UUID',
      primaryKey: true,
      generated: true,
    });
  });

  it('genera una clave foranea a la misma tabla para una asociacion recursiva', () => {
    const claseId = '11111111-1111-4111-8111-111111111111';
    const model: SemanticModel = {
      classes: [
        {
          id: claseId,
          displayName: 'Empleado',
          codeName: 'Empleado',
          databaseName: 'empleado',
          attributes: [],
        },
      ],
      relationships: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'ASSOCIATION',
          sourceClassId: claseId,
          targetClassId: claseId,
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
          sourceRoleName: 'jefe',
          targetRoleName: 'subordinados',
        },
      ],
    };

    const empleado = entity(
      buildGenerationIr({ projectName: 'Organizacion', snapshotVersion: 1, model }),
      'Empleado',
    );

    expect(empleado.relationships).toEqual([
      expect.objectContaining({
        kind: 'MANY_TO_ONE',
        fieldName: 'jefe',
        columnName: 'jefe_id',
        targetEntityId: claseId,
        targetClassName: 'Empleado',
      }),
    ]);
  });

  it('respeta el extremo propietario al invertir una asociacion recursiva', () => {
    const claseId = '11111111-1111-4111-8111-111111111111';
    const model: SemanticModel = {
      classes: [
        {
          id: claseId,
          displayName: 'Empleado',
          codeName: 'Empleado',
          databaseName: 'empleado',
          attributes: [],
        },
      ],
      relationships: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          sourceClassId: claseId,
          targetClassId: claseId,
          sourceMultiplicity: '0..*',
          targetMultiplicity: '0..1',
          sourceRoleName: 'subordinados',
          targetRoleName: 'jefe',
        },
      ],
    };

    const empleado = entity(
      buildGenerationIr({ projectName: 'Organizacion', snapshotVersion: 1, model }),
      'Empleado',
    );

    expect(empleado.relationships).toEqual([
      expect.objectContaining({
        kind: 'MANY_TO_ONE',
        fieldName: 'jefe',
        columnName: 'jefe_id',
        optional: true,
      }),
    ]);
  });

  it('rechaza un modelo semanticamente invalido antes de generar', () => {
    expect(() =>
      buildGenerationIr({
        projectName: 'Hostil',
        snapshotVersion: 1,
        model: fixture('T07').model,
      }),
    ).toThrow(InvalidGenerationModelError);
  });
});

/**
 * RM-07 - la jerarquia, sobre T08.
 *
 * Todo lo que sigue es lo que separa una herencia de una clave foranea, y son
 * justo las cosas que la plantilla no puede decidir sola: de donde sale la
 * clave, que declara cada clase y que hereda sin declararlo.
 */
describe('herencia', () => {
  const ir = (): Ir =>
    buildGenerationIr({
      projectName: 'Institucion',
      snapshotVersion: 1,
      model: fixture('T08').model,
    });

  it('la subclase extiende a su superclase directa, no a la raiz', () => {
    const construida = ir();

    expect(entity(construida, 'Empleado').superClassName).toBe('Persona');
    expect(entity(construida, 'Docente').superClassName).toBe('Empleado');
    expect(entity(construida, 'Persona').superClassName).toBeNull();
  });

  it('solo la raiz de la jerarquia declara la estrategia', () => {
    const construida = ir();

    expect(entity(construida, 'Persona').inheritanceRoot).toBe(true);
    // Empleado hereda y a la vez tiene subclase: sigue sin ser raiz.
    expect(entity(construida, 'Empleado').inheritanceRoot).toBe(false);
    expect(entity(construida, 'Materia').inheritanceRoot).toBe(false);
  });

  it('la clave primaria viene de la raiz, saltando el nivel intermedio', () => {
    const construida = ir();
    const raiz = entity(construida, 'Persona').primaryKey;

    for (const className of ['Empleado', 'Docente', 'Estudiante']) {
      expect(entity(construida, className).primaryKey).toEqual(raiz);
      // Y no se declara otra vez: seria un segundo @Id en la misma jerarquia.
      expect(entity(construida, className).declaredAttributes.some((a) => a.primaryKey)).toBe(
        false,
      );
    }
  });

  it('la clase declara lo suyo y expone tambien lo heredado', () => {
    const docente = entity(ir(), 'Docente');

    expect(docente.declaredAttributes.map((a) => a.fieldName)).toEqual(['escalafon']);
    // De la raiz hacia abajo, con la clave delante.
    expect(docente.attributes.map((a) => a.fieldName)).toEqual([
      'id',
      'nombre',
      'correo',
      'fechaIngreso',
      'salario',
      'escalafon',
    ]);
  });

  it('una clave foranea de la superclase la hereda la subclase sin declararla', () => {
    const construida = ir();

    expect(entity(construida, 'Empleado').declaredRelationships.map((r) => r.fieldName)).toEqual([
      'departamento',
    ]);
    // Docente no la declara -no puede, ya esta en Empleado- pero su DTO y su
    // servicio la necesitan.
    expect(entity(construida, 'Docente').declaredRelationships).toHaveLength(0);
    expect(entity(construida, 'Docente').relationships.map((r) => r.fieldName)).toEqual([
      'departamento',
    ]);
  });

  it('una clave foranea puede apuntar a una subclase', () => {
    const materia = entity(ir(), 'Materia');

    expect(materia.relationships).toEqual([
      expect.objectContaining({ fieldName: 'docente', targetClassName: 'Docente' }),
    ]);
  });

  it('la generalizacion no produce ninguna clave foranea', () => {
    const construida = ir();

    // Tres generalizaciones y cuatro asociaciones en T08: si la herencia se
    // proyectara como clave foranea, habria tres campos de mas.
    const campos = construida.entities.flatMap((entidad) =>
      entidad.declaredRelationships.map((r) => `${entidad.className}.${r.fieldName}`),
    );

    expect(campos.sort()).toEqual([
      'Empleado.departamento',
      'Inscripcion.estudiante',
      'Inscripcion.materia',
      'Materia.docente',
    ]);
  });
});

type Ir = ReturnType<typeof buildGenerationIr>;

function t01Ir(): Ir {
  return buildGenerationIr({
    projectName: 'Sistema de Ventas',
    snapshotVersion: 1,
    model: fixture('T01').model,
  });
}

function entity(ir: Ir, className: string): Ir['entities'][number] {
  const found = ir.entities.find((item) => item.className === className);
  if (found === undefined) throw new Error(`No existe ${className} en la IR.`);
  return found;
}
