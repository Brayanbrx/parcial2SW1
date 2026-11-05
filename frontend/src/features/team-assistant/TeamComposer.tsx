import { useEffect, useRef, useState } from 'react';
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
import { VoiceCommandControl } from './VoiceCommandControl.js';

export interface ComposerDraft {
  readonly text: string;
  readonly mode: TeamMode;
  readonly inputMode: TeamInputMode;
}
export type ComposerRestore = ComposerDraft & {
  revision: number;
  preserveExistingText?: boolean;
};
export function TeamComposer(props: {
  model: SemanticModel;
  canWrite: boolean;
  enabled: boolean;
  visible: boolean;
  reviewEnabled?: boolean;
  pending: boolean;
  context: readonly PendingTurn[];
  restore: ComposerRestore | null;
  send(draft: ComposerDraft): Promise<boolean>;
  cancel(): void;
  clearContext(): void;
}) {
  const [text, setText] = useState('');
  const currentText = useRef(text);
  currentText.current = text;
  const [mode, setMode] = useState<TeamMode>('INSTRUCT');
  const [original, setOriginal] = useState<string | null>(null);
  const beforeDictation = useRef('');
  const input = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const voice = useSpeech((transcript) => {
    if (!transcript.trim()) {
      setText(beforeDictation.current);
      setOriginal(null);
      return;
    }
    const value = [beforeDictation.current, transcript].filter(Boolean).join(' ');
    setOriginal(value);
    setText(prepareDictation(value));
  });
  const dictating = voice.listening || voice.stopping;
  const visible = dictating
    ? [beforeDictation.current, voice.transcript].filter(Boolean).join(' ')
    : text;
  const full = mode === 'INSTRUCT' && exceedsContext(props.context);
  useEffect(() => {
    if (!props.restore) return;
    // El comando de voz se envía sin vaciar el borrador escrito. Recuperar su
    // transcripción automáticamente no debe sobrescribir ese trabajo aparte.
    if (props.restore.preserveExistingText && currentText.current.trim()) return;
    setText(props.restore.text);
    setMode(props.restore.mode);
    setOriginal(props.restore.inputMode === 'DICTATION' ? props.restore.text : null);
    input.current?.focus();
  }, [props.restore]);
  useEffect(() => {
    if (dictating && input.current) input.current.scrollTop = input.current.scrollHeight;
  }, [dictating, visible]);
  const blocked =
    props.pending || !props.enabled || (mode === 'REVIEW' && props.reviewEnabled === false);
  const commandAllowed =
    !blocked && props.visible && props.canWrite && mode === 'INSTRUCT' && !dictating && !full;
  const command = useVoiceCommand(commandAllowed, (transcript) => {
    if (sending.current || !commandAllowed) return;
    sending.current = true;
    void props
      .send({ text: transcript, mode: 'INSTRUCT', inputMode: 'VOICE_COMMAND' })
      .finally(() => {
        sending.current = false;
      });
  });
  const commanding = command.phase !== 'idle';
  useEffect(() => {
    // Cambiar de hilo/borrador invalida cualquier captura iniciada con el contexto anterior.
    command.cancel();
  }, [props.restore, command.cancel]);
  async function submit() {
    if (
      sending.current ||
      blocked ||
      dictating ||
      commanding ||
      full ||
      !text.trim() ||
      text.trim().length > 2000 ||
      (mode === 'INSTRUCT' && !props.canWrite)
    )
      return;
    sending.current = true;
    const draft = {
      text: text.trim(),
      mode,
      inputMode: original === null ? ('TEXT' as const) : ('DICTATION' as const),
    };
    try {
      if (await props.send(draft)) {
        setText('');
        setOriginal(null);
      }
    } finally {
      sending.current = false;
    }
  }
  return (
    <>
      <div className="pestanas team-modes" aria-label="Modo del asistente">
        {(
          [
            ['INSTRUCT', 'Instruir', 'modo-instruir'],
            ['ASK', 'Preguntar', 'modo-preguntar'],
            ['REVIEW', 'Revisar', 'modo-revisar'],
          ] as const
        ).map(([value, label, testId]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'activa' : ''}
            aria-pressed={mode === value}
            data-testid={testId}
            disabled={
              props.pending ||
              dictating ||
              commanding ||
              (value === 'INSTRUCT' && !props.canWrite) ||
              (value === 'REVIEW' && props.reviewEnabled === false)
            }
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="asistente-aprendizaje">
        <AssistantLearningGuide
          model={props.model}
          canWrite={props.canWrite}
          canUseExample={
            !props.pending &&
            !dictating &&
            !commanding &&
            !text.trim() &&
            props.context.length === 0
          }
          useExample={(next, value) => {
            setMode(next === 'instruir' ? 'INSTRUCT' : 'ASK');
            setText(value);
            setOriginal(null);
            input.current?.focus();
          }}
        />
      </div>
      {props.context.length > 0 && (
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
        className="entrada"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          rows={3}
          value={visible}
          disabled={props.pending}
          readOnly={dictating}
          aria-label={
            mode === 'INSTRUCT'
              ? 'Instrucción para el asistente'
              : mode === 'ASK'
                ? 'Pregunta para el asistente'
                : 'Revisión para el asistente'
          }
          placeholder={
            mode === 'INSTRUCT'
              ? 'Instrucción…'
              : mode === 'ASK'
                ? 'Pregunta…'
                : '¿Qué quieres revisar?'
          }
          data-testid="entrada-asistente"
          onChange={(event) => setText(event.target.value)}
        />
        {voice.supported && (
          <button
            type="button"
            className={voice.listening ? 'escuchando' : ''}
            title={voice.listening ? 'Parar dictado' : 'Dictar'}
            disabled={
              props.pending ||
              commanding ||
              voice.stopping ||
              (mode === 'INSTRUCT' && !props.canWrite)
            }
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
            {voice.listening ? 'Parar' : voice.stopping ? 'Finalizando…' : 'Dictar'}
          </button>
        )}
        {dictating && (
          <button
            type="button"
            onClick={() => {
              voice.cancel();
              setText(beforeDictation.current);
              setOriginal(null);
            }}
          >
            Cancelar dictado
          </button>
        )}
        <button
          type="submit"
          disabled={
            blocked ||
            full ||
            dictating ||
            commanding ||
            !text.trim() ||
            text.trim().length > 2000 ||
            (mode === 'INSTRUCT' && !props.canWrite)
          }
          data-testid="enviar-asistente"
        >
          {props.pending ? '…' : 'Enviar'}
        </button>
        {props.pending && (
          <button type="button" data-testid="cancelar-solicitud" onClick={props.cancel}>
            Cancelar solicitud
          </button>
        )}
      </form>
      <VoiceCommandControl command={command} disabled={!commandAllowed} />
      <p className={visible.trim().length > 2000 ? 'error' : 'limite-asistente'}>
        {visible.trim().length}/2000 caracteres
        {visible.trim().length > 2000
          ? '. Acorta el texto antes de enviar; tu dictado se conserva completo.'
          : ''}
      </p>
    </>
  );
}
