# IA personal y «IA de VM»

Cada cuenta elige **Asistente → Mi motor de IA**. Puede heredar la configuración
del proyecto, utilizar proveedores, conectar su computadora o seleccionar
**IA de VM**. Las políticas OWNER y los permisos del proyecto siguen vigentes.
La selección se congela en cada solicitud aceptada: cambiarla afecta solicitudes
nuevas. Las opciones personales y de VM no recurren a otro motor automáticamente.

## Computadora de cada participante

1. Instalar Node.js 22.15 o posterior y Ollama con un modelo descargado localmente.
2. En la web, abrir **Mi motor de IA → Vincular mi computadora**, descargar el
   conector y generar el código de un solo uso (vence en diez minutos).
3. Ejecutar `node ai-connector.mjs --pair`. Introducir el origen HTTPS de la web
   y el código. Para pruebas se admite HTTP únicamente en localhost.
4. Volver a la web, elegir el modelo de la computadora en **Motor y modelo**
   y pulsar **Guardar motor**. El selector se actualiza mientras está abierto.

En usos posteriores basta `node ai-connector.mjs`. Las credenciales limitadas del
dispositivo se guardan en `~/.umlforge-ai/device.json`, vencen a los 90 días y
pueden revocarse desde la web. Un cambio de versión de sesión también las invalida.
El conector usa Ollama en `127.0.0.1:11434`, sin publicar ese puerto en Internet.
Para refrescar el catálogo tras instalar modelos, reiniciar el conector.

`UML_AI_CONTEXT_WINDOW` limita el contexto de entrada anunciado (16384 por defecto)
y configura `num_ctx` de Ollama. Se reserva para la salida hasta una cuarta parte
de esa ventana, con un máximo de 4096 tokens; ajustar la ventana según el
modelo y memoria disponibles. `UML_AI_CONCURRENCY` limita inferencias por dispositivo
(1 por defecto, 1–4). Los límites global y por pizarra del worker también se aplican.
Por defecto, cada ejecución en **Mi computadora** tiene cinco minutos desde que
el conector la recibe. La espera de turno tiene otro plazo de hasta cinco minutos.
Ambos se ajustan con `TEAM_AI_DEVICE_TIMEOUT_MS`. **Cancelar solicitud** detiene
el trabajo en curso o lo retira de la cola y conserva el texto para reenviarlo.

## IA de VM con la sesión instalada

El conector de la VM usa el ejecutable Codex ya autenticado bajo el mismo usuario
Linux. En toda la interfaz aparece **IA de VM**. Este motor ejecuta el cliente en
la VM y realiza la inferencia mediante el proveedor de esa sesión; necesita
Internet. La inferencia con hardware propio corresponde a Ollama en cada laptop.

1. Desplegar esta versión de API y web y aplicar las migraciones con el mecanismo
   habitual (`prisma migrate deploy`). No cambiar imágenes sobre una base sin migrar.
2. Generar un secreto aleatorio de al menos 48 caracteres, por ejemplo con
   `openssl rand -hex 32`. Guardarlo como `AI_VM_CONNECTOR_TOKEN` en el archivo de
   entorno privado de la API. Añadir los correos de las cuentas verificadas con
   acceso a `AI_VM_ALLOWED_EMAILS`, separados por comas, y recrear el servicio API.
3. Como el usuario que ya inició sesión en la VM, ejecutar:

   ```bash
   bash scripts/preparar-ia-vm.sh
   ```

   Prepara Node 22.15 si falta (descarga oficial verificada con SHA-256) y el
   servicio systemd de usuario. No arranca el servicio ni cambia el despliegue.

4. Completar `~/.config/umlforge-ai/vm.env` con:

   ```dotenv
   UML_AI_SERVER=https://tu-dominio
   UML_AI_VM_TOKEN=el-mismo-secreto-privado-de-la-API
   UML_AI_VM_MODEL=modelo-disponible-en-tu-sesion
   UML_AI_VM_EXECUTABLE=/home/azureuser/.local/bin/codex
   UML_AI_CONTEXT_WINDOW=32768
   UML_AI_CONCURRENCY=1
   ```

   Elegir un modelo disponible para esa cuenta. La prueba del 11/11/2026 en la VM
   Azure confirmó CLI 0.167.1 autenticada y una respuesta con su modelo
   predeterminado `gpt-6.1-sol`. No se copian tokens de la cuenta a la API.

5. Arrancar y comprobar:

   ```bash
   systemctl --user enable --now uml-ia-vm.service
   systemctl --user status uml-ia-vm.service
   journalctl --user -u uml-ia-vm.service -n 30
   sudo loginctl enable-linger "$USER"
   ```

6. En la web elegir **IA de VM** y el modelo anunciado. Una prueba real desde
   la aplicación confirma acceso al modelo; estar conectado no acredita cuotas
   ni disponibilidad de inferencia en el proveedor.

Las ejecuciones usan `codex exec`, reutilizan la autenticación guardada, ignoran
configuración personal de herramientas, deshabilitan shell, apps, hooks y agentes,
usan un directorio temporal vacío con sandbox de lectura y sesiones efímeras.
El texto entra por stdin; se solicita una salida estructurada. El servidor valida
las operaciones antes de crear propuestas. El conector no aplica cambios al
documento colaborativo ni modifica el repositorio.

Referencia oficial: [modo no interactivo y autenticación guardada](https://learn.chatgpt.com/docs/non-interactive-mode).

## Transporte y operación

Los conectores abren WSS hacia `/api/ai-devices/connect`, autenticándose en el
primer mensaje. Nunca hay tokens en la URL. Caddy admite el upgrade; nginx y
Vite reenvían la conexión de `/api`. No se necesitan conexiones entrantes a las
laptops. La API guarda hashes de códigos y credenciales personales. La clave de
la VM solo autoriza inferencia en el canal VM, no acceso a la API de usuarios.

Hay una conexión activa por dispositivo y una para la VM por instancia de API.
Reconectar reemplaza la anterior y falla sus tareas pendientes; no se repiten
automáticamente. Heartbeat, cancelación y timeout descartan resultados tardíos.
Los mensajes conservan autor, destinatario y snapshot, y muestran el motor usado.
El diagrama, contexto y respuestas siguen pasando por el servidor compartido.

Se mantiene el despliegue de una sola instancia API. Escalar a varias réplicas
requiere coordinar la propiedad de las conexiones y los trabajos.

## Verificación

```bash
npm run typecheck
npm run test:connector
npx vitest run shared/contracts/tests/ai-devices.test.ts shared/ai/tests/connector.test.ts
npx vitest run --config config/vitest.integration.config.ts backend/api/tests/integration/ai-devices.integration.test.ts
npm run build --workspace @uml/web
npx playwright test --config e2e/offline/playwright.config.ts e2e/offline/personal-ai.spec.ts
```

La integración usa API, PostgreSQL y WebSocket reales con inferencia controlada.
La prueba del navegador verifica selección y persistencia personal con API
sustituida, nombre «IA de VM», estados de conexión y tamaños de pantalla.
