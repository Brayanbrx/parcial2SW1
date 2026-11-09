import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';

type Account = Awaited<ReturnType<Harness['signUp']>>;

/** Whisper falso con la ruta que expone whisper-server --inference-path. */
function fakeWhisper() {
  const requests: string[] = [];
  let reply: { status: number; text: string } = { status: 200, text: 'Crea la clase Producto' };
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('latin1')));
    request.on('end', () => {
      requests.push(`${request.method} ${request.url}\n${body}`);
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(
        reply.status === 200 ? JSON.stringify({ text: reply.text }) : '{"error":"caído"}',
      );
    });
  });
  return {
    server,
    requests,
    set(next: { status: number; text: string }) {
      reply = next;
    },
  };
}

describe('voz local: transcripción del panel con Whisper', () => {
  const whisper = fakeWhisper();
  const saved = { ...process.env };
  let api: Harness;
  let owner: Account, viewer: Account, outsider: Account;
  let projectId: string, boardId: string;
  // Un WAV mínimo: el puerto valida el tipo, no decodifica el contenido.
  const audio = Buffer.from('RIFF0000WAVEfmt ').toString('base64');
  const transcribe = (token: string, body: unknown = { audio, mediaType: 'audio/wav' }) =>
    api.request('POST', `/boards/${boardId}/team-ai/transcribe`, { token, body });
  const source = (aiSource: 'LOCAL' | 'PROVIDERS', enabled = true) =>
    api.app.prisma.projectAiSettings.upsert({
      where: { projectId },
      create: { projectId, aiSource, enabled },
      update: { aiSource, enabled },
    });

  beforeAll(async () => {
    await new Promise<void>((resolve) => whisper.server.listen(0, '127.0.0.1', resolve));
    const { port } = whisper.server.address() as AddressInfo;
    process.env['AI_SPEECH_PROVIDER'] = 'mock';
    process.env['AI_SPEECH_CHAIN_TIMEOUT_MS'] = '180000';
    process.env['AI_LOCAL_SPEECH_BASE_URL'] = `http://127.0.0.1:${port}/v1`;
    process.env['AI_LOCAL_SPEECH_MODEL'] = 'whisper-small';
    api = await startHarness({ teamAi: false });
    owner = await api.signUp('voz-owner@test.invalid');
    viewer = await api.signUp('voz-viewer@test.invalid');
    outsider = await api.signUp('voz-outsider@test.invalid');
    projectId = (
      await api.request('POST', '/projects', { token: owner.token, body: { displayName: 'Voz' } })
    ).body.id as string;
    await api.app.prisma.projectMember.create({
      data: { projectId, userId: viewer.userId, role: 'VIEWER' },
    });
    boardId = (await api.app.prisma.board.create({ data: { projectId, displayName: 'Voz' } })).id;
  });
  afterAll(async () => {
    await api?.stop();
    await new Promise((resolve) => whisper.server.close(resolve));
    process.env = saved;
  });
  beforeEach(async () => {
    whisper.requests.length = 0;
    whisper.set({ status: 200, text: 'Crea la clase Producto' });
    await api.app.prisma.projectAiSettings.deleteMany({ where: { projectId } });
  });

  it('informa el Whisper del servidor en la configuración', async () => {
    const response = await api.request('GET', `/projects/${projectId}/ai-settings`, {
      token: viewer.token,
    });
    expect(response.body).toMatchObject({
      aiSource: 'PROVIDERS',
      localSpeechModel: 'whisper-small',
      speechTimeoutMs: 180_000,
    });
  });

  it('con Proveedores transcribe la nube y no llama a Whisper local', async () => {
    const response = await transcribe(owner.token);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ text: 'agrega telefono tipo String a Cliente' });
    expect(whisper.requests).toHaveLength(0);
  });

  it('con Modelo local transcribe Whisper en español, también para VIEWER', async () => {
    await source('LOCAL');
    const response = await transcribe(viewer.token);
    expect(response.body).toEqual({ text: 'Crea la clase Producto' });
    expect(whisper.requests).toHaveLength(1);
    expect(whisper.requests[0]).toMatch(/^POST \/v1\/audio\/transcriptions/);
    expect(whisper.requests[0]).toMatch(/name="language"\r\n\r\nes/);
  });

  it('si Whisper local falla, transcriben los proveedores', async () => {
    await source('LOCAL');
    whisper.set({ status: 500, text: '' });
    const response = await transcribe(owner.token);
    expect(response.body).toEqual({ text: 'agrega telefono tipo String a Cliente' });
    expect(whisper.requests).toHaveLength(1);
  });

  it('un audio sin palabras responde 422 sin pasar a la nube', async () => {
    await source('LOCAL');
    whisper.set({ status: 200, text: '[BLANK_AUDIO]' });
    const response = await transcribe(owner.token);
    expect([response.status, response.body.error.code]).toEqual([422, 'no_speech']);
  });

  it('rechaza ajenos, IA desactivada y cuerpos inválidos', async () => {
    expect((await transcribe(outsider.token)).status).toBe(404);
    expect((await transcribe(owner.token, { audio })).status).toBe(400);
    await source('LOCAL', false);
    const disabled = await transcribe(owner.token);
    expect([disabled.status, disabled.body.error.code]).toEqual([409, 'ai_disabled']);
    expect(whisper.requests).toHaveLength(0);
  });
});
