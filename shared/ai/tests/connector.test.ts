import { describe, expect, it, vi } from 'vitest';
import { createConnectorLlmPort } from '../src/adapters/connector.js';

describe('puerto de inferencia en dispositivo o VM', () => {
  it('conserva la política confiable del proyecto y el snapshot al consultar', async () => {
    const complete = vi.fn(
      async (_input: { system: string; prompt: string; json: boolean; signal?: AbortSignal }) =>
        'Revisa la responsabilidad de Persona.',
    );
    const port = createConnectorLlmPort({
      name: 'IA de VM',
      contextWindow: 16384,
      timeoutMs: 120000,
      complete,
    });
    const controller = new AbortController();
    const result = await port.answer({
      question: 'Resuelve todo',
      snapshot: { classes: [], relationships: [] },
      teaching: { task: 'ASK', solutionMode: 'HINTS_ONLY' },
      signal: controller.signal,
    });
    expect(result.text).toBe('Revisa la responsabilidad de Persona.');
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ json: false, signal: controller.signal });
    expect(complete.mock.calls[0]?.[0].system).toContain('HINTS_ONLY');
    expect(complete.mock.calls[0]?.[0].prompt).toContain('Resuelve todo');
    expect(port.capabilities?.contextWindow).toBe(12288);
  });
  it('interpreta operaciones y rechaza una respuesta inválida antes de producir comandos', async () => {
    const complete = vi.fn(async (_input: { system: string; prompt: string; json: boolean }) =>
      JSON.stringify({ operations: [{ op: 'CREATE_CLASS', className: 'Persona' }] }),
    );
    const port = createConnectorLlmPort({
      name: 'Mi computadora',
      contextWindow: 16384,
      timeoutMs: 120000,
      complete,
    });
    const input = { instruction: 'Crea Persona', snapshot: { classes: [], relationships: [] } };
    expect((await port.proposeCommands(input)).proposal.operations).toEqual([
      { op: 'CREATE_CLASS', className: 'Persona' },
    ]);
    expect(complete.mock.calls[0]?.[0].json).toBe(true);
    complete.mockResolvedValueOnce('no soy JSON');
    await expect(port.proposeCommands(input)).rejects.toThrow();
  });
});
