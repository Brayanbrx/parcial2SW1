import { expect, test } from '@playwright/test';
import { resolveProposal } from '@uml/ai';
import { serializeToXmi } from '@uml/xmi';
import { abrirHerramienta, crearClase } from '../support/actors.js';
import { montarEscenario, type EscenarioCompartido } from '../support/escenario.js';

async function permisos(escenario: EscenarioCompartido, role: 'VIEWER' | 'EDITOR'): Promise<void> {
  const client = escenario.ana.page.request;
  const login = await client.post('/api/auth/login', {
    data: { email: escenario.ana.email, password: 'contrasena-de-prueba' },
  });
  expect(login.ok()).toBe(true);
  const { accessToken } = await login.json();
  const headers = { authorization: `Bearer ${accessToken}` };
  const boardId = new URL(escenario.ana.page.url()).pathname.split('/').pop();
  const board = await (await client.get(`/api/boards/${boardId}`, { headers })).json();
  const members = (await (
    await client.get(`/api/projects/${board.projectId}/members`, { headers })
  ).json()) as { id: string; email: string }[];
  const member = members.find((user) => user.email === escenario.beto.email)!;
  const response = await client.patch(`/api/projects/${board.projectId}/members/${member.id}`, {
    headers,
    data: { role },
  });
  expect(response.ok()).toBe(true);
}

test('actualiza permisos de participantes inactivos y permite recuperar el rol editor', async ({
  browser,
}) => {
  const escenario = await montarEscenario(browser, 'Permisos vivos');
  try {
    await crearClase(escenario.ana, 'Cliente');
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await permisos(escenario, 'VIEWER');
    await expect(escenario.beto.page.getByTestId('crear-clase')).toBeDisabled();
    await expect(escenario.beto.page.getByTestId('solo-lectura')).toBeVisible();
    await expect(escenario.beto.page.getByTestId('aviso-permisos')).toContainText(
      'no se enviará sin permiso de edición',
    );
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await permisos(escenario, 'EDITOR');
    await expect(escenario.beto.page.getByTestId('crear-clase')).toBeEnabled();
    await crearClase(escenario.beto, 'Producto');
    await expect(escenario.ana.page.getByTestId('clase-Producto')).toBeVisible();
  } finally {
    await escenario.cerrar();
  }
});

test('al reconectar como lector descarta cambios rechazados sin reintroducirlos en Yjs', async ({
  browser,
}) => {
  const escenario = await montarEscenario(browser, 'Permisos sin red');
  try {
    await crearClase(escenario.ana, 'Cliente');
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await escenario.beto.page.context().setOffline(true);
    await expect(escenario.beto.page.getByTestId('estado-conexion')).toHaveText('Sin conexión');
    await crearClase(escenario.beto, 'Fantasma');
    await expect(escenario.beto.page.getByTestId('clase-Fantasma')).toBeVisible();
    await permisos(escenario, 'VIEWER');
    await escenario.beto.page.context().setOffline(false);
    await expect(escenario.beto.page.getByTestId('crear-clase')).toBeDisabled();
    await expect(escenario.beto.page.getByTestId('estado-conexion')).toHaveText('En vivo');
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await expect(escenario.beto.page.getByTestId('clase-Fantasma')).toHaveCount(0);
    await expect(escenario.ana.page.getByTestId('clase-Fantasma')).toHaveCount(0);
    await escenario.beto.page.reload();
    await expect(escenario.beto.page.getByTestId('estado-conexion')).toHaveText('En vivo');
    await expect(escenario.beto.page.getByTestId('clase-Fantasma')).toHaveCount(0);
  } finally {
    await escenario.cerrar();
  }
});

test('una propuesta antigua no borra el atributo añadido por otro colaborador', async ({
  browser,
}) => {
  const escenario = await montarEscenario(browser, 'Propuesta desactualizada');
  try {
    await crearClase(escenario.ana, 'Cliente');
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toBeVisible();
    await escenario.ana.page.route('**/api/boards/*/assistant/instruction', async (route) => {
      const { model } = route.request().postDataJSON();
      const outcome = resolveProposal({
        model,
        actorId: '11111111-1111-4111-8111-111111111111',
        origin: 'AI_TEXT',
        proposal: { operations: [{ op: 'DELETE_CLASS', className: 'Cliente' }] },
      });
      await route.fulfill({ json: { ...outcome, rationale: null } });
    });
    await abrirHerramienta(escenario.ana, 'asistente');
    await escenario.ana.page.getByTestId('entrada-asistente').fill('elimina Cliente');
    await escenario.ana.page.getByTestId('enviar-asistente').click();
    await expect(escenario.ana.page.getByTestId('aplicar-propuesta')).toBeVisible();
    await escenario.beto.page.getByTestId('clase-Cliente').click();
    await escenario.beto.page.getByTestId('nuevo-atributo').fill('datoNuevo');
    await escenario.beto.page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(escenario.ana.page.getByTestId('clase-Cliente')).toContainText('datoNuevo');
    await escenario.ana.page.getByTestId('aplicar-propuesta').click();
    await expect(escenario.ana.page.getByTestId('propuesta-obsoleta')).toBeVisible();
    await expect(escenario.ana.page.getByTestId('entrada-asistente')).toHaveValue(
      'elimina Cliente',
    );
    await expect(escenario.ana.page.getByTestId('clase-Cliente')).toContainText('datoNuevo');
    await expect(escenario.beto.page.getByTestId('clase-Cliente')).toContainText('datoNuevo');
  } finally {
    await escenario.cerrar();
  }
});

test('el candidato XMI permite corregir nombres que colisionan antes de aplicarlo', async ({
  browser,
}) => {
  const escenario = await montarEscenario(browser, 'Colisión editable');
  try {
    const xml = serializeToXmi(
      {
        classes: ['Detalle de Venta', 'detalle venta'].map((displayName) => ({
          id: crypto.randomUUID(),
          displayName,
          codeName: 'DetalleVenta',
          databaseName: 'detalle_venta',
          attributes: [],
        })),
        relationships: [],
      },
      { modelName: 'Colision' },
    );
    await abrirHerramienta(escenario.ana, 'importar');
    await escenario.ana.page.getByTestId('archivo-xmi').setInputFiles({
      name: 'colision.xmi',
      mimeType: 'application/xml',
      buffer: Buffer.from(xml),
    });
    await expect(escenario.ana.page.getByTestId('aplicar-candidato')).toBeVisible();
    const names = escenario.ana.page.getByTestId('candidato').getByRole('textbox');
    await expect(names).toHaveCount(2);
    await names.nth(1).fill('Detalle de Compra');
    await escenario.ana.page.getByTestId('aplicar-candidato').click();
    await expect(escenario.beto.page.getByTestId('clase-DetalleVenta')).toBeVisible();
    await expect(escenario.beto.page.getByTestId('clase-DetalleCompra')).toBeVisible();
  } finally {
    await escenario.cerrar();
  }
});
