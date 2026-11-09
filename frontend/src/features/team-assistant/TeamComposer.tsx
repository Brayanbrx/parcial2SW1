import { useEffect, useId, useRef, useState } from 'react';
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
import { IconoDetener, IconoEnviar, IconoLibro, IconoMicrofono } from '../../components/icons.js';
import type { VoiceEngine } from '../assistant/recorder-recognition.js';

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
  /** Voz transcrita en el servidor (Whisper local); sin él, reconocimiento del navegador. */
  voiceEngine?: VoiceEngine | undefined;
}) {
  const [text, setText] = useState('');
  const currentText = useRef(text);
  currentText.current = text;
  const [mode, setMode] = useState<TeamMode>('INSTRUCT');
  const helpId = useId();
  const [original, setOriginal] = useState<string | null>(null);
  const beforeDictation = useRef('');
  const input = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const blocked =
    props.pending || !props.enabled || (mode === 'REVIEW' && props.reviewEnabled === false);
  const dictationAllowed = !blocked && props.visible && (mode !== 'INSTRUCT' || props.canWrite);
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
  const commandAllowed =
    !blocked && props.visible && props.canWrite && mode === 'INSTRUCT' && !dictating && !full;
  const command = useVoiceCommand(
    commandAllowed,
    (transcript) => {
      if (sending.current || !commandAllowed) return;
      sending.current = true;
      void props
        .send({ text: transcript, mode: 'INSTRUCT', inputMode: 'VOICE_COMMAND' })
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
  const length = visible.trim().length;
  return (
    <div className="team-composer">
      <div className="team-composer-cabecera">
        <div className="segmentado team-modes" role="group" aria-label="Modo del asistente">
          {(
            [
              ['INSTRUCT', 'Instruir', 'modo-instruir', 'Pide cambios en el diagrama'],
              ['ASK', 'Preguntar', 'modo-preguntar', 'Resuelve dudas de diseño o conceptos'],
              ['REVIEW', 'Revisar', 'modo-revisar', 'Pide una revisión del modelo'],
            ] as const
          ).map(([value, label, testId, hint]) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'activa' : ''}
              aria-pressed={mode === value}
              data-testid={testId}
              title={hint}
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
        className={`entrada team-entrada${dictating || commanding ? ' escuchando' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          rows={2}
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
              ? 'Pide un cambio: «Agrega la clase Cliente con nombre y correo»'
              : mode === 'ASK'
                ? 'Pregunta: «¿Qué es una clase asociativa?»'
                : '¿Qué quieres que revise del modelo?'
          }
          data-testid="entrada-asistente"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/⌘ + Enter envía sin soltar el teclado; Enter solo sigue
            // siendo salto de línea, como en cualquier campo de varias líneas.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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
                onClick={props.cancel}
              >
                Cancelar solicitud
              </button>
            )}
            <button
              type="submit"
              className="principal team-enviar"
              title="Enviar (Ctrl + Enter)"
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
              <span>{props.pending ? 'Enviando…' : 'Enviar'}</span>
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
