import { defineConfig } from 'vitest/config';

/**
 * Un solo ejecutor de pruebas para todo el monorepo.
 *
 * RNF-15: las pruebas del paquete de dominio corren en el entorno `node`, sin
 * navegador, sin base de datos, sin WebSocket, sin proveedor de IA y sin sistema
 * de archivos. Las pruebas de extremo a extremo con dos navegadores viven aparte
 * y llegan en la fase 5.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      '{shared,backend}/*/tests/**/*.test.ts',
      'frontend/tests/**/*.test.ts',
      'fixtures/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/integration/**', 'e2e/**'],
    // Levantar la aplicacion Fastify en un `beforeAll` cuesta unos cinco
    // segundos de carga de modulos —Prisma, los adaptadores de IA, las
    // plantillas— y el limite por defecto son diez. Ese margen se agota en
    // cuanto la maquina esta cargada, y el sintoma es un fallo que no se
    // reproduce: pasa aislado y falla en la suite completa.
    hookTimeout: 30_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/vitest-junit.xml' },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'reports/coverage',
      include: [
        'shared/*/src/**/*.ts',
        'backend/*/src/**/*.ts',
        'frontend/src/**/*.ts',
        'fixtures/src/**/*.ts',
      ],
    },
  },
});
