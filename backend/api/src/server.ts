import { buildApp, SERVICE_NAME } from './app.js';
import { loadConfig } from './config.js';

/**
 * Punto de entrada del proceso HTTP api
 * config recibe la configuracion y app.ts construye FASTFITY
 * Solo manejamos el ciclo de vida, arranque, escucha y apagado ordenado
 */

const config = loadConfig();
const app = await buildApp(config);

/**
 * SIGINT == Ctrl + C
 * SIGTERM == apagado solicitado por dockercito, sysmd u otro
 */
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    app.log.info({ senal }, 'cerrando el proceso');
    void app.close().then(() => process.exit(0));
  });
}

// Abre el socket HTTP para aceptar solicitudes
try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info({ service: SERVICE_NAME, port: config.API_PORT }, 'proceso api escuchando');
} catch (error) {
  app.log.fatal({ error }, 'el proceso api no pudo arrancar');
  process.exit(1);
}
