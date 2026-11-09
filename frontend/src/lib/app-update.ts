import { useSyncExternalStore } from 'react';

/**
 * Aviso de versión nueva de la aplicación.
 *
 * El service worker no reemplaza una versión en uso por su cuenta: espera a que
 * se cierren todas las pestañas, para que un editor abierto nunca mezcle
 * archivos de dos compilaciones. Pero recargar UNA pestaña no basta para
 * soltarla, y la gente se quedaba con la versión vieja (y con errores de
 * contrato frente a una API nueva) sin saber por qué. Aquí se detecta la
 * versión en espera y se ofrece activarla de forma explícita.
 *
 * - `disponible`: hay una versión instalada esperando. Actualizar la activa y
 *   recarga esta pestaña.
 * - `aplicada`: otra pestaña ya la activó; esta sigue con archivos de la
 *   anterior y solo necesita recargar.
 */
export type AppUpdateState = 'al-dia' | 'disponible' | 'aplicada';

/** Cada cuánto se pregunta al servidor por un `sw.js` nuevo con la pestaña abierta. */
const REVISION_MS = 30 * 60_000;
/** Al volver a la pestaña solo se revisa si pasó al menos este tiempo. */
const REVISION_MINIMA_MS = 5 * 60_000;
/** Si el trabajador nuevo no toma el control a tiempo, se recarga igualmente. */
const RECARGA_FORZADA_MS = 4000;

let estado: AppUpdateState = 'al-dia';
let esperando: ServiceWorker | null = null;
let solicitada = false;
const oyentes = new Set<() => void>();

function cambiar(siguiente: AppUpdateState): void {
  if (estado === siguiente) return;
  estado = siguiente;
  oyentes.forEach((oyente) => oyente());
}

export function watchForUpdates(
  registration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer = navigator.serviceWorker,
): () => void {
  let controlador = container.controller;
  let ultimaRevision = Date.now();
  let instalando: ServiceWorker | null = null;

  const revisar = (): void => {
    // Sin controlador es la primera instalación: no hay versión que sustituir.
    if (registration.waiting === null || container.controller === null) return;
    esperando = registration.waiting;
    cambiar('disponible');
  };
  const alCambiarInstalacion = (): void => {
    if (instalando?.state === 'installed') revisar();
  };
  const alEncontrar = (): void => {
    if (instalando === registration.installing) return;
    instalando?.removeEventListener('statechange', alCambiarInstalacion);
    instalando = registration.installing;
    instalando?.addEventListener('statechange', alCambiarInstalacion);
  };
  const alCambiarControlador = (): void => {
    const anterior = controlador;
    controlador = container.controller;
    if (solicitada) {
      window.location.reload();
      return;
    }
    // `clients.claim()` de la primera instalación también cambia el
    // controlador, pero entonces no había una versión anterior en uso.
    if (anterior !== null) cambiar('aplicada');
  };
  const buscar = (): void => {
    ultimaRevision = Date.now();
    void registration.update().catch(() => {
      /* Sin red o servidor caído: se vuelve a intentar en la próxima revisión. */
    });
  };
  const alVolver = (): void => {
    if (document.visibilityState === 'visible' && Date.now() - ultimaRevision > REVISION_MINIMA_MS)
      buscar();
  };

  registration.addEventListener('updatefound', alEncontrar);
  alEncontrar();
  revisar();
  container.addEventListener('controllerchange', alCambiarControlador);
  document.addEventListener('visibilitychange', alVolver);
  const temporizador = window.setInterval(buscar, REVISION_MS);
  return () => {
    registration.removeEventListener('updatefound', alEncontrar);
    instalando?.removeEventListener('statechange', alCambiarInstalacion);
    container.removeEventListener('controllerchange', alCambiarControlador);
    document.removeEventListener('visibilitychange', alVolver);
    window.clearInterval(temporizador);
  };
}

/**
 * Activa la versión nueva y recarga. Sin una versión en espera solo recarga:
 * también sirve como «Recargar página» cuando un error indica archivos viejos.
 */
export function applyAppUpdate(): void {
  if (estado !== 'disponible' || esperando === null) {
    window.location.reload();
    return;
  }
  solicitada = true;
  esperando.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(() => window.location.reload(), RECARGA_FORZADA_MS);
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function getAppUpdateState(): AppUpdateState {
  return estado;
}

export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(suscribir, getAppUpdateState, () => 'al-dia');
}
