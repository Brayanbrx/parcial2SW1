import { useId, useRef } from 'react';
import type { useVoiceCommand } from '../assistant/useVoiceCommand.js';

export function VoiceCommandControl({
  command,
  disabled,
}: {
  command: ReturnType<typeof useVoiceCommand>;
  disabled: boolean;
}) {
  const helpId = useId();
  const pointer = useRef<number | null>(null);
  const active = command.phase !== 'idle';
  if (!command.supported)
    return (
      <p className="team-status">
        Este navegador no admite comandos de voz. Puedes escribir la instrucción.
      </p>
    );
  return (
    <div className="team-voice-command">
      <div className="team-actions">
        <button
          type="button"
          data-testid="comando-voz"
          className={active ? 'escuchando' : ''}
          aria-label="Comando de voz"
          aria-pressed={active}
          aria-describedby={helpId}
          disabled={disabled || command.phase === 'stopping'}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary || active || pointer.current !== null)
              return;
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
            if (event.repeat && (event.key === 'Enter' || event.key === ' '))
              event.preventDefault();
          }}
          onClick={(event) => {
            // Activación de teclado/tecnología asistiva: inicio y fin con dos pulsaciones.
            // El click sintetizado tras pointerup nunca inicia una segunda captura.
            if (event.detail !== 0) return;
            if (active) command.stop();
            else command.start();
          }}
        >
          {command.phase === 'stopping'
            ? 'Finalizando comando…'
            : active
              ? 'Escuchando comando…'
              : 'Comando de voz'}
        </button>
        {active && (
          <button type="button" onClick={command.cancel}>
            Cancelar comando de voz
          </button>
        )}
      </div>
      <p id={helpId} className="team-status">
        Mantén pulsado y suelta para enviar. Con teclado, pulsa Enter o Espacio para iniciar y otra
        vez para finalizar. Escape cancela. Disponible en Instruir.
      </p>
      <p role="status" data-testid="transcripcion-comando-voz">
        {command.phase === 'stopping'
          ? 'Esperando la transcripción final…'
          : command.phase === 'listening'
            ? `Escuchando: ${command.transcript}`
            : command.finalText
              ? `Transcripción final: ${command.finalText}`
              : ''}
      </p>
      {command.error && (
        <p className="error" role="alert">
          {command.error}
        </p>
      )}
    </div>
  );
}
