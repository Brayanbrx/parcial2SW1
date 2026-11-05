import { useRef, useState } from 'react';
import type { AiSettingsValues, ProjectAiSettings } from '@uml/contracts';
import { teamAiApi } from '../../lib/api.js';

export function TeamSettings({
  settings,
  refresh,
}: {
  settings: ProjectAiSettings;
  refresh(): Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<AiSettingsValues>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { enabled, solutionMode, executionMode, reviewMode } = draft;
      await teamAiApi.saveSettings(settings.projectId, {
        enabled,
        solutionMode,
        executionMode,
        reviewMode,
      });
      await refresh();
      dialog.current?.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(settings);
          setError(null);
          dialog.current?.showModal();
        }}
      >
        Configurar IA
      </button>
      <dialog ref={dialog} className="team-settings" aria-label="IA del proyecto">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>IA del proyecto</h2>
          <p>Estos cambios se comparten con todas las pizarras del proyecto.</p>
          <label>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />{' '}
            Habilitar nuevas solicitudes
          </label>
          <label>
            Respuestas
            <select
              value={draft.solutionMode}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  solutionMode: e.target.value as AiSettingsValues['solutionMode'],
                })
              }
            >
              <option value="HINTS_ONLY">Solo pistas</option>
              <option value="ON_REQUEST">Soluciones a petición</option>
            </select>
          </label>
          <p>
            Preguntar y Revisar empiezan con orientación. Solo pistas mantiene esa ayuda incluso si
            se solicita resolver el ejercicio. Instruir conserva las solicitudes explícitas de
            cambios.
          </p>
          <label>
            Aplicación de cambios
            <select
              value={draft.executionMode}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  executionMode: e.target.value as AiSettingsValues['executionMode'],
                })
              }
            >
              <option value="PROPOSE_ONLY">Siempre revisar</option>
              <option value="AUTO_SAFE_VOICE">Automática para comandos de voz seguros</option>
              <option value="AUTO_SAFE_ALL">Automática para texto y comandos de voz seguros</option>
            </select>
          </label>
          <p>
            El dictado siempre requiere revisión. Las acciones sensibles necesitan confirmación.
          </p>
          <label>
            Revisión del modelo
            <select
              value={draft.reviewMode}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, reviewMode: e.target.value as AiSettingsValues['reviewMode'] })
              }
            >
              <option value="OFF">Desactivada</option>
              <option value="ON_DEMAND">A petición</option>
              <option value="ON_ISSUES">Al detectar problemas</option>
            </select>
          </label>
          <p>
            Desactivada impide Revisar; A petición permite solicitar una revisión. Al detectar
            problemas también permite revisiones solicitadas.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="team-actions">
            <button type="submit" disabled={busy}>
              Guardar configuración
            </button>
            <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>
              Cerrar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
