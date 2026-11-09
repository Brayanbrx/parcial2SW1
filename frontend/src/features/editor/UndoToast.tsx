import { useEffect, useState } from 'react';
import type { UndoDeletion } from './undo-delete.js';

/** Tiempo para arrepentirse; se detiene mientras el puntero o el foco están encima. */
const DURACION_MS = 8000;

/**
 * «Clase «Cliente» eliminada · Deshacer».
 *
 * Borrar es inmediato y se comparte al instante, así que un clic de más no se
 * puede corregir a mano sin rehacer nombres, tipos y relaciones. El aviso da
 * unos segundos para recuperarlo todo, con los mismos identificadores.
 */
export function UndoToast({
  aviso,
  onUndo,
  onClose,
}: {
  readonly aviso: (UndoDeletion & { readonly clave: number }) | null;
  onUndo(): void;
  onClose(): void;
}): React.JSX.Element {
  const clave = aviso?.clave ?? null;
  // La pausa pertenece a un aviso: si el puntero estaba encima cuando se fue,
  // el siguiente no hereda la pausa y se cierra a su tiempo.
  const [punteroEn, setPunteroEn] = useState<number | null>(null);
  const [focoEn, setFocoEn] = useState<number | null>(null);
  const pausado = clave !== null && (punteroEn === clave || focoEn === clave);

  useEffect(() => {
    if (clave === null || pausado) return;
    const temporizador = window.setTimeout(onClose, DURACION_MS);
    return () => window.clearTimeout(temporizador);
  }, [clave, pausado, onClose]);

  return (
    // La región existe siempre para que el lector de pantalla anuncie cada aviso.
    <div className="aviso-deshacer-region" role="status" aria-live="polite">
      {aviso !== null && (
        <div
          key={aviso.clave}
          className="aviso-flotante aviso-deshacer"
          data-testid="aviso-deshacer"
          onPointerEnter={() => setPunteroEn(aviso.clave)}
          onPointerLeave={() => setPunteroEn(null)}
          onFocus={() => setFocoEn(aviso.clave)}
          onBlur={(evento) => {
            if (!evento.currentTarget.contains(evento.relatedTarget)) setFocoEn(null);
          }}
        >
          <span>{aviso.message}</span>
          <button
            type="button"
            className="principal"
            data-testid="deshacer"
            title="Deshacer (Ctrl+Z)"
            onClick={onUndo}
          >
            Deshacer
          </button>
          <button
            type="button"
            className="aviso-cerrar"
            aria-label="Cerrar aviso"
            title="Cerrar"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
