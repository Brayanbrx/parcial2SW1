# ADR-029 · Motores personales y «IA de VM» mediante conectores salientes

- **Estado:** implementada.
- **Fecha:** 2026-11-11.

## Decisión

Cada usuario puede heredar el motor del proyecto, usar los proveedores, elegir
su propio dispositivo con Ollama o usar **IA de VM**. Las políticas del proyecto
siguen gobernando permisos, pistas, revisión y aplicación de propuestas.

Los conectores mantienen WSS saliente con la API. La vinculación personal usa un
código aleatorio de un solo uso, de diez minutos, y credenciales de inferencia
almacenadas como hash, con caducidad y versión de sesión. La VM usa una clave de
servicio independiente. El operador concede acceso a cuentas verificadas con
`AI_VM_ALLOWED_EMAILS`.

La elección se congela al aceptar cada solicitud en `executionTarget` privado.
El feed solo añade el nombre público del motor. Ninguna tarea contiene tokens
ni autor elegido por el conector. La respuesta debe coincidir con el ID asignado
en la misma conexión; el servidor conserva validación de operaciones, actor,
snapshot y precondiciones antes de aplicar cambios.

El broker respeta la capacidad por dispositivo, además de los límites del worker.
Cancelar, revocar, reemplazar una conexión o agotar el timeout descarta la tarea
y sus resultados tardíos. Un motor personal o de VM no cae automáticamente a
los proveedores. Se conserva el respaldo previo para LOCAL del servidor.

El conector autónomo requiere Node 22.15 o posterior. En laptops llama a Ollama
en loopback. En la VM invoca `codex exec` con autenticación guardada, sin
configuración personal de herramientas, sandbox de lectura, herramientas de shell,
apps, hooks y agentes deshabilitados, directorio temporal vacío y salida JSON.
En la interfaz el único nombre del servicio es **IA de VM**.

## Límites

La inferencia de IA de VM utiliza el proveedor de la sesión instalada y necesita
Internet. La inferencia en el hardware de cada participante corresponde al motor
Ollama. El contexto y los resultados siguen pasando por el servidor de la app.

El broker tiene un único propietario por instancia API; varias réplicas requieren
coordinar conexiones y trabajos. El servicio de la VM no gestiona cuotas del
proveedor ni acredita acceso a un modelo solo por conectarse.

Guía de operación y pruebas: [IA personal y de VM](../../infra/IA-REMOTA.md).
