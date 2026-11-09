import { useRef } from 'react';
import type { useVoiceCommand } from '../assistant/useVoiceCommand.js';
import { IconoOndas } from '../../components/icons.js';

type Command = ReturnType<typeof useVoiceCommand>;

/**
 * Botón «mantener para hablar». Va en la fila de acciones del compositor; su
 * estado (transcripción, errores) lo pinta `VoiceCommandStatus` debajo, para
 * que la fila nunca crezca ni empuje a «Enviar» fuera del panel.
 */
export function VoiceCommandButton({
  command,
  disabled,
  helpId,
}: {
  command: Command;
  disabled: boolean;
  helpId: string;
}) {
  const pointer = useRef<number | null>(null);
  const active = command.phase !== 'idle';
  if (!command.supported) return null;
  return (
    <>
      <button
        type="button"
        data-testid="comando-voz"
        className={`team-voz${active ? ' escuchando' : ''}`}
        aria-label="Comando de voz"
        aria-pressed={active}
        aria-describedby={helpId}
        title="Mantén pulsado, habla y suelta: la IA aplica los cambios seguros"
        disabled={disabled || command.phase === 'stopping'}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || active || pointer.current !== null) return;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          command.start();
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          pointer.current = null;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            command.cancel();
          else command.stop();
        }}
        onPointerCancel={() => {
          pointer.current = null;
          command.cancel();
        }}
        onLostPointerCapture={() => {
          if (pointer.current === null) return;
          pointer.current = null;
          command.cancel();
        }}
        onKeyDown={(event) => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
        }}
        onClick={(event) => {
          // Activación de teclado/tecnología asistiva: inicio y fin con dos pulsaciones.
          // El click sintetizado tras pointerup nunca inicia una segunda captura.
          if (event.detail !== 0) return;
          if (active) command.stop();
          else command.start();
        }}
      >
        <IconoOndas size={16} />
        <span>
          {command.phase === 'stopping'
            ? 'Finalizando…'
            : active
              ? 'Escuchando…'
              : 'Comando de voz'}
        </span>
      </button>
      {active && (
        <button type="button" className="fantasma" onClick={command.cancel}>
          Cancelar comando de voz
        </button>
      )}
    </>
  );
}

export function VoiceCommandStatus({ command, helpId }: { command: Command; helpId: string }) {
  if (!command.supported)
    return (
      <p className="team-nota">
        Este navegador no admite comandos de voz. Puedes escribir la instrucción.
      </p>
    );
  const text =
    command.phase === 'stopping'
      ? 'Esperando la transcripción final…'
      : command.phase === 'listening'
        ? `Escuchando: ${command.transcript}`
        : command.finalText
          ? `Transcripción final: ${command.finalText}`
          : '';
  return (
    <>
      <p id={helpId} className="visualmente-oculto">
        Mantén pulsado y suelta para enviar. Con teclado, pulsa Enter o Espacio para iniciar y otra
        vez para finalizar. Escape cancela. Disponible en Instruir.
      </p>
      <p
        role="status"
        data-testid="transcripcion-comando-voz"
        className={text ? 'team-transcripcion' : 'team-transcripcion vacia'}
      >
        {text}
      </p>
      {command.error && (
        <p className="error" role="alert">
          {command.error}
        </p>
      )}
    </>
  );
}
