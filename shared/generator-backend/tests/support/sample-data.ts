import { randomInt, randomUUID } from 'node:crypto';
import type { GenerationIr, IrAttribute, IrEntity } from '@uml/generation-ir';

/**
 * Datos de prueba sintetizados desde la representacion intermedia.
 *
 * El banco tiene siete modelos y escribir a mano el cuerpo de cada alta seria
 * siete veces el mismo trabajo, desincronizado cada vez que cambie un modelo.
 * Los tipos ya estan en la IR: de ahi sale un valor valido para cada campo.
 */

export interface SampleRecord {
  readonly entity: IrEntity;
  readonly id: string;
  readonly body: Record<string, unknown>;
}

/**
 * Orden topologico: primero las entidades de las que dependen otras.
 *
 * La DoD de la seccion 15.1 lo exige — "alta de entidades raiz (orden topologico
 * de dependencias), alta de entidades dependientes" — porque dar de alta un hijo
 * antes que su padre viola la clave foranea y devuelve 409.
 */
export function topologicalOrder(ir: GenerationIr): readonly IrEntity[] {
  const pendientes = new Map(ir.entities.map((entity) => [entity.sourceClassId, entity]));
  const ordenadas: IrEntity[] = [];
  const colocadas = new Set<string>();

  while (pendientes.size > 0) {
    const listas = [...pendientes.values()].filter((entity) =>
      entity.relationships.every(
        (relacion) =>
          colocadas.has(relacion.targetEntityId) ||
          relacion.targetEntityId === entity.sourceClassId,
      ),
    );

    if (listas.length === 0) {
      // Un ciclo de claves foraneas obligatorias no se puede dar de alta en
      // ningun orden. El validador no lo prohibe, asi que se reporta aqui en
      // lugar de entrar en un bucle infinito.
      throw new Error(
        `Ciclo de dependencias entre: ${[...pendientes.values()].map((e) => e.className).join(', ')}`,
      );
    }

    for (const entity of listas) {
      ordenadas.push(entity);
      colocadas.add(entity.sourceClassId);
      pendientes.delete(entity.sourceClassId);
    }
  }

  return ordenadas;
}

/**
 * Las entidades que heredan de una, directa o indirectamente.
 *
 * Hace falta para contar. En JPA una subclase **es** una superclase, asi que
 * `GET /api/persona` devuelve tambien los empleados y los estudiantes que se
 * dieron de alta por su propia ruta. Sin esto la DoD contaria una fila donde la
 * jerarquia produce cuatro y llamaria fallo a lo unico correcto que podia pasar.
 */
export function descendantsOf(ir: GenerationIr, entity: IrEntity): readonly IrEntity[] {
  const porSuperclase = new Map<string, IrEntity[]>();

  for (const candidata of ir.entities) {
    if (candidata.superEntityId === null) continue;
    const hermanas = porSuperclase.get(candidata.superEntityId) ?? [];
    hermanas.push(candidata);
    porSuperclase.set(candidata.superEntityId, hermanas);
  }

  const descendientes: IrEntity[] = [];
  const pendientes = [...(porSuperclase.get(entity.sourceClassId) ?? [])];

  while (pendientes.length > 0) {
    const actual = pendientes.shift() as IrEntity;
    descendientes.push(actual);
    pendientes.push(...(porSuperclase.get(actual.sourceClassId) ?? []));
  }

  return descendientes;
}

/** Un registro por entidad, con las claves foraneas apuntando a los ya creados. */
export function buildSampleRecords(ir: GenerationIr): readonly SampleRecord[] {
  const registros: SampleRecord[] = [];
  const idPorEntidad = new Map<string, string | number>();

  for (const entity of topologicalOrder(ir)) {
    const id = ['Integer', 'Long'].includes(entity.primaryKey.conceptualType)
      ? randomInt(1, 1_000_000_000)
      : randomUUID();
    const body: Record<string, unknown> = { [entity.primaryKey.fieldName]: id };

    for (const attribute of entity.attributes) {
      if (attribute.primaryKey) continue;
      body[attribute.fieldName] = sampleValue(attribute);
    }

    for (const relacion of entity.relationships) {
      const destino = idPorEntidad.get(relacion.targetEntityId);
      // Una relacion opcional sin destino creado se deja nula, que es
      // exactamente lo que RTM-06 permite.
      body[relacion.queryParameterName] = destino ?? null;
    }

    idPorEntidad.set(entity.sourceClassId, id);
    registros.push({ entity, id: String(id), body });
  }

  return registros;
}

/**
 * Un valor valido y reconocible para cada tipo.
 *
 * Los valores no son aleatorios salvo el identificador: que la prueba falle
 * siempre igual vale mas que cubrir mas casos por casualidad.
 */
function sampleValue(attribute: IrAttribute): unknown {
  switch (attribute.conceptualType) {
    case 'String':
      // Corto y unico: hay atributos con restriccion de unicidad, y repetir el
      // mismo texto en dos altas produciria un 409 que no viene al caso.
      return `${attribute.fieldName}-${randomUUID().slice(0, 8)}`;
    case 'Integer':
      return 7;
    case 'Long':
      return 1_234_567;
    case 'Decimal':
      return 42.5;
    case 'Boolean':
      return true;
    case 'Date':
      return '2026-09-01';
    case 'DateTime':
      // Sin zona horaria: es lo que espera `LocalDateTime`.
      return '2026-09-01T12:00:00';
    case 'UUID':
      return randomUUID();
  }
}

/** Un valor distinto del que ya tiene, para comprobar la modificacion. */
export function modifiedValue(attribute: IrAttribute): unknown {
  switch (attribute.conceptualType) {
    case 'Integer':
      return 99;
    case 'Long':
      return 9_999_999;
    case 'Decimal':
      return 99.5;
    case 'Boolean':
      return false;
    default:
      return sampleValue(attribute);
  }
}

/** El primer atributo modificable de la entidad, si tiene alguno. */
export function firstMutableAttribute(entity: IrEntity): IrAttribute | undefined {
  return entity.attributes.find((attribute) => !attribute.primaryKey && !attribute.unique);
}
