import { describe, expect, it } from 'vitest';
import { fixture } from '@uml/fixtures';
import { parseXmi, serializeToXmi, xmiToBatch } from '@uml/xmi';
import { removeCandidateCommand } from '../src/features/import/candidate.js';
import { emptyBoardState } from '@uml/contracts';
import { planBatch } from '@uml/domain-core';

describe('retirar operaciones del candidato', () => {
  it('quitar una clase retira sus atributos y enlaces sin dejar referencias rotas', () => {
    const model = fixture('T01').model;
    const batch = xmiToBatch(parseXmi(serializeToXmi(model, { modelName: 'Prueba' })), {
      current: emptyBoardState().semantic,
      mode: 'ADD',
      actorId: crypto.randomUUID(),
    }).batch;
    const create = batch.commands.find((c) => c.type === 'CREATE_CLASS')!;
    const result = removeCandidateCommand(batch, create.commandId);
    const planned = planBatch(emptyBoardState(), result);
    expect(planned.applied).toBe(true);
    if (planned.applied)
      expect(planned.state.semantic.classes).toHaveLength(model.classes.length - 1);
  });
});
