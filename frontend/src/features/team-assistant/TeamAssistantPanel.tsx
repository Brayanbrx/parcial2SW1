import { useEffect, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  BoardState,
  CommandBatch,
  SemanticModel,
  TeamMessage,
  TeamRequestBody,
  ValidationIssue,
} from '@uml/contracts';
import { ApiError, teamAiApi, type SessionUser } from '../../lib/api.js';
import { TeamComposer, type ComposerDraft, type ComposerRestore } from './TeamComposer.js';
import { TeamSettings } from './TeamSettings.js';
import { ProposalCard } from './ProposalCard.js';
import { ProposalExecution } from './proposal-execution.js';
import { useTeamFeed } from './use-team-feed.js';
import { clarificationTurns, modeLabel, requestLabel } from './feed-model.js';
import './team-assistant.css';

export function TeamAssistantPanel(props: {
  boardId: string;
  projectId: string;
  user: SessionUser;
  isOwner: boolean;
  provider: HocuspocusProvider | null;
  visible: boolean;
  online: boolean;
  state: BoardState;
  canWrite: boolean;
  apply(
    batch: CommandBatch,
    expected: SemanticModel,
    scope: 'AFFECTED',
  ): readonly ValidationIssue[] | null;
}) {
  const { boardId, projectId, user } = props;
  const feed = useTeamFeed(
    boardId,
    projectId,
    user.id,
    props.provider,
    props.visible && props.online,
  );
  const { messages, proposals, settings } = feed.snapshot;
  const [mineOnly, setMineOnly] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restore, setRestore] = useState<ComposerRestore | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const execution = useRef(new ProposalExecution());
  const cancelWanted = useRef(false);
  const mounted = useRef(true);
  const activeDraft = useRef<ComposerDraft | null>(null);
  const retry = useRef<{ fingerprint: string; body: TeamRequestBody } | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const ownRequest = messages.find((m) => m.id === activeId);
  const pending =
    posting ||
    (activeId !== null &&
      (!ownRequest || ownRequest.status === 'QUEUED' || ownRequest.status === 'PROCESSING'));
  const context = useMemo(
    () => clarificationTurns(messages, replyToId, user.id),
    [messages, replyToId, user.id],
  );
  const names = useMemo(
    () =>
      new Map([
        ...feed.members.map((member) => [member.id, member.displayName] as const),
        [user.id, user.displayName],
      ]),
    [feed.members, user.id, user.displayName],
  );
  const name = (id: string | null) =>
    id ? (names.get(id) ?? `Participante ${id.slice(0, 8)}`) : 'Equipo';
  const requestProposals = useMemo(
    () => new Map(proposals.map((p) => [p.requestMessageId, p])),
    [proposals],
  );
  const visibleMessages = mineOnly
    ? messages.filter((m) => m.authorId === user.id || m.addressedToId === user.id)
    : messages;
  const processing = messages.find((m) => m.status === 'PROCESSING');
  const queued = messages.filter((m) => m.status === 'QUEUED').length;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (messages.length && props.visible) end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, proposals.length, props.visible]);
  useEffect(() => {
    if (!ownRequest || ['QUEUED', 'PROCESSING'].includes(ownRequest.status ?? '')) return;
    const response = messages.find(
      (m) => m.authorKind === 'AI' && m.replyToId === ownRequest.id && m.addressedToId === user.id,
    );
    // DONE y su respuesta pueden estar en páginas distintas de la recuperación.
    if (ownRequest.status === 'DONE' && !response && !requestProposals.has(ownRequest.id)) return;
    if (ownRequest.status === 'FAILED' || ownRequest.status === 'INTERRUPTED') {
      // Un reintento debe responder a la misma aclaración, no enviar una
      // respuesta aislada como «correo» sin la instrucción que la originó.
      setReplyToId(ownRequest.replyToId);
      if (activeDraft.current)
        setRestore({
          ...activeDraft.current,
          revision: Date.now(),
          preserveExistingText: activeDraft.current.inputMode === 'VOICE_COMMAND',
        });
    } else if (response?.kind === 'CLARIFICATION' && ownRequest.mode === 'INSTRUCT')
      setReplyToId(response.id);
    else setReplyToId(null);
    setActiveId(null);
  }, [ownRequest, messages, requestProposals, user.id]);

  async function cancel(id = activeId) {
    cancelWanted.current = true;
    const key = retry.current?.body.clientRequestId ?? ownRequest?.clientRequestId;
    if (key) execution.current.cancel(key);
    if (!id) {
      setNotice('Cancelando la solicitud cuando se confirme su recepción…');
      return;
    }
    try {
      const cancelled = await teamAiApi.cancel(boardId, id);
      if (!mounted.current) return;
      setActiveId(null);
      setReplyToId(cancelled.replyToId);
      if (activeDraft.current)
        setRestore({
          ...activeDraft.current,
          revision: Date.now(),
          preserveExistingText: activeDraft.current.inputMode === 'VOICE_COMMAND',
        });
      setNotice('Solicitud cancelada. Puedes revisar el texto y volver a enviarlo.');
      await feed.refresh();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'No se pudo cancelar.');
    }
  }
  async function send(draft: ComposerDraft): Promise<boolean> {
    if (
      sending.current ||
      pending ||
      !props.online ||
      settings?.enabled === false ||
      (draft.mode === 'INSTRUCT' && !props.canWrite)
    )
      return false;
    sending.current = true;
    cancelWanted.current = false;
    activeDraft.current = draft;
    setPosting(true);
    setError(null);
    setNotice(null);
    const content = { ...draft, replyToId, model: props.state.semantic };
    const fingerprint = JSON.stringify(content);
    const body: TeamRequestBody =
      retry.current?.fingerprint === fingerprint
        ? retry.current.body
        : { ...content, clientRequestId: crypto.randomUUID() };
    retry.current = { fingerprint, body };
    if (body.mode === 'INSTRUCT') execution.current.register(body.clientRequestId, body.inputMode);
    try {
      const accepted = await teamAiApi.send(boardId, body, AbortSignal.timeout(15_000));
      if (!mounted.current) return false;
      retry.current = null;
      setActiveId(accepted.id);
      if (cancelWanted.current) {
        execution.current.cancel(body.clientRequestId);
        await cancel(accepted.id);
        return false;
      }
      void feed.refresh();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      // Un error de red puede ocultar un 202: el reintento conserva la misma clave.
      if (cause instanceof ApiError && cause.status < 500) {
        execution.current.cancel(body.clientRequestId);
        retry.current = null;
      }
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar. Conservamos tu texto.');
      return false;
    } finally {
      sending.current = false;
      if (mounted.current) setPosting(false);
    }
  }
  function restoreRequest(request: TeamMessage) {
    if (request.authorKind !== 'USER' || request.authorId !== user.id) return;
    setReplyToId(request.replyToId);
    setRestore({
      text: request.text,
      mode: request.mode,
      inputMode: request.inputMode,
      revision: Date.now(),
    });
  }
  function showParent(id: string) {
    setMineOnly(false);
    requestAnimationFrame(() => {
      const target = document.getElementById(`team-message-${id}`);
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
  }
  return (
    <section
      className="asistente team-assistant"
      data-testid="asistente"
      aria-label="Asistente del equipo"
    >
      <header className="team-heading">
        <div>
          <h3>Actividad del equipo</h3>
          <small>Conversación compartida de esta pizarra</small>
        </div>
        {props.isOwner && settings && props.online && (
          <TeamSettings settings={settings} refresh={feed.refresh} />
        )}
      </header>
      <label className="team-filter">
        <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />{' '}
        Mis intervenciones
      </label>
      <p className="team-status" role="status">
        {processing
          ? `IA respondiendo a ${name(processing.authorId)} (${queued} en cola)`
          : queued
            ? `${queued} solicitud${queued === 1 ? '' : 'es'} en cola`
            : 'Al día con el equipo'}
      </p>
      {!props.online && (
        <p className="advertencia">Sin conexión. El historial se recuperará al reconectar.</p>
      )}
      {settings?.enabled === false && (
        <p className="advertencia">
          La IA está deshabilitada en este proyecto. Puedes consultar el historial.
        </p>
      )}
      {settings?.enabled && (
        <p className="team-status" data-testid="team-teaching-policy">
          {settings.solutionMode === 'HINTS_ONLY'
            ? 'Solo pistas: Preguntar y Revisar ofrecen orientación. Instruir permite solicitar cambios.'
            : 'Soluciones a petición: empieza con pistas; pide una solución o un ejemplo resuelto cuando lo necesites.'}
          {settings.reviewMode === 'OFF' && ' El OWNER ha desactivado Revisar.'}
        </p>
      )}
      {feed.error && (
        <div role="alert" className="error">
          {feed.error}{' '}
          <button type="button" onClick={() => void feed.refresh()}>
            Reintentar lectura
          </button>
        </div>
      )}
      {feed.loading && <p role="status">Cargando actividad…</p>}
      <ol
        className="conversacion"
        data-testid="conversacion"
        aria-label="Conversación del equipo"
        aria-busy={feed.loading}
      >
        {!feed.loading && !visibleMessages.length && (
          <li className="pista">
            {mineOnly
              ? 'Todavía no tienes intervenciones.'
              : 'Pregunta, solicita cambios o pide una revisión. Todo el equipo verá la conversación.'}
          </li>
        )}
        {visibleMessages.map((message) => {
          const proposal = requestProposals.get(message.id);
          const owned = message.authorId === user.id;
          return (
            <li
              key={message.id}
              id={`team-message-${message.id}`}
              tabIndex={-1}
              className={message.authorKind === 'USER' ? 'usuario' : 'asistente-mensaje'}
              data-message-id={message.id}
            >
              <div className="team-message-meta">
                <strong>
                  {message.authorKind === 'USER'
                    ? name(message.authorId)
                    : message.authorKind === 'AI'
                      ? `IA → ${name(message.addressedToId)}`
                      : 'Sistema'}
                </strong>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString('es', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              {message.mode && (
                <small>
                  {modeLabel[message.mode]}
                  {message.inputMode === 'DICTATION'
                    ? ' · Dictado'
                    : message.inputMode === 'VOICE_COMMAND'
                      ? ' · Comando de voz'
                      : ''}
                </small>
              )}
              {message.replyToId && (
                <button
                  type="button"
                  className="team-reply-link"
                  onClick={() => showParent(message.replyToId!)}
                >
                  Ver mensaje de referencia
                </button>
              )}
              <p>{message.text}</p>
              {message.status && (
                <small className="team-status">{requestLabel[message.status]}</small>
              )}
              {owned && message.errorCode === 'team_ai_input_budget' && (
                <p>
                  El diagrama y la solicitud superan el contexto disponible. Reduce el alcance de la
                  consulta o revisa la solicitud antes de reintentar.
                </p>
              )}
              {owned && message.errorCode === 'team_ai_settings_changed' && (
                <p>
                  El OWNER cambió el modo de respuestas durante la consulta. Envía la pregunta de
                  nuevo para usar la configuración actual.
                </p>
              )}
              {owned && message.errorCode === 'team_ai_review_disabled' && (
                <p>El OWNER ha desactivado la revisión del modelo.</p>
              )}
              {owned &&
                [
                  'team_ai_context_limit',
                  'invalid_clarification',
                  'team_ai_invalid_context',
                ].includes(message.errorCode ?? '') && (
                  <p>
                    No se pudo recuperar un hilo válido dentro de sus límites. Usa «Empezar de
                    nuevo» y escribe la solicitud completa.
                  </p>
                )}
              {owned &&
                ['QUEUED', 'PROCESSING'].includes(message.status ?? '') &&
                message.id !== activeId && (
                  <button
                    type="button"
                    disabled={!props.online || pending}
                    onClick={() => {
                      activeDraft.current = {
                        text: message.text,
                        mode: message.mode!,
                        inputMode: message.inputMode!,
                      };
                      void cancel(message.id);
                    }}
                  >
                    Cancelar esta solicitud
                  </button>
                )}
              {owned && ['FAILED', 'INTERRUPTED'].includes(message.status ?? '') && (
                <button type="button" onClick={() => restoreRequest(message)} disabled={pending}>
                  Reintentar con este texto
                </button>
              )}
              {message.kind === 'CLARIFICATION' && message.addressedToId === user.id && (
                <button
                  type="button"
                  disabled={pending || !props.canWrite}
                  onClick={() => {
                    setReplyToId(message.id);
                    setRestore({
                      text: '',
                      mode: 'INSTRUCT',
                      inputMode: 'TEXT',
                      revision: Date.now(),
                    });
                  }}
                >
                  Responder aclaración
                </button>
              )}
              {proposal && (
                <ProposalCard
                  proposal={proposal}
                  projectId={props.projectId}
                  request={message}
                  settings={settings}
                  execution={execution.current}
                  userId={user.id}
                  canWrite={props.canWrite && !pending}
                  online={props.online}
                  apply={props.apply}
                  refresh={feed.refresh}
                  restore={() => restoreRequest(message)}
                />
              )}
            </li>
          );
        })}
        <li ref={end} className="ancla-conversacion" aria-hidden="true" />
      </ol>
      {notice && (
        <p className="team-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <TeamComposer
        model={props.state.semantic}
        canWrite={props.canWrite}
        enabled={props.online && settings?.enabled !== false}
        visible={props.visible}
        reviewEnabled={settings?.reviewMode !== 'OFF'}
        pending={pending}
        context={context}
        restore={restore}
        send={send}
        cancel={() => void cancel()}
        clearContext={() => setReplyToId(null)}
      />
    </section>
  );
}
