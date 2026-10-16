import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integracion de la API.
 * Levantan un PostgreSQL en Docker y aplican las migraciones, asi que tardan segundos en lugar de milisegundos
 * El bucle rapido del nucleo de dominio no debe depender de Docker
 */
export default defineConfig({
  // Vitest toma como raiz la carpeta del archivo de configuracion
  // Este vive en config/, asi que se ancla al repositorio: sin esto buscaria las pruebas
  // dentro de `config/` y no encontraria ninguna
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['backend/*/tests/integration/**/*.integration.test.ts'],
    // Cada archivo levanta su propio contenedor; en paralelo se pisarian los
    // recursos de la maquina sin ganar tiempo real.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/vitest-integration-junit.xml' },
  },
});
