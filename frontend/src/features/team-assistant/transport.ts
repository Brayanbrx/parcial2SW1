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
  /** IDs recuperados antes de empezar a contar novedades. */
  readonly initialMessageIds: readonly string[] | null;
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
  let initialMessageIds: readonly string[] | null = null;
  let cursor = 'start';
  let visible = false;
  let stopped = false;
  let accessBlocked = false;
  let dirty = false;
  /**
   * Con el panel oculto no se sondea, pero un aviso del servidor sí se atiende:
   * así el contador de mensajes nuevos y el estado de la IA siguen al día sin
   * gastar una consulta cada 2,5 s por cada persona que no está mirando.
   */
  let background = false;
  const active = () => !stopped && !accessBlocked && (visible || background);
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (): TeamFeedSnapshot => ({
    messages: [...messages.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
    proposals: [...proposals.values()],
    settings,
    initialMessageIds,
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
    if (visible && active()) timer = setTimeout(() => void refresh(), 2500);
  }
  async function drain() {
    try {
      while (dirty && active()) {
        dirty = false;
        // El historial inicial y las pasadas pedidas por avisos terminan aunque se oculte el panel.
        const requested = background || initialMessageIds === null;
        background = false;
        const proceed = () => !stopped && (visible || requested);
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
          if (!hasMore && initialMessageIds === null) initialMessageIds = [...messages.keys()];
          options.onChange(snapshot());
        } while (hasMore && proceed());
        if (!proceed()) return;
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
        // Pausa las lecturas automáticas y olvida el cursor y la copia anterior.
        // El botón de reintento puede volver a comprobar el permiso por HTTP.
        accessBlocked = true;
        dirty = false;
        background = false;
        cursor = 'start';
        messages.clear();
        proposals.clear();
        settings = null;
        initialMessageIds = null;
        options.onChange(snapshot());
      }
      options.onError(error);
    }
  }
  /** `inBackground`: atender también con el panel oculto (avisos, reconexión). */
  function refresh(inBackground = false): Promise<void> {
    if (stopped || accessBlocked || (!visible && !inBackground)) return Promise.resolve();
    if (inBackground) background = true;
    dirty = true;
    clearTimeout(timer);
    if (!running) {
      running = drain().finally(() => {
        running = undefined;
        if (dirty && active()) void refresh(background);
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
    retry() {
      accessBlocked = false;
      return refresh(true);
    },
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
      void refresh(true);
    },
  };
}
