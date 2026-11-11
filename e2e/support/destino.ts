import type { Page } from '@playwright/test';

/**
 * El compositor del panel empieza dirigido al equipo: a la IA se le escribe a
 * propósito. Las pruebas que conversan con la IA eligen su modo si todavía
 * apuntan al equipo; si ya eligieron uno con su botón, este se mantiene.
 */
export async function hablarConIa(
  page: Page,
  modo: 'instruir' | 'preguntar' | 'revisar' = 'instruir',
): Promise<void> {
  const equipo = page.getByTestId('destino-equipo');
  if ((await equipo.getAttribute('aria-pressed')) === 'true')
    await page.getByTestId(`modo-${modo}`).click();
}
