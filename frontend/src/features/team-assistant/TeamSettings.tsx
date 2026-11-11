import { useRef, useState } from 'react';
import type { AiSettingsValues, ProjectAiSettings } from '@uml/contracts';
import { teamAiApi } from '../../lib/api.js';
import { IconoAjustes } from '../../components/icons.js';

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
      const { enabled, solutionMode, executionMode, reviewMode, aiSource } = draft;
      await teamAiApi.saveSettings(settings.projectId, {
        enabled,
        solutionMode,
        executionMode,
        reviewMode,
        aiSource,
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
        className="boton-icono"
        aria-label="Configurar IA"
        title="Configurar IA del proyecto"
        onClick={() => {
          setDraft(settings);
          setError(null);
          dialog.current?.showModal();
        }}
      >
        <IconoAjustes size={18} />
      </button>
      <dialog
        ref={dialog}
        className="team-settings team-project-settings"
        aria-label="IA del proyecto"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="team-settings-heading">
            <h2>IA del proyecto</h2>
            <p>Para todas las pizarras del proyecto.</p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />{' '}
            Activar asistente
          </label>
          <label>
            Motor de IA
            <select
              data-testid="motor-ia"
              value={draft.aiSource}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, aiSource: e.target.value as AiSettingsValues['aiSource'] })
              }
            >
              <option value="PROVIDERS">Proveedores en la nube</option>
              <option value="LOCAL" disabled={!settings.localModel}>
                Modelo local{settings.localModel ? '' : ' · sin configurar'}
              </option>
              <option value="VM" disabled={!settings.vmModel && draft.aiSource !== 'VM'}>
                IA de VM
              </option>
            </select>
          </label>
          {(draft.aiSource !== 'PROVIDERS' || !settings.vmModel) && (
            <p className="team-settings-note" data-testid="ayuda-motor-ia">
              {draft.aiSource === 'LOCAL'
                ? `${settings.localModel ?? 'Modelo sin configurar'}${settings.localSpeechModel ? ' · Voz local' : ''}. Si falla, se usa la nube.`
                : settings.vmModel
                  ? `${settings.vmModel} · Para cuentas con acceso.`
                  : settings.vmAllowed
                    ? 'IA de VM está desconectada.'
                    : 'Tu cuenta aún no tiene acceso a IA de VM.'}
            </p>
          )}
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
              <option value="AUTO_SAFE_VOICE">Automática en cambios seguros por voz</option>
              <option value="AUTO_SAFE_ALL">Automática en cambios seguros por texto o voz</option>
            </select>
          </label>
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
