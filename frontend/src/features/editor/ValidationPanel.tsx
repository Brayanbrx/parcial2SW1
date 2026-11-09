import { useEffect, useId, useRef, useState } from 'react';
import { errorsOf, warningsOf, type ValidationIssue } from '@uml/contracts';
import { IconoChevron } from '../../components/icons.js';

export interface ValidationPanelProps {
  readonly issues: readonly ValidationIssue[];
  onSelect(elementId: string): void;
}

/**
 * Errores y avisos del modelo (RF-017).
 *
 * Los errores bloquean la generacion; los avisos la permiten. La distincion se
 * ve en el panel para que nadie descubra en la defensa que la pizarra no se
 * podia generar.
 *
 * Cada hallazgo que corresponde a una construccion no soportada trae su
 * sugerencia: el validador dice como modelarlo, no solo que esta mal.
 *
 * Vive en la barra de estado y no en la columna lateral: es una consulta, y
 * la columna es para trabajar (conversación y propiedades). El botón muestra
 * siempre el recuento; la lista se abre encima, sin desplazar nada.
 */
export function ValidationPanel({ issues, onSelect }: ValidationPanelProps): React.JSX.Element {
  const errores = errorsOf(issues);
  const avisos = warningsOf(issues);
  const panelId = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (event: PointerEvent) => {
      if (!raiz.current?.contains(event.target as Node)) setAbierto(false);
    };
    // En el documento y no en el panel: tras abrirlo, el foco sigue en el botón.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAbierto(false);
      if (raiz.current?.contains(document.activeElement)) boton.current?.focus();
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const resumen =
    errores.length > 0
      ? `${errores.length} ${errores.length === 1 ? 'error' : 'errores'}`
      : avisos.length > 0
        ? `${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}`
        : 'Sin observaciones';
  const tono = errores.length > 0 ? 'error' : avisos.length > 0 ? 'aviso' : 'ok';

  return (
    <div className="validacion-dock" ref={raiz}>
      <button
        ref={boton}
        type="button"
        className={`validacion-boton ${tono}`}
        aria-expanded={abierto}
        aria-controls={panelId}
        data-testid="abrir-validacion"
        title="Revisión del modelo"
        onClick={() => setAbierto((valor) => !valor)}
      >
        <span className="validacion-punto" aria-hidden="true" />
        <span className="visualmente-oculto">Revisión del modelo: </span>
        {resumen}
        <IconoChevron size={14} className="validacion-chevron" />
      </button>

      <section
        id={panelId}
        className="validacion"
        data-testid="panel-validacion"
        aria-label="Revisión del modelo"
        hidden={!abierto}
      >
        <header>
          <strong className="validacion-titulo">Revisión del modelo</strong>
          <span className={errores.length > 0 ? 'contador error' : 'contador ok'}>
            {errores.length} {errores.length === 1 ? 'error' : 'errores'}
          </span>
          <span className="contador aviso">
            {avisos.length} {avisos.length === 1 ? 'aviso' : 'avisos'}
          </span>
          <span className={errores.length > 0 ? 'estado bloqueado' : 'estado listo'}>
            {errores.length > 0 ? 'No se puede generar' : 'Listo para generar'}
          </span>
        </header>

        <div className="validacion-cuerpo">
          {issues.length === 0 && <p className="pista">El modelo no tiene observaciones.</p>}

          <ul>
            {[...errores, ...avisos].map((hallazgo, indice) => (
              <li
                key={`${hallazgo.code}-${hallazgo.elementIds.join(',')}-${indice}`}
                className={hallazgo.severity === 'ERROR' ? 'error' : 'aviso'}
              >
                <button
                  type="button"
                  onClick={() => {
                    const primero = hallazgo.elementIds[0];
                    if (primero !== undefined) onSelect(primero);
                  }}
                >
                  <span className="mensaje">{hallazgo.message}</span>
                  {hallazgo.suggestion !== undefined && (
                    <span className="sugerencia">{hallazgo.suggestion}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
