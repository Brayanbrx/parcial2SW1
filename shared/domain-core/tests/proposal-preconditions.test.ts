import { describe, expect, it } from 'vitest';
import { applyBatch, validateProposalPreconditions } from '@uml/domain-core';
import type { BoardState, CommandBatch } from '@uml/contracts';
import { batch, cmd, emptyBoard, nextId } from './helpers.js';

function apply(state: BoardState, commands: CommandBatch): BoardState {
  const result = applyBatch(state, commands);
  if (!result.applied) throw new Error(JSON.stringify(result.issues));
  return result.state;
}

describe('precondiciones de propuestas revisadas', () => {
  const a = nextId(),
    b = nextId();
  const baseline = apply(
    emptyBoard(),
    batch(cmd.createClass(a, 'Cliente'), cmd.createClass(b, 'Venta')),
  );

  it('rechaza borrar una clase a la que añadieron atributos después de prepararla', () => {
    const current = apply(baseline, batch(cmd.addAttribute(a, nextId(), 'nombre')));
    expect(
      validateProposalPreconditions(batch(cmd.deleteClass(a)), baseline.semantic, current.semantic),
    ).toEqual([expect.objectContaining({ code: 'STALE_PROPOSAL', elementIds: [a] })]);
  });

  it('rechaza el borrado si ahora arrastraría una relación nueva', () => {
    const id = nextId();
    const current = apply(baseline, batch(cmd.createRelationship(id, a, b)));
    expect(
      validateProposalPreconditions(
        batch(cmd.deleteClass(a)),
        baseline.semantic,
        current.semantic,
      )[0]?.elementIds,
    ).toContain(id);
  });

  it('permite cambios ajenos y desplazamientos mientras se revisa', () => {
    const current = apply(baseline, batch(cmd.renameClass(b, 'Pedido'), cmd.moveClass(a, 20, 30)));
    expect(
      validateProposalPreconditions(
        batch(cmd.addAttribute(a, nextId(), 'telefono')),
        baseline.semantic,
        current.semantic,
      ),
    ).toEqual([]);
  });

  it('rechaza un objetivo eliminado o renombrado', () => {
    for (const change of [cmd.deleteClass(a), cmd.renameClass(a, 'Proveedor')]) {
      const current = apply(baseline, batch(change));
      expect(
        validateProposalPreconditions(
          batch(cmd.addAttribute(a, nextId(), 'nombre')),
          baseline.semantic,
          current.semantic,
        ),
      ).not.toEqual([]);
    }
  });

  it('un reemplazo detecta clases nuevas ajenas al lote preparado', () => {
    const newClass = nextId();
    const current = apply(baseline, batch(cmd.createClass(newClass, 'Producto')));
    expect(
      validateProposalPreconditions(
        batch(cmd.deleteClass(a), cmd.deleteClass(b)),
        baseline.semantic,
        current.semantic,
        'MODEL',
      )[0]?.elementIds,
    ).toContain(newClass);
  });

  it('un reemplazo permite mover clases sin cambiar su significado', () => {
    const current = apply(baseline, batch(cmd.moveClass(a, 500, 700)));
    expect(
      validateProposalPreconditions(
        batch(cmd.deleteClass(a)),
        baseline.semantic,
        current.semantic,
        'MODEL',
      ),
    ).toEqual([]);
  });

  it('compara la relación y sus extremos antes de cambiar multiplicidad', () => {
    const id = nextId();
    const related = apply(baseline, batch(cmd.createRelationship(id, a, b)));
    const current = apply(related, batch(cmd.changeMultiplicity(id, '1', '0..1')));
    expect(
      validateProposalPreconditions(
        batch(cmd.changeMultiplicity(id, '1', '1..*')),
        related.semantic,
        current.semantic,
      ),
    ).not.toEqual([]);
  });
});
