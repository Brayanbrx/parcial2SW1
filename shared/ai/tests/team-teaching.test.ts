import { describe, expect, it } from 'vitest';
import { buildTeamContext, estimateTeamInputTokens, type TeamContextInput } from '@uml/ai';
import { sistemaDeConsulta, SISTEMA_CONSULTA } from '../src/prompt.js';

describe('política pedagógica y presupuesto', () => {
  const input: TeamContextInput = {
    boardId: 'board',
    requesterId: 'ana',
    requesterName: 'Ana',
    groupTurns: [],
    personalTurns: [],
    request: {
      mode: 'ASK',
      text: 'Explica herencia',
      snapshot: { classes: [], relationships: [] },
    },
  };
  it('mantiene consultas legacy y distingue pistas, soluciones a petición y revisión', () => {
    expect(sistemaDeConsulta()).toBe(SISTEMA_CONSULTA);
    expect(sistemaDeConsulta({ solutionMode: 'HINTS_ONLY', task: 'ASK' })).toContain(
      'nunca la solución completa',
    );
    const review = sistemaDeConsulta({ solutionMode: 'ON_REQUEST', task: 'REVIEW' });
    expect(review).toContain('solicitud actual pide explícitamente');
    expect(review).toContain('Revisión solicitada');
    expect(review).toContain('nunca devuelvas un lote de comandos');
  });
  it('incluye la política de sistema y los hallazgos enriquecidos en el presupuesto obligatorio', () => {
    const team = buildTeamContext(input, { maxInputTokens: 32768 });
    const legacyBudget = estimateTeamInputTokens(input.request, team);
    const enriched: TeamContextInput = {
      ...input,
      request: {
        ...input.request,
        teaching: { task: 'REVIEW', solutionMode: 'HINTS_ONLY' },
        issues: [
          { code: 'EXAMPLE', severity: 'ERROR', message: 'Problema', elementIds: ['class-id'] },
        ],
      },
    };
    expect(estimateTeamInputTokens(enriched.request, team)).toBeGreaterThan(legacyBudget);
    expect(() => buildTeamContext(enriched, { maxInputTokens: legacyBudget })).toThrow(
      'team_ai_input_budget',
    );
    expect(() =>
      buildTeamContext(enriched, {
        maxInputTokens: estimateTeamInputTokens(enriched.request, team),
      }),
    ).not.toThrow();
  });
});
