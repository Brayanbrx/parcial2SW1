import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAiPorts, loadAiConfig, NoSpeechError } from '@uml/ai';
import { aiRoutes } from '../src/modules/ai/routes.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function setup(enabled: boolean | null, member = true) {
  app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { userId: 'user', email: 'test@example.org', sessionVersion: 0 };
  });
  const settings = vi.fn(async () => (enabled === null ? null : { enabled }));
  app.decorate('prisma', {
    board: { findUnique: async () => ({ id: 'board', projectId: 'project' }) },
    projectMember: { findUnique: async () => (member ? { role: 'OWNER' } : null) },
    projectAiSettings: { findUnique: settings },
  } as never);
  const ports = createAiPorts(loadAiConfig({}));
  const answer = vi.spyOn(ports.llm, 'answer');
  const propose = vi.spyOn(ports.llm, 'proposeCommands');
  const speech = vi.spyOn(ports.speech, 'transcribe');
  await app.register(aiRoutes, { ports });
  return { settings, answer, propose, speech };
}

const model = { classes: [], relationships: [] };
const boardId = '00000000-0000-4000-8000-000000000001';
const send = (route: 'question' | 'instruction') =>
  app.inject({
    method: 'POST',
    url: `/boards/${boardId}/assistant/${route}`,
    payload: { [route]: route === 'question' ? '¿Puedo generar?' : 'crea Cliente', model },
  });

describe('legacy assistant policy', () => {
  it.each(['question', 'instruction'] as const)(
    'blocks %s before invoking any provider when AI is disabled',
    async (route) => {
      const h = await setup(false);
      const response = await send(route);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('ai_disabled');
      expect(h.answer).not.toHaveBeenCalled();
      expect(h.propose).not.toHaveBeenCalled();
    },
  );
  it.each([true, null])('preserves existing behavior with enabled=%s', async (enabled) => {
    const h = await setup(enabled);
    expect((await send('question')).statusCode).toBe(200);
    expect((await send('instruction')).statusCode).toBe(200);
    expect(h.answer).toHaveBeenCalledOnce();
    expect(h.propose).toHaveBeenCalledOnce();
  });
  it('checks membership before revealing project settings', async () => {
    const h = await setup(false, false);
    expect((await send('question')).statusCode).toBe(404);
    expect((await send('instruction')).statusCode).toBe(404);
    expect(h.settings).not.toHaveBeenCalled();
  });
  it('reports silence as no_speech, not a provider failure', async () => {
    const h = await setup(true);
    h.speech.mockRejectedValue(new NoSpeechError('mock'));
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/transcribe',
      payload: {
        audio: 'UklGRg==',
        mediaType: 'audio/wav',
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('no_speech');
  });
});
