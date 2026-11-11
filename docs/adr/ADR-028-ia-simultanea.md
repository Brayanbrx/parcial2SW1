# ADR-028 · Solicitudes de IA simultáneas en una misma pizarra

- **Estado:** implementada.
- **Fecha:** 2026-11-10.

## Contexto

El requisito 3 pide que la IA colabore simultáneamente con varios desarrolladores.
El worker anterior procesaba una sola solicitud por pizarra. Aunque las personas
podían editar juntas y enviar solicitudes, una inferencia lenta retenía las demás.

## Decisión

- El worker permite inferencias simultáneas en una misma pizarra. El límite
  `TEAM_AI_BOARD_CONCURRENCY` es 3 por defecto (1–32), y
  `TEAM_AI_MAX_CONCURRENCY` limita el total por instancia de la API a 6 (1–64).
  Ambos límites se aplican a la vez. Los límites existentes de solicitudes
  pendientes por usuario y pizarra siguen incluyendo QUEUED y PROCESSING.
- La reclamación del siguiente trabajo conserva el orden FIFO por pizarra.
  Las pizarras pendientes se turnan al asignar lugares disponibles. Una
  respuesta puede terminar antes que otra que empezó primero.
- La inferencia ocurre fuera de las transacciones. Los bloqueos breves de
  PostgreSQL siguen protegiendo las reclamaciones, permisos, marcas de tiempo
  y publicación; no serializan las llamadas al modelo.
- La recuperación distingue los IDs activos del worker de los PROCESSING
  huérfanos. Un fallo al persistir no vuelve a ejecutar el proveedor ni
  interrumpe las otras inferencias. Reiniciar sigue marcando los trabajos
  pendientes como INTERRUPTED. Se mantiene el diseño de un solo worker API;
  esto no habilita varias réplicas de la API con consumidores independientes.
- Cada solicitud conserva su timeout, cancelación, autor y snapshot. Las
  respuestas mantienen replyToId y addressedToId. Las propuestas conservan
  batchId, actorId y expectedSemantic; la aplicación sigue verificando las
  precondiciones y detectando STALE antes de modificar el documento compartido.
- El estado del panel y de la presencia de IA muestra todos los destinatarios
  activos y el número de solicitudes en paralelo, además de las que esperan.

## Alcance local y despliegue

El mismo worker usa el motor elegido por el proyecto, sea local o proveedor.
La plataforma puede mantener varias llamadas al motor local en vuelo; la
cantidad de inferencias que realmente ejecuta a la vez depende de su servidor,
modelo y hardware. Estos límites no configuran Ollama ni reservan VRAM.

No se implementa todavía un conector entre la web desplegada y el modelo de la
laptop. Sigue vigente la conectividad descrita en ADR-027. Para activar esta
ampliación en un despliegue existente hay que reconstruir y recrear API y web.

## Verificación

Las pruebas de cola cubren límites por pizarra y global, reparto entre pizarras,
finalización fuera de orden, cancelación y timeout independientes, notificaciones
durante reclamaciones, fallos de persistencia y cierre con reclamación en curso.

La integración usa API y PostgreSQL reales con un procesador controlado para
mantener varias solicitudes abiertas: dos desarrolladores reciben sus respuestas
en otro orden, las instrucciones conservan snapshots y lotes distintos, un
PROCESSING huérfano se recupera sin interrumpir los activos, y siguen comprobándose
permisos, políticas, cancelación, expiración y reinicio. Las propuestas se generan
con el puerto mock real. No mide rendimiento de un modelo local ni de la nube.

Validación del cambio: 131 pruebas aprobadas de cola, contexto, adaptadores,
modelo local, feed y ejecución de propuestas; 105 integraciones aprobadas de
API, worker, contexto y transporte WebSocket (15 del worker). ESLint y formato
correctos en los archivos de código modificados; `npm run typecheck` aprobado
para todo el proyecto y las pruebas; compilación de producción web aprobada.
La prueba de recarga del transporte ahora distingue el historial compartido de
la línea base inicial propia de cada pestaña.

```powershell
npx vitest run backend/api/tests/team-ai-queue.test.ts
npx vitest run --config config/vitest.integration.config.ts backend/api/tests/integration/team-ai-worker.integration.test.ts
```
