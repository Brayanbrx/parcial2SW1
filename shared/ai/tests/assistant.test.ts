import { RELATIONSHIP_KINDS, type SemanticModel } from '@uml/contracts';
import { applyBatch } from '@uml/domain-core';
import { fixture } from '@uml/fixtures';
import {
  MockLlmPort,
  MockVisionPort,
  inferirTipoAtributo,
  interpretarPropuesta,
  nombreDeClase,
  MAX_PROPOSAL_OPERATIONS,
  ProviderContractError,
  PROPOSAL_JSON_SCHEMA,
  PROPOSAL_OPERATION_NAMES,
  describir,
  pareceTruncada,
  assistantOperationSchema,
  batchProposalSchema,
  resolveProposal,
  type BatchProposal,
  type ResolutionOutcome,
} from '@uml/ai';
import { describe, expect, it } from 'vitest';

/**
 * Capa de IA. Todo con el adaptador simulado: estas pruebas corren en
 * integracion continua y nunca llaman a un proveedor de pago (15.5).
 */

const ACTOR = '11111111-1111-4111-8111-111111111111';

function identificadores(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
  };
}

async function instruir(
  instruccion: string,
  modelo: SemanticModel,
): Promise<{ proposal: BatchProposal; outcome: ResolutionOutcome }> {
  const { proposal } = await new MockLlmPort().proposeCommands({
    instruction: instruccion,
    snapshot: modelo,
  });

  return {
    proposal,
    outcome: resolveProposal({
      proposal,
      model: modelo,
      actorId: ACTOR,
      origin: 'AI_TEXT',
      newId: identificadores(),
      now: () => new Date('2026-09-01T12:00:00.000Z'),
    }),
  };
}

const t01 = fixture('T01').model;
const vacio: SemanticModel = { classes: [], relationships: [] };

describe('el modelo propone, el sistema resuelve', () => {
  it('XMI conserva atributos con nombres técnicos coincidentes para corregir el candidato', () => {
    const proposal: BatchProposal = {
      operations: [
        { op: 'CREATE_CLASS', className: 'Venta' },
        { op: 'ADD_ATTRIBUTE', className: 'Venta', attributeName: 'fecha de venta', type: 'Date' },
        { op: 'ADD_ATTRIBUTE', className: 'Venta', attributeName: 'fechaVenta', type: 'Date' },
      ],
    };
    const outcome = resolveProposal({ proposal, model: vacio, actorId: ACTOR, origin: 'XMI' });
    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') throw new Error('Debe ser editable');
    expect(outcome.batch.commands.filter((c) => c.type === 'ADD_ATTRIBUTE')).toHaveLength(2);
    // Las instrucciones de voz mantienen su búsqueda normalizada.
    expect(
      resolveProposal({ proposal, model: vacio, actorId: ACTOR, origin: 'AI_TEXT' }).kind,
    ).toBe('QUESTION');
  });
  it('CA-032.1 — anadir un atributo no cambia nada mas', async () => {
    // `telefono` no vale: T01 ya lo tiene, y el resolver preguntaria en lugar de
    // duplicarlo — que es justamente lo que comprueba otra prueba mas abajo.
    const { outcome } = await instruir('agrega direccion tipo String a Cliente', t01);

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;

    const resultado = applyBatch(
      { schemaVersion: '1.0.0', semantic: t01, layout: { positions: {}, sizes: {} } },
      outcome.batch,
    );
    expect(resultado.applied).toBe(true);
    if (!resultado.applied) return;

    const cliente = resultado.state.semantic.classes.find((c) => c.codeName === 'Cliente');
    expect(cliente?.attributes.map((a) => a.codeName)).toEqual([
      'id',
      'nombre',
      'correo',
      'telefono',
      'direccion',
    ]);

    // Y ningun otro elemento cambio.
    const resto = resultado.state.semantic.classes.filter((c) => c.codeName !== 'Cliente');
    expect(resto).toEqual(t01.classes.filter((c) => c.codeName !== 'Cliente'));
    expect(resultado.state.semantic.relationships).toEqual(t01.relationships);
  });

  it('CA-032.2 — "crea X con a, b y c" es un solo lote', async () => {
    const { outcome } = await instruir('crea Proveedor con nombre, nit y direccion', t01);

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;

    // Un CREATE_CLASS y tres ADD_ATTRIBUTE, en el mismo lote: si uno fuera
    // invalido no se aplicaria ninguno.
    expect(outcome.batch.commands.map((c) => c.type)).toEqual([
      'CREATE_CLASS',
      'ADD_ATTRIBUTE',
      'ADD_ATTRIBUTE',
      'ADD_ATTRIBUTE',
    ]);
  });

  it('el lote lleva el origen y el actor', async () => {
    const { outcome } = await instruir('crea Proveedor', t01);
    if (outcome.kind !== 'BATCH') throw new Error('deberia resolver');

    // RF-A09: cada lote se atribuye a un usuario identificado, y el origen dice
    // que vino del asistente y no de la interfaz.
    expect(outcome.batch.origin).toBe('AI_TEXT');
    expect(outcome.batch.actorId).toBe(ACTOR);
    expect(outcome.batch.commands.every((c) => c.origin === 'AI_TEXT')).toBe(true);
  });

  it('RA-06 — solo produce comandos del vocabulario cerrado', async () => {
    const { outcome } = await instruir('relaciona Cliente con Producto', t01);
    if (outcome.kind !== 'BATCH') throw new Error('deberia resolver');

    expect(outcome.batch.commands.map((c) => c.type)).toEqual(['CREATE_RELATIONSHIP']);
  });
});

describe('el modelo nunca resuelve identificadores (6.5)', () => {
  it('la propuesta se expresa por nombre', async () => {
    const { proposal } = await instruir('agrega telefono tipo String a Cliente', t01);

    // Nada en la propuesta se parece a un identificador del modelo.
    const serializada = JSON.stringify(proposal);
    for (const umlClass of t01.classes) {
      expect(serializada).not.toContain(umlClass.id);
    }
  });

  it('el resolver encuentra la clase aunque el nombre venga escrito de otra forma', async () => {
    // Quien habla dice "detalle de venta"; la clase se llama "Detalle de Venta".
    // Exigir la cadena exacta es justo lo que un asistente por voz no puede pedir.
    const { outcome } = await instruir('agrega observacion tipo String a detalle de venta', t01);

    expect(outcome.kind).toBe('BATCH');
  });
});

describe('desambiguacion estructural (6.6)', () => {
  it('pregunta cuando el objetivo no existe, y ofrece lo que si hay', async () => {
    const { outcome } = await instruir('agrega telefono tipo String a Inexistente', t01);

    expect(outcome.kind).toBe('QUESTION');
    if (outcome.kind !== 'QUESTION') return;

    expect(outcome.question).toMatch(/no encuentro/i);
    expect(outcome.options).toEqual(expect.arrayContaining(['Cliente', 'Producto']));
  });

  it('pregunta cuando el objetivo resuelve a mas de un elemento', async () => {
    // Una pizarra que quedo con dos clases del mismo nombre tecnico por una
    // fusion concurrente (CA-025.1). Adivinar cual seria peor que preguntar.
    const ambiguo: SemanticModel = {
      classes: [
        {
          id: '33333333-3333-4333-8333-000000000001',
          displayName: 'Detalle de Venta',
          codeName: 'DetalleVenta',
          databaseName: 'detalle_venta',
          attributes: [],
        },
        {
          id: '33333333-3333-4333-8333-000000000002',
          displayName: 'detalle venta',
          codeName: 'DetalleVenta',
          databaseName: 'detalle_venta',
          attributes: [],
        },
      ],
      relationships: [],
    };

    const { outcome } = await instruir('agrega cantidad tipo Integer a Detalle de Venta', ambiguo);

    expect(outcome.kind).toBe('QUESTION');
    if (outcome.kind !== 'QUESTION') return;
    expect(outcome.question).toMatch(/2 clases/i);
    expect(outcome.options).toHaveLength(2);
  });

  it('pregunta cuando no entendio, en lugar de proponer nada', async () => {
    const { outcome } = await instruir('haz algo bonito con esto', t01);

    expect(outcome.kind).toBe('QUESTION');
  });

  it('6.7 — no construye el diagrama entero desde una descripcion', async () => {
    // El docente fue explicito: el agente asiste, no autogenera. La unica
    // excepcion es la importacion desde fotografia o XMI.
    const { outcome } = await instruir('hazme un sistema de facturacion completo', vacio);

    expect(outcome.kind).toBe('QUESTION');
  });

  it('avisa si el atributo ya existe en lugar de duplicarlo', async () => {
    const { outcome } = await instruir('agrega nombre tipo String a Cliente', t01);

    expect(outcome.kind).toBe('QUESTION');
    if (outcome.kind !== 'QUESTION') return;
    expect(outcome.question).toMatch(/ya tiene/i);
  });
});

describe('una operacion ve lo que hicieron las anteriores del mismo lote', () => {
  it('lo creado antes es resoluble despues', async () => {
    // "crea Cliente con nombre" son dos operaciones: la segunda apunta a la
    // clase que acaba de crear la primera.
    const { outcome } = await instruir('crea Proveedor con nombre y nit', vacio);

    expect(outcome.kind).toBe('BATCH');
  });

  it('lo borrado antes deja de existir despues', () => {
    // Reemplazar el contenido de una pizarra borra y vuelve a crear en el mismo
    // lote. Sin esto, cualquier nombre que se repitiera hacia fallar la
    // importacion en modo de reemplazo.
    const propuesta: BatchProposal = {
      operations: [
        { op: 'DELETE_CLASS', className: 'Cliente' },
        { op: 'CREATE_CLASS', className: 'Cliente' },
      ],
    };

    const outcome = resolveProposal({
      proposal: propuesta,
      model: t01,
      actorId: ACTOR,
      origin: 'XMI',
      newId: identificadores(),
    });

    expect(outcome.kind).toBe('CONFIRMATION');
    if (outcome.kind !== 'CONFIRMATION') return;
    expect(outcome.batch.commands.map((c) => c.type)).toEqual(['DELETE_CLASS', 'CREATE_CLASS']);
  });
});

describe('confirmacion de lo destructivo (RF-035)', () => {
  it('borrar una clase con dependencias pide confirmacion', async () => {
    const { outcome } = await instruir('elimina Cliente', t01);

    expect(outcome.kind).toBe('CONFIRMATION');
    if (outcome.kind !== 'CONFIRMATION') return;

    // El lote existe y esta listo: lo que falta es el visto bueno.
    expect(outcome.batch.commands.map((c) => c.type)).toEqual(['DELETE_CLASS']);
    expect(outcome.question).toMatch(/elimina \d+ elementos/i);
    expect(outcome.summary.join(' ')).toMatch(/dependen de ella/);
  });

  it('crear no pide confirmacion', async () => {
    const { outcome } = await instruir('crea Proveedor', t01);

    expect(outcome.kind).toBe('BATCH');
  });
});

describe('el asistente aplica las mismas reglas que la interfaz (RF-033)', () => {
  it('una propuesta que produce un lote inaplicable se rechaza', () => {
    // Una relacion hacia una clase que no esta en el modelo no llega a comando:
    // el resolver pregunta. Pero si la propuesta trae una operacion cuyo
    // resultado el dominio rechaza —un nombre sin identificador posible— el
    // resolver lo devuelve como rechazo, no como lote.
    const propuesta: BatchProposal = {
      operations: [{ op: 'CREATE_CLASS', className: '***' }],
    };

    const outcome = resolveProposal({
      proposal: propuesta,
      model: vacio,
      actorId: ACTOR,
      origin: 'AI_TEXT',
      newId: identificadores(),
    });

    expect(outcome.kind).toBe('REJECTED');
    if (outcome.kind !== 'REJECTED') return;
    expect(outcome.issues.map((i) => i.code)).toContain('INVALID_IDENTIFIER');
  });
});

describe('consultas sin modificar (RF-036 y RF-037)', () => {
  it('responde sobre la pizarra y senala los errores', async () => {
    const { text } = await new MockLlmPort().answer({
      question: '¿Puedo generar?',
      snapshot: t01,
      issues: [
        { code: 'DUPLICATE_CLASS_NAME', severity: 'ERROR', message: 'Dos clases colisionan.' },
      ],
    });

    expect(text).toContain('4 clases');
    expect(text).toMatch(/bloquean la generacion/i);
  });
});

/**
 * RM-07 - la herencia, por texto y por voz.
 *
 * Es la unica relacion cuyo orden no es simetrico, y la unica que el esquema
 * entregado al proveedor podia rechazar aunque el contrato la aceptara.
 */
describe('el asistente y la generalizacion', () => {
  it('«X hereda de Y» produce una generalizacion con la subclase en el origen', async () => {
    const { outcome } = await instruir('Detalle de Venta hereda de Venta', t01);

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;

    const comando = outcome.batch.commands[0];
    expect(comando?.type).toBe('CREATE_RELATIONSHIP');
    if (comando?.type !== 'CREATE_RELATIONSHIP') return;

    const clase = (codeName: string): string | undefined =>
      t01.classes.find((c) => c.codeName === codeName)?.id;

    expect(comando.payload.kind).toBe('GENERALIZATION');
    expect(comando.payload.sourceClassId).toBe(clase('DetalleVenta'));
    expect(comando.payload.targetClassId).toBe(clase('Venta'));
  });

  it('el esquema que se entrega al proveedor admite `kind`', () => {
    // Sin esta propiedad la herencia era inalcanzable desde el asistente: el
    // esquema declara `additionalProperties: false`, asi que un `kind` que no
    // este enumerado aqui se rechaza antes de que el contrato lo vea.
    const propiedades = PROPOSAL_JSON_SCHEMA.properties.operations.items.properties;

    expect(propiedades.kind.enum).toContain('GENERALIZATION');
    expect([...propiedades.kind.enum].sort()).toEqual([...RELATIONSHIP_KINDS].sort());
  });

  it('el estado que ve el modelo distingue la herencia de una asociacion', () => {
    const persona = t01.classes[0];
    const cliente = t01.classes[1];
    if (persona === undefined || cliente === undefined) throw new Error('T01 sin clases');

    const conHerencia: SemanticModel = {
      classes: t01.classes,
      relationships: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          kind: 'GENERALIZATION',
          sourceClassId: cliente.id,
          targetClassId: persona.id,
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
        },
      ],
    };

    const texto = describir(conHerencia);
    expect(texto).toContain(
      `${JSON.stringify(cliente.displayName)} hereda de ${JSON.stringify(persona.displayName)}`,
    );
    // Y sin multiplicidades, que en una generalizacion no significan nada.
    expect(texto).not.toContain(`${cliente.displayName} 1 —`);
  });
});

describe('el contrato del proveedor', () => {
  it('el esquema JSON y el esquema Zod enumeran las mismas operaciones', () => {
    // Es lo unico que puede desincronizarse en silencio: el esquema JSON se
    // escribe a mano porque los proveedores exigen un subconjunto estricto.
    const enZod = assistantOperationSchema.options.map((opcion) => opcion.shape.op.value as string);

    expect([...PROPOSAL_OPERATION_NAMES].sort()).toEqual([...new Set(enZod)].sort());
  });

  it('acepta los `null` con los que un proveedor rellena lo que no aplica', () => {
    // Con salida estructurada estricta, un proveedor devuelve todas las
    // propiedades del esquema y pone `null` en las que no usa. Ninguna admite
    // `null`, asi que la propuesta entera se caia con un mensaje que hablaba de
    // `needsClarification` cuando el problema no era ese.
    const conNulos = JSON.stringify({
      operations: [
        {
          op: 'CREATE_RELATIONSHIP',
          kind: 'GENERALIZATION',
          fromClass: 'Estudiante',
          toClass: 'Persona',
          fromMultiplicity: '1',
          toMultiplicity: '1',
          fromRole: null,
          toRole: null,
        },
      ],
      rationale: 'Crear una generalizacion.',
      needsClarification: null,
    });

    const propuesta = interpretarPropuesta('openrouter', conNulos);

    expect(propuesta.needsClarification).toBeUndefined();
    expect(propuesta.operations[0]).toMatchObject({
      op: 'CREATE_RELATIONSHIP',
      kind: 'GENERALIZATION',
    });
    expect(propuesta.operations[0]).not.toHaveProperty('fromRole');
  });

  it('rechaza una propuesta que no cumple el contrato', () => {
    for (const invalida of [
      { operations: [{ op: 'DROP_DATABASE' }] },
      {
        operations: [
          { op: 'ADD_ATTRIBUTE', className: 'Cliente', attributeName: 'x', type: 'Blob' },
        ],
      },
      { operations: [{ op: 'CREATE_CLASS' }] },
    ]) {
      expect(batchProposalSchema.safeParse(invalida).success).toBe(false);
    }
  });

  describe('una respuesta cortada a la mitad', () => {
    /** Lo que devuelve un proveedor al que se le acaba el presupuesto de salida. */
    function cortada(clases: number): string {
      const completo = JSON.stringify({
        operations: Array.from({ length: clases }, (_, i) => ({
          op: 'CREATE_CLASS',
          className: `Clase${String(i + 1).padStart(2, '0')}`,
        })),
      });

      // A media operacion: ni la llave ni las comillas cierran.
      return `${completo.slice(0, completo.lastIndexOf('{'))}{"op":"CREATE_CLA`;
    }

    it('aprovecha las operaciones completas en vez de perder la importacion entera', () => {
      // El sintoma que lo motivo: la foto de un diagrama de catorce clases
      // terminaba en «La respuesta no era JSON valido» y ni una sola clase.
      const propuesta = interpretarPropuesta('prueba', cortada(14), { tolerante: true });

      expect(propuesta.operations).toHaveLength(13);
      expect(propuesta.operations.at(0)).toMatchObject({ className: 'Clase01' });
      expect(propuesta.operations.at(-1)).toMatchObject({ className: 'Clase13' });
    });

    it('avisa de que la lectura quedo incompleta', () => {
      // Sin el aviso, trece clases de catorce llegan con el mismo aspecto que
      // catorce de catorce, y quien las aplica no tiene forma de saberlo.
      const propuesta = interpretarPropuesta('prueba', cortada(14), { tolerante: true });

      expect(propuesta.rationale).toMatch(/cortada/i);
      expect(propuesta.rationale).toContain('13');
    });

    it('no confunde una llave dentro de un texto con el fin de una operacion', () => {
      const propuesta = interpretarPropuesta(
        'prueba',
        '{"operations":[{"op":"CREATE_CLASS","className":"Con} llave"},{"op":"CREATE_CL',
        { tolerante: true },
      );

      expect(propuesta.operations).toEqual([{ op: 'CREATE_CLASS', className: 'Con} llave' }]);
    });

    it('sigue fallando cuando no hay nada que rescatar', () => {
      // Rescatar es para un corte, no para tapar una respuesta que no era una
      // propuesta: inventarse una vacia seria peor que fallar.
      expect(() => interpretarPropuesta('prueba', 'Claro, aqui tienes tu diagrama:')).toThrow(
        ProviderContractError,
      );
      expect(() => interpretarPropuesta('prueba', '{"operations":[{"op":')).toThrow(
        ProviderContractError,
      );
    });
  });

  describe('una operacion que el contrato rechaza', () => {
    const conUnaMala = JSON.stringify({
      operations: [
        { op: 'CREATE_CLASS', className: 'Persona' },
        { op: 'ADD_ATTRIBUTE', className: 'Persona', attributeName: 'ci', type: 'String' },
        // `varchar` no esta en el vocabulario conceptual.
        { op: 'ADD_ATTRIBUTE', className: 'Persona', attributeName: 'nombre', type: 'varchar' },
        { op: 'CREATE_CLASS', className: 'Curso' },
      ],
    });

    it('sin tolerancia tira la propuesta entera, como necesita el asistente', () => {
      // El prompt le promete al modelo que el lote es atomico. Aplicar la mitad
      // de lo que alguien pidio seria peor que no aplicar nada.
      expect(() => interpretarPropuesta('prueba', conUnaMala)).toThrow(ProviderContractError);
    });

    it('con tolerancia conserva las buenas y descarta la mala', () => {
      // Importar una fotografia produce un candidato editable: perder sesenta y
      // ocho operaciones buenas por una con un tipo raro no ayuda a nadie.
      const propuesta = interpretarPropuesta('prueba', conUnaMala, { tolerante: true });

      expect(propuesta.operations).toHaveLength(3);
      expect(propuesta.operations.map((o) => o.op)).toEqual([
        'CREATE_CLASS',
        'ADD_ATTRIBUTE',
        'CREATE_CLASS',
      ]);
    });

    it('cuenta lo descartado en la explicacion que se le muestra a la persona', () => {
      const propuesta = interpretarPropuesta('prueba', conUnaMala, { tolerante: true });

      expect(propuesta.rationale).toContain('1');
      expect(propuesta.rationale).toContain('ADD_ATTRIBUTE');
    });

    it('sigue fallando si no sobrevive ninguna, en vez de dar un candidato vacio', () => {
      const todasMalas = JSON.stringify({
        operations: [
          { op: 'ADD_ATTRIBUTE', className: 'Persona', attributeName: 'x', type: 'Blob' },
        ],
      });

      expect(() => interpretarPropuesta('prueba', todasMalas, { tolerante: true })).toThrow(
        ProviderContractError,
      );
    });

    it('el error dice que estaba mal, no solo que algo lo estaba', () => {
      // «La propuesta no cumple el contrato de operaciones» obligaba a mirar el
      // registro del servidor, al que quien importa una foto no tiene acceso.
      try {
        interpretarPropuesta('prueba', conUnaMala);
        expect.unreachable('tenia que fallar');
      } catch (error) {
        expect((error as Error).message).toMatch(/type|operations/i);
      }
    });
  });

  it('completa un tipo omitido antes de validar la respuesta del proveedor', () => {
    const propuesta = interpretarPropuesta(
      'prueba',
      JSON.stringify({
        operations: [
          { op: 'ADD_ATTRIBUTE', className: 'Producto', attributeName: 'id' },
          { op: 'ADD_ATTRIBUTE', className: 'Producto', attributeName: 'descripcion' },
        ],
      }),
    );

    expect(propuesta.operations).toEqual([
      { op: 'ADD_ATTRIBUTE', className: 'Producto', attributeName: 'id', type: 'Integer' },
      {
        op: 'ADD_ATTRIBUTE',
        className: 'Producto',
        attributeName: 'descripcion',
        type: 'String',
      },
    ]);
  });
});

describe('inferencia de tipos por naturaleza del atributo', () => {
  const casos: readonly (readonly [string, string])[] = [
    ['id', 'Integer'],
    ['productoId', 'Integer'],
    ['descripcion', 'String'],
    ['correoElectronico', 'String'],
    ['fecha', 'Date'],
    ['fechaHora', 'DateTime'],
    ['creadoEn', 'DateTime'],
    ['precio', 'Decimal'],
    ['cantidad', 'Integer'],
    ['estaActivo', 'Boolean'],
    ['uuid', 'UUID'],
    ['observacionLibre', 'String'],
  ];

  for (const [nombre, esperado] of casos) {
    it(`${nombre} -> ${esperado}`, () => {
      expect(inferirTipoAtributo(nombre)).toBe(esperado);
    });
  }
});

describe('el adaptador simulado es determinista (6.4)', () => {
  it('la misma instruccion produce siempre lo mismo', async () => {
    const primera = await instruir('crea Proveedor con nombre y nit', t01);
    const segunda = await instruir('crea Proveedor con nombre y nit', t01);

    expect(primera.proposal).toEqual(segunda.proposal);
    expect(JSON.stringify(primera.outcome)).toBe(JSON.stringify(segunda.outcome));
  });

  it('el candidato de vision tambien es fijo', async () => {
    const vision = new MockVisionPort();
    const primera = await vision.extractModel();
    const segunda = await vision.extractModel();

    expect(primera.proposal).toEqual(segunda.proposal);
  });
});

/**
 * El nombre de la clase, sin las palabras que lo preceden.
 *
 * Un diagrama real acabó con una clase llamada «una clase Usuario», nombre
 * técnico `una_clase_usuario`, porque el instructor dijo «crea una clase
 * Usuario» y solo se quitaban «la» y «clase» en ese orden exacto. De ahí pasó al
 * código generado y al XMI que se abrió en Enterprise Architect.
 */
describe('nombre de clase en las instrucciones', () => {
  const casos: readonly (readonly [string, string])[] = [
    ['una clase Usuario', 'Usuario'],
    ['la clase Usuario', 'Usuario'],
    ['clase Usuario', 'Usuario'],
    ['un Usuario', 'Usuario'],
    ['una nueva entidad Pedido', 'Pedido'],
    ['la tabla Factura', 'Factura'],
    ['Usuario', 'Usuario'],
    ['Detalle de Venta', 'Detalle de Venta'],
  ];

  for (const [entrada, esperado] of casos) {
    it(`«${entrada}» → «${esperado}»`, () => {
      expect(nombreDeClase(entrada)).toBe(esperado);
    });
  }

  it('nunca se queda sin nombre', () => {
    // «crea clase» a secas: mejor una clase llamada «clase» que ninguna, y el
    // usuario la renombra. Devolver vacio produciria un error del validador
    // sobre algo que el no escribio.
    expect(nombreDeClase('clase')).toBe('clase');
    expect(nombreDeClase('una')).toBe('una');
  });
});

describe('tamano de una propuesta (RNF-03)', () => {
  function operaciones(cuantas: number): { op: 'CREATE_CLASS'; className: string }[] {
    return Array.from({ length: cuantas }, (_, indice) => ({
      op: 'CREATE_CLASS' as const,
      className: `Clase${indice}`,
    }));
  }

  it('cabe un modelo del tamano que el proyecto promete soportar', () => {
    // RNF-03 son 30 clases, 100 atributos y 40 relaciones: 170 operaciones.
    // Con el tope anterior de 40, importar la foto de un diagrama de ocho
    // tablas se cortaba por la mitad **en silencio**.
    expect(batchProposalSchema.safeParse({ operations: operaciones(170) }).success).toBe(true);
    expect(batchProposalSchema.safeParse({ operations: operaciones(200) }).success).toBe(true);
  });

  it('sigue habiendo un tope, y pasarlo se rechaza', () => {
    // El tope existe para acotar lo que un proveedor puede proponer de una vez.
    expect(batchProposalSchema.safeParse({ operations: operaciones(201) }).success).toBe(false);
  });

  it('el esquema que se le entrega al modelo declara el mismo tope', () => {
    // Si divergieran, el modelo produciria mas de lo que el validador acepta y
    // la propuesta se rechazaria entera despues de haberla pagado.
    expect(PROPOSAL_JSON_SCHEMA.properties.operations.maxItems).toBe(MAX_PROPOSAL_OPERATIONS);
  });

  it('una propuesta que llega al tope se marca como probablemente truncada', () => {
    // Es la unica senal disponible: al modelo se le da un maximo y lo respeta
    // sin decir que dejo cosas fuera.
    const alTope = batchProposalSchema.parse({ operations: operaciones(MAX_PROPOSAL_OPERATIONS) });
    const holgada = batchProposalSchema.parse({ operations: operaciones(12) });

    expect(pareceTruncada(alTope)).toBe(true);
    expect(pareceTruncada(holgada)).toBe(false);
  });
});
