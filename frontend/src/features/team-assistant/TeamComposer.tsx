import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  contextToDraft,
  exceedsContext,
  type PendingTurn,
  type SemanticModel,
  type TeamInputMode,
  type TeamMode,
} from '@uml/contracts';
import { AssistantLearningGuide } from '../assistant/AssistantLearningGuide.js';
import { useSpeech } from '../assistant/useSpeech.js';
import { prepareDictation } from '../assistant/prepare-dictation.js';
import { useVoiceCommand } from '../assistant/useVoiceCommand.js';
import { VoiceCommandButton, VoiceCommandStatus } from './VoiceCommandControl.js';
import {
  IconoDetener,
  IconoEnviar,
  IconoIA,
  IconoLibro,
  IconoMicrofono,
} from '../../components/icons.js';
import type { VoiceEngine } from '../assistant/recorder-recognition.js';
import { IA_EQUIPO, colorEstable, iniciales } from './identity.js';
import {
  extractAiMention,
  insertMention,
  matchesQuery,
  mentionOptions,
  mentionQuery,
  resolveMentions,
  type MentionCandidate,
} from './mentions.js';

/** TEAM: mensaje entre personas, la IA no lo responde. AI: solicitud con `mode`. */
export type ComposerDestination = 'TEAM' | 'AI';
export interface ComposerDraft {
  readonly text: string;
  readonly destination: ComposerDestination;
  /** Solo cuenta cuando el destino es la IA. */
  readonly mode: TeamMode;
  readonly inputMode: TeamInputMode;
  /** IDs de integrantes mencionados con @. */
  readonly mentions: readonly string[];
}
export type ComposerRestore = Omit<ComposerDraft, 'mentions'> & {
  mentions?: readonly string[];
  revision: number;
  preserveExistingText?: boolean;
};

const AI_OPTION = 'ia-del-equipo';
interface MentionOption {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}
const MODES = [
  ['INSTRUCT', 'Instruir', 'modo-instruir', 'Pide a la IA cambios en el diagrama'],
  ['ASK', 'Preguntar', 'modo-preguntar', 'Pregunta a la IA dudas de diseño o conceptos'],
  ['REVIEW', 'Revisar', 'modo-revisar', 'Pide a la IA una revisión del modelo'],
] as const;

export function TeamComposer(props: {
  model: SemanticModel;
  canWrite: boolean;
  /** Hay conexión: se puede escribir al equipo. */
  enabled: boolean;
  /** La IA acepta solicitudes en este proyecto. */
  aiEnabled: boolean;
  visible: boolean;
  reviewEnabled?: boolean;
  pending: boolean;
  cancelling: boolean;
  context: readonly PendingTurn[];
  restore: ComposerRestore | null;
  /** Integrantes que se pueden mencionar, sin la persona actual. */
  members: readonly MentionCandidate[];
  send(draft: ComposerDraft): Promise<boolean>;
  cancel(): void;
  clearContext(): void;
  /** Voz transcrita en el servidor (Whisper local); sin él, reconocimiento del navegador. */
  voiceEngine?: VoiceEngine | undefined;
}) {
  const [text, setText] = useState('');
  const currentText = useRef(text);
  currentText.current = text;
  const members = useRef(props.members);
  members.current = props.members;
  // Por defecto se habla con el equipo: a la IA se le escribe a propósito.
  const [destination, setDestination] = useState<ComposerDestination>('TEAM');
  // «@IA» vale para un mensaje; elegir un modo con su botón se mantiene.
  const [oneShot, setOneShot] = useState(false);
  const [mode, setMode] = useState<TeamMode>('INSTRUCT');
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const helpId = useId();
  const listId = useId();
  const keysId = useId();
  const [original, setOriginal] = useState<string | null>(null);
  const beforeDictation = useRef('');
  const input = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const ai = destination === 'AI';
  const blocked =
    props.pending ||
    !props.enabled ||
    (ai && (!props.aiEnabled || (mode === 'REVIEW' && props.reviewEnabled === false)));
  const dictationAllowed =
    !blocked && props.visible && (!ai || mode !== 'INSTRUCT' || props.canWrite);
  const voice = useSpeech(
    (transcript) => {
      if (!transcript.trim()) {
        setText(beforeDictation.current);
        setOriginal(null);
        return;
      }
      const value = [beforeDictation.current, transcript].filter(Boolean).join(' ');
      setOriginal(value);
      setText(prepareDictation(value));
    },
    props.voiceEngine,
    dictationAllowed,
  );
  const dictating = voice.listening || voice.stopping;
  const visible = dictating
    ? [beforeDictation.current, voice.transcript].filter(Boolean).join(' ')
    : text;
  const full = ai && mode === 'INSTRUCT' && exceedsContext(props.context);
  const clarifying = props.context.length > 0;
  useEffect(() => {
    // Una aclaración pendiente espera la respuesta de esta persona a la IA.
    if (!clarifying) return;
    setDestination('AI');
    setMode('INSTRUCT');
    setOneShot(false);
  }, [clarifying]);
  useEffect(() => {
    if (props.aiEnabled) return;
    setDestination('TEAM');
    setOneShot(false);
  }, [props.aiEnabled]);
  useEffect(() => {
    if (!props.restore) return;
    // El comando de voz se envía sin vaciar el borrador escrito. Recuperar su
    // transcripción automáticamente no debe sobrescribir ese trabajo aparte.
    if (props.restore.preserveExistingText && currentText.current.trim()) return;
    setText(props.restore.text);
    setMode(props.restore.mode);
    setDestination(props.restore.destination);
    setOneShot(false);
    setPicked(
      new Map(
        (props.restore.mentions ?? []).flatMap((id) => {
          const member = members.current.find((candidate) => candidate.id === id);
          return member ? [[id, member.displayName] as const] : [];
        }),
      ),
    );
    setOriginal(props.restore.inputMode === 'DICTATION' ? props.restore.text : null);
    input.current?.focus();
  }, [props.restore]);
  useEffect(() => {
    if (dictating && input.current) input.current.scrollTop = input.current.scrollHeight;
  }, [dictating, visible]);
  useLayoutEffect(() => {
    // Tras insertar o quitar una mención, el cursor queda justo después.
    const at = pendingCaret.current;
    if (at === null || !input.current) return;
    pendingCaret.current = null;
    input.current.setSelectionRange(at, at);
    setCaret(at);
  }, [text]);
  const commandAllowed =
    !props.pending &&
    props.enabled &&
    props.aiEnabled &&
    props.visible &&
    props.canWrite &&
    (!ai || mode === 'INSTRUCT') &&
    !dictating &&
    !full;
  const command = useVoiceCommand(
    commandAllowed,
    (transcript) => {
      if (sending.current || !commandAllowed) return;
      sending.current = true;
      // El comando de voz siempre es una instrucción para la IA.
      void props
        .send({
          text: transcript,
          destination: 'AI',
          mode: 'INSTRUCT',
          inputMode: 'VOICE_COMMAND',
          mentions: [],
        })
        .finally(() => {
          sending.current = false;
        });
    },
    props.voiceEngine,
  );
  const commanding = command.phase !== 'idle';
  useEffect(() => {
    // Cambiar de hilo/borrador invalida cualquier captura iniciada con el contexto anterior.
    command.cancel();
  }, [props.restore, command.cancel]);

  const query = dictating || props.pending ? null : mentionQuery(text, caret);
  const options: MentionOption[] = query
    ? [
        ...(props.aiEnabled && matchesQuery('IA', query.query)
          ? [{ id: AI_OPTION, label: IA_EQUIPO.nombre, hint: 'Pedirle algo a la IA' }]
          : []),
        ...mentionOptions(query.query, props.members).map((member) => ({
          id: member.id,
          label: member.displayName,
          hint: member.hint ?? 'Integrante',
        })),
      ]
    : [];
  const open = query !== null && options.length > 0 && dismissed !== query.start;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const queryKey = query ? `${query.start}:${query.query}` : null;
  useEffect(() => {
    setActive(0);
    if (queryKey === null) setDismissed(null);
  }, [queryKey]);

  function chooseAi(once: boolean) {
    setDestination('AI');
    setOneShot(once);
    if (mode === 'INSTRUCT' && !props.canWrite) setMode('ASK');
  }
  function pick(option: MentionOption) {
    if (!query) return;
    if (option.id === AI_OPTION) {
      // La IA no queda escrita: el destino lo muestran los botones de arriba.
      const rest = text.slice(caret).replace(/^[ \t]+/, '');
      pendingCaret.current = query.start;
      setText(text.slice(0, query.start) + rest);
      chooseAi(true);
      return;
    }
    const next = insertMention(text, query.start, caret, option.label);
    pendingCaret.current = next.caret;
    setText(next.text);
    setPicked((current) => new Map(current).set(option.id, option.label));
  }

  async function submit() {
    let target = destination;
    let body = text;
    if (target === 'TEAM' && props.aiEnabled) {
      // «@IA» al final del mensaje, sin espacio detrás, también la invoca.
      const cleaned = extractAiMention(text, true);
      if (cleaned !== null) {
        target = 'AI';
        body = cleaned;
        setText(cleaned);
        chooseAi(true);
      }
    }
    const toAi = target === 'AI';
    // Solo el «@IA» recién convertido adapta el modo a quien no puede instruir
    // (como hace chooseAi); un modo elegido a mano se respeta y se bloquea igual
    // que el botón Enviar.
    const targetMode: TeamMode =
      target !== destination && mode === 'INSTRUCT' && !props.canWrite ? 'ASK' : mode;
    const message = body.trim();
    if (
      sending.current ||
      props.pending ||
      !props.enabled ||
      dictating ||
      commanding ||
      !message ||
      message.length > 2000 ||
      (toAi &&
        (!props.aiEnabled ||
          (targetMode === 'REVIEW' && props.reviewEnabled === false) ||
          (targetMode === 'INSTRUCT' && (!props.canWrite || exceedsContext(props.context)))))
    )
      return;
    sending.current = true;
    const draft: ComposerDraft = {
      text: message,
      destination: target,
      mode: targetMode,
      inputMode: original === null ? 'TEXT' : 'DICTATION',
      mentions: resolveMentions(message, props.members, picked),
    };
    // Al equipo se le escribe como en un chat: la caja se vacía al instante y
    // conserva el foco para el siguiente mensaje. Si el envío falla, el texto
    // vuelve, salvo que ya se haya empezado a escribir otro.
    const previous = { text: body, original, picked };
    if (!toAi) {
      setText('');
      setOriginal(null);
      setPicked(new Map());
    }
    try {
      if (await props.send(draft)) {
        if (toAi) {
          setText('');
          setOriginal(null);
          setPicked(new Map());
        }
        if (toAi && (oneShot || target !== destination)) {
          setDestination('TEAM');
          setOneShot(false);
        }
      } else if (!toAi && !currentText.current.trim()) {
        setText(previous.text);
        setOriginal(previous.original);
        setPicked(previous.picked);
      }
    } finally {
      sending.current = false;
    }
  }
  const length = visible.trim().length;
  return (
    <div className="team-composer">
      <div className="team-composer-cabecera">
        <div className="segmentado team-modes" role="group" aria-label="Destino del mensaje">
          <button
            type="button"
            className={ai ? '' : 'activa'}
            aria-pressed={!ai}
            data-testid="destino-equipo"
            title="Para tus compañeros. La IA no responde, pero lo tendrá en cuenta como contexto."
            disabled={props.pending || dictating || commanding}
            onClick={() => {
              setDestination('TEAM');
              setOneShot(false);
            }}
          >
            Equipo
          </button>
          <span className="team-modos-ia" aria-hidden="true">
            <IconoIA size={13} />
          </span>
          {MODES.map(([value, label, testId, hint]) => (
            <button
              key={value}
              type="button"
              className={ai && mode === value ? 'activa' : ''}
              aria-pressed={ai && mode === value}
              data-testid={testId}
              title={hint}
              disabled={
                props.pending ||
                dictating ||
                commanding ||
                !props.aiEnabled ||
                (value === 'INSTRUCT' && !props.canWrite) ||
                (value === 'REVIEW' && props.reviewEnabled === false)
              }
              onClick={() => {
                setMode(value);
                setDestination('AI');
                setOneShot(false);
              }}
            >
              {label}
              <span className="visualmente-oculto"> a la IA</span>
            </button>
          ))}
        </div>
        <AssistantLearningGuide
          model={props.model}
          canWrite={props.canWrite}
          triggerClassName="team-guia"
          triggerIcon={<IconoLibro size={17} />}
          iconOnly
          canUseExample={
            !props.pending &&
            !dictating &&
            !commanding &&
            props.aiEnabled &&
            !text.trim() &&
            props.context.length === 0
          }
          useExample={(next, value) => {
            setMode(next === 'instruir' ? 'INSTRUCT' : 'ASK');
            setDestination('AI');
            setOneShot(false);
            setText(value);
            setOriginal(null);
            input.current?.focus();
          }}
        />
      </div>
      {ai && props.context.length > 0 && (
        <div className="contexto-asistente" data-testid="contexto-asistente" role="status">
          <span>
            {full
              ? 'Hay muchas aclaraciones pendientes. Revisa la solicitud completa antes de continuar.'
              : 'Aclaración en curso: recordaré la solicitud anterior en tu próximo mensaje.'}
          </span>
          {full && (
            <button
              type="button"
              disabled={props.pending || dictating || commanding}
              data-testid="revisar-contexto"
              onClick={() => {
                setText(contextToDraft(props.context, text));
                props.clearContext();
                setOriginal(null);
              }}
            >
              Revisar solicitud completa
            </button>
          )}
          <button
            type="button"
            disabled={props.pending || dictating || commanding}
            data-testid="descartar-contexto"
            onClick={props.clearContext}
          >
            Empezar de nuevo
          </button>
        </div>
      )}
      {voice.error && (
        <p className="error" role="alert">
          {voice.error}
        </p>
      )}
      {dictating && (
        <p role="status" className="estado-dictado">
          {voice.stopping
            ? 'Finalizando el dictado…'
            : 'Escuchando. Pulsa Parar cuando termines; después podrás revisar el texto.'}
        </p>
      )}
      {!dictating && original !== null && (
        <div className="revision-dictado" data-testid="revision-dictado">
          <p>Revisa el dictado antes de enviarlo.</p>
          {original !== text && (
            <button type="button" disabled={props.pending} onClick={() => setText(original)}>
              Recuperar dictado original
            </button>
          )}
        </div>
      )}
      <form
        className={`entrada team-entrada${dictating || commanding ? ' escuchando' : ''}${ai ? ' para-ia' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="Mencionar a"
          className="team-menciones"
          data-testid="sugerencias-mencion"
          hidden={!open}
        >
          {open &&
            options.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'activa' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
              >
                {option.id === AI_OPTION ? (
                  <span className="team-avatar ia" aria-hidden="true">
                    <IconoIA size={13} />
                  </span>
                ) : (
                  <span
                    className="team-avatar"
                    style={{ background: colorEstable(option.id) }}
                    aria-hidden="true"
                  >
                    {iniciales(option.label)}
                  </span>
                )}
                <span className="team-mencion-texto">
                  <b>{option.label}</b>
                  <small>{option.hint}</small>
                </span>
              </li>
            ))}
        </ul>
        <span id={keysId} className="visualmente-oculto">
          Enter envía; Shift + Enter agrega un salto de línea.
        </span>
        <span className="visualmente-oculto" role="status">
          {open
            ? `${options.length} ${options.length === 1 ? 'sugerencia' : 'sugerencias'} para mencionar. Flechas para elegir, Enter para insertar.`
            : ''}
        </span>
        <textarea
          ref={input}
          rows={2}
          value={visible}
          disabled={props.pending}
          readOnly={dictating}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={keysId}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          aria-label={
            !ai
              ? 'Mensaje para el equipo'
              : mode === 'INSTRUCT'
                ? 'Instrucción para el asistente'
                : mode === 'ASK'
                  ? 'Pregunta para el asistente'
                  : 'Revisión para el asistente'
          }
          placeholder={
            !ai
              ? props.aiEnabled
                ? 'Escribe al equipo. Usa @ para mencionar a alguien o @IA para pedirle algo a la IA'
                : 'Escribe al equipo. Usa @ para mencionar a alguien'
              : mode === 'INSTRUCT'
                ? 'Pide un cambio: «Agrega la clase Cliente con nombre y correo»'
                : mode === 'ASK'
                  ? 'Pregunta: «¿Qué es una clase asociativa?»'
                  : '¿Qué quieres que revise del modelo?'
          }
          data-testid="entrada-asistente"
          onChange={(event) => {
            let value = event.target.value;
            let position = event.target.selectionStart ?? value.length;
            if (!ai && props.aiEnabled) {
              // «@IA » escrito a mano cambia el destino y desaparece del texto.
              const cleaned = extractAiMention(value);
              if (cleaned !== null) {
                position = Math.max(0, position - (value.length - cleaned.length));
                value = cleaned;
                pendingCaret.current = position;
                chooseAi(true);
              }
            }
            setText(value);
            setCaret(position);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (open && query) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive((activeIndex + step + options.length) % options.length);
                return;
              }
              if (
                (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) ||
                (event.key === 'Tab' && !event.shiftKey)
              ) {
                const option = options[activeIndex];
                if (option) {
                  event.preventDefault();
                  pick(option);
                  return;
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setDismissed(query.start);
                return;
              }
            }
            // Como en cualquier chat: Enter envía y Shift + Enter salta de línea.
            // Mientras un teclado IME compone (acentos, CJK), Enter confirma la
            // composición y no envía. Ctrl/⌘ + Enter sigue enviando.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="team-entrada-acciones">
          <div className="team-entrada-voz">
            {voice.supported && (
              <button
                type="button"
                className={`team-dictar${voice.listening ? ' escuchando' : ''}`}
                title={
                  voice.listening ? 'Parar dictado' : 'Dictar: revisarás el texto antes de enviarlo'
                }
                disabled={!dictationAllowed || commanding || voice.stopping}
                data-testid="dictar"
                onClick={() => {
                  if (voice.listening) voice.stop();
                  else {
                    beforeDictation.current = text;
                    setOriginal(null);
                    voice.start();
                  }
                }}
              >
                {voice.listening ? <IconoDetener size={15} /> : <IconoMicrofono size={15} />}
                <span>
                  {voice.listening ? 'Parar' : voice.stopping ? 'Finalizando…' : 'Dictar'}
                </span>
              </button>
            )}
            {dictating && (
              <button
                type="button"
                className="fantasma"
                onClick={() => {
                  voice.cancel();
                  setText(beforeDictation.current);
                  setOriginal(null);
                }}
              >
                Cancelar dictado
              </button>
            )}
            <VoiceCommandButton command={command} disabled={!commandAllowed} helpId={helpId} />
          </div>
          <div className="team-entrada-envio">
            {length > 0 && (
              <span className={length > 2000 ? 'team-contador excedido' : 'team-contador'}>
                {length}/2000
              </span>
            )}
            {props.pending && (
              <button
                type="button"
                className="fantasma"
                data-testid="cancelar-solicitud"
                disabled={!props.enabled || props.cancelling}
                onClick={props.cancel}
              >
                {props.cancelling ? 'Cancelando…' : 'Cancelar solicitud'}
              </button>
            )}
            <button
              type="submit"
              className="principal team-enviar"
              title={`${ai ? 'Enviar a la IA' : 'Enviar al equipo'} (Enter). Salto de línea: Shift + Enter`}
              disabled={
                blocked ||
                full ||
                dictating ||
                commanding ||
                !text.trim() ||
                text.trim().length > 2000 ||
                (ai && mode === 'INSTRUCT' && !props.canWrite)
              }
              data-testid="enviar-asistente"
            >
              <span>{props.pending ? 'En espera' : 'Enviar'}</span>
              <IconoEnviar size={15} />
            </button>
          </div>
        </div>
      </form>
      <VoiceCommandStatus command={command} helpId={helpId} />
      {length > 2000 && (
        <p className="error" role="alert">
          {length}/2000 caracteres. Acorta el texto antes de enviar; tu dictado se conserva
          completo.
        </p>
      )}
    </div>
  );
}
