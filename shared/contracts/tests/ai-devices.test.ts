import { describe, expect, it } from 'vitest';
import {
  personalAiChoiceSchema,
  connectorHelloSchema,
  connectorTaskSchema,
} from '../src/ai-devices.js';

describe('selección personal de IA', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('el proyecto es el valor explícito para heredar su configuración', () => {
    expect(personalAiChoiceSchema.parse({ source: 'PROJECT' })).toEqual({
      source: 'PROJECT',
      deviceId: null,
      model: null,
    });
    expect(personalAiChoiceSchema.safeParse({ source: 'VM', model: 'modelo' }).success).toBe(true);
  });
  it.each([
    { source: 'DEVICE', model: 'modelo' },
    { source: 'VM', model: 'modelo', deviceId: id },
    { source: 'VM' },
    { source: 'PROJECT', model: 'modelo' },
    { source: 'DEVICE', deviceId: id },
    { source: 'PROVIDERS', token: 'secreto' },
  ])('rechaza combinaciones ambiguas o credenciales: %j', (choice) => {
    expect(personalAiChoiceSchema.safeParse(choice).success).toBe(false);
  });
  it('el saludo declara versión, credencial limitada, modelos y capacidad acotada', () => {
    const hello = {
      type: 'hello',
      version: 1,
      kind: 'DEVICE',
      token: 'x'.repeat(64),
      models: [{ name: 'modelo', contextWindow: 16384 }],
      maxConcurrency: 1,
    };
    expect(connectorHelloSchema.safeParse(hello).success).toBe(true);
    expect(connectorHelloSchema.safeParse({ ...hello, maxConcurrency: 100 }).success).toBe(false);
    expect(connectorHelloSchema.safeParse({ ...hello, version: 2 }).success).toBe(false);
    expect(connectorHelloSchema.safeParse({ ...hello, userId: id }).success).toBe(false);
    expect(
      connectorTaskSchema.safeParse({
        type: 'task',
        id,
        model: 'modelo',
        system: 'UML',
        prompt: 'Pregunta',
        json: true,
        timeoutMs: 120000,
        command: 'sh',
      }).success,
    ).toBe(false);
  });
});
