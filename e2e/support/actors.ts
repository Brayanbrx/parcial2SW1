import { expect, type Browser, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Ayudantes para conducir la interfaz como lo haria una persona.
 *
 * Cada actor tiene su propio contexto de navegador, con sus propias cookies. Dos
 * pestanas del mismo contexto compartirian la sesion, y entonces no se estaria
 * probando lo que dice la seccion 15.4: dos usuarios distintos.
 */

export interface Actor {
  readonly page: Page;
  readonly email: string;
  readonly displayName: string;
  close(): Promise<void>;
}

let contador = 0;

export function nuevoCorreo(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${Date.now()}-${contador}@example.com`;
}

/** Abre un navegador nuevo y registra una cuenta. */
export async function registrarActor(browser: Browser, prefijo: string): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = nuevoCorreo(prefijo);
  const displayName = prefijo;

  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('displayName').fill(displayName);
  await page.getByTestId('password').fill('contrasena-de-prueba');
  await page.getByTestId('enviar').click();
  await activarCuentaEIniciarSesion(page, email);

  return {
    page,
    email,
    displayName,
    close: () => context.close(),
  };
}

/** Completa el registro también en las pruebas que preparan su propia página. */
export async function activarCuentaEIniciarSesion(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId('activacion-pendiente')).toBeVisible();
  // Solo en el entorno de pruebas local con MAIL_PROVIDER=log. No hay endpoint
  // de prueba ni tokens de activación en las respuestas públicas.
  const { stdout } = await promisify(execFile)('docker', [
    'compose',
    '-f',
    'infra/compose.yml',
    '--env-file',
    'infra/.env',
    'logs',
    '--no-color',
    '--no-log-prefix',
    '--tail',
    '500',
    'api',
  ]);
  const messages = stdout.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line) as { destinatario?: string; cuerpo?: string }];
    } catch {
      return [];
    }
  });
  const token = messages
    .findLast((m) => m.destinatario === email && m.cuerpo?.includes('/activar#'))
    ?.cuerpo?.match(/#token=([^\s]+)/)?.[1];
  if (!token)
    throw new Error(
      'E2E necesita MAIL_PROVIDER=log y el Compose local para leer el correo de activación.',
    );
  await page.goto(`/activar#token=${token}`);
  await page.getByRole('button', { name: 'Activar mi cuenta', exact: true }).click();
  await expect(page.getByTestId('cuenta-activada')).toBeVisible();
  await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('contrasena-de-prueba');
  await page.getByTestId('enviar').click();

  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
}

export async function crearProyecto(actor: Actor, nombre: string): Promise<string> {
  await actor.page.getByTestId('nombre-proyecto').fill(nombre);
  await actor.page.getByTestId('crear-proyecto').click();
  await expect(actor.page.getByTestId('lista-pizarras')).toBeVisible();

  const url = new URL(actor.page.url());
  return url.pathname.split('/').pop() as string;
}

export async function crearPizarra(actor: Actor, nombre: string): Promise<void> {
  await actor.page.getByTestId('nombre-pizarra').fill(nombre);
  await actor.page.getByTestId('crear-pizarra').click();
  await expect(actor.page.getByRole('link', { name: nombre })).toBeVisible();
}

export async function invitar(actor: Actor, rol: 'editor' | 'lector'): Promise<string> {
  await actor.page.getByTestId(`invitar-${rol}`).click();
  const codigo = actor.page.getByTestId('codigo-generado');
  await expect(codigo).toBeVisible();
  return (await codigo.textContent()) as string;
}

export async function aceptarInvitacion(actor: Actor, codigo: string): Promise<void> {
  await actor.page.goto('/proyectos');
  await actor.page.getByTestId('codigo-invitacion').fill(codigo);
  await actor.page.getByTestId('aceptar-invitacion').click();
  await expect(actor.page.getByTestId('lista-pizarras')).toBeVisible();
}

/** Abre la pizarra y espera a que la sesion colaborativa este en vivo. */
export async function abrirPizarra(actor: Actor, nombre: string): Promise<void> {
  await actor.page.getByRole('link', { name: nombre }).click();
  await expect(actor.page.getByTestId('estado-conexion')).toHaveText('En vivo');
}

/**
 * Posicion de una clase en coordenadas del diagrama.
 *
 * React Flow escribe la posicion del modelo en el `transform` del nodo. Se lee de
 * ahi y no del rectangulo en pantalla, porque cada navegador tiene su propio
 * zoom y desplazamiento: comparar pixeles entre dos ventanas distintas mide el
 * viewport, no el modelo.
 */
export async function posicionEnDiagrama(
  actor: Actor,
  nombreTecnico: string,
): Promise<{ x: number; y: number }> {
  const nodo = actor.page.locator('.react-flow__node', {
    has: actor.page.getByTestId(`clase-${nombreTecnico}`),
  });

  const estilo = (await nodo.first().getAttribute('style')) ?? '';
  const coincidencia = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(estilo);
  if (coincidencia === null) throw new Error(`Sin transform para ${nombreTecnico}: ${estilo}`);

  return { x: Number(coincidencia[1]), y: Number(coincidencia[2]) };
}

/**
 * Cambia a una de las tres herramientas del panel derecho.
 *
 * Antes estaban las tres apiladas y siempre visibles. Con cinco paneles en
 * veintidos centimetros ninguna se podia usar, asi que ahora van en pestanas y
 * hay que abrir la que se va a tocar.
 */
export async function abrirHerramienta(
  actor: Actor,
  herramienta: 'asistente' | 'importar' | 'generar',
): Promise<void> {
  await actor.page.getByTestId(`pestana-${herramienta}`).click();
}

export async function crearClase(actor: Actor, nombre: string): Promise<void> {
  await actor.page.getByTestId('crear-clase').click();
  await expect(actor.page.getByTestId('inspector-clase')).toBeVisible();
  await actor.page.getByTestId('nombre-clase').fill(nombre);
}

/**
 * Tamano dibujado de una tarjeta, leido del nodo de React Flow.
 *
 * React Flow escribe `width` y `height` en el estilo del nodo a partir de lo
 * que declara el modelo, asi que esto mide lo que la otra persona **ve**, no lo
 * que creemos haberle mandado.
 */
export async function tamanoEnDiagrama(
  actor: Actor,
  nombreTecnico: string,
): Promise<{ width: number; height: number }> {
  const nodo = actor.page.locator('.react-flow__node', {
    has: actor.page.getByTestId(`clase-${nombreTecnico}`),
  });

  const caja = await nodo.first().boundingBox();
  if (caja === null) throw new Error(`Sin caja para ${nombreTecnico}`);

  return { width: Math.round(caja.width), height: Math.round(caja.height) };
}
