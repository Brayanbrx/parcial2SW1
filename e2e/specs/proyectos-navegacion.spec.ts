import { expect, test } from '@playwright/test';

test('cambiar de proyecto descarta respuestas e invitaciones del proyecto anterior', async ({
  page,
}) => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const user = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'ana@example.com',
    displayName: 'Ana',
  };
  let holdFirst = false;
  let requested!: () => void;
  let release!: () => void;
  const pendingRequest = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/refresh')) {
      await route.fulfill({ json: { accessToken: 'test-token', user } });
    } else if (path.endsWith('/auth/me')) {
      await route.fulfill({ json: user });
    } else if (path === `/api/projects/${firstId}/invites` && route.request().method() === 'POST') {
      await route.fulfill({ json: { code: 'invitacion-primer-proyecto' } });
    } else if (path === `/api/projects/${firstId}` || path === `/api/projects/${secondId}`) {
      const first = path.endsWith(firstId);
      if (first && holdFirst) {
        requested();
        await responseGate;
      }
      await route.fulfill({
        json: {
          id: first ? firstId : secondId,
          displayName: first ? 'Proyecto anterior' : 'Proyecto actual',
          role: 'OWNER',
          boards: [],
        },
      });
    } else {
      await route.fulfill({ json: [] });
    }
  });

  try {
    await page.goto(`/proyectos/${firstId}`);
    await expect(page.getByRole('heading', { name: 'Proyecto anterior' })).toBeVisible();
    await page.getByTestId('invitar-editor').click();
    await expect(page.getByTestId('codigo-generado')).toHaveText('invitacion-primer-proyecto');
    holdFirst = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pendingRequest;
    // Simula una transición del historial que React Router resuelve sin recargar.
    await page.evaluate((id) => {
      window.history.pushState({}, '', `/proyectos/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondId);
    await expect(page.getByRole('heading', { name: 'Proyecto actual' })).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/projects/${firstId}`,
    );
    release();
    await oldResponse;
    // Da al cliente oportunidad de consumir el JSON y a React de pintarlo.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByRole('heading', { name: 'Proyecto actual' })).toBeVisible();
    await expect(page.getByTestId('codigo-generado')).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
