# Base común, pantallas específicas y despliegue

## Qué se adapta sin recompilar

Login local admin / admin sin internet desde la primera instalación, login opcional por URL de backend, contrato de datos, colecciones, formularios CRUD, claves, relaciones como IDs, cola offline y agente local constituyen la base común. La cuenta local usa el contrato incluido en el APK. En modo servidor, `/mobile-contract` proporciona el modelo al iniciar sesión. Ambos modos mantienen sus datos separados. Cerrar sesión permite conectar otro backend compatible; cada servidor/cuenta/contrato conserva sus datos separados.

El perfil **Android + backend** incluye `/session/login`, `/mobile-contract` y `/mobile-sync`. El ZIP Spring independiente no incluye ese perfil. Un backend Spring escrito por separado puede conectarse si implementa esos endpoints y el mismo protocolo; la base Flutter no interpreta automáticamente cualquier API REST.

Los formularios genéricos aparecen según el contrato. Pantallas especializadas (agenda, caja, compras, inventario) se añaden al código Flutter y requieren compilar de nuevo. Su comportamiento de negocio no se infiere del diagrama.

## Añadir una pantalla propia

Crear un widget en `lib/ui/features/` y registrarlo en `lib/ui/custom_pages.dart`. El menú de la barra superior muestra solo las pantallas cuyos recursos existen en el backend conectado. Ejemplo, para un backend con recurso `clientes`:

```dart
final List<AppPage> customPages = [
  AppPage(
    id: 'clientes-resumen',
    title: 'Resumen de clientes',
    resources: {'clientes'},
    builder: (context, model) => Scaffold(
      appBar: AppBar(title: const Text('Resumen de clientes')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: model.repository!.local.rows('clientes'),
        builder: (context, snapshot) {
          if (snapshot.hasError) return const Text('No se pudo leer la lista local');
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          return Center(child: Text('${snapshot.data!.length} clientes guardados'));
        },
      ),
    ),
  ),
];
```

Para escribir usar `model.save(resource, dto, create: true/false, expected: original)` y `model.delete(resource, id, expected: original)`. `resource` se obtiene con `model.schema.resource('clientes')`. Leer los datos mediante el repositorio local; llamar HTTP directamente desde una pantalla evita la cola y rompe su funcionamiento offline. Para flujos complejos añadir un ViewModel/caso de uso que componga el repositorio y reglas del backend. Varias llamadas CRUD no constituyen una transacción de negocio conjunta.

## Desarrollo local

Vía corta, desde la raíz del paquete: `apk.bat install` (Windows) o `sh apk.sh install` compila e instala en el teléfono por USB; `apk.bat run` abre `flutter run` con recarga en caliente; `--api=http://IP:8082` fija la URL inicial del backend. A mano, desde `mobile/`:

```sh
dart run tool/start_backend.dart 8082 5435
dart run tool/bootstrap.dart
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8082
```

El primer comando es opcional para el modo local. Requiere Docker y crea `backend/.env` con administrador admin / admin y secretos aleatorios de base de datos y firma si no existe. Consultar AUTH_USERNAME/AUTH_PASSWORD allí. Si ya existe, se conservan sus puertos y valores. Un teléfono físico usa la IP LAN del equipo, no `10.0.2.2` ni `localhost`. Si un firewall bloquea el puerto de la API, habilitarlo solo en la red de desarrollo necesaria.

## Desplegar rápido con Railway

El backend incluye Dockerfile y `railway.json` (Docker + healthcheck). Subir el código generado a un repositorio propio, sin `.env`, credenciales, bases locales ni pesos GGUF. Crear un servicio desde ese repositorio, con raíz `backend` si se subió el ZIP completo; si se subió solamente el contenido de `backend`, usar la raíz del repositorio. Si Railway no detecta la configuración en un monorepo, indicar `/backend/railway.json` como archivo de configuración del servicio.

Añadir PostgreSQL al mismo proyecto y configurar en el servicio Spring:

| Variable | Valor |
| --- | --- |
| DATABASE_URL | `jdbc:postgresql://HOST_PRIVADO:5432/BASE` (no copiar directamente una URL `postgresql://usuario:clave@...`) |
| DB_USER | Usuario del servicio PostgreSQL |
| DB_PASSWORD | Contraseña del servicio PostgreSQL |
| AUTH_USERNAME | Administrador elegido |
| AUTH_PASSWORD | Contraseña propia, 12 caracteres mínimo y 72 bytes máximo |
| AUTH_TOKEN_SECRET | Secreto aleatorio de al menos 32 caracteres |
| CORS_ALLOWED_ORIGINS | Vacío para Android; orígenes exactos separados por comas si hay frontend web |

Usar referencias de variables del servicio PostgreSQL para no duplicar credenciales. Spring ya lee `PORT`; Railway puede asignarlo. Habilitar un dominio público para la API y comprobar `https://TU-DOMINIO/actuator/health`. PostgreSQL debe permanecer en red privada. Usar la URL HTTPS pública en el login Flutter. Revisar el costo del servicio elegido antes de crearlo.

Render también admite el Dockerfile: crear PostgreSQL y un Web Service Docker, configurar las mismas variables, raíz del backend y healthcheck. Un VPS con Docker Compose sigue siendo otra opción, pero requiere configurar dominio y proxy HTTPS.

## CORS, HTTPS y distribución Android

CORS es una restricción del navegador. Android nativo y Postman no necesitan permisos CORS. Para un cliente web propio, por ejemplo:

```env
CORS_ALLOWED_ORIGINS=https://gestion.ejemplo.com,http://localhost:5173
```

Indicar el origen del frontend (protocolo, host y puerto), sin rutas ni comodines. El perfil móvil habilita preflight para CRUD, login, contrato y sincronización, con Content-Type/Authorization. No confundir CORS con autenticación: las rutas de datos continúan requiriendo Bearer token. Esto permite clientes web del backend; el motor GGUF generado sigue destinado a Android.

El APK debug admite HTTP para desarrollo. `apk.bat release` produce un APK de release con la firma de depuración, suficiente para instalar por USB o compartir el archivo. Para distribución usar HTTPS, configurar una clave de firma propia en Android y construir APK release o AAB; no guardar contraseñas de firma en Git ni claves de IA en el APK que se distribuye. Subir el backend y distribuir el APK son dos procesos separados. Cambiar solo la URL del backend no exige recompilar porque se introduce en login; cambiar pantallas o permisos nativos sí. No se realiza una publicación externa automáticamente desde el generador.

El esquema JPA usa `ddl-auto=update` para facilitar prototipos. Antes de mantener datos reales con cambios de esquema, preparar migraciones versionadas y copias de seguridad. El perfil de login es un administrador compartido; roles, registro y recuperación de cuenta deben añadirse según la aplicación.

Referencias: [Railway Docker](https://docs.railway.com/guides/docker-compose), [Railway configuración](https://docs.railway.com/config-as-code/reference), [Railway red pública](https://docs.railway.com/networking/public-networking), [Render Docker](https://render.com/docs/docker), [Spring CORS](https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html).
