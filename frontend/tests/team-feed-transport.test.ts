import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS, type TeamFeedPage, type TeamMessage } from '@uml/contracts';
import { createTeamFeedTransport } from '../src/features/team-assistant/transport.js';

const boardId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const messageId = '00000000-0000-4000-8000-000000000003';
const message = (status: 'QUEUED' | 'CANCELLED', time = 0): TeamMessage => ({
  id: messageId,
  boardId,
  authorKind: 'USER',
  authorId: projectId,
  addressedToId: null,
  replyToId: null,
  clientRequestId: messageId,
  mode: 'ASK',
  inputMode: 'TEXT',
  kind: 'QUESTION',
  text: '¿Qué es UML?',
  status,
  errorCode: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(time).toISOString(),
});
const page = (messages: TeamMessage[] = [], nextCursor = 'cursor'): TeamFeedPage => ({
  messages,
  proposals: [],
  nextCursor,
  hasMore: false,
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});
function setup(loadPage = vi.fn(async (_cursor: string, _signal: AbortSignal) => page())) {
  const onChange = vi.fn(),
    onError = vi.fn();
  const loadSettings = vi.fn(async () => ({
    ...DEFAULT_AI_SETTINGS,
    projectId,
    updatedAt: new Date(0).toISOString(),
  }));
  const transport = createTeamFeedTransport({
    boardId,
    projectId,
    loadPage,
    loadSettings,
    onChange,
    onError,
  });
  cleanups.push(transport.stop);
  return { transport, loadPage, loadSettings, onChange, onError };
}
const event = JSON.stringify({ type: 'team.update', boardId, messageId, status: 'CANCELLED' });

describe('recuperación del feed de equipo', () => {
  it('pagina por cursor, combina estados por ID y no duplica historial', async () => {
    const load = vi.fn(async (cursor: string, _signal: AbortSignal) =>
      cursor === 'start'
        ? { ...page([message('QUEUED')], 'first'), hasMore: true }
        : page([message('CANCELLED', 1)], 'last'),
    );
    const { transport } = setup(load);
    transport.setVisible(true);
    await transport.refresh();
    expect(transport.snapshot().messages).toEqual([message('CANCELLED', 1)]);
    expect(load.mock.calls.map(([cursor]) => cursor)).toContain('first');
    await transport.refresh();
    expect(transport.snapshot().messages).toHaveLength(1);
    expect(load.mock.calls.at(-1)?.[0]).toBe('last');
  });
  it('coalesce avisos durante una petición y consulta de nuevo al terminar', async () => {
    let resolve!: (value: TeamFeedPage) => void;
    const load = vi.fn(async (_cursor: string, _signal: AbortSignal) =>
      page([message('CANCELLED', 1)]),
    );
    load.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { transport } = setup(load);
    transport.setVisible(true);
    for (let i = 0; i < 10; i++) transport.acceptEvent(event);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(page([message('QUEUED')]));
    await transport.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(transport.snapshot().messages[0]?.status).toBe('CANCELLED');
  });
  it('solo sondea visible cada 2,5 s y reconcilia configuración sin evento', async () => {
    vi.useFakeTimers();
    const { transport, loadPage, loadSettings } = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadPage).not.toHaveBeenCalled();
    transport.setVisible(true);
    await transport.refresh();
    const before = loadPage.mock.calls.length;
    loadSettings.mockResolvedValue({
      ...DEFAULT_AI_SETTINGS,
      enabled: false,
      projectId,
      updatedAt: new Date(1).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(loadPage).toHaveBeenCalledTimes(before + 1);
    expect(transport.snapshot().settings?.enabled).toBe(false);
    transport.setVisible(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadPage).toHaveBeenCalledTimes(before + 1);
    transport.setVisible(true);
    await transport.refresh();
    expect(loadPage.mock.calls.length).toBeGreaterThan(before + 1);
  });
  it('ignora eventos inválidos, ajenos y estados anunciados sin persistencia', async () => {
    const { transport, loadPage } = setup(vi.fn(async () => page([message('QUEUED')])));
    transport.setVisible(true);
    await transport.refresh();
    const before = loadPage.mock.calls.length;
    for (const payload of [
      'bad json',
      'x'.repeat(3000),
      JSON.stringify({ type: 'team.message', boardId: projectId, messageId }),
      JSON.stringify({ type: 'ai.settings', projectId: boardId }),
    ])
      transport.acceptEvent(payload);
    expect(loadPage).toHaveBeenCalledTimes(before);
    transport.acceptEvent(event);
    await transport.refresh();
    expect(transport.snapshot().messages[0]?.status).toBe('QUEUED');
  });
  it('conserva cursor ante caída HTTP y recupera en el siguiente sondeo', async () => {
    vi.useFakeTimers();
    const { transport, loadPage, onError } = setup();
    transport.setVisible(true);
    await transport.refresh();
    loadPage.mockRejectedValueOnce(new Error('offline'));
    await transport.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    loadPage.mockResolvedValue(page([message('CANCELLED', 1)], 'new'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(loadPage.mock.calls.at(-1)?.[0]).toBe('cursor');
    expect(transport.snapshot().messages[0]?.status).toBe('CANCELLED');
  });
  it('aborta al desmontar y descarta respuestas tardías', async () => {
    let resolve!: (value: TeamFeedPage) => void;
    const { transport, loadPage, onChange } = setup(
      vi.fn(
        (_cursor, _signal) =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    transport.setVisible(true);
    const pending = transport.refresh();
    transport.stop();
    expect(loadPage.mock.calls[0]?.[1].aborted).toBe(true);
    resolve(page([message('QUEUED')]));
    await pending;
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])(
    'borra la copia y detiene el sondeo tras pérdida de acceso %s',
    async (status) => {
      vi.useFakeTimers();
      const { transport, loadPage } = setup(vi.fn(async () => page([message('QUEUED')])));
      transport.setVisible(true);
      await transport.refresh();
      loadPage.mockRejectedValueOnce({ status });
      await transport.refresh();
      expect(transport.snapshot().messages).toEqual([]);
      const count = loadPage.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(loadPage).toHaveBeenCalledTimes(count);
    },
  );
  it('rechaza una página de otra pizarra sin avanzar el cursor', async () => {
    const { transport, loadPage, onError } = setup(
      vi.fn(async () => page([{ ...message('QUEUED'), boardId: projectId }])),
    );
    transport.setVisible(true);
    await transport.refresh();
    expect(onError).toHaveBeenCalled();
    expect(transport.snapshot().messages).toEqual([]);
    loadPage.mockResolvedValue(page());
    await transport.refresh();
    expect(loadPage.mock.calls.at(-1)?.[0]).toBe('start');
  });
});
