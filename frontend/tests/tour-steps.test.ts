import { describe, expect, it } from 'vitest';
import { readTourStep, tourForPath, tours } from '../src/features/help/tour-steps.js';

describe('recorrido interactivo', () => {
  it('selecciona el recorrido de la pantalla y excluye rutas de acceso', () => {
    expect(tourForPath('/proyectos')).toBe('projects');
    expect(tourForPath('/proyectos/123')).toBe('project');
    expect(tourForPath('/pizarras/123')).toBe('board');
    expect(tourForPath('/cuenta')).toBe('account');
    expect(tourForPath('/entrar')).toBeNull();
    expect(tourForPath('/restablecer')).toBeNull();
  });
  it('retoma pasos válidos solo en su recorrido y tolera datos dañados o retirados', () => {
    expect(readTourStep('{"kind":"board","step":"generation"}', 'board')).toBe(
      tours.board.steps.findIndex((step) => step.id === 'generation'),
    );
    for (const value of [
      null,
      '{',
      '{}',
      'null',
      '{"kind":"projects","step":"name"}',
      '{"kind":"board","step":"removed"}',
    ]) {
      expect(readTourStep(value, 'board')).toBe(-1);
    }
  });
});
