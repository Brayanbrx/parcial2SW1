# Android de gestión

Interfaz Material 3: login, CRUD por colección, búsqueda local, asistente con LiteRT-LM o GGUF, voz con Whisper local y cola de sincronización. Arquitectura UI/ViewModel → Repository → HTTP/SQLite. El contrato se genera desde el mismo snapshot que Spring Boot.

## Acceso sin internet desde la primera instalación

Cada APK incluye el modelo del diagrama y crea automáticamente la cuenta local **admin / admin**. Dejar desactivado **Conectar a un servidor** e iniciar sesión con esas credenciales, incluso en modo avión. No requiere backend ni un acceso previo con internet. Crear, consultar, editar y borrar registros funciona en SQLite; cerrar sesión y reiniciar conserva los datos. La semilla se crea una sola vez por instalación y almacena un verificador PBKDF2 con sal en el almacenamiento seguro.

La cuenta local guarda sus datos exclusivamente en este dispositivo. Para usar un backend, activar **Conectar a un servidor** e iniciar sesión allí. Los datos se guardan por separado y no se transfieren automáticamente entre modos.

### Docker funciona pero la app muestra modo local

Docker no cambia la cuenta elegida en el telefono. En Ajustes, cerrar sesion y activar **Conectar a un servidor**. Con USB, ejecutar `apk.bat usb --port=8082` desde la raiz del paquete y entrar con `http://127.0.0.1:8082`. En emulador usar `http://10.0.2.2:8082`; por Wi-Fi, la IP LAN de la PC y el puerto publicado. Confirmar el puerto con `docker compose port api 8080` dentro de backend/. Las credenciales son las de backend/.env. Para repararlo al reconectar el cable, deja ejecutandose `apk.bat usb --watch --device=SERIAL --port=8082` en la PC. El monitor solo actua sobre ese dispositivo y puerto; Ctrl+C lo detiene. No inicia Docker ni garantiza conexion si la PC esta apagada. El indicador de modo local no mide internet ni la disponibilidad de la IA local.

## Base reutilizable entre aplicaciones

En modo servidor, la app obtiene `/mobile-contract` del backend autenticado (protocolo 1). Colecciones, campos, claves, relaciones y título se adaptan a ese contrato y se conservan en la sesión para abrir sin internet. Cambiar de backend desde Ajustes → Cerrar sesión / cambiar cuenta. Cada servidor/cuenta/contrato mantiene su SQLite y cola separados; no se mezclan pendientes entre negocios. Antes de enviar la cola se verifica que el contrato siga siendo compatible. Si cambia, se conservan los pendientes y se bloquea el envío; restaurar la versión compatible para resolverlos. No hay migración automática entre contratos diferentes.

El backend debe generarse con el perfil **Android + backend** de esta versión. Un REST arbitrario o el ZIP Spring independiente necesita implementar `/session/login`, `/mobile-contract` y `/mobile-sync`; cambiar solamente la URL no adapta protocolos distintos. La flexibilidad cubre cualquier modelo aceptado por el generador y las operaciones CRUD del contrato, no reglas de negocio que no estén implementadas.

Solo el primer acceso en modo servidor requiere conexión para iniciar sesión y obtener el contrato. Después, tanto formularios como propuestas del agente escriben en SQLite y se sincronizan cuando la aplicación está abierta y el backend es accesible. Android no mantiene este proceso vivo con la app cerrada: al reabrir se retoma la cola. No se envía la instrucción sin interpretar para ejecutarla después; se guarda la operación validada y confirmada.

## Compilar e instalar el APK con una orden

Con Flutter instalado, desde la raíz del paquete (la carpeta que contiene `backend/` y `mobile/`):

| Orden | Qué hace |
| --- | --- |
| `apk.bat` / `sh apk.sh` | Crea el proyecto Android si falta, descarga dependencias, compila el APK de depuración ARM64 y lo copia a `mobile/dist/`. |
| `apk.bat install` | Lo anterior y además instala el APK y abre la app en el teléfono conectado por USB (adb). |
| `apk.bat run` | `flutter run` en el teléfono, con recarga en caliente. |
| `apk.bat deploy` | Con Docker Desktop iniciado: levanta backend y PostgreSQL, espera su salud, conecta por USB, compila, instala y abre la app. |
| `apk.bat backend` | Levanta solamente backend y PostgreSQL con Docker; conserva el `.env` existente. |
| `apk.bat run --usb` | Recarga en caliente con acceso al backend de la PC por USB. Inicia antes `apk.bat backend`. |
| `apk.bat usb` | Restablece el túnel al reconectar el cable, sin compilar. |
| `apk.bat usb --watch --device=SERIAL` | Mantiene la conexión USB y repara el túnel al volver a conectar ese teléfono. |
| `apk.bat install --skip-build` | Instala el APK debug ya generado en `mobile/dist/`, sin recompilar ni cambiar su configuración. |
| `apk.bat check` | Prepara Android, analiza el código y ejecuta las pruebas Flutter. |
| `apk.bat release` | APK de release con firma de depuración, para compartir el archivo. |
| `apk.bat devices` / `doctor` | Teléfonos detectados; estado de Flutter, adb y proyecto. |

En PowerShell anteponer `.\`: por ejemplo `.\apk.bat deploy`. En Linux/macOS sustituir `apk.bat` por `sh apk.sh` en todas las órdenes.

Opciones: `--api=https://servidor.example` fija la URL inicial del login, `--device=SERIAL` elige el teléfono, `--universal` compila todas las arquitecturas. Desde `mobile/` lo mismo es `dart tool/apk.dart ...`. En el teléfono: Opciones de desarrollador → Depuración USB, conectar el cable y aceptar el aviso. El script busca adb en el PATH, en `ANDROID_HOME` y en la ruta habitual del SDK de Android Studio.

`deploy` es autodespliegue **local** en la PC. Conecta mediante `adb reverse` al puerto publicado por Docker (8082 por defecto); no requiere compartir Wi-Fi ni abrir puertos del firewall. En el login activar **Conectar a un servidor** y usar `http://127.0.0.1:8082` y las credenciales de `backend/.env` (admin/admin si es nuevo). El modo local sigue siendo el predeterminado. `--port=9090` configura otro puerto para un backend nuevo; un `.env` existente conserva su puerto. Para `run --usb` o `usb`, pasar ese puerto explícitamente. Al quitar el cable se pierde el túnel: reconectar y ejecutar `apk.bat usb --port=8082`. `--usb` y `--api` son alternativas.

Para un backend remoto ya desplegado: `apk.bat install --api=https://tu-backend.example`. El backend incluye `railway.json` y Dockerfile; ver [despliegue remoto](docs/extension-and-deployment.md). El ZIP contiene código fuente y comandos; el APK aparece en `mobile/dist/` después de compilar en la PC.

## Preparación a mano

Flutter 3.44 / Dart 3.12 o compatible, Android SDK y NDK 29.0.13113456. Ejecutar `dart run tool/bootstrap.dart`, `flutter pub get`, `flutter analyze`, `flutter test`, `flutter run`. El bootstrap crea el armazón nativo Android con el SDK instalado sin reemplazar un proyecto Android existente. API mínima 26. Para generar APK: `flutter build apk --debug --target-platform android-arm64`. Para distribución usar firma release propia y backend HTTPS; el permiso HTTP está limitado a debug.

Arranque opcional del backend desde `mobile/`: `dart run tool/start_backend.dart 8082 5435`. Crea `../backend/.env` si falta, con administrador admin / admin y secretos aleatorios de base de datos y firma, y ejecuta Docker Compose. Si ya existe `.env`, conserva sus valores y puertos. Consultar allí AUTH_USERNAME/AUTH_PASSWORD. Con esos puertos, el emulador usa `http://10.0.2.2:8082`; en teléfono usar la IP LAN del equipo. No publicar `.env`.

El backend del paquete debe configurar AUTH_USERNAME, AUTH_PASSWORD y AUTH_TOKEN_SECRET. Es una cuenta administradora para una aplicación de gestión compartida, no un sistema multiempresa ni administración de usuarios. El token vence a los 15 minutos; volver a iniciar sesión renueva el acceso remoto. La sesión se guarda en el almacenamiento seguro del sistema; no se guarda la contraseña. La cuenta local permite iniciar sesión sin conexión desde la primera instalación. Los datos SQLite no están cifrados: dependen del aislamiento de Android y del bloqueo del dispositivo. Cerrar sesión conserva los datos/cola separados por servidor, cuenta y contrato.

## Offline

Para usar IA local y sincronizar despues, iniciar sesion **una vez en modo servidor**, con el backend accesible, y conservar esa sesion. En Asistente, seleccionar **Local** tanto en Origen del texto como en Origen de la voz e importar ambos modelos. Perder la conexion no cambia la cuenta: las propuestas confirmadas se guardan en SQLite y quedan pendientes. No cerrar sesion para trabajar offline; cerrar y volver a abrir la app conserva la sesion y la cola.

Por USB, internet publico no es necesario ni para Gemma/Whisper ni para sincronizar: Docker debe estar en marcha y `adb reverse` debe conectar el puerto del telefono al backend de la PC. Al perder el cable o el tunel, el movil sigue trabajando; al restablecerlo, con la app abierta, intenta sincronizar cada 30 segundos. Tambien lo intenta al volver al primer plano y con Sincronizar. Si la app esta cerrada, se retoma al abrirla. Recuperar Wi-Fi por si solo no repara un tunel USB. La cuenta **solo local** guarda un conjunto de datos separado y no se convierte automaticamente en una cuenta de servidor.

Texto: escribir la instruccion y pulsar Enviar. Voz: Dictar, Terminar dictado, revisar/corregir el texto y Enviar. El asistente puede consultar varias veces, preguntar y continuar con tu respuesta. Para crear, modificar o borrar, revisar las diferencias y pulsar Confirmar cambio. La transcripcion por si sola no guarda ni elimina registros. Sin conexion solo pueden consultarse los registros ya descargados o creados en el telefono. En Modelos y opciones sigue disponible el modo sencillo con Revisar propuesta.

Altas y cambios se guardan en una transacción SQLite antes del envío. En modo servidor, la sincronización se intenta cada 30 segundos, al volver al primer plano y manualmente. Reintentos conservan el mismo operationId y el servidor guarda un recibo en PostgreSQL. Antes del primer intento se pueden consolidar ediciones de un mismo registro; crear y luego borrar un registro aún no enviado cancela esa alta. Después del primer intento se exige sincronizar o resolver su conflicto antes de editarlo otra vez, porque el servidor podría haber aplicado una solicitud cuya respuesta se perdió. La migración de colas antiguas las trata como ya intentadas.

Las claves UUID se generan en el móvil; las numéricas/textuales las introduce el usuario. Las relaciones requieren IDs existentes: crear primero el padre. Colisiones o discrepancias con los datos originales se presentan como conflictos y frenan la cola. Se permite aceptar explícitamente la versión del servidor y volver a editar. La descarga completa de cada colección conserva cambios locales pendientes y elimina registros remotos borrados; no implementa sincronización incremental para grandes volúmenes.

El backend compara el DTO original con el actual antes de editar/borrar y usa bloqueo de fila, versión JPA y recibos transaccionales. No es un merge automático de negocio; una modificación que vuelve exactamente al mismo contenido puede no distinguirse de la versión original. Los recibos deben mantenerse mientras puedan llegar reintentos de dispositivos offline; diseñar su retención antes de un despliegue prolongado.

## Modelos locales de texto y voz

En Asistente, importar archivos `.litertlm` o `.gguf` para texto y Whisper GGML `.bin` para voz. Las listas Modelo de texto y Modelo de voz permiten cambiar entre varios archivos conservados en el dispositivo. La selección, CPU/GPU de LiteRT-LM, plantilla GGUF e idioma de Whisper persisten. No se incluyen pesos ni se descargan automáticamente. Ver [configuración, prompts y comparación](docs/local-models.md).

LiteRT-LM utiliza la plantilla propia del modelo; GGUF requiere elegir la indicada por su distribucion (por ejemplo `gemma`). El asistente con herramientas conserva el motor entre pasadas y mensajes, y lo libera tras 60 segundos de inactividad o antes de usar Whisper. `AssistantRunner`, `AssistantRuntime` y `LocalTextEngine` separan conversacion, ciclo de vida y runtime. La app genera UUID antes de mostrar una alta. Sin pesos siguen disponibles los CRUD manuales.

El agente recibe el catalogo de recursos y puede consultar campos, buscar registros, leer detalles, calcular agregados y preparar un cambio. Guarda memoria de la conversacion durante la sesion y trata las aclaraciones como preguntas. Valida herramientas, tipos y registros; exige confirmacion antes de guardar. No ejecuta SQL ni llamadas arbitrarias. LiteRT puede usar function calling nativo tras Probar herramientas nativas; GGUF y el modo JSON usan el mismo ciclo controlado por la app. Whisper transcribe español localmente; el texto se revisa antes de enviarlo. Ver [limites y banco de evaluacion](docs/assistant-evaluation.md).

Los campos opcionales (`nullable: true`) omitidos en un alta se guardan como `null`. Solo se piden los obligatorios del contrato: si Cliente tiene id Integer obligatorio y nombre/telefono opcionales, «Crea un cliente con id 1 llamado Ana» deja telefono vacio. Las claves numericas no se inventan; las UUID se generan en la app. Para hacer opcional otro campo, desmarcar Obligatorio en el diagrama y regenerar un contrato compatible en movil y backend.

LiteRT carga, genera y libera el modelo en un isolate separado para mantener la pantalla disponible durante las llamadas nativas. El asistente admite hasta 8 pasadas y 240 segundos por solicitud; cada carga/inferencia tiene hasta 120 segundos. La transcripcion y el modo sencillo conservan su limite de 120 segundos. Cancelar solicitud responde sin liberar prematuramente el bloqueo de una llamada nativa pendiente. Estas mejoras requieren regenerar y recompilar el APK; levantar Docker no actualiza el codigo instalado.

Si LiteRT no termina de cargar con GPU, cerrar y volver a abrir la app y seleccionar **CPU** en Asistente antes de reintentar. En la prueba con POCO X6 Pro y `gemma-4-E2B-it.litertlm`, GPU agoto los 120 segundos; CPU completo las propuestas de alta, consulta y edicion en aproximadamente 44–76 segundos. `ggml-small-q5_1.bin` tardo unos 58 segundos por dictado de prueba. Son mediciones de ese equipo y esos archivos, no tiempos garantizados; voz requiere primero transcribir y despues interpretar el texto.

## IA en línea (opcional)

En Asistente, **Origen del texto** y **Origen de la voz** eligen entre el modelo local importado y la IA en línea. La IA en línea usa los mismos proveedores y nombres de variable que `infra/.env` del generador, para copiar y pegar la configuración:

- **Al compilar:** copiar `mobile/ai.env.example` a `mobile/ai.env`, pegar `AI_LLM_PROVIDER`, `AI_LLM_MODEL`, `AI_SPEECH_PROVIDER`, `AI_SPEECH_MODEL` y las `*_API_KEY` que uses, y ejecutar `apk.bat`. El script lo incrusta con `--dart-define-from-file`. `ai.env` está en `.gitignore`. Una clave dentro del APK se puede extraer: es para tu teléfono, no para distribuir.
- **En la app:** Asistente → IA en línea, pegar proveedor, modelo y clave y guardar. Se guarda en el almacenamiento seguro del teléfono y manda sobre lo compilado.

Texto: gemini, openrouter, groq, anthropic, mistral, zai, moonshot y sambanova (endpoint compatible con OpenAI o el API de Anthropic, con modo JSON). Voz: groq o mistral por `/audio/transcriptions`. La app llama al proveedor directamente con tu clave, no a través del backend Spring, y sigue validando cada propuesta y pidiendo confirmación. Sin internet, volver al modo local.

## Pruebas y límites

`flutter test` verifica repositorio y validación con SQLite y HTTP simulados. Probar en Android físico: cargar modelo, modo avión, alta por texto/voz, cierre y reapertura, reconexión, conflictos y consumo de memoria. Compilar no acredita que un GGUF concreto funcione en todos los teléfonos.

Motores locales: llama_flutter_android 0.2.6, litertlm 0.0.13 (runtime 0.15.0) y whisper_ggml 2.6.0. El modo local no necesita ninguna clave. La IA en línea es opcional y usa tu propia clave. La lectura directa de OpenAPI sigue fuera: se mantiene `/mobile-contract`.
