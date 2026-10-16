import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo con dos navegadores (plan maestro 15.4).
 *
 * Se ejecutan contra el entorno de contenedores levantado, porque lo que se
 * quiere comprobar es la cadena completa: navegador → proxy → proceso HTTP y
 * proceso WebSocket → PostgreSQL. Sustituir cualquier eslabon por un doble
 * dejaria sin probar justo lo que puede fallar el dia de la defensa.
 *
 *   npm run up          (una vez)
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './specs',
  // Las salas son compartidas: dos ficheros en paralelo se pisarian.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['junit', { outputFile: '../reports/e2e-junit.xml' }]]
    : 'list',

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
