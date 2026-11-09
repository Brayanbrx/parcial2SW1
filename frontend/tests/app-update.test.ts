import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppUpdate from '../src/lib/app-update.js';

type Modulo = typeof AppUpdate;

class Trabajador extends EventTarget {
  state = 'installing';
  readonly postMessage = vi.fn();
  instalar(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

let reload: ReturnType<typeof vi.fn>;
let modulo: Modulo;

function entorno(
  controlador: object | null,
  esperando: Trabajador | null = null,
  instalando: Trabajador | null = null,
) {
  const registro = Object.assign(new EventTarget(), {
    waiting: esperando,
    installing: instalando,
    update: vi.fn(async () => undefined),
  });
  const contenedor = Object.assign(new EventTarget(), { controller: controlador });
  const detener = modulo.watchForUpdates(
    registro as unknown as ServiceWorkerRegistration,
    contenedor as unknown as ServiceWorkerContainer,
  );
  return { registro, contenedor, detener };
}

beforeEach(async () => {
  vi.useFakeTimers();
  reload = vi.fn();
  vi.stubGlobal('window', {
    location: { reload },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }),
  );
  // El estado del aviso vive en el módulo: cada prueba parte de uno nuevo.
  vi.resetModules();
  modulo = await import('../src/lib/app-update.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('aviso de versión nueva', () => {
  it('ofrece la versión en espera y solo la activa cuando se pide', () => {
    const nueva = new Trabajador();
    nueva.state = 'installed';
    const { contenedor } = entorno({}, nueva);
    expect(modulo.getAppUpdateState()).toBe('disponible');
    expect(nueva.postMessage).not.toHaveBeenCalled();

    modulo.applyAppUpdate();
    expect(nueva.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    contenedor.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('detecta una versión que termina de instalarse con la pestaña abierta', () => {
    const { registro } = entorno({});
    expect(modulo.getAppUpdateState()).toBe('al-dia');
    const nueva = new Trabajador();
    registro.installing = nueva;
    registro.dispatchEvent(new Event('updatefound'));
    registro.waiting = nueva;
    nueva.instalar();
    expect(modulo.getAppUpdateState()).toBe('disponible');
  });

  it('detecta una instalación que ya estaba en curso al iniciar la vigilancia', () => {
    const nueva = new Trabajador();
    const { registro } = entorno({}, null, nueva);
    expect(modulo.getAppUpdateState()).toBe('al-dia');

    registro.waiting = nueva;
    registro.installing = null;
    nueva.instalar();

    expect(modulo.getAppUpdateState()).toBe('disponible');
  });

  it('no avisa en la primera instalación, aunque tome el control', () => {
    const nueva = new Trabajador();
    nueva.state = 'installed';
    const { contenedor } = entorno(null, nueva);
    contenedor.controller = {};
    contenedor.dispatchEvent(new Event('controllerchange'));
    expect(modulo.getAppUpdateState()).toBe('al-dia');
    expect(reload).not.toHaveBeenCalled();
  });

  it('pide recargar si otra pestaña ya activó la versión nueva', () => {
    const { contenedor } = entorno({});
    contenedor.controller = {};
    contenedor.dispatchEvent(new Event('controllerchange'));
    expect(modulo.getAppUpdateState()).toBe('aplicada');
    expect(reload).not.toHaveBeenCalled();
    modulo.applyAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recarga igualmente si la versión nueva no toma el control a tiempo', () => {
    const nueva = new Trabajador();
    nueva.state = 'installed';
    entorno({}, nueva);
    modulo.applyAppUpdate();
    vi.advanceTimersByTime(4000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('pregunta periódicamente por versiones nuevas y deja de hacerlo al detenerse', () => {
    const { registro, detener } = entorno({});
    vi.advanceTimersByTime(30 * 60_000);
    expect(registro.update).toHaveBeenCalledTimes(1);
    detener();
    vi.advanceTimersByTime(60 * 60_000);
    expect(registro.update).toHaveBeenCalledTimes(1);
  });
});
