import { errorsOf, warningsOf, type ValidationIssue } from '@uml/contracts';

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
 */
export function ValidationPanel({ issues, onSelect }: ValidationPanelProps): React.JSX.Element {
  const errores = errorsOf(issues);
  const avisos = warningsOf(issues);

  return (
    <section className="validacion" data-testid="panel-validacion">
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
    </section>
  );
}
