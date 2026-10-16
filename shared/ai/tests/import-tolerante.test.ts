import { describe, expect, it } from 'vitest';
import { applyBatch } from '@uml/domain-core';
import type { SemanticModel } from '@uml/contracts';
import {
  MAX_PROPOSAL_OPERATIONS,
  interpretarPropuesta,
  resolveProposal,
  type AssistantOperation,
  type BatchProposal,
} from '../src/index.js';

/**
 * La importacion por fotografia no se corta en la primera duda.
 *
 * Una lectura ya costo una llamada al proveedor. Si el resolver la tirara
 * entera porque una clase ya estaba en la pizarra, o porque el modelo dejo una
 * duda escrita en `needsClarification`, la persona tendria que pagar otra
 * lectura para llegar al mismo candidato. En modo tolerante lo irresoluble se
 * omite y viaja como aviso; el asistente por texto conserva su regimen atomico.
 */

const actorId = '11111111-1111-4111-8111-111111111111';
const vacio: SemanticModel = { classes: [], relationships: [] };
const conCliente: SemanticModel = {
  classes: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayName: 'Cliente',
      codeName: 'Cliente',
      databaseName: 'cliente',
      attributes: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          displayName: 'nombre',
          codeName: 'nombre',
          databaseName: 'nombre',
          type: 'String',
          primaryKey: false,
          nullable: true,
          unique: false,
        },
      ],
    },
  ],
  relationships: [],
};

const create = (className: string): AssistantOperation => ({ op: 'CREATE_CLASS', className });
const attr = (className: string, attributeName: string): AssistantOperation => ({
  op: 'ADD_ATTRIBUTE',
  className,
  attributeName,
  type: 'String',
});
const rel = (fromClass: string, toClass: string): AssistantOperation => ({
  op: 'CREATE_RELATIONSHIP',
  fromClass,
  toClass,
  fromMultiplicity: '1',
  toMultiplicity: '0..*',
});

function tolerante(proposal: BatchProposal, model = vacio) {
  return resolveProposal({ proposal, model, actorId, origin: 'IMAGE', tolerante: true });
}

describe('importacion tolerante: lo irresoluble se omite, no bloquea', () => {
  it('una duda escrita junto a operaciones produce candidato y aviso, no pregunta', () => {
    const outcome = tolerante({
      operations: [create('Materia'), rel('Materia', 'Materia')],
      needsClarification:
        'El texto de la relacion en bucle de Materia no muestra roles; se interpreto como autoasociacion.',
    });

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;
    expect(outcome.batch.commands).toHaveLength(2);
    expect(outcome.skipped).toEqual([
      { element: 'la lectura', reason: expect.stringContaining('bucle de Materia') },
    ]);
  });

  it('sin operaciones, la duda sigue siendo una pregunta: no hay nada que aplicar', () => {
    const outcome = tolerante({ operations: [], needsClarification: 'No veo un diagrama.' });
    expect(outcome).toMatchObject({ kind: 'QUESTION', question: 'No veo un diagrama.' });
  });

  it('el asistente por texto conserva el regimen atomico', () => {
    const outcome = resolveProposal({
      proposal: { operations: [create('Materia')], needsClarification: '¿Materia o Material?' },
      model: vacio,
      actorId,
      origin: 'AI_TEXT',
    });
    expect(outcome.kind).toBe('QUESTION');
    expect('skipped' in outcome).toBe(false);
  });

  it('una clase que ya estaba se reutiliza: sus atributos nuevos se anaden a la existente', () => {
    const outcome = tolerante(
      {
        operations: [
          create('Cliente'),
          attr('Cliente', 'nombre'),
          attr('Cliente', 'correo'),
          create('Pedido'),
          rel('Cliente', 'Pedido'),
        ],
      },
      conCliente,
    );

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;
    expect(outcome.batch.commands.map((c) => c.type)).toEqual([
      'ADD_ATTRIBUTE',
      'CREATE_CLASS',
      'CREATE_RELATIONSHIP',
    ]);
    expect(outcome.skipped?.map((s) => s.element)).toEqual([
      'Clase «Cliente»',
      'Atributo «nombre» de «Cliente»',
    ]);

    const aplicado = applyBatch(
      { schemaVersion: '1.0.0', semantic: conCliente, layout: { positions: {}, sizes: {} } },
      outcome.batch,
    );
    expect(aplicado.applied).toBe(true);
    if (!aplicado.applied) return;
    const cliente = aplicado.state.semantic.classes.find((c) => c.displayName === 'Cliente');
    expect(cliente?.attributes.map((a) => a.displayName)).toEqual(['nombre', 'correo']);
    expect(aplicado.state.semantic.relationships).toHaveLength(1);
  });

  it('una relacion hacia una clase que no se leyo se omite y el resto sigue', () => {
    const outcome = tolerante({
      operations: [create('Curso'), rel('Curso', 'Fantasma'), attr('Curso', 'grupo')],
    });

    expect(outcome.kind).toBe('BATCH');
    if (outcome.kind !== 'BATCH') return;
    expect(outcome.batch.commands.map((c) => c.type)).toEqual(['CREATE_CLASS', 'ADD_ATTRIBUTE']);
    expect(outcome.skipped).toEqual([
      {
        element: 'Relacion «Curso» — «Fantasma»',
        reason: expect.stringContaining('Fantasma'),
      },
    ]);
  });

  it('si todo se omite, se explica por que en lugar de entregar un lote vacio', () => {
    const outcome = tolerante({ operations: [create('Cliente')] }, conCliente);
    expect(outcome.kind).toBe('QUESTION');
    if (outcome.kind !== 'QUESTION') return;
    expect(outcome.question).toContain('Clase «Cliente»');
    expect(outcome.skipped).toHaveLength(1);
  });

  it('el modo de reemplazo sigue pidiendo confirmacion, con el lote listo', () => {
    const outcome = tolerante(
      {
        operations: [
          { op: 'DELETE_CLASS', className: 'Cliente' },
          create('Cliente'),
          attr('Cliente', 'nombre'),
        ],
      },
      conCliente,
    );
    expect(outcome.kind).toBe('CONFIRMATION');
    if (outcome.kind !== 'CONFIRMATION') return;
    expect(outcome.batch.commands).toHaveLength(3);
    expect(outcome.skipped).toEqual([]);
  });
});

describe('interpretacion tolerante: una lectura pagada no se tira por un detalle', () => {
  const clase = (className: string) => ({ op: 'CREATE_CLASS', className });
  const relacion = (extra: Record<string, unknown>) => ({
    op: 'CREATE_RELATIONSHIP',
    fromClass: 'A',
    toClass: 'B',
    ...extra,
  });

  it('un needsClarification vacio no tumba la propuesta, ni en el asistente', () => {
    const texto = JSON.stringify({
      operations: [clase('A')],
      rationale: '',
      needsClarification: '',
    });
    for (const opciones of [{ tolerante: true }, {}]) {
      const propuesta = interpretarPropuesta('test', texto, opciones);
      expect(propuesta.operations).toHaveLength(1);
      expect(propuesta.needsClarification).toBeUndefined();
      expect(propuesta.rationale).toBeUndefined();
    }
  });

  it('las relaciones sin multiplicidad se completan y se avisa, en vez de descartarlas', () => {
    const texto = JSON.stringify({
      operations: [
        clase('A'),
        clase('B'),
        relacion({ kind: 'GENERALIZATION' }),
        relacion({ toMultiplicity: '0..*' }),
        relacion({}),
      ],
      rationale: 'Lectura de prueba.',
    });
    const propuesta = interpretarPropuesta('test', texto, { tolerante: true });

    expect(propuesta.operations).toHaveLength(5);
    expect(propuesta.operations.slice(2)).toEqual([
      expect.objectContaining({ fromMultiplicity: '1', toMultiplicity: '1' }),
      expect.objectContaining({ fromMultiplicity: '1', toMultiplicity: '0..*' }),
      expect.objectContaining({ fromMultiplicity: '1', toMultiplicity: '0..*' }),
    ]);
    // La generalizacion no cuenta como suposicion: no tiene multiplicidad.
    expect(propuesta.rationale).toBe(
      'Se supuso 1 — 0..* en 2 relacion(es) que venian sin multiplicidad; revisalas antes de ' +
        'aplicar. Lectura de prueba.',
    );
    // El asistente por texto sigue siendo estricto.
    expect(() => interpretarPropuesta('test', texto)).toThrow(/fromMultiplicity/);
  });

  it('una operacion vacia se descarta sola, sin anular las demas', () => {
    const texto = JSON.stringify({
      operations: [clase('A'), { op: 'CHANGE_MULTIPLICITY', fromClass: 'A', toClass: 'B' }],
    });
    const propuesta = interpretarPropuesta('test', texto, { tolerante: true });
    expect(propuesta.operations).toEqual([clase('A')]);
    expect(propuesta.rationale).toContain('CHANGE_MULTIPLICITY (no indica ningun cambio)');
  });

  it('pasarse del maximo recorta y avisa, no anula la lectura', () => {
    const operations = Array.from({ length: MAX_PROPOSAL_OPERATIONS + 5 }, (_, i) =>
      clase(`C${String(i)}`),
    );
    const propuesta = interpretarPropuesta('test', JSON.stringify({ operations }), {
      tolerante: true,
    });
    expect(propuesta.operations).toHaveLength(MAX_PROPOSAL_OPERATIONS);
    expect(propuesta.rationale).toContain('Se dejaron fuera 5 operaciones');
  });
});
