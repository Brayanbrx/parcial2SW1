import { emptyBoardState, type UmlClass, type UmlRelationship } from '@uml/contracts';
import { expect, it } from 'vitest';
import { associationClassPosition, classifierSize } from '../src/features/editor/uml-layout.js';

it('coloca una clase de asociación ancha sin invadir la tarjeta vecina', () => {
  const state = emptyBoardState();
  const classifier = (id: string): UmlClass => ({
    id,
    displayName: id,
    codeName: id,
    databaseName: id,
    attributes: [],
  });
  const relationship: UmlRelationship = {
    id: 'r',
    sourceClassId: 'A',
    targetClassId: 'B',
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
  };
  state.semantic.classes = ['A', 'B', 'C'].map(classifier);
  state.semantic.relationships = [relationship];
  state.layout.positions = { A: { x: 0, y: 0 }, B: { x: 500, y: 0 }, C: { x: 530, y: 180 } };
  const size = classifierSize({ ...classifier('D'), displayName: 'RegistroAcademico'.repeat(4) });
  expect(associationClassPosition(state, relationship, size)).toEqual({
    x: 370 - size.width / 2,
    y: 284,
  });
});
