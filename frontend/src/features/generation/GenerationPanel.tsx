import { hasErrors, type ValidationIssue } from '@uml/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, downloadGeneration, type GenerationSummary } from '../../lib/api.js';

/**
 * Generación del proyecto desde la pizarra (RF-060 a RF-072, RF-080 a RF-084).
 *
 * Son dos pasos del guion de la defensa: «seleccionar la pizarra y generar» y
 * «descargar el ZIP, abrirlo en el IDE, configurar la base y ejecutar».
 *
 * El botón se apaga cuando el modelo tiene errores, con el mismo criterio que
 * usa el panel de validación: los errores bloquean la generación, no la edición
 * (ADR-003). El servidor lo vuelve a comprobar — un botón deshabilitado no es
 * una autorización — pero decirlo aquí evita el viaje.
 */
export function GenerationPanel({
  boardId,
  issues,
  canWrite,
}: {
  readonly boardId: string;
  readonly issues: readonly ValidationIssue[];
  readonly canWrite: boolean;
}): React.JSX.Element {
  const [historial, setHistorial] = useState<readonly GenerationSummary[]>([]);
  const [ultima, setUltima] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [basePackage, setBasePackage] = useState('');
  const [includeMobile, setIncludeMobile] = useState(false);
  const [ultimoMobile, setUltimoMobile] = useState(false);

  const bloqueado = hasErrors(issues);

  const refrescar = useCallback(() => {
    api
      .listGenerations(boardId)
      .then(setHistorial)
      .catch((causa: unknown) =>
        setError(
          causa instanceof Error
            ? `No se pudo cargar el historial: ${causa.message}`
            : 'No se pudo cargar el historial.',
        ),
      );
  }, [boardId]);

  useEffect(refrescar, [refrescar]);

  const generar = useCallback(async () => {
    setTrabajando(true);
    setError(null);
    setEstado(null);

    try {
      const resultado = await api.generate(boardId, basePackage, includeMobile);
      setUltima(resultado.id);
      setUltimoMobile(includeMobile);
      setEstado(
        `Generado ${resultado.artifactName} · ${resultado.entities} entidades · ` +
          `versión ${resultado.snapshotVersion} del modelo · paquete ${resultado.basePackage}`,
      );
      refrescar();
    } catch (causa) {
      // El 422 trae los hallazgos del validador. Se cuentan en lugar de
      // repetirlos: ya están, uno por uno, en el panel de validación.
      if (causa instanceof ApiError && causa.code === 'model_not_generable') {
        const detalles = causa.details as { issues?: readonly unknown[] } | undefined;
        setError(
          `El modelo tiene ${detalles?.issues?.length ?? 0} error(es). ` +
            'Revisa el panel de validación.',
        );
      } else {
        setError(causa instanceof Error ? causa.message : 'No se pudo generar.');
      }
    } finally {
      setTrabajando(false);
    }
  }, [boardId, basePackage, includeMobile, refrescar]);

  const descargar = useCallback(
    async (generationId: string, target: 'spring' | 'mobile' = 'spring') => {
      setError(null);

      try {
        const { blob, fileName } = await downloadGeneration(generationId, target);

        // El navegador no deja guardar un archivo sin un clic: se crea un enlace
        // temporal sobre el blob y se pulsa. La URL se revoca después, porque si
        // no el blob se queda en memoria hasta recargar la página.
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = fileName;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);

        setEstado(`Descargado ${fileName}`);
      } catch (causa) {
        setError(causa instanceof Error ? causa.message : 'No se pudo descargar.');
      }
    },
    [],
  );

  const eliminar = useCallback(
    async (generacion: GenerationSummary) => {
      // El ZIP no existe en el servidor: lo que se borra es el registro y la
      // version congelada sobre la que se regenera. Eso hace la descarga
      // imposible para siempre, y por eso se pregunta antes.
      const confirmado = window.confirm(
        `¿Eliminar la generación v${generacion.snapshotVersion} de ${generacion.projectName}? ` +
          'Ya no se podrá descargar.',
      );
      if (!confirmado) return;

      setError(null);
      try {
        await api.deleteGeneration(generacion.id);
        if (ultima === generacion.id) {
          setUltima(null);
          setUltimoMobile(false);
        }
        setEstado(`Eliminada la generación v${generacion.snapshotVersion}.`);
        refrescar();
      } catch (causa) {
        setError(causa instanceof Error ? causa.message : 'No se pudo eliminar.');
      }
    },
    [refrescar, ultima],
  );

  return (
    <section className="generacion" data-testid="panel-generacion">
      <h3>Generación</h3>

      {!canWrite && (
        <p className="aviso">Tu rol es de solo lectura: puedes descargar, no generar.</p>
      )}

      <label className="paquete">
        <span>Paquete Java</span>
        <input
          type="text"
          value={basePackage}
          placeholder="bo.edu.sw1"
          data-testid="paquete-base"
          onChange={(evento) => setBasePackage(evento.target.value)}
        />
      </label>

      <label className="opcion-checkbox">
        <input
          type="checkbox"
          checked={includeMobile}
          onChange={(event) => setIncludeMobile(event.target.checked)}
          disabled={trabajando || !canWrite}
          data-testid="incluir-flutter"
        />
        <span>
          Incluir app Android <small>Flutter, inicio de sesión y datos sin conexión.</small>
        </span>
      </label>
      {includeMobile && (
        <p className="aviso">
          Incluye la app Flutter y su backend. Para compilar el APK necesitas Flutter y Android SDK
          en tu equipo. Los modelos de texto y voz se instalan después en el teléfono.
        </p>
      )}
      <button
        type="button"
        className="principal"
        data-testid="generar"
        disabled={!canWrite || bloqueado || trabajando}
        onClick={() => void generar()}
      >
        {trabajando ? 'Generando…' : 'Generar proyecto'}
      </button>

      {bloqueado && (
        <p className="aviso" data-testid="generacion-bloqueada">
          El modelo tiene errores. Corrígelos para poder generar.
        </p>
      )}

      {ultima !== null && (
        <div className="descargas">
          <button
            type="button"
            data-testid="descargar-spring"
            onClick={() => void descargar(ultima)}
          >
            Descargar backend
          </button>
          {ultimoMobile && (
            <button
              type="button"
              data-testid="descargar-mobile"
              onClick={() => void descargar(ultima, 'mobile')}
            >
              Descargar Android + backend
            </button>
          )}
        </div>
      )}

      {estado !== null && (
        <p className="aviso" data-testid="estado-generacion">
          {estado}
        </p>
      )}
      {(includeMobile || ultimoMobile || historial.some((g) => g.mobileSha256)) && (
        <details className="aviso" data-testid="comandos-android">
          <summary>Compilar APK y probar en el celular</summary>
          <p>
            Extrae Android + backend y abre PowerShell en esa carpeta. Activa Depuración USB en el
            celular, conecta el cable y acepta la autorización en su pantalla.
          </p>
          <ul>
            <li>
              <code>.\apk.bat doctor</code> — comprobar Flutter, Android SDK y dispositivos.
            </li>
            <li>
              <code>.\apk.bat build</code> — crear el APK en <code>mobile/dist/</code>.
            </li>
            <li>
              <code>.\apk.bat install</code> — compilar, instalar y abrir la app.
            </li>
            <li>
              <code>.\apk.bat deploy</code> — levantar backend con Docker e instalar con conexión
              USB.
            </li>
            <li>
              <code>.\apk.bat run --usb</code> — probar con recarga en caliente y backend ya
              iniciado.
            </li>
          </ul>
          <p>
            La app funciona sin servidor con admin / admin. Para usar el backend, activa Conectar a
            un servidor en el login. En Linux/macOS usa <code>sh apk.sh</code>.
          </p>
        </details>
      )}
      {error !== null && (
        <p className="error" data-testid="error-generacion">
          {error}
        </p>
      )}

      {historial.length > 0 && (
        <ul className="historial" data-testid="historial-generaciones">
          {historial.slice(0, 5).map((generacion) => (
            <li key={generacion.id} className={generacion.status === 'FAILED' ? 'fallida' : ''}>
              <strong>v{generacion.snapshotVersion}</strong>
              <span>
                {generacion.author.displayName} ·{' '}
                {new Date(generacion.createdAt).toLocaleString('es-BO')}
              </span>
              <span className={`estado estado-${generacion.status.toLowerCase()}`}>
                {generacion.status === 'READY'
                  ? 'Lista'
                  : generacion.status === 'CREATING'
                    ? 'Preparando…'
                    : 'Falló'}
              </span>
              {/* El paquete y el nombre son los que se congelaron, no los de
                  ahora: es justamente lo que permite descargar una generacion
                  vieja y recibir lo mismo que el dia que se hizo. */}
              <span className="manifiesto">
                {generacion.projectName} · {generacion.basePackage}
                {generacion.status === 'FAILED' && ` · falló: ${generacion.error ?? ''}`}
              </span>
              {(generacion.status === 'READY' || canWrite) && (
                <span className="acciones-historial">
                  {generacion.status === 'READY' && (
                    <button
                      type="button"
                      aria-label={`Descargar backend de la versión ${generacion.snapshotVersion}`}
                      onClick={() => void descargar(generacion.id)}
                    >
                      Backend
                    </button>
                  )}
                  {generacion.status === 'READY' && generacion.mobileSha256 && (
                    <button type="button" onClick={() => void descargar(generacion.id, 'mobile')}>
                      Android + backend
                    </button>
                  )}
                  {/* Una generacion fallida o en curso tambien se puede retirar:
                      no tiene artefacto, pero sigue ocupando el historial. */}
                  {canWrite && (
                    <button
                      type="button"
                      className="eliminar"
                      aria-label={`Eliminar la generación v${generacion.snapshotVersion}`}
                      data-testid={`eliminar-generacion-${generacion.snapshotVersion}`}
                      onClick={() => void eliminar(generacion)}
                    >
                      Eliminar
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
