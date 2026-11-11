import { expect, test, type Page, type Request } from '@playwright/test';
import { createDecoder, readVarString, readVarUint } from 'lib0/decoding';

const board = '/pizarras/00000000-0000-4000-8000-000000000010';
const secondBoard = '/pizarras/00000000-0000-4000-8000-000000000011';
const betoId = '00000000-0000-4000-8000-000000000002';

async function enter(page: Page, account = 'ana'): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('email').fill(`${account}@example.com`);
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(board);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('offline-disponible')).toBeVisible();
}

async function create(page: Page, name: string): Promise<void> {
  await page.getByTestId('crear-clase').click();
  await page.getByTestId('nombre-clase').fill(name);
  await page.getByTestId('nombre-clase').press('Tab');
  await expect(page.getByTestId(`clase-${name}`)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
});

test('Ctrl+C copia texto y C activa la herramienta de clase', async ({ page }) => {
  await enter(page);
  const classTool = page.getByTestId('tool-class');
  await expect(classTool).toHaveAttribute('aria-pressed', 'false');
  const text = await page.locator('#editor-toolbox h2').evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.addEventListener(
      'copy',
      () => {
        document.body.dataset.copiedText = window.getSelection()?.toString();
      },
      { once: true },
    );
    return selection.toString();
  });
  expect(text).not.toBe('');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.locator('body')).toHaveAttribute('data-copied-text', text);
  await expect(classTool).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('c');
  await expect(classTool).toHaveAttribute('aria-pressed', 'true');
});

test('solo permite generar después de que el servidor confirme la edición local', async ({
  page,
}) => {
  let paused = false;
  const pending: (() => void)[] = [];
  await page.routeWebSocket('**/collab', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (paused && typeof message !== 'string') {
        const decoder = createDecoder(message);
        readVarString(decoder);
        if (readVarUint(decoder) === 0 && readVarUint(decoder) === 2) {
          pending.push(() => server.send(message));
          return;
        }
      }
      server.send(message);
    });
  });
  let generations = 0;
  await page.route(`**/api${board.replace('/pizarras/', '/boards/')}/generations`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    generations++;
    return route.fulfill({
      status: 201,
      json: {
        id: 'demo',
        artifactName: 'demo.zip',
        entities: 1,
        snapshotVersion: 2,
        basePackage: 'bo.edu.sw1',
      },
    });
  });
  await enter(page);
  await page.getByTestId('pestana-generar').click();
  const generate = page.getByTestId('generar');
  await expect(generate).toBeEnabled();

  paused = true;
  await create(page, 'CambioPendiente');
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await expect(generate).toBeDisabled();
  expect(generations).toBe(0);

  paused = false;
  for (const send of pending) send();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByTestId('estado-generacion')).toContainText('Generado demo.zip');
  expect(generations).toBe(1);
});

test('la instantánea offline espera la confirmación de las ediciones locales', async ({ page }) => {
  let paused = false;
  const pending: (() => void)[] = [];
  await page.routeWebSocket('**/collab', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (paused && typeof message !== 'string') {
        const decoder = createDecoder(message);
        readVarString(decoder);
        if (readVarUint(decoder) === 0 && readVarUint(decoder) === 2) {
          pending.push(() => server.send(message));
          return;
        }
      }
      server.send(message);
    });
  });
  const snapshot = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) =>
        item.startsWith('uml_board_snapshot_v1:'),
      );
      return key === undefined ? null : localStorage.getItem(key);
    });
  await enter(page);
  const confirmed = await snapshot();
  expect(confirmed).not.toBeNull();
  paused = true;
  await create(page, 'Pendiente');
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await snapshot()).toBe(confirmed);

  paused = false;
  for (const send of pending) send();
  await expect.poll(snapshot).not.toBe(confirmed);
});

test('crear una clase después de borrar otra evita ocupar una posición usada', async ({ page }) => {
  const position = (name: string) =>
    page.getByTestId(`clase-${name}`).evaluate((card) => {
      const node = card.closest('.react-flow__node')!;
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { x: transform.e, y: transform.f };
    });
  await enter(page);
  await create(page, 'Primera');
  await create(page, 'Segunda');
  await page.getByTestId('clase-Primera').click();
  await page.getByRole('button', { name: 'Eliminar clase', exact: true }).click();
  await expect(page.getByTestId('clase-Primera')).toHaveCount(0);
  await create(page, 'Tercera');

  expect(await position('Tercera')).not.toEqual(await position('Segunda'));
});

test('las clases que estaban visibles siguen accesibles al añadir otra en la misma fila', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enter(page);
  await create(page, 'Alumno');
  await create(page, 'Materia');
  await create(page, 'Inscripcion');

  await page.getByTestId('tool-association').click();
  await page.getByTestId('clase-Alumno').click({ timeout: 3000 });
  await page.getByTestId('clase-Inscripcion').click({ timeout: 3000 });
  await expect(page.getByTestId('inspector-relacion')).toContainText('Alumno → Inscripcion');
});

test('deshacer sigue disponible con foco aunque el puntero salga del aviso', async ({ page }) => {
  await enter(page);
  await create(page, 'Cliente');
  await page.clock.install();
  await page.getByRole('button', { name: 'Eliminar clase', exact: true }).click();
  const undo = page.getByTestId('deshacer');
  await undo.hover();
  await undo.focus();
  await page.getByTestId('crear-clase').hover();
  await page.clock.fastForward(9000);
  await expect(undo).toBeFocused();

  await undo.press('Enter');
  await expect(page.getByTestId('clase-Cliente')).toBeVisible();
});

test('actualizar el historial tras generar cancela la consulta anterior', async ({ page }) => {
  const generation = {
    id: 'generacion-historial',
    artifactName: 'pizarra.zip',
    entities: 1,
    snapshotVersion: 2,
    basePackage: 'bo.edu.sw1',
    status: 'READY',
    author: { id: 'ana', displayName: 'Ana' },
    createdAt: new Date().toISOString(),
    projectName: 'Proyecto',
  };
  let generated = false;
  let initial: Request | null = null;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(
    `**/api${board.replace('/pizarras/', '/boards/')}/generations`,
    async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        generated = true;
        return route.fulfill({ status: 201, json: generation });
      }
      if (generated) return route.fulfill({ json: [generation] });
      initial = request;
      await pending;
      await route.fulfill({ json: [] }).catch(() => undefined);
    },
  );

  try {
    await enter(page);
    await page.getByTestId('pestana-generar').click();
    await expect.poll(() => initial !== null).toBe(true);
    const cancelled = page.waitForEvent('requestfailed', {
      predicate: (request) => request === initial,
      timeout: 10_000,
    });
    await Promise.all([cancelled, page.getByTestId('generar').click()]);
    release();
    await expect(page.getByTestId('historial-generaciones')).toContainText('v2');
  } finally {
    release();
  }
});

test('recupera el historial de generaciones al volver la conexión', async ({ page }) => {
  let reachable = false;
  await page.route(`**/api${board.replace('/pizarras/', '/boards/')}/generations`, (route) =>
    reachable
      ? route.fulfill({
          json: [
            {
              id: 'generacion-guardada',
              snapshotVersion: 3,
              status: 'READY',
              author: { id: 'ana', displayName: 'Ana' },
              createdAt: new Date().toISOString(),
              projectName: 'Proyecto guardado',
              basePackage: 'bo.edu.sw1',
            },
          ],
        })
      : route.fulfill({ status: 503, json: { error: { message: 'Sin conexión' } } }),
  );

  await enter(page);
  await page.getByTestId('pestana-generar').click();
  await expect(page.getByTestId('error-generacion')).toContainText(
    'No se pudo cargar el historial',
  );
  reachable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.getByTestId('historial-generaciones')).toContainText('Proyecto guardado');
  await expect(page.getByTestId('error-generacion')).toBeHidden();
});

test('terminar un borrado conserva los enlaces de la generación posterior', async ({ page }) => {
  let version = 0;
  const generation = (n: number) => ({
    id: `generacion-${n}`,
    artifactName: `proyecto-${n}.zip`,
    entities: 1,
    snapshotVersion: n,
    basePackage: 'bo.edu.sw1',
    status: 'READY',
    author: { id: 'ana', displayName: 'Ana' },
    createdAt: new Date().toISOString(),
    projectName: 'Proyecto',
  });
  await page.route(`**/api${board.replace('/pizarras/', '/boards/')}/generations`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: generation(++version) })
      : route.fulfill({ json: version === 0 ? [] : [generation(version)] }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/generations/generacion-1', async (route) => {
    await pending;
    await route.fulfill({ status: 204 });
  });

  try {
    await enter(page);
    await page.getByTestId('pestana-generar').click();
    const generate = page.getByTestId('generar');
    await generate.click();
    await expect(page.getByTestId('historial-generaciones')).toContainText('v1');
    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      page.waitForRequest((request) => request.method() === 'DELETE'),
      page.getByTestId('eliminar-generacion-1').click(),
    ]);
    await generate.click();
    const status = page.getByTestId('estado-generacion');
    await expect(status).toContainText('proyecto-2.zip');
    release();

    await expect(status).toContainText('Eliminada la generación v1');
    await expect(page.getByTestId('descargar-spring')).toBeVisible();
  } finally {
    release();
  }
});

test('permite seguir añadiendo atributos después de confirmar al salir del campo', async ({
  page,
}) => {
  await enter(page);
  await create(page, 'Persona');
  await page.getByRole('button', { name: '+ Atributo', exact: true }).click();

  const field = page.getByRole('textbox', { name: 'Nuevo atributo de Persona' });
  const node = page.getByTestId('clase-Persona');
  await field.fill('nombre: String');
  await field.press('Tab');
  await expect(node).toContainText('nombre: String');
  await expect(field).toHaveValue('');

  await field.fill('edad: Integer');
  await field.press('Enter');
  await expect(node).toContainText('edad: Integer');
  await expect(node.getByText('nombre', { exact: false })).toHaveCount(1);
});

test('confirmar una edición en línea conserva los campos editados por otro colaborador', async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  try {
    const remote = await other.newPage();
    await enter(page);
    await create(page, 'NombreInicial');
    await enter(remote, 'beto');

    const title = (editor: Page) =>
      editor.getByRole('textbox', { name: 'Nombre de la clase', exact: true });
    await page.getByTestId('clase-NombreInicial').locator('header .nombre').dblclick();
    await remote.getByTestId('clase-NombreInicial').locator('header .nombre').dblclick();
    await title(remote).fill('NombreRemoto');
    await title(remote).press('Enter');
    const localNode = page.getByTestId('clase-NombreRemoto');
    await expect(localNode).toBeVisible();
    await expect(title(page)).toHaveValue('NombreInicial');
    await title(page).press('Tab');
    await expect(title(page)).toHaveCount(0);
    await expect(localNode).toBeVisible();

    await localNode.locator('header .nombre').click();
    await page.getByRole('button', { name: '+ Atributo', exact: true }).click();
    const add = page.getByRole('textbox', { name: 'Nuevo atributo de NombreRemoto' });
    await add.fill('nombre: String');
    await add.press('Enter');
    await add.press('Escape');

    const remoteNode = remote.getByTestId('clase-NombreRemoto');
    await localNode.locator('[data-atributo]').filter({ hasText: 'nombre: String' }).dblclick();
    const localField = page.getByRole('textbox', { name: 'Atributo nombre', exact: true });
    await localField.fill('- nombreVisible: String');
    await remoteNode.locator('[data-atributo]').filter({ hasText: 'nombre: String' }).dblclick();
    const remoteField = remote.getByRole('textbox', { name: 'Atributo nombre', exact: true });
    await remoteField.fill('nombre: Integer');
    await remoteField.press('Enter');
    await expect(
      page.getByRole('combobox', { name: 'Tipo del atributo nombre', exact: true }),
    ).toHaveValue('Integer');
    await remote.locator('.uml-attribute summary').click();
    await remote
      .locator('.uml-attribute')
      .getByRole('combobox', { name: 'Visibilidad', exact: true })
      .selectOption('protected');
    await localField.press('Enter');
    await expect(localNode.locator('.visibilidad .guion')).toHaveText('#');
    await expect(localNode).toContainText('nombreVisible: Integer');
    await expect(remoteNode).toContainText('nombreVisible: Integer');
  } finally {
    await other.close();
  }
});

test('al reconectar valida el acceso vigente sin rotar la cookie innecesariamente', async ({
  page,
}) => {
  await enter(page);
  let refreshes = 0;
  await page.route('**/api/auth/refresh', (route) => {
    refreshes++;
    return route.continue();
  });
  await page.context().setOffline(true);
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  expect(refreshes).toBe(0);
});

test('abre la copia local si el acceso vence y la renovación de la consulta falla', async ({
  page,
}) => {
  await enter(page);
  await create(page, 'AccesoVencido');
  await page.route(`**/api${board.replace('/pizarras/', '/boards/')}`, (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }),
  );
  let refreshes = 0;
  await page.route('**/api/auth/refresh', (route) => {
    refreshes++;
    return refreshes === 1
      ? route.continue()
      : route.fulfill({ status: 503, json: { error: { message: 'Servicio no disponible' } } });
  });
  await page.reload();
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('clase-AccesoVencido')).toBeVisible();
  await create(page, 'CambioPendiente');
  await page.unroute('**/api/auth/refresh');
  await page.unroute(`**/api${board.replace('/pizarras/', '/boards/')}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('clase-CambioPendiente')).toBeVisible();
});

test('carga el detalle de un proyecto abierto sin conexión al recuperarse', async ({ page }) => {
  await enter(page);
  await page.context().setOffline(true);
  await page.goto('/proyectos/recuperado');
  await expect(page.getByTestId('aviso-sin-conexion')).toBeVisible();
  await page.route('**/api/projects/recuperado', (route) =>
    route.fulfill({
      json: { id: 'recuperado', displayName: 'Proyecto recuperado', role: 'OWNER', boards: [] },
    }),
  );
  await page.context().setOffline(false);
  await expect(page.getByTestId('lista-pizarras')).toBeVisible();
  await page.getByTestId('nombre-pizarra').fill('Borrador conservado');
  await page.context().setOffline(true);
  await expect(page.getByTestId('aviso-sin-conexion')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByTestId('aviso-sin-conexion')).toHaveCount(0);
  await expect(page.getByTestId('nombre-pizarra')).toHaveValue('Borrador conservado');
});

test('carga los proyectos al recuperar la conexión sin perder el formulario', async ({ page }) => {
  await enter(page);
  await page.context().setOffline(true);
  await page.goto('/proyectos');
  await expect(page.getByTestId('aviso-sin-conexion')).toBeVisible();
  await page.getByTestId('nombre-proyecto').fill('Borrador conservado');
  await page.route('**/api/projects', (route) =>
    route.fulfill({
      json: [
        {
          id: 'recuperado',
          displayName: 'Proyecto recuperado',
          role: 'OWNER',
          boardCount: 1,
          memberCount: 1,
        },
      ],
    }),
  );
  await page.context().setOffline(false);
  await expect(page.getByTestId('aviso-sin-conexion')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Proyecto recuperado', exact: true })).toBeVisible();
  await expect(page.getByTestId('nombre-proyecto')).toHaveValue('Borrador conservado');
});

test('un login en otra pestaña espera al logout pendiente antes de cambiar la cookie', async ({
  page,
}) => {
  await enter(page);
  const sibling = await page.context().newPage();
  await sibling.goto(board);
  await expect(sibling.getByTestId('estado-conexion')).toHaveText('En vivo');
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/auth/logout', async (route) => {
    started();
    await gate;
    await route.continue();
  });
  try {
    await page.getByTestId('salir').click();
    await received;
    await expect(sibling.getByTestId('email')).toBeVisible();
    await sibling.getByTestId('email').fill('beto@example.com');
    await sibling.getByTestId('password').fill('password-test');
    await sibling.getByTestId('enviar').click();
    // Observe the shared browser lock: the old response must finish setting its
    // cookie before this other tab sends the new login request.
    await expect
      .poll(() =>
        sibling.evaluate(async () =>
          (await navigator.locks.query()).pending?.some(
            (lock) => lock.name === 'uml-refresh-session',
          ),
        ),
      )
      .toBe(true);
    release();
    await expect(sibling.getByTestId('lista-proyectos')).toBeVisible();
    await sibling.reload();
    await expect(sibling.getByTestId('lista-proyectos')).toBeVisible();
    expect(
      await sibling.evaluate(
        () => JSON.parse(localStorage.getItem('uml_offline_user_v1') ?? '{}').id,
      ),
    ).toBe(betoId);
  } finally {
    release();
    await sibling.close();
  }
});

test('un token de acceso vencido no retira la copia para abrir sin conexión', async ({
  page,
  request,
}) => {
  await enter(page);
  await create(page, 'Sobrevive');
  // Una renovación que no llega a completarse: es el caso que dejaba la pizarra
  // inabrible sin red aunque su instantánea siguiera intacta.
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Temporalmente no disponible' } } }),
  );
  await request.post('/test/close?reason=token-invalido');
  await expect(page.getByTestId('estado-conexion')).not.toHaveText('En vivo');
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) => key.startsWith('uml_offline_board_v1:')).length,
    ),
  ).toBe(1);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('clase-Sobrevive')).toBeVisible();
});

test('un parpadeo de red no descarta el trabajo en curso de los paneles', async ({ page }) => {
  await enter(page);
  await create(page, 'Elegida');
  await page.getByTestId('pestana-importar').click();
  await expect(page.getByTestId('pestana-importar')).toHaveAttribute('aria-selected', 'true');
  await page.context().setOffline(true);
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  // El asistente y la importación guardan su conversación y su candidato en el
  // propio panel: cambiar de modo no puede remontarlos.
  await expect(page.getByTestId('pestana-importar')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('nombre-clase')).toHaveValue('Elegida');
});

for (const [path, field] of [
  ['/cuenta', 'perfil-nombre'],
  ['/proyectos', 'nombre-proyecto'],
] as const) {
  test(`conserva el formulario de ${path} durante una desconexión confirmada`, async ({ page }) => {
    await enter(page);
    await page.goto(path);
    const input = page.getByTestId(field);
    await input.fill('Trabajo sin guardar');
    await page.context().setOffline(true);
    await expect(page.getByTestId('aviso-sin-conexion')).toBeVisible();
    await expect(input).toHaveValue('Trabajo sin guardar');
    await page.context().setOffline(false);
    await expect(page.getByTestId('aviso-sin-conexion')).toHaveCount(0);
    await expect(input).toHaveValue('Trabajo sin guardar');
  });
}

test('una renovación temporalmente fallida permite editar offline y se recupera sin recargar', async ({
  page,
  request,
}) => {
  await enter(page);
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: 'Temporalmente no disponible' } },
    }),
  );
  await request.post('/test/close?reason=token-invalido');
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await create(page, 'DuranteRenovacion');
  await page.unroute('**/api/auth/refresh');
  // No se emite online: navigator.onLine fue true durante todo el fallo.
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('clase-DuranteRenovacion')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('clase-DuranteRenovacion')).toBeVisible();
});

test('autenticar como lector degrada la caché antes de completar la sincronización', async ({
  page,
  request,
}) => {
  await enter(page, 'beto');
  await request.post(`/test/role?id=${betoId}&role=VIEWER`);
  let authenticated = false;
  await page.routeWebSocket('**/collab', (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (typeof message !== 'string') {
        const decoder = createDecoder(message);
        readVarString(decoder);
        const type = readVarUint(decoder);
        // Hocuspocus: retrasar Sync y SyncStatus, dejando pasar Auth.
        if (type === 0 || type === 8) return;
        if (type === 2) authenticated = true;
      }
      ws.send(message);
    });
  });
  await page.reload();
  await expect.poll(() => authenticated).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) =>
          key.startsWith('uml_offline_board_v1:'),
        );
        return key === undefined ? null : JSON.parse(localStorage.getItem(key) ?? 'null')?.role;
      }),
    )
    .toBe('VIEWER');
  await page.context().setOffline(true);
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('crear-clase')).toBeDisabled();
});

test('conserva edición offline si la sesión funciona pero la consulta de pizarra falla', async ({
  page,
}) => {
  await enter(page);
  await create(page, 'Guardada');
  let attempts = 0;
  await page.route(`**/api${board.replace('/pizarras/', '/boards/')}`, (route) => {
    attempts++;
    return route.fulfill({
      status: 503,
      json: { error: { message: 'Servicio de pizarras no disponible' } },
    });
  });
  await page.reload();
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('clase-Guardada')).toBeVisible();
  await create(page, 'MientrasFalla');
  const countDrafts = () =>
    page.evaluate(
      () => Object.keys(localStorage).filter((key) => key.startsWith('uml_board_draft_v1:')).length,
    );
  const slots = await countDrafts();
  await expect.poll(() => attempts).toBeGreaterThanOrEqual(2);
  await create(page, 'TrasReintento');
  expect(await countDrafts()).toBe(slots);
  await page.unroute(`**/api${board.replace('/pizarras/', '/boards/')}`);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.reload();
  await expect(page.getByTestId('clase-MientrasFalla')).toBeVisible();
  await expect(page.getByTestId('clase-TrasReintento')).toBeVisible();
});

test('retira el indicador de disponibilidad si deja de poder guardar la instantánea', async ({
  page,
}) => {
  await enter(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('uml_board_snapshot_v1:'))
        throw new DOMException('Cuota agotada', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await create(page, 'ProtegidaEnBorrador');
  await expect(page.getByTestId('aviso-permisos')).toContainText('No se pudo actualizar');
  await expect(page.getByTestId('offline-disponible')).toHaveCount(0);
});

test('recarga, cierra y abre offline, luego combina cambios con otro colaborador', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await create(page, 'Local');
  const other = await browser.newContext();
  const remote = await other.newPage();
  await enter(remote, 'beto');
  await expect(remote.getByTestId('clase-Local')).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('nombre-clase')).toHaveValue('Local');
  await create(page, 'SinRed');
  await page.reload();
  await expect(page.getByTestId('clase-SinRed')).toBeVisible();
  await create(page, 'TrasRecargar');
  await expect(page.getByTestId('auditoria-pendiente')).toBeVisible();
  await create(remote, 'Remota');
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(board);
  await expect(reopened.getByTestId('clase-TrasRecargar')).toBeVisible();
  await reopened.getByRole('link', { name: 'Ver pizarras guardadas' }).click();
  await expect(reopened.getByTestId('pizarras-offline')).toContainText('Pizarra 1');
  await reopened.getByRole('link', { name: 'Pizarra 1', exact: true }).click();
  await context.setOffline(false);
  await expect(reopened.getByTestId('estado-conexion')).toHaveText('En vivo');
  for (const name of ['Local', 'SinRed', 'TrasRecargar', 'Remota']) {
    await expect(reopened.getByTestId(`clase-${name}`)).toHaveCount(1);
    await expect(remote.getByTestId(`clase-${name}`)).toHaveCount(1);
  }
  await reopened.reload();
  await expect(reopened.getByTestId('clase-TrasRecargar')).toBeVisible();
  expect(errors).toEqual([]);
  const cachedUrls = await reopened.evaluate(async () => {
    const result: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys()) result.push(request.url);
    return result;
  });
  expect(cachedUrls.some((url) => /\/(api|collab)\//.test(url))).toBe(false);
  await other.close();
});

test('una pizarra visitada sin editar se abre offline; una no visitada no', async ({ page }) => {
  await enter(page);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('crear-clase')).toBeEnabled();
  await page.goto(secondBoard);
  await expect(page.getByRole('alert')).toContainText('no está disponible sin conexión');
});

test('un lector conserva la copia remota sin obtener permiso de edición offline', async ({
  page,
  request,
}) => {
  await request.post(`/test/role?id=${betoId}&role=VIEWER`);
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('crear-clase')).toBeDisabled();
  await expect(page.getByTestId('solo-lectura')).toBeVisible();
});

test('perder edición mientras está offline no publica el borrador al reconectar', async ({
  page,
  browser,
  request,
}) => {
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await page.reload();
  await create(page, 'Pendiente');
  await request.post(`/test/role?id=${betoId}&role=VIEWER`);
  await page.context().setOffline(false);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('crear-clase')).toBeDisabled();
  await expect(page.getByTestId('clase-Pendiente')).toHaveCount(0);
  const context = await browser.newContext();
  const owner = await context.newPage();
  await enter(owner);
  await expect(owner.getByTestId('clase-Pendiente')).toHaveCount(0);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('crear-clase')).toBeDisabled();
  await expect(page.getByTestId('clase-Pendiente')).toHaveCount(0);
  await page.context().setOffline(false);
  await request.post(`/test/role?id=${betoId}&role=EDITOR`);
  await page.reload();
  await expect(page.getByTestId('clase-Pendiente')).toBeVisible();
  await expect(owner.getByTestId('clase-Pendiente')).toBeVisible();
  await context.close();
});

test('salir offline impide que la cookie restaure la cuenta al recargar online', async ({
  page,
}) => {
  await enter(page);
  await page.goto(secondBoard);
  await expect(page.getByTestId('offline-disponible')).toBeVisible();
  await page.context().setOffline(true);
  await page.getByTestId('salir').click();
  await page.reload();
  await expect(page.getByTestId('email')).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByTestId('email')).toBeVisible();
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await page.goto('/sin-conexion');
  await expect(page.getByTestId('pizarras-offline').getByRole('link')).toHaveCount(1);
  await page.goto(secondBoard);
  await expect(page.getByRole('alert')).toContainText('no está disponible sin conexión');
});

test('revocar acceso invalida la entrada offline sin borrar el trabajo pendiente', async ({
  page,
  request,
}) => {
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await create(page, 'Privada');
  await request.post(`/test/role?id=${betoId}&role=NONE`);
  await page.context().setOffline(false);
  await expect(page.getByRole('alert')).toContainText('Sin acceso');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('no está disponible sin conexión');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key.startsWith('uml_board_draft_v1:')),
    ),
  ).toBe(true);
});

test('sesión vencida pide login y conserva los cambios para la misma cuenta', async ({
  page,
  request,
}) => {
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await create(page, 'Conservar');
  await request.post(`/test/expire?id=${betoId}`);
  await page.context().setOffline(false);
  await expect(page.getByTestId('email')).toBeVisible();
  await enter(page, 'beto');
  await expect(page.getByTestId('clase-Conservar')).toBeVisible();
});

test('recupera borradores al recibir nuevamente edición sin recargar la pizarra', async ({
  page,
  request,
}) => {
  await enter(page, 'beto');
  await page.context().setOffline(true);
  await create(page, 'Recuperable');
  await request.post(`/test/role?id=${betoId}&role=VIEWER`);
  await page.context().setOffline(false);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('crear-clase')).toBeDisabled();
  await expect(page.getByTestId('clase-Recuperable')).toHaveCount(0);
  await request.post(`/test/role?id=${betoId}&role=EDITOR`);
  await expect(page.getByTestId('crear-clase')).toBeEnabled();
  await expect(page.getByTestId('clase-Recuperable')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('clase-Recuperable')).toBeVisible();
});

test('un fallo del servidor al recargar permite editar la copia y reintenta al recuperarse', async ({
  page,
}) => {
  await enter(page);
  await create(page, 'ServidorCaido');
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Temporalmente no disponible' } } }),
  );
  await page.reload();
  await expect(page.getByTestId('modo-offline')).toBeVisible();
  await expect(page.getByTestId('clase-ServidorCaido')).toBeVisible();
  await create(page, 'DuranteFallo');
  await page.unroute('**/api/auth/refresh');
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await page.reload();
  await expect(page.getByTestId('clase-DuranteFallo')).toBeVisible();
});
