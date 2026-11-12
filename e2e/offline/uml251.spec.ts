import { expect, test, type Page } from '@playwright/test';

const board = '/pizarras/00000000-0000-4000-8000-000000000010';

async function enter(page: Page, account = 'ana') {
  await page.goto('/entrar');
  await page.getByTestId('email').fill(`${account}@example.com`);
  await page.getByTestId('password').fill('password-test');
  await page.getByTestId('enviar').click();
  await expect(page.getByTestId('lista-proyectos')).toBeVisible();
  await page.goto(board);
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
}

async function create(page: Page, name: string) {
  await page.getByTestId('crear-clase').click();
  await page.getByTestId('nombre-clase').fill(name);
  await page.getByTestId('nombre-clase').press('Tab');
  await expect(page.getByTestId(`clase-${name}`)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post('/test/reset');
});
test.use({ viewport: { width: 1500, height: 1000 } });

test('edita y conserva notación de atributos y operaciones sin marcas de base de datos', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await enter(page);
  await create(page, 'Pedido');
  await page.getByRole('checkbox', { name: 'Abstracta', exact: true }).check();
  await page.getByLabel('Nombre del nuevo atributo', { exact: true }).fill('total');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  const properties = page.locator('.uml-attribute');
  await properties.locator('summary').click();
  await properties.getByLabel('Visibilidad', { exact: true }).selectOption('protected');
  await properties.getByLabel('Multiplicidad de total', { exact: true }).fill('2..5');
  await properties.getByLabel('Multiplicidad de total', { exact: true }).press('Tab');
  await properties.getByRole('checkbox', { name: 'Atributo estático' }).check();
  await properties.getByRole('checkbox', { name: 'Solo lectura' }).check();
  await page.getByTestId('agregar-operacion').click();
  const operation = page.locator('.uml-operation');
  await operation.getByLabel('Nombre de operación', { exact: true }).fill('calcularTotal');
  await operation.getByLabel('Nombre de operación', { exact: true }).press('Tab');
  await operation
    .getByLabel('Tipo de retorno (vacío: sin retorno)', { exact: true })
    .fill('Decimal');
  await operation.getByLabel('Tipo de retorno (vacío: sin retorno)', { exact: true }).press('Tab');
  await operation.getByRole('button', { name: '+ Parámetro', exact: true }).click();
  await operation.getByLabel('Nombre del parámetro', { exact: true }).fill('impuesto');
  await operation.getByLabel('Nombre del parámetro', { exact: true }).press('Tab');
  await operation.getByLabel('Tipo del parámetro', { exact: true }).fill('Decimal');
  await operation.getByLabel('Tipo del parámetro', { exact: true }).press('Tab');
  const node = page.getByTestId('clase-Pedido');
  await expect(node).toContainText('+ calcularTotal(impuesto: Decimal): Decimal');
  await expect(node).toContainText('total: String [2..5] {readOnly}');
  await expect(node.locator('.visibilidad .guion')).toHaveText('#');
  await expect(node.locator('header')).toHaveCSS('font-style', 'italic');
  await expect(node.locator('.uml-static .campo')).toHaveCSS('text-decoration-line', 'underline');
  await expect(node.locator('.pk, .uq, .obligatorio, .tecnico')).toHaveCount(0);
  await expect(node).not.toHaveClass(/con-error/);
  await page.getByTestId('abrir-validacion').click();
  await expect(page.getByTestId('panel-validacion')).toContainText('Generación:');
  await page.screenshot({ path: 'reports/uml251-editor.png', fullPage: true });
  await page.reload();
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(page.getByTestId('clase-Pedido')).toContainText(
    '+ calcularTotal(impuesto: Decimal): Decimal',
  );
  expect(failures).toEqual([]);
});

test('propone un nombre libre después de eliminar un parámetro intermedio', async ({ page }) => {
  await enter(page);
  await create(page, 'Pedido');
  await page.getByTestId('agregar-operacion').click();
  const operation = page.locator('.uml-operation');
  const add = operation.getByRole('button', { name: '+ Parámetro', exact: true });
  for (let index = 0; index < 3; index++) await add.click();
  await operation.getByRole('button', { name: 'Eliminar parámetro 2', exact: true }).click();
  await add.click();
  const fields = operation.getByLabel('Nombre del parámetro', { exact: true });
  await expect(fields.nth(1)).toHaveValue('parametro3');
  await expect(fields.nth(2)).toHaveValue('parametro2');
});

test('crea una clase de asociación con atributos y recupera el vínculo al deshacer', async ({
  page,
}) => {
  await enter(page);
  await create(page, 'Alumno');
  await create(page, 'Materia');
  await page.getByTestId('tool-association').click();
  await page.getByTestId('clase-Alumno').click();
  await page.getByTestId('clase-Materia').click();
  const association = page.locator('[data-relationship-kind="ASSOCIATION"]');
  await page.getByTestId('multiplicidad-origen').fill('0..*');
  await page.getByTestId('multiplicidad-origen').press('Tab');
  await page.getByRole('button', { name: 'Agregar clase de asociación' }).click();
  await page.getByTestId('nombre-clase').fill('Matrícula');

  const connector = association.locator('.enlace-clase-asociacion');
  await expect(connector).toHaveAttribute('stroke-dasharray', '7 4');
  await expect(association.locator('.multiplicidad')).toHaveText(['0..*', '0..*']);

  const nameField = page.getByRole('textbox', { name: 'Nombre del nuevo atributo' });
  const add = page.getByRole('button', { name: 'Añadir', exact: true });
  await nameField.fill('estado');
  await add.click();
  await nameField.fill('fecha');
  await add.click();
  const fecha = page.locator('.uml-attribute').filter({ hasText: 'fecha' });
  await fecha.locator('summary').click();
  const multiplicity = fecha.getByLabel('Multiplicidad de fecha');
  await multiplicity.fill('1');
  await multiplicity.press('Tab');
  const card = page.getByRole('group', { name: /^Clase Matrícula,/ });
  await expect(card).toContainText('fecha: String');
  await expect(card).toContainText('estado: String');
  await expect(card).not.toContainText(/\[(1|0\.\.1)\]/);

  await page.reload();
  await expect(page.getByTestId('estado-conexion')).toHaveText('En vivo');
  await expect(connector).toHaveAttribute('stroke-dasharray', '7 4');
  await card.getByText('Matrícula', { exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar clase', exact: true }).click();
  await expect(connector).toHaveCount(0);
  await expect(association.locator('.multiplicidad')).toHaveText(['0..*', '0..*']);
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(connector).toHaveAttribute('stroke-dasharray', '7 4');
  await expect(card).toContainText('fecha: String');
});

test('mantiene los borradores de Propiedades en el elemento seleccionado', async ({ page }) => {
  await enter(page);
  await create(page, 'Alumno');
  await create(page, 'Materia');
  const atributo = page.getByRole('textbox', { name: 'Nombre del nuevo atributo' });
  await atributo.fill('borrador');
  await page.getByTestId('clase-Alumno').click();
  await expect(atributo).toHaveValue('');

  for (const [source, target] of [
    ['Alumno', 'Materia'],
    ['Materia', 'Alumno'],
  ]) {
    await page.getByTestId('tool-association').click();
    await page.getByTestId(`clase-${source}`).click();
    await page.getByTestId(`clase-${target}`).click();
  }
  const origen = page.getByTestId('multiplicidad-origen');
  await origen.fill('rango incorrecto');
  await origen.press('Tab');
  await expect(origen).toHaveAttribute('aria-invalid', 'true');
  const primera = page.getByRole('group', { name: 'ASSOCIATION entre Alumno y Materia' });
  await primera.press('Enter');
  await expect(origen).toHaveValue('1');
  await expect(origen).toHaveAttribute('aria-invalid', 'false');
});

test('comparte interfaces, enumeraciones y realización entre dos navegadores', async ({
  page,
  browser,
}) => {
  await enter(page);
  await create(page, 'Estado');
  await page.getByTestId('tipo-clasificador').selectOption('ENUMERATION');
  await page.getByLabel('Nuevo literal', { exact: true }).fill('PENDIENTE');
  await page.getByRole('button', { name: 'Añadir literal', exact: true }).click();
  await create(page, 'Facturable');
  await page.getByTestId('tipo-clasificador').selectOption('INTERFACE');
  await page.getByTestId('agregar-operacion').click();
  await page.getByLabel('Nombre de operación', { exact: true }).fill('facturar');
  await page.getByLabel('Nombre de operación', { exact: true }).press('Tab');
  await create(page, 'Factura');
  await page.getByTestId('tool-realization').click();
  await page.getByTestId('clase-Factura').click();
  await page.getByTestId('clase-Facturable').click();
  await expect(
    page.locator('[data-relationship-kind="REALIZATION"] .asociacion-linea'),
  ).toHaveAttribute('stroke-dasharray', '7 4');
  await expect(page.locator('[data-relationship-kind="REALIZATION"] .triangulo')).toHaveCount(1);
  await expect(page.locator('[data-relationship-kind="REALIZATION"] .multiplicidad')).toHaveCount(
    0,
  );
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await enter(other, 'beto');
    await expect(other.getByTestId('clase-Estado')).toContainText('«enumeration»');
    await expect(other.getByTestId('clase-Estado')).toContainText('PENDIENTE');
    await expect(other.getByTestId('clase-Facturable')).toContainText('«interface»');
    await expect(other.getByTestId('clase-Facturable')).toContainText('+ facturar()');
    await expect(other.getByTestId('clase-Facturable').locator('.uml-operations li')).toHaveCSS(
      'font-style',
      'italic',
    );
  } finally {
    await context.close();
  }
});
