import { useEffect, useRef, useState } from 'react';
import type { PersonalAiChoice, PersonalAiState } from '@uml/contracts';
import { teamAiApi } from '../../lib/api.js';

const project: PersonalAiChoice = { source: 'PROJECT', deviceId: null, model: null };
const providers: PersonalAiChoice = { ...project, source: 'PROVIDERS' };
const choiceKey = ({ source, deviceId, model }: PersonalAiChoice) =>
  JSON.stringify([source, deviceId, model]);

/** Preferencia propia. Las políticas del proyecto se siguen aplicando a todos. */
export function PersonalAiSettings({
  online,
  visible,
  projectEngine,
}: {
  online: boolean;
  visible: boolean;
  projectEngine: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const revision = useRef(0);
  const [state, setState] = useState<PersonalAiState | null>(null);
  const [draftChoice, setDraft] = useState<PersonalAiChoice | null>(null);
  const draft = draftChoice ?? state?.choice;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  useEffect(() => {
    if (!online || !visible) return;
    const controller = new AbortController();
    let loading = false;
    let loaded = false;
    const refresh = async () => {
      if (loading || document.visibilityState === 'hidden') return;
      loading = true;
      const requestRevision = revision.current;
      try {
        const next = await teamAiApi.personalEngines(
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        );
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        setState(next);
        if (open && !loaded) setError(null);
        loaded = true;
      } catch (cause) {
        if (open && !loaded && !controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'No se pudo consultar el estado.');
      } finally {
        loading = false;
      }
    };
    const changes =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('uml-personal-ai');
    channel.current = changes;
    const refreshVisible = () => void refresh();
    changes?.addEventListener('message', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    void refresh();
    const timer = setInterval(refreshVisible, open ? 3000 : 5000);
    return () => {
      controller.abort();
      changes?.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('focus', refreshVisible);
      clearInterval(timer);
    };
  }, [open, online, visible]);

  const devices = state?.devices ?? [];
  const vmChoices: PersonalAiChoice[] = state?.vm.connected
    ? state.vm.models.map(({ name }) => ({ source: 'VM', deviceId: null, model: name }))
    : [];
  const laptops = devices
    .filter((device) => device.connected && device.models.length > 0)
    .map((device) => ({
      id: device.id,
      name: device.name,
      choices: device.models.map(({ name }): PersonalAiChoice => ({
        source: 'DEVICE',
        deviceId: device.id,
        model: name,
      })),
    }));
  const choices = [
    project,
    providers,
    ...laptops.flatMap((laptop) => laptop.choices),
    ...vmChoices,
  ];
  const label = (choice: PersonalAiChoice) => {
    switch (choice.source) {
      case 'PROJECT':
        return projectEngine ? `Proyecto · ${projectEngine}` : 'Proyecto';
      case 'PROVIDERS':
        return 'Nube';
      case 'VM':
        return `IA de VM · ${choice.model}`;
      case 'DEVICE':
        return `${devices.find((device) => device.id === choice.deviceId)?.name ?? 'Mi computadora'} · ${choice.model}`;
    }
  };
  const value = draft ? choiceKey(draft) : '';
  const available = choices.some((choice) => choiceKey(choice) === value);
  const canSave = !!state && available && value !== choiceKey(state.choice);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="team-engine-trigger"
        title={state ? label(state.choice) : undefined}
        disabled={!online}
        data-testid="mi-motor-ia"
        onClick={() => {
          setError(null);
          setDraft(null);
          setPairing(null);
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <span>Mi motor de IA</span>
        {state && <small>{label(state.choice)}</small>}
      </button>
      <dialog
        ref={dialog}
        className="team-settings team-personal-settings"
        aria-label="Mi motor de IA"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => {
          setOpen(false);
          setPairing(null);
          trigger.current?.focus();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !online || !draft || !canSave) return;
            setBusy(true);
            setError(null);
            void teamAiApi
              .savePersonalEngine(draft)
              .then((choice) => {
                revision.current++;
                setState((current) => (current ? { ...current, choice } : current));
                channel.current?.postMessage('changed');
                dialog.current?.close();
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="team-settings-heading">
            <h2>Mi motor de IA</h2>
            <p>Se aplica a tus próximas solicitudes.</p>
          </div>
          <label>
            Motor y modelo
            <select
              value={value}
              disabled={busy || !online || !draft}
              onChange={(e) => {
                const choice = choices.find((item) => choiceKey(item) === e.target.value);
                if (choice) setDraft(choice);
                setError(null);
              }}
            >
              {!draft && (
                <option value="">
                  {online && !error ? 'Cargando…' : 'Sin conexión al servidor'}
                </option>
              )}
              {draft && !available && (
                <option value={value} disabled>
                  {label(draft)} · no disponible
                </option>
              )}
              <option value={choiceKey(project)}>Configuración del proyecto</option>
              <option value={choiceKey(providers)}>Proveedores en la nube</option>
              {laptops.length ? (
                laptops.map((laptop) => (
                  <optgroup key={laptop.id} label={`Mi computadora · ${laptop.name}`}>
                    {laptop.choices.map((choice) => (
                      <option key={choiceKey(choice)} value={choiceKey(choice)}>
                        {label(choice)}
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option disabled>Mi computadora · sin conexión</option>
              )}
              {vmChoices.length ? (
                vmChoices.map((choice) => (
                  <option key={choiceKey(choice)} value={choiceKey(choice)}>
                    {label(choice)}
                  </option>
                ))
              ) : (
                <option disabled>
                  IA de VM · {state?.vm.allowed ? 'desconectada' : 'sin acceso'}
                </option>
              )}
            </select>
          </label>
          <details>
            <summary>Vincular mi computadora</summary>
            <p>
              Instala Node.js 22.15 o posterior y Ollama con un modelo local. Descarga el conector y
              ejecútalo en tu computadora; te pedirá la dirección de esta web y el código temporal.
            </p>
            <a href="/api/ai-devices/connector.mjs" download="ai-connector.mjs">
              Descargar conector
            </a>
            <p>
              <code>node ai-connector.mjs --pair</code>
            </p>
            <button
              type="button"
              disabled={busy || !online}
              onClick={() => {
                setBusy(true);
                setError(null);
                void teamAiApi
                  .pairDevice()
                  .then(setPairing)
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : 'No se pudo generar el código.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Generar código de vinculación
            </button>
            {pairing && (
              <p role="status">
                Código: <strong>{pairing.code}</strong>
                <br />
                Válido hasta{' '}
                {new Date(pairing.expiresAt).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                . Úsalo una sola vez en tu conector.
              </p>
            )}
            {devices.map((device) => (
              <p key={device.id}>
                {device.name} · {device.connected ? 'Conectada' : 'Desconectada'}{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void teamAiApi
                      .removeDevice(device.id)
                      .then(async () => {
                        const next = await teamAiApi.personalEngines();
                        revision.current++;
                        setState(next);
                        if (draft?.deviceId === device.id) setDraft(null);
                        channel.current?.postMessage('changed');
                      })
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error ? cause.message : 'No se pudo desvincular.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Desvincular {device.name}
                </button>
              </p>
            ))}
          </details>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="team-actions">
            <button type="submit" disabled={busy || !online || !canSave}>
              {busy ? 'Guardando…' : 'Guardar motor'}
            </button>
            <button
              type="button"
              className="secundario"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              Cerrar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
