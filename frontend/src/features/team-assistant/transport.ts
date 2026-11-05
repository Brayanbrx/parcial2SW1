import {
  teamAiEventPayloadSchema,
  type AiProposal,
  type ProjectAiSettings,
  type TeamFeedPage,
  type TeamMessage,
} from '@uml/contracts';

export interface TeamFeedSnapshot {
  readonly messages: readonly TeamMessage[];
  readonly proposals: readonly AiProposal[];
  readonly settings: ProjectAiSettings | null;
}

/** Solo lectura. Ni un evento ni recuperar historial ejecuta comandos UML. */
export function createTeamFeedTransport(options: {
  boardId: string;
  projectId: string;
  loadPage: (cursor: string, signal: AbortSignal) => Promise<TeamFeedPage>;
  loadSettings: (signal: AbortSignal) => Promise<ProjectAiSettings>;
  onChange: (snapshot: TeamFeedSnapshot) => void;
  onError: (error: unknown) => void;
}) {
  const messages = new Map<string, TeamMessage>();
  const proposals = new Map<string, AiProposal>();
  const lifetime = new AbortController();
  let settings: ProjectAiSettings | null = null;
  let cursor = 'start';
  let visible = false;
  let stopped = false;
  let dirty = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (): TeamFeedSnapshot => ({
    messages: [...messages.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
    proposals: [...proposals.values()],
    settings,
  });
  const merge = <T extends { id: string; updatedAt: string }>(map: Map<string, T>, rows: T[]) => {
    for (const row of rows) {
      const previous = map.get(row.id);
      if (!previous || row.updatedAt >= previous.updatedAt) map.set(row.id, row);
    }
  };
  const signal = () => AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]);
  function schedule() {
    clearTimeout(timer);
    if (visible && !stopped) timer = setTimeout(() => void refresh(), 2500);
  }
  async function drain() {
    try {
      while (dirty && visible && !stopped) {
        dirty = false;
        let hasMore: boolean;
        do {
          const page = await options.loadPage(cursor, signal());
          if (stopped) return;
          if (
            page.messages.some((m) => m.boardId !== options.boardId) ||
            page.proposals.some((p) => p.boardId !== options.boardId) ||
            (page.hasMore && page.nextCursor === cursor)
          )
            throw new Error('Página de recuperación inválida.');
          merge(messages, page.messages);
          merge(proposals, page.proposals);
          cursor = page.nextCursor;
          hasMore = page.hasMore;
          options.onChange(snapshot());
        } while (hasMore && visible && !stopped);
        if (!visible || stopped) return;
        // Settings no comparte el cursor de pizarra; también se reconcilia si se perdió su aviso.
        const nextSettings = await options.loadSettings(signal());
        if (stopped) return;
        if (nextSettings.projectId !== options.projectId)
          throw new Error('Configuración de otro proyecto.');
        settings = nextSettings;
        options.onChange(snapshot());
      }
    } catch (error) {
      if (stopped) return;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403 || status === 404) {
        stop();
        messages.clear();
        proposals.clear();
        settings = null;
        options.onChange(snapshot());
      }
      dirty = false;
      options.onError(error);
    }
  }
  function refresh(): Promise<void> {
    if (stopped || !visible) return Promise.resolve();
    dirty = true;
    clearTimeout(timer);
    if (!running) {
      running = drain().finally(() => {
        running = undefined;
        if (dirty && visible && !stopped) void refresh();
        else schedule();
      });
    }
    return running;
  }
  function stop() {
    stopped = true;
    lifetime.abort();
    clearTimeout(timer);
  }
  return {
    snapshot,
    refresh,
    stop,
    setVisible(value: boolean) {
      if (visible === value || stopped) return;
      visible = value;
      if (visible) void refresh();
      else clearTimeout(timer);
    },
    acceptEvent(payload: string) {
      const parsed = teamAiEventPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const event = parsed.data;
      if (
        event.type === 'ai.settings'
          ? event.projectId !== options.projectId
          : event.boardId !== options.boardId
      )
        return;
      // El estado anunciado no modifica la copia: se consulta la autoridad HTTP.
      void refresh();
    },
  };
}
