import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  BoardState,
  CommandBatch,
  SemanticModel,
  TeamMessage,
  TeamMode,
  TeamRequestBody,
  ValidationIssue,
} from '@uml/contracts';
import { ApiError, teamAiApi, type SessionUser } from '../../lib/api.js';
import { TeamComposer, type ComposerDraft, type ComposerRestore } from './TeamComposer.js';
import { TeamSettings } from './TeamSettings.js';
import { ProposalCard } from './ProposalCard.js';
import { ProposalExecution } from './proposal-execution.js';
import { useTeamFeed } from './use-team-feed.js';
import { applyAppUpdate } from '../../lib/app-update.js';
import { clarificationTurns, modeLabel, requestLabel } from './feed-model.js';
import { createServerVoiceEngine } from '../assistant/recorder-recognition.js';
import { recordingToWav } from '../assistant/wav.js';
import { IconoIA } from '../../components/icons.js';
import { RichText } from './RichText.js';
import { IA_EQUIPO, colorEstable, iniciales, type ActividadIa } from './identity.js';
import './team-assistant.css';

/** Ejemplos del estado vacío: al pulsarlos llenan el compositor, no envían. */
const SUGERENCIAS: readonly (readonly [TeamMode, string, string])[] = [
  ['INSTRUCT', 'Instruir', 'Agrega la clase Pedido con fecha y total'],
  ['ASK', 'Preguntar', '¿Qué es un atributo derivado?'],
  ['REVIEW', 'Revisar', '¿Está bien modelada la herencia?'],
];

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
  /** Presencia actual: da a cada autor el mismo color que tiene en la pizarra. */
  participants?: readonly { readonly displayName: string; readonly color: string }[];
  /** Estado de la IA para mostrarla como un integrante más fuera del panel. */
  onActivity?(activity: ActividadIa): void;
  /** Mensajes de otros (personas o IA) que llegaron con el panel oculto. */
  onUnread?(count: number): void;
}) {
  const { boardId, projectId, user } = props;
  const feed = useTeamFeed(
    boardId,
    projectId,
    user.id,
    props.provider,
    props.visible && props.online,
  );
  const { messages, proposals, settings, initialMessageIds } = feed.snapshot;
  // Con «Modelo local» y Whisper en el servidor, la voz no sale del equipo.
  const localVoice = settings?.aiSource === 'LOCAL' && !!settings.localSpeechModel;
  const voiceEngine = useMemo(
    () =>
      localVoice
        ? createServerVoiceEngine(
            (wav, signal) => teamAiApi.transcribe(boardId, wav, signal),
            recordingToWav,
            settings?.speechTimeoutMs,
          )
        : undefined,
    [localVoice, boardId, settings?.speechTimeoutMs],
  );
  const [mineOnly, setMineOnly] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const policyId = useId();
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
  const presenceColors = useMemo(
    () => new Map((props.participants ?? []).map((p) => [p.displayName, p.color])),
    [props.participants],
  );
  const colorOf = (id: string | null) =>
    (id && presenceColors.get(name(id))) ?? colorEstable(id ?? 'equipo');
  const activity: ActividadIa = !props.online
    ? { estado: 'sin-conexion', detalle: 'Sin conexión' }
    : settings?.enabled === false
      ? { estado: 'pausada', detalle: 'Desactivada' }
      : processing
        ? {
            estado: 'pensando',
            detalle: `Respondiendo a ${name(processing.authorId)}${queued ? ` · ${queued} en cola` : ''}`,
          }
        : queued
          ? { estado: 'en-cola', detalle: `${queued} en cola` }
          : { estado: 'disponible', detalle: 'Disponible' };
  const onActivity = props.onActivity;
  useEffect(() => {
    onActivity?.({ estado: activity.estado, detalle: activity.detalle });
  }, [onActivity, activity.estado, activity.detalle]);
  const seen = useRef<{ baseline: readonly string[]; ids: Set<string> } | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (initialMessageIds === null) {
      seen.current = null;
      setUnread(0);
      return;
    }
    if (seen.current?.baseline !== initialMessageIds) {
      seen.current = { baseline: initialMessageIds, ids: new Set(initialMessageIds) };
    }
    const known = seen.current.ids;
    if (props.visible) {
      for (const m of messages) known.add(m.id);
      setUnread(0);
      return;
    }
    setUnread(messages.filter((m) => m.authorId !== user.id && !known.has(m.id)).length);
  }, [initialMessageIds, messages, props.visible, user.id]);
  const onUnread = props.onUnread;
  useEffect(() => {
    onUnread?.(unread);
  }, [onUnread, unread]);
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
    // El mismo envío puede haberse registrado aunque su respuesta se perdiera.
    const content = { ...draft, replyToId };
    const fingerprint = JSON.stringify(content);
    const body: TeamRequestBody =
      retry.current?.fingerprint === fingerprint
        ? retry.current.body
        : { ...content, model: props.state.semantic, clientRequestId: crypto.randomUUID() };
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
    // Desde el historial se prepara otra solicitud tras un resultado conocido.
    if (retry.current?.body.clientRequestId === request.clientRequestId) retry.current = null;
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
  const policy =
    settings?.solutionMode === 'HINTS_ONLY'
      ? {
          short: 'Solo pistas',
          long: ': Preguntar y Revisar ofrecen orientación. Instruir permite solicitar cambios.',
        }
      : {
          short: 'Soluciones a petición',
          long: ': empieza con pistas; pide una solución o un ejemplo resuelto cuando lo necesites.',
        };
  return (
    <section
      className="asistente team-assistant"
      data-testid="asistente"
      aria-label="Asistente del equipo"
    >
      <header className="team-perfil">
        <span className={`team-avatar ia estado-${activity.estado}`} aria-hidden="true">
          <IconoIA size={18} />
        </span>
        <div className="team-perfil-texto">
          <h3>
            {IA_EQUIPO.nombre}
            <span className="team-rol">{IA_EQUIPO.rol}</span>
          </h3>
          <p className={`team-estado estado-${activity.estado}`} role="status">
            {processing
              ? `IA respondiendo a ${name(processing.authorId)} (${queued} en cola)`
              : queued
                ? `${queued} solicitud${queued === 1 ? '' : 'es'} en cola`
                : !props.online
                  ? 'Sin conexión'
                  : settings?.enabled === false
                    ? 'Desactivada en este proyecto'
                    : 'Al día con el equipo'}
          </p>
        </div>
        {props.isOwner && settings && props.online && (
          <TeamSettings settings={settings} refresh={feed.refresh} />
        )}
      </header>
      <div className="team-barra">
        <label className="team-filtro">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Mis intervenciones
        </label>
        {settings?.enabled && (
          <span data-testid="team-teaching-policy" className="team-politica-contenedor">
            <button
              type="button"
              className="team-politica"
              aria-expanded={policyOpen}
              aria-controls={policyId}
              onClick={() => setPolicyOpen((open) => !open)}
            >
              {policy.short}
            </button>
            <span
              id={policyId}
              className={policyOpen ? 'team-politica-detalle' : 'visualmente-oculto'}
            >
              {policy.short}
              {policy.long}
              {settings.reviewMode === 'OFF' && ' El OWNER ha desactivado Revisar.'}
            </span>
          </span>
        )}
      </div>
      {!props.online && (
        <p className="team-aviso advertencia">
          Sin conexión. El historial se recuperará al reconectar.
        </p>
      )}
      {settings?.enabled === false && (
        <p className="team-aviso advertencia">
          La IA está deshabilitada en este proyecto. Puedes consultar el historial.
        </p>
      )}
      {feed.error && (
        <div role="alert" className="team-aviso error">
          <span>{feed.error}</span>
          <span className="team-aviso-acciones">
            <button type="button" className="fantasma" onClick={() => void feed.retry()}>
              Reintentar lectura
            </button>
            {feed.stale && (
              <button type="button" className="fantasma" onClick={applyAppUpdate}>
                Recargar página
              </button>
            )}
          </span>
        </div>
      )}
      {feed.loading && (
        <p role="status" className="team-cargando">
          Cargando actividad…
        </p>
      )}
      <ol
        className="conversacion"
        data-testid="conversacion"
        aria-label="Conversación del equipo"
        aria-busy={feed.loading}
      >
        {!feed.loading && !visibleMessages.length && (
          <li className="team-vacio">
            {mineOnly ? (
              <p>Todavía no tienes intervenciones.</p>
            ) : (
              <>
                <span className="team-avatar ia grande" aria-hidden="true">
                  <IconoIA size={22} />
                </span>
                <strong>Soy la IA del equipo</strong>
                <p>
                  Veo el mismo diagrama que ustedes. Explico conceptos, propongo cambios y aviso
                  cuando algo no cuadra. Todo el equipo ve lo que conversamos.
                </p>
                <ul className="team-sugerencias" aria-label="Ejemplos para empezar">
                  {SUGERENCIAS.map(([mode, label, text]) => (
                    <li key={mode}>
                      <button
                        type="button"
                        disabled={
                          pending ||
                          !props.online ||
                          settings?.enabled === false ||
                          (mode === 'INSTRUCT' && !props.canWrite) ||
                          (mode === 'REVIEW' && settings?.reviewMode === 'OFF')
                        }
                        onClick={() =>
                          setRestore({ text, mode, inputMode: 'TEXT', revision: Date.now() })
                        }
                      >
                        <b>{label}</b>
                        <span>«{text}»</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        )}
        {visibleMessages.map((message) => {
          const proposal = requestProposals.get(message.id);
          const owned = message.authorId === user.id;
          const author =
            message.authorKind === 'USER'
              ? name(message.authorId)
              : message.authorKind === 'AI'
                ? `IA → ${name(message.addressedToId)}`
                : 'Sistema';
          return (
            <li
              key={message.id}
              id={`team-message-${message.id}`}
              tabIndex={-1}
              className={`team-msg ${message.authorKind === 'USER' ? 'usuario' : 'asistente-mensaje'}${owned ? ' propio' : ''}${message.kind === 'REVIEW' ? ' moderacion' : ''}`}
              data-message-id={message.id}
            >
              {message.authorKind === 'USER' ? (
                <span
                  className="team-avatar"
                  style={{ background: colorOf(message.authorId) }}
                  aria-hidden="true"
                >
                  {iniciales(name(message.authorId))}
                </span>
              ) : (
                <span className="team-avatar ia" aria-hidden="true">
                  <IconoIA size={16} />
                </span>
              )}
              <div className="team-msg-cuerpo">
                <div className="team-message-meta">
                  <strong>{author}</strong>
                  {message.mode && (
                    <small className="team-etiqueta">
                      {modeLabel[message.mode]}
                      {message.inputMode === 'DICTATION'
                        ? ' · Dictado'
                        : message.inputMode === 'VOICE_COMMAND'
                          ? ' · Comando de voz'
                          : ''}
                    </small>
                  )}
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString('es', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                {message.replyToId && (
                  <button
                    type="button"
                    className="team-reply-link"
                    onClick={() => showParent(message.replyToId!)}
                  >
                    ↳ Ver mensaje de referencia
                  </button>
                )}
                {message.authorKind === 'USER' ? (
                  <p className="team-texto">{message.text}</p>
                ) : (
                  <RichText className="team-texto" text={message.text} />
                )}
                {message.status && message.status !== 'DONE' && (
                  <small className={`team-status estado-${message.status.toLowerCase()}`}>
                    {requestLabel[message.status]}
                  </small>
                )}
                {owned && message.errorCode === 'team_ai_input_budget' && (
                  <p>
                    El diagrama y la solicitud superan el contexto disponible. Reduce el alcance de
                    la consulta o revisa la solicitud antes de reintentar.
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
              </div>
            </li>
          );
        })}
        {processing && !mineOnly && (
          <li className="team-msg asistente-mensaje team-pensando" aria-hidden="true">
            <span className="team-avatar ia estado-pensando">
              <IconoIA size={16} />
            </span>
            <div className="team-msg-cuerpo">
              <div className="team-message-meta">
                <strong>{IA_EQUIPO.nombre}</strong>
              </div>
              <p>
                <span className="team-puntos">
                  <i />
                  <i />
                  <i />
                </span>
                Pensando la respuesta para {name(processing.authorId)}
              </p>
            </div>
          </li>
        )}
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
        voiceEngine={voiceEngine}
      />
    </section>
  );
}
