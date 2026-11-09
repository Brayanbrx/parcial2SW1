import { useState } from 'react';
import { applyAppUpdate, useAppUpdate } from '../lib/app-update.js';

/**
 * Avisa que hay una versión nueva sin interrumpir: no recarga sola, porque
 * podría haber texto a medio escribir. La pizarra no se pierde al recargar
 * (los cambios se guardan en el navegador antes de aplicarse).
 */
export function AppUpdateNotice(): React.JSX.Element {
  const estado = useAppUpdate();
  const [descartado, setDescartado] = useState<string | null>(null);
  const visible = estado !== 'al-dia' && descartado !== estado;

  return (
    // La región viva existe siempre: un lector de pantalla no anuncia de forma
    // fiable una región que aparece ya con contenido.
    <div className="aviso-version-region" role="status" aria-live="polite">
      {visible && (
        <div className="aviso-flotante aviso-version" data-testid="aviso-version">
          <span>
            {estado === 'aplicada'
              ? 'La aplicación se actualizó en otra pestaña. Recarga para seguir con la versión nueva.'
              : 'Hay una versión nueva de la aplicación.'}
          </span>
          <button type="button" className="principal" onClick={applyAppUpdate}>
            {estado === 'aplicada' ? 'Recargar' : 'Actualizar'}
          </button>
          <button
            type="button"
            className="aviso-cerrar"
            aria-label="Más tarde"
            title="Más tarde"
            onClick={() => setDescartado(estado)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
