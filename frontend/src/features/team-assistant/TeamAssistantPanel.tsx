import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  BoardState,
  CommandBatch,
  ProjectRole,
  SemanticModel,
  TeamChatBody,
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
import { PersonalAiSettings } from './PersonalAiSettings.js';
import { RichText } from './RichText.js';
import { IA_EQUIPO, colorEstable, iniciales, type ActividadIa } from './identity.js';
import { mentionSegments, type MentionCandidate } from './mentions.js';
import './team-assistant.css';

/** Ejemplos del estado vacío: al pulsarlos llenan el compositor, no envían. */
const SUGERENCIAS: readonly (readonly [TeamMode, string, string])[] = [
  ['INSTRUCT', 'Instruir', 'Agrega la clase Pedido con fecha y total'],
  ['ASK', 'Preguntar', '¿Qué es un atributo derivado?'],
  ['REVIEW', 'Revisar', '¿Está bien modelada la herencia?'],
];
const ROL: Record<ProjectRole, string> = {
  OWNER: 'Propietario',
  EDITOR: 'Editor',
  VIEWER: 'Lector',
};

/** Texto de una persona con sus menciones resaltadas; la propia, más visible. */
function MentionText(props: {
  text: string;
  mentions: readonly { readonly id: string; readonly name: string }[];
  self: string;
}) {
  return (
    <p className="team-texto">
      {mentionSegments(props.text, props.mentions).map((segment, index) =>
        segment.mention ? (
          <span
            key={index}
            className={`team-mencion${segment.mention === props.self ? ' yo' : ''}`}
          >
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </p>
  );
}

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
  /** De esos mensajes, cuántos mencionan con @ a esta persona. */
  onMentioned?(count: number): void;
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
  const projectEngine = settings
    ? settings.aiSource === 'LOCAL'
      ? (settings.localModel ?? 'Modelo local')
      : settings.aiSource === 'VM'
        ? 'IA de VM'
        : 'Nube'
    : null;
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
  const [cancelling, setCancelling] = useState(false);
  const [cancelOnArrival, setCancelOnArrival] = useState<readonly string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restore, setRestore] = useState<ComposerRestore | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const execution = useRef(new ProposalExecution());
  const cancelWanted = useRef<string | null>(null);
  const activeKey = useRef<string | null>(null);
  const cancelInFlight = useRef(false);
  const mounted = useRef(true);
  const activeDraft = useRef<ComposerDraft | null>(null);
  const retry = useRef<{ fingerprint: string; body: TeamRequestBody } | null>(null);
  const chatRetry = useRef<{ fingerprint: string; body: TeamChatBody } | null>(null);
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
  const mentionable = useMemo<readonly MentionCandidate[]>(
    () =>
      feed.members
        .filter((member) => member.id !== user.id)
        .map((member) => ({
          id: member.id,
          displayName: member.displayName,
          hint: ROL[member.role],
        })),
    [feed.members, user.id],
  );
  const requestProposals = useMemo(
    () => new Map(proposals.map((p) => [p.requestMessageId, p])),
    [proposals],
  );
  const visibleMessages = mineOnly
    ? messages.filter(
        (m) =>
          m.authorId === user.id || m.addressedToId === user.id || m.mentions.includes(user.id),
      )
    : messages;
  const processing = messages.filter((m) => m.status === 'PROCESSING');
  const queued = messages.filter((m) => m.status === 'QUEUED').length;
  const processingNames = [...new Set(processing.map((m) => name(m.authorId)))].join(', ');
  const processingDetail = `Respondiendo a ${processingNames}${processing.length > 1 ? ` · ${processing.length} solicitudes en paralelo` : ''}${queued ? ` · ${queued} en cola` : ''}`;
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
      : processing.length
        ? {
            estado: 'pensando',
            detalle: processingDetail,
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
  const [mentioned, setMentioned] = useState(0);
  useEffect(() => {
    if (initialMessageIds === null) {
      seen.current = null;
      setUnread(0);
      setMentioned(0);
      return;
    }
    if (seen.current?.baseline !== initialMessageIds) {
      seen.current = { baseline: initialMessageIds, ids: new Set(initialMessageIds) };
    }
    const known = seen.current.ids;
    if (props.visible) {
      for (const m of messages) known.add(m.id);
      setUnread(0);
      setMentioned(0);
      return;
    }
    const fresh = messages.filter((m) => m.authorId !== user.id && !known.has(m.id));
    setUnread(fresh.length);
    setMentioned(fresh.filter((m) => m.mentions.includes(user.id)).length);
  }, [initialMessageIds, messages, props.visible, user.id]);
  const onUnread = props.onUnread;
  useEffect(() => {
    onUnread?.(unread);
  }, [onUnread, unread]);
  const onMentioned = props.onMentioned;
  useEffect(() => {
    onMentioned?.(mentioned);
  }, [onMentioned, mentioned]);
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
    if (
      ownRequest.status === 'FAILED' ||
      ownRequest.status === 'INTERRUPTED' ||
      ownRequest.status === 'CANCELLED'
    ) {
      // Un reintento debe responder a la misma aclaración, no enviar una
      // respuesta aislada como «correo» sin la instrucción que la originó.
      setReplyToId(ownRequest.replyToId);
      if (activeDraft.current)
        setRestore({
          ...activeDraft.current,
          revision: Date.now(),
          preserveExistingText:
            ownRequest.status === 'CANCELLED' || activeDraft.current.inputMode === 'VOICE_COMMAND',
        });
    } else if (response?.kind === 'CLARIFICATION' && ownRequest.mode === 'INSTRUCT')
      setReplyToId(response.id);
    else setReplyToId(null);
    setActiveId(null);
  }, [ownRequest, messages, requestProposals, user.id]);

  function finishCancellation(message: TeamMessage, key: string, restoreDraft: boolean) {
    if (retry.current?.body.clientRequestId === key) retry.current = null;
    if (restoreDraft && activeKey.current === key) {
      setActiveId((current) => (current === message.id ? null : current));
      setReplyToId(message.replyToId);
      if (activeDraft.current)
        setRestore({ ...activeDraft.current, revision: Date.now(), preserveExistingText: true });
    }
    setError(null);
    setNotice('Solicitud cancelada. Puedes volver a usar el texto.');
  }

  async function cancel(id = activeId, key = activeKey.current, restoreDraft = true) {
    if (!props.online || cancelInFlight.current) return;
    if (!key) return;
    execution.current.cancel(key);
    setCancelling(true);
    setError(null);
    if (!id) {
      cancelWanted.current = key;
      setNotice('Cancelando cuando se confirme el envío…');
      return;
    }
    cancelInFlight.current = true;
    setNotice(null);
    try {
      const cancelled = await teamAiApi.cancel(boardId, id);
      if (!mounted.current) return;
      finishCancellation(cancelled, key, restoreDraft);
      void feed.refresh();
    } catch (cause) {
      const snapshot = await feed.refreshSnapshot();
      if (!mounted.current) return;
      const observed = snapshot.messages.find((message) => message.id === id);
      if (observed?.status === 'CANCELLED') finishCancellation(observed, key, restoreDraft);
      else setError(cause instanceof Error ? cause.message : 'No se pudo cancelar.');
    } finally {
      cancelInFlight.current = false;
      if (mounted.current) setCancelling(false);
    }
  }

  const reconcileCancellation = useEffectEvent((message: TeamMessage, key: string) => {
    setCancelOnArrival((current) => current.filter((item) => item !== key));
    if (message.status === 'QUEUED' || message.status === 'PROCESSING')
      void cancel(message.id, key);
    else if (message.status === 'CANCELLED') finishCancellation(message, key, true);
    else setNotice('La solicitud ya terminó.');
  });
  useEffect(() => {
    if (!props.online || cancelling || cancelOnArrival.length === 0) return;
    const message = messages.find(
      (item) =>
        item.authorId === user.id &&
        item.clientRequestId &&
        cancelOnArrival.includes(item.clientRequestId),
    );
    if (message?.clientRequestId) reconcileCancellation(message, message.clientRequestId);
  }, [props.online, cancelling, cancelOnArrival, messages, user.id]);
  /**
   * Mensaje entre personas: no espera respuesta de la IA ni toca la aclaración
   * en curso. Tampoco marca `posting`: eso deshabilitaría la caja (perdiendo el
   * foco tras cada Enter) y ofrecería «Cancelar solicitud» para algo que no la tiene.
   */
  async function sendChat(draft: ComposerDraft): Promise<boolean> {
    if (sending.current || pending || !props.online || draft.inputMode === 'VOICE_COMMAND')
      return false;
    sending.current = true;
    setError(null);
    setNotice(null);
    const content = { text: draft.text, inputMode: draft.inputMode, mentions: [...draft.mentions] };
    const fingerprint = JSON.stringify(content);
    // Un fallo de red puede ocultar un envío registrado: el reintento conserva la clave.
    const body: TeamChatBody =
      chatRetry.current?.fingerprint === fingerprint
        ? chatRetry.current.body
        : { ...content, clientRequestId: crypto.randomUUID() };
    chatRetry.current = { fingerprint, body };
    try {
      await teamAiApi.chat(boardId, body, AbortSignal.timeout(15_000));
      if (!mounted.current) return false;
      chatRetry.current = null;
      void feed.refresh();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      if (cause instanceof ApiError && cause.status < 500) chatRetry.current = null;
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar. Conservamos tu texto.');
      return false;
    } finally {
      sending.current = false;
    }
  }
  async function send(draft: ComposerDraft): Promise<boolean> {
    if (draft.destination === 'TEAM') return sendChat(draft);
    if (
      sending.current ||
      pending ||
      !props.online ||
      settings?.enabled === false ||
      (draft.mode === 'INSTRUCT' && !props.canWrite)
    )
      return false;
    sending.current = true;
    cancelWanted.current = null;
    activeDraft.current = draft;
    setPosting(true);
    setError(null);
    setNotice(null);
    // El mismo envío puede haberse registrado aunque su respuesta se perdiera.
    const content = {
      mode: draft.mode,
      inputMode: draft.inputMode,
      text: draft.text,
      mentions: [...draft.mentions],
      replyToId,
    };
    const fingerprint = JSON.stringify(content);
    const body: TeamRequestBody =
      retry.current?.fingerprint === fingerprint
        ? retry.current.body
        : { ...content, model: props.state.semantic, clientRequestId: crypto.randomUUID() };
    retry.current = { fingerprint, body };
    activeKey.current = body.clientRequestId;
    if (body.mode === 'INSTRUCT') execution.current.register(body.clientRequestId, body.inputMode);
    try {
      const accepted = await teamAiApi.send(boardId, body, AbortSignal.timeout(15_000));
      if (!mounted.current) return false;
      retry.current = null;
      setActiveId(accepted.id);
      if (cancelWanted.current === body.clientRequestId) {
        await cancel(accepted.id, body.clientRequestId);
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
      if (cancelWanted.current === body.clientRequestId) {
        retry.current = null;
        setCancelling(false);
        if (cause instanceof ApiError && cause.status < 500) {
          setNotice('Envío cancelado.');
        } else {
          setCancelOnArrival((current) => [...current, body.clientRequestId]);
          void feed.refreshSnapshot();
        }
        return false;
      }
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar. Conservamos tu texto.');
      return false;
    } finally {
      sending.current = false;
      if (mounted.current) setPosting(false);
    }
  }
  function restoreRequest(request: TeamMessage) {
    if (request.authorKind !== 'USER' || request.kind === 'CHAT' || request.authorId !== user.id)
      return;
    // Desde el historial se prepara otra solicitud tras un resultado conocido.
    if (retry.current?.body.clientRequestId === request.clientRequestId) retry.current = null;
    setReplyToId(request.replyToId);
    setRestore({
      text: request.text,
      destination: 'AI',
      mode: request.mode,
      inputMode: request.inputMode,
      mentions: request.mentions,
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
            {processing.length
              ? processingDetail
              : queued
                ? `${queued} solicitud${queued === 1 ? '' : 'es'} en cola`
                : !props.online
                  ? 'Sin conexión'
                  : settings?.enabled === false
                    ? 'Desactivada en este proyecto'
                    : 'Al día con el equipo'}
          </p>
        </div>
        <PersonalAiSettings
          online={props.online}
          visible={props.visible}
          projectEngine={projectEngine}
        />
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
          La IA está deshabilitada en este proyecto. El equipo puede seguir conversando aquí.
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
                  cuando algo no cuadra. Conversen entre ustedes aquí; para pedirme algo, escriban
                  @IA o elijan Instruir, Preguntar o Revisar.
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
                          setRestore({
                            text,
                            destination: 'AI',
                            mode,
                            inputMode: 'TEXT',
                            revision: Date.now(),
                          })
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
          const mentionsMe = !owned && message.mentions.includes(user.id);
          // Mismo formato en los dos sentidos: «Ana → IA» e «IA → Ana». Un
          // mensaje al equipo sin menciones lleva solo el nombre de quien escribe.
          const recipients = message.mentions.map(name).join(', ');
          const author =
            message.authorKind === 'USER'
              ? message.kind !== 'CHAT'
                ? `${name(message.authorId)} → IA`
                : recipients
                  ? `${name(message.authorId)} → ${recipients}`
                  : name(message.authorId)
              : message.authorKind === 'AI'
                ? `IA → ${name(message.addressedToId)}`
                : 'Sistema';
          return (
            <li
              key={message.id}
              id={`team-message-${message.id}`}
              tabIndex={-1}
              className={`team-msg ${message.authorKind === 'USER' ? 'usuario' : 'asistente-mensaje'}${owned ? ' propio' : ''}${message.kind === 'REVIEW' ? ' moderacion' : ''}${message.kind === 'CHAT' ? ' chat' : ''}${mentionsMe ? ' menciona-me' : ''}`}
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
                  {message.engineLabel && (
                    <small className="team-etiqueta">{message.engineLabel}</small>
                  )}
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
                {mentionsMe && <span className="visualmente-oculto">Te menciona. </span>}
                {message.authorKind === 'USER' ? (
                  <MentionText
                    text={message.text}
                    mentions={message.mentions.map((id) => ({ id, name: name(id) }))}
                    self={user.id}
                  />
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
                {owned && message.errorCode === 'team_ai_timeout' && (
                  <p>Se agotó el tiempo de espera. Puedes reintentar o cambiar de motor.</p>
                )}
                {owned && message.errorCode === 'ai_engine_unavailable' && (
                  <p>El motor elegido no está disponible. Puedes cambiarlo en «Mi motor de IA».</p>
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
                      disabled={!props.online || pending || cancelling}
                      onClick={() => void cancel(message.id, message.clientRequestId, false)}
                    >
                      Cancelar esta solicitud
                    </button>
                  )}
                {owned && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(message.status ?? '') && (
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
                        destination: 'AI',
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
        {processing.length > 0 && !mineOnly && (
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
                {processingDetail}
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
        enabled={props.online}
        aiEnabled={settings?.enabled !== false}
        members={mentionable}
        visible={props.visible}
        reviewEnabled={settings?.reviewMode !== 'OFF'}
        pending={pending}
        cancelling={cancelling}
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
