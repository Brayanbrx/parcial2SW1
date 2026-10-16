import { CONCEPTUAL_TYPES, type ConceptualType, type SemanticModel } from '@uml/contracts';
import { toWords } from '@uml/domain-core';
import type { AssistantOperation, BatchProposal } from '../proposal.js';
import type {
  AnswerOptions,
  AnswerResult,
  LlmPort,
  ProposeOptions,
  ProposeResult,
  SpeechPort,
  VisionPort,
} from '../ports.js';

/**
 * Adaptadores simulados. **No son opcionales** (plan maestro 6.4).
 *
 * Son lo que permite que las pruebas del dominio y el banco de regresion corran
 * en integracion continua sin llamar a un servicio de pago ni depender de la red.
 * Sin ellos, cada ejecucion cuesta dinero y falla cuando el proveedor tiene un
 * mal dia.
 *
 * Las respuestas son fijas y deterministas: interpretan la instruccion con
 * patrones, no con un modelo. No pretenden ser inteligentes — pretenden ser
 * predecibles, que es lo que una prueba necesita.
 */

const PROVIDER = 'mock';

export class MockLlmPort implements LlmPort {
  public readonly name = PROVIDER;

  public async proposeCommands(options: ProposeOptions): Promise<ProposeResult> {
    const inicio = Date.now();
    const instruccionAcumulada = [
      ...(options.context ?? [])
        .filter((turno) => turno.role === 'user')
        .map((turno) => turno.text),
      options.instruction,
    ].join(' ');

    return {
      proposal: interpretar(instruccionAcumulada, options.snapshot),
      usage: {
        provider: PROVIDER,
        model: 'mock-determinista',
        latencyMs: Date.now() - inicio,
      },
    };
  }

  public async answer(options: AnswerOptions): Promise<AnswerResult> {
    const { snapshot, issues = [] } = options;
    const errores = issues.filter((item) => item.severity === 'ERROR');

    const partes = [
      `La pizarra tiene ${snapshot.classes.length} clases y ${snapshot.relationships.length} relaciones.`,
      snapshot.classes.length === 0
        ? 'Todavia no hay ninguna clase.'
        : `Clases: ${snapshot.classes.map((umlClass) => umlClass.displayName).join(', ')}.`,
      errores.length === 0
        ? 'No hay errores que impidan generar.'
        : `Hay ${errores.length} error(es) que bloquean la generacion: ${errores.map((item) => item.message).join(' ')}`,
    ];

    return {
      text: partes.join(' '),
      usage: { provider: PROVIDER, model: 'mock-determinista', latencyMs: 0 },
    };
  }
}

export class MockVisionPort implements VisionPort {
  public readonly name = PROVIDER;

  public async extractModel(): Promise<{ proposal: BatchProposal }> {
    // Un candidato fijo y pequeno. La fase 8 lo sustituye por el modelo de vision
    // real; hasta entonces esto es lo que prueba el camino completo.
    return {
      proposal: {
        operations: [
          { op: 'CREATE_CLASS', className: 'Cliente' },
          { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'nombre', type: 'String' },
          { op: 'CREATE_CLASS', className: 'Pedido' },
          { op: 'ADD_ATTRIBUTE', className: 'Pedido', attributeName: 'fecha', type: 'DateTime' },
          {
            op: 'CREATE_RELATIONSHIP',
            fromClass: 'Cliente',
            toClass: 'Pedido',
            fromMultiplicity: '1',
            toMultiplicity: '0..*',
          },
        ],
        rationale: 'Candidato fijo del adaptador simulado.',
      },
    };
  }
}

export class MockSpeechPort implements SpeechPort {
  public readonly name = PROVIDER;

  public async transcribe(): Promise<{ text: string }> {
    return { text: 'agrega telefono tipo String a Cliente' };
  }
}

// ---------------------------------------------------------------------------
// Interpretacion por patrones
// ---------------------------------------------------------------------------

/**
 * Reconoce las cuatro formas de instruccion que usan las pruebas y la demo.
 *
 * Esto **no** se presenta como inteligencia artificial en ningun sitio: es un
 * doble de prueba. El asistente de verdad es el adaptador del proveedor.
 */
function interpretar(instruccion: string, snapshot: SemanticModel): BatchProposal {
  const texto = instruccion.trim();
  const plano = normalizar(texto);

  // "agrega <atributo> tipo <Tipo> a <Clase>"
  const atributo =
    /^(?:agrega|anade|add)\s+(.+?)\s+(?:tipo|de tipo|type)\s+(\w+)\s+a\s+(.+)$/i.exec(texto);
  if (atributo !== null) {
    return {
      operations: [
        {
          op: 'ADD_ATTRIBUTE',
          className: (atributo[3] as string).trim(),
          attributeName: (atributo[1] as string).trim(),
          type: tipoDe(atributo[2] as string),
        },
      ],
      rationale: 'Anadir un atributo a una clase existente.',
    };
  }

  // "crea <Clase> con <a>, <b> y <c>"
  const claseConAtributos = /^(?:crea|crear|create)\s+(.+?)\s+con\s+(.+)$/i.exec(texto);
  if (claseConAtributos !== null) {
    const className = nombreDeClase(claseConAtributos[1] as string);
    const nombres = (claseConAtributos[2] as string)
      .split(/,| y | and /i)
      .map((parte) => parte.trim())
      .filter((parte) => parte.length > 0);

    return {
      operations: [
        { op: 'CREATE_CLASS', className },
        ...nombres.map<AssistantOperation>((nombre) => ({
          op: 'ADD_ATTRIBUTE',
          className,
          attributeName: nombre,
          type: 'String',
        })),
      ],
      rationale: 'Crear una clase con sus atributos.',
    };
  }

  // "crea <Clase>"
  const clase = /^(?:crea|crear|create)\s+(.+)$/i.exec(texto);
  if (clase !== null) {
    return {
      operations: [{ op: 'CREATE_CLASS', className: nombreDeClase(clase[1] as string) }],
      rationale: 'Crear una clase.',
    };
  }

  // "elimina <Clase>"
  const eliminar = /^(?:elimina|borra|delete)\s+(.+)$/i.exec(texto);
  if (eliminar !== null) {
    return {
      operations: [{ op: 'DELETE_CLASS', className: nombreDeClase(eliminar[1] as string) }],
      rationale: 'Eliminar una clase.',
    };
  }

  // "<Subclase> hereda de <Superclase>"
  const herencia = /^(.+?)\s+(?:hereda de|extiende de|extiende|es un(?:a)?)\s+(.+)$/i.exec(texto);
  if (herencia !== null) {
    return {
      operations: [
        {
          op: 'CREATE_RELATIONSHIP',
          kind: 'GENERALIZATION',
          // El origen es la subclase y el destino la superclase: es la unica
          // relacion del vocabulario en la que el orden no es simetrico.
          fromClass: nombreDeClase(herencia[1] as string),
          toClass: nombreDeClase(herencia[2] as string),
          fromMultiplicity: '1',
          toMultiplicity: '1',
        },
      ],
      rationale: 'Crear una generalizacion.',
    };
  }

  // "relaciona <A> con <B>"
  const relacion = /^(?:relaciona|conecta)\s+(.+?)\s+con\s+(.+)$/i.exec(texto);
  if (relacion !== null) {
    return {
      operations: [
        {
          op: 'CREATE_RELATIONSHIP',
          fromClass: nombreDeClase(relacion[1] as string),
          toClass: nombreDeClase(relacion[2] as string),
          fromMultiplicity: '1',
          toMultiplicity: '0..*',
        },
      ],
      rationale: 'Relacionar dos clases.',
    };
  }

  // Nada reconocido. Se dice, en lugar de devolver una propuesta vacia: "no
  // entendi" y "no hay nada que hacer" necesitan respuestas distintas.
  return {
    operations: [],
    needsClarification:
      snapshot.classes.length === 0
        ? 'No entendi la instruccion. Prueba con «crea Cliente».'
        : `No entendi «${plano}». Prueba con «agrega telefono tipo String a ${snapshot.classes[0]?.displayName ?? 'Cliente'}».`,
  };
}

function normalizar(texto: string): string {
  return toWords(texto).join(' ');
}

/**
 * Palabras que preceden al nombre y no forman parte de el.
 *
 * «crea una clase Usuario» tiene que crear `Usuario`, no `una clase Usuario`.
 * La version anterior solo quitaba «la» y «clase» en ese orden exacto, asi que
 * cualquier otra forma de decirlo —«una clase», «la entidad», «una nueva
 * tabla»— acababa dentro del nombre. Se veia enseguida: la clase salia en el
 * diagrama llamada «una clase Usuario», con su nombre tecnico
 * `una_clase_usuario`, y de ahi pasaba al codigo generado y al XMI.
 */
const PREFIJOS_DE_NOMBRE = new Set([
  'un',
  'una',
  'unos',
  'unas',
  'el',
  'la',
  'los',
  'las',
  'nuevo',
  'nueva',
  'clase',
  'clases',
  'entidad',
  'entidades',
  'tabla',
  'tablas',
]);

export function nombreDeClase(texto: string): string {
  const palabras = texto
    .trim()
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0);
  let inicio = 0;

  // Se para al llegar a la ultima palabra: «crea clase» tiene que dejar
  // «clase» como nombre en lugar de quedarse sin nada.
  while (
    inicio < palabras.length - 1 &&
    PREFIJOS_DE_NOMBRE.has((palabras[inicio] as string).toLowerCase())
  ) {
    inicio += 1;
  }

  return palabras.slice(inicio).join(' ');
}

function tipoDe(nombre: string): ConceptualType {
  const buscado = nombre.toLowerCase();
  const alias: Readonly<Record<string, ConceptualType>> = {
    int: 'Integer',
    entero: 'Integer',
    varchar: 'String',
    text: 'String',
    texto: 'String',
    bool: 'Boolean',
    booleano: 'Boolean',
    numeric: 'Decimal',
    numero: 'Decimal',
    timestamp: 'DateTime',
  };
  if (alias[buscado] !== undefined) return alias[buscado];
  const encontrado = CONCEPTUAL_TYPES.find((tipo) => tipo.toLowerCase() === buscado);
  return encontrado ?? 'String';
}
