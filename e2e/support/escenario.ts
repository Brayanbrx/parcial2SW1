import type { Browser } from '@playwright/test';
import {
  abrirPizarra,
  aceptarInvitacion,
  crearPizarra,
  crearProyecto,
  invitar,
  registrarActor,
  type Actor,
} from './actors.js';

/**
 * Monta un proyecto con dos personas y las deja dentro de la misma pizarra.
 *
 * Cada prueba monta el suyo. Encadenarlas seria mas rapido, pero un fallo en la
 * primera arrastraria a todas las demas y el informe diria que fallaron cinco
 * cosas cuando en realidad fallo una. Playwright ademas cierra los contextos
 * creados en `beforeAll` entre pruebas, asi que compartirlos no es fiable.
 */
export interface EscenarioCompartido {
  readonly ana: Actor;
  readonly beto: Actor;
  cerrar(): Promise<void>;
}

export interface OpcionesEscenario {
  /** Rol con el que se invita a la segunda persona. */
  readonly rol?: 'editor' | 'lector';
  /** Pizarras a crear. La primera es la que se abre. */
  readonly pizarras?: readonly string[];
  /** Si la segunda persona abre tambien la primera pizarra. */
  readonly abrirAmbos?: boolean;
}

export async function montarEscenario(
  browser: Browser,
  nombreProyecto: string,
  opciones: OpcionesEscenario = {},
): Promise<EscenarioCompartido> {
  const rol = opciones.rol ?? 'editor';
  const pizarras = opciones.pizarras ?? ['Ventas'];
  const abrirAmbos = opciones.abrirAmbos ?? true;

  const ana = await registrarActor(browser, 'ana');
  const beto = await registrarActor(browser, 'beto');

  await crearProyecto(ana, nombreProyecto);
  for (const pizarra of pizarras) await crearPizarra(ana, pizarra);

  const codigo = await invitar(ana, rol);
  await aceptarInvitacion(beto, codigo);

  const primera = pizarras[0] as string;
  await abrirPizarra(ana, primera);
  if (abrirAmbos) await abrirPizarra(beto, primera);

  return {
    ana,
    beto,
    async cerrar() {
      await ana.close();
      await beto.close();
    },
  };
}
