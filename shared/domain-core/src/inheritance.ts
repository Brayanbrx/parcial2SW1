import type { SemanticModel, UmlClass, UmlRelationship } from '@uml/contracts';

/**
 * Grafo de generalizacion (RM-07).
 *
 * Una generalizacion tiene la subclase en el origen y la superclase en el
 * destino. Es la unica relacion del vocabulario que **no** produce una clave
 * foranea: produce una jerarquia, y la jerarquia se proyecta a tabla por clase
 * unida por la clave primaria.
 *
 * Todo lo que necesitan saber el validador, la representacion intermedia y los
 * dos generadores sobre la herencia sale de aqui, en una sola implementacion
 * (RA-05). Dos recorridos distintos del mismo grafo terminarian discrepando en
 * el caso raro —la cadena de tres niveles, el ciclo— que es justo donde importa.
 */

/** La subclase es el origen y la superclase el destino. */
function isGeneralization(relationship: UmlRelationship): boolean {
  return relationship.kind === 'GENERALIZATION';
}

/**
 * Las relaciones que si producen una clave foranea.
 *
 * Asociacion, composicion y agregacion comparten proyeccion relacional; se
 * distinguen por su notacion y por lo que documentan, no por lo que generan.
 */
export function isStructuralRelationship(relationship: UmlRelationship): boolean {
  return !isGeneralization(relationship);
}

export interface InheritanceGraph {
  /** Superclase directa de cada subclase. Una clase sin herencia no aparece. */
  readonly superclassById: ReadonlyMap<string, string>;
  /** Subclases directas de cada superclase, en el orden en que se declararon. */
  readonly subclassesById: ReadonlyMap<string, readonly string[]>;
  /** Generalizaciones de una clase consigo misma. */
  readonly selfGeneralizations: readonly UmlRelationship[];
  /** Clases con mas de una superclase, con las generalizaciones implicadas. */
  readonly multipleInheritance: ReadonlyMap<string, readonly UmlRelationship[]>;
  /** Ciclos detectados, cada uno como la lista de clases que lo cierran. */
  readonly cycles: readonly (readonly string[])[];
}

export function buildInheritanceGraph(model: SemanticModel): InheritanceGraph {
  const existentes = new Set(model.classes.map((umlClass) => umlClass.id));

  const superclassById = new Map<string, string>();
  const subclassesById = new Map<string, string[]>();
  const selfGeneralizations: UmlRelationship[] = [];
  const porSubclase = new Map<string, UmlRelationship[]>();

  for (const relationship of model.relationships) {
    if (!isGeneralization(relationship)) continue;

    if (relationship.sourceClassId === relationship.targetClassId) {
      selfGeneralizations.push(relationship);
      continue;
    }

    // Una generalizacion hacia una clase borrada ya la denuncia
    // RELATIONSHIP_TO_MISSING_CLASS. Aqui se ignora para que el grafo solo
    // contenga aristas que se puedan recorrer.
    if (
      !existentes.has(relationship.sourceClassId) ||
      !existentes.has(relationship.targetClassId)
    ) {
      continue;
    }

    const acumuladas = porSubclase.get(relationship.sourceClassId) ?? [];
    acumuladas.push(relationship);
    porSubclase.set(relationship.sourceClassId, acumuladas);
  }

  const multipleInheritance = new Map<string, readonly UmlRelationship[]>();

  for (const [subclaseId, relaciones] of porSubclase) {
    if (relaciones.length > 1) multipleInheritance.set(subclaseId, [...relaciones]);

    // Se conserva la primera para que el grafo siga siendo recorrible: el
    // hallazgo bloquea la generacion, pero el editor tiene que poder seguir
    // dibujando y validando el resto del modelo mientras tanto.
    const primera = relaciones[0] as UmlRelationship;
    superclassById.set(subclaseId, primera.targetClassId);

    const hermanas = subclassesById.get(primera.targetClassId) ?? [];
    hermanas.push(subclaseId);
    subclassesById.set(primera.targetClassId, hermanas);
  }

  return {
    superclassById,
    subclassesById,
    selfGeneralizations,
    multipleInheritance,
    cycles: findCycles(superclassById),
  };
}

/**
 * Los ancestros de una clase, de la superclase directa hacia la raiz.
 *
 * El conjunto de visitados no es defensa teorica: mientras alguien dibuja, el
 * modelo pasa por estados con un ciclo a medio hacer, y el validador tiene que
 * poder recorrerlo para denunciarlo.
 */
export function ancestorsOf(graph: InheritanceGraph, classId: string): string[] {
  const ancestros: string[] = [];
  const vistos = new Set<string>([classId]);

  let actual = graph.superclassById.get(classId);
  while (actual !== undefined && !vistos.has(actual)) {
    ancestros.push(actual);
    vistos.add(actual);
    actual = graph.superclassById.get(actual);
  }

  return ancestros;
}

/** La clase de la que cuelga toda la jerarquia: la que no hereda de nadie. */
export function rootOf(graph: InheritanceGraph, classId: string): string {
  const ancestros = ancestorsOf(graph, classId);
  return ancestros.length === 0 ? classId : (ancestros[ancestros.length - 1] as string);
}

/**
 * Las clases ordenadas de forma que cada una va detras de su superclase.
 *
 * La representacion intermedia lo necesita porque una subclase hereda la clave
 * primaria de su raiz: para construirla hay que haber construido antes la de
 * arriba. Si queda alguna clase fuera del orden —solo puede pasar por un
 * ciclo— se anade al final para no perderla.
 */
export function inTopologicalOrder(
  model: SemanticModel,
  graph: InheritanceGraph,
): readonly UmlClass[] {
  const porId = new Map(model.classes.map((umlClass) => [umlClass.id, umlClass]));
  const ordenadas: UmlClass[] = [];
  const colocadas = new Set<string>();

  const colocar = (umlClass: UmlClass, enCurso: Set<string>): void => {
    if (colocadas.has(umlClass.id) || enCurso.has(umlClass.id)) return;
    enCurso.add(umlClass.id);

    const superclaseId = graph.superclassById.get(umlClass.id);
    const superclase = superclaseId === undefined ? undefined : porId.get(superclaseId);
    if (superclase !== undefined) colocar(superclase, enCurso);

    enCurso.delete(umlClass.id);
    colocadas.add(umlClass.id);
    ordenadas.push(umlClass);
  };

  for (const umlClass of model.classes) colocar(umlClass, new Set());
  for (const umlClass of model.classes) {
    if (!colocadas.has(umlClass.id)) ordenadas.push(umlClass);
  }

  return ordenadas;
}

/**
 * Ciclos de herencia, por recorrido con marcas.
 *
 * Cada nodo se sigue hasta la raiz o hasta volver a pisar algo del camino
 * actual; en ese caso el tramo repetido es el ciclo. Se normaliza empezando por
 * el identificador menor para que el mismo ciclo no se reporte dos veces con
 * distinto punto de partida.
 */
function findCycles(superclassById: ReadonlyMap<string, string>): (readonly string[])[] {
  const ciclos = new Map<string, readonly string[]>();
  const resueltos = new Set<string>();

  for (const inicio of superclassById.keys()) {
    if (resueltos.has(inicio)) continue;

    const camino: string[] = [];
    const posicion = new Map<string, number>();
    let actual: string | undefined = inicio;

    while (actual !== undefined && !resueltos.has(actual)) {
      const yaVisto = posicion.get(actual);
      if (yaVisto !== undefined) {
        const ciclo = camino.slice(yaVisto);
        const menor = [...ciclo].sort()[0] as string;
        const desde = ciclo.indexOf(menor);
        const normalizado = [...ciclo.slice(desde), ...ciclo.slice(0, desde)];
        ciclos.set(normalizado.join('>'), normalizado);
        break;
      }

      posicion.set(actual, camino.length);
      camino.push(actual);
      actual = superclassById.get(actual);
    }

    for (const visitado of camino) resueltos.add(visitado);
  }

  return [...ciclos.values()];
}
