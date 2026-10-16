import { buildCollabServer, SERVICE_NAME } from './app.js';
import { loadConfig } from './config.js';

// CICLO DE VIDA DEL PROCESO

const config = loadConfig();
const collab = buildCollabServer(config);

let cerrando = false;
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    if (cerrando) return;
    cerrando = true;
    // El apagado ordenado guarda los documentos abiertos antes de salir: sin el,
    // lo escrito en los ultimos segundos se perderia con el proceso.
    void collab.close().then(() => process.exit(0));
  });
}

await collab.listen();
console.warn(
  JSON.stringify({ service: SERVICE_NAME, port: collab.port(), msg: 'proceso collab escuchando' }),
);
