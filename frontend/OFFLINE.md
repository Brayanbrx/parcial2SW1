# Uso del editor web sin conexión

El editor permite abrir y recargar pizarras visitadas previamente, continuar editando y sincronizar con Yjs al recuperar conexión. La aplicación Flutter generada mantiene su mecanismo independiente de SQLite y cola de operaciones.

## Uso

1. Abre la versión compilada de la web mediante HTTPS o `http://localhost`. Inicia sesión con conexión.
2. Abre cada pizarra que quieras usar offline y espera el indicador **Disponible sin conexión**. Este aparece cuando tanto la interfaz como la copia de la pizarra están guardadas.
3. Puedes desconectarte, editar, recargar la página o cerrar y volver a abrir la pestaña en el mismo navegador. **Ver pizarras guardadas** permite navegar entre las copias de esa cuenta.
4. Al reconectar se renueva la sesión, se consulta el acceso actual y después se recuperan los borradores sobre el documento del servidor. También se reintenta cada cinco segundos cuando el navegador indica conectividad, y al volver a enfocar la ventana.

Si la sesión ya no es válida, inicia sesión con la misma cuenta para recuperar los pendientes. Si el permiso cambió a lector, se abre el documento del servidor sin enviar el borrador y la entrada offline pasa a solo lectura. Solo la revocación del acceso a la pizarra retira su entrada; que caduque el token de acceso, que ocurre cada quince minutos con una pizarra abierta, no la toca. Los borradores se conservan para una recuperación posterior si se vuelve a autorizar la edición.

Si la renovación del token falla por red o por un error temporal del servidor, el editor pasa a la copia local y reintenta sin exigir una recarga, incluso si el navegador sigue indicando conexión. El permiso de lectura se guarda al autenticar, antes de completar la sincronización.

Si la sesión se recupera pero el servicio de pizarras sigue sin responder, la copia local continúa editable y se reintenta la consulta. Un error de permisos no activa este respaldo. El indicador de disponibilidad se retira si falla el guardado de la instantánea, y el contador de cambios por auditar usa la cuenta local incluso después de recargar sin red.

Si el servidor restablece el permiso de edición mientras la pizarra sigue abierta como lector, los borradores se recuperan automáticamente sobre el documento sincronizado, sin necesitar una recarga.

## Límites

- El primer inicio de sesión y las pizarras nunca visitadas necesitan conexión. Crear proyectos, gestionar miembros, el asistente, importar mediante el servidor, exportar XMI y generar código también la requieren. La exportación PNG se realiza en el navegador.
- La caché de la interfaz se genera con `npm run build --workspace @uml/web`. El servidor de desarrollo Vite no instala un service worker. En HTTP sobre una IP de la red local el navegador no permite instalarlo: usa HTTPS o localhost. Véase [la documentación del navegador](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- Los datos se guardan por origen, cuenta y pizarra, en este navegador. Borrar sus datos, cambiar de navegador o usar una sesión privada que se cierre puede eliminar las copias. No sustituyen una copia de seguridad.
- Se conserva el almacenamiento local del editor existente (`localStorage`). Si se agota la cuota, no se acepta una edición que no pueda guardarse; se muestra un aviso. La actualización de la copia para apertura offline también informa sus errores.
- Los permisos guardados permiten editar únicamente la copia local mientras no hay red. Los permisos vigentes del servidor siguen controlando las escrituras remotas. Una revocación desconocida no puede detectarse sin conexión.
- La sincronización necesita la aplicación abierta. No se ejecuta un proceso de sincronización con todas las pestañas cerradas.

## Implementación

El service worker precarga únicamente los archivos estáticos de una compilación completa, incluidos los módulos diferidos del editor y las fuentes. No intercepta la API ni WebSocket. Cada compilación tiene su propia caché; una actualización espera a que se cierren las pestañas de la versión anterior antes de activarse.

La identidad recordada contiene únicamente ID, correo y nombre. Los tokens de acceso siguen en memoria y el refresh token en su cookie HTTP-only. Salir borra la identidad recordada y, si no se pudo contactar al servidor, deja pendiente la revocación para impedir que una recarga restaure la sesión cerrada. Los cambios pendientes permanecen separados por cuenta.

Inicio de sesión, cierre y renovación comparten un bloqueo del navegador para evitar que una respuesta pendiente de otra pestaña sobrescriba la cookie de una sesión nueva.

Las instantáneas permiten abrir también documentos vacíos o visitados solo como lector. Se reescriben cuando la pizarra deja de recibir cambios durante un segundo, al ocultar la pestaña y al cerrarla, en lugar de en cada actualización del documento. Los borradores guardan los cambios antes de aplicarlos. Al reconectar se crea otra réplica de Yjs: no se conecta la réplica offline antes de verificar permisos; solo se mezclan borradores después de autenticación con escritura y sincronización inicial. El cambio de réplica no remonta el editor: la conversación del asistente y el candidato de importación en curso sobreviven a un corte de red.

Quedarse sin conexión se confirma antes de pasar a la copia local: el evento del navegador también se dispara al cambiar de red. El editor marca «Sin conexión» de inmediato por su cuenta y sigue guardando cada cambio. Las otras páginas permanecen montadas incluso durante cortes prolongados y muestran un aviso; los formularios conservan lo escrito al reconectar. El enlace **Ver pizarras guardadas** abre el catálogo en `/sin-conexion` sin sustituir automáticamente la página actual.

Abrir una copia local no escribe ni unifica las ranuras de borrador, aunque haya varias o no quede cuota. Cada editor conserva su ranura al reintentar la conexión; las ranuras se unifican al restaurarlas en una conexión autorizada.

## Verificación

`npm run test:offline` compila la versión de producción y ejecuta Chromium contra un servidor Hocuspocus real y una API de prueba aislada, sin Docker ni PostgreSQL. Cubre recarga y reapertura sin red, cambios concurrentes, pizarras no visitadas, lectores, permisos retirados, cierre de sesión, recuperación de una sesión vencida, caducidad del token de acceso con renovación fallida y un parpadeo de red con trabajo abierto en los paneles. No sustituye `npm run test:e2e`, que verifica el backend completo con PostgreSQL.

Las pruebas unitarias de `frontend/tests/board-drafts.test.ts`, `offline.test.ts` y `api.test.ts` cubren persistencia, separación de cuentas, corrupción, falta de almacenamiento y renovación de sesión.
