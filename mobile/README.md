# UML Forge móvil

App Flutter de **uso de emergencia** para cuando no hay computadora a mano.
Consume el mismo backend que la web (`/api`). Hace lo esencial:

- Iniciar sesión (la sesión se conserva; renueva el acceso sola).
- Ver proyectos, sus pizarras y miembros; crear proyectos y pizarras.
- Editar tablas: crear, renombrar, eliminar, agregar/editar/eliminar campos y
  gestionar relaciones. Los cambios se ven al instante en la web de quien tenga
  la pizarra abierta.
- Pestaña **Actividad** con quién cambió qué.
- **Notificaciones push**: «Alejandro agregó el campo email a la tabla Cliente».

Estructura (igual que `frontend/src`): `lib/features/{auth,projects,editor}` y
`lib/core` (cliente HTTP, tema, push).

## Cómo se edita desde el móvil

El editor web sincroniza con Yjs por WebSocket. La app no habla ese protocolo:
envía un lote de comandos a `POST /api/boards/:id/commands`; el servidor lo
valida con las mismas reglas del editor y lo escribe en la sala colaborativa.
Requiere que el servidor tenga `COLLAB_INTERNAL_SECRET` configurado.

## Compilar el APK

```bash
cd mobile
flutter pub get
flutter build apk --release
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. Cópialo al
teléfono y ábrelo (permite «instalar apps de orígenes desconocidos»).

El servidor por defecto es `https://uml.asiscarretera.online`. Cámbialo desde la
pantalla de acceso («Cambiar servidor») o al compilar:

```bash
flutter build apk --release --dart-define=SERVER_URL=https://tu-servidor
```

## Activar las notificaciones push (una sola vez)

Las push usan Firebase Cloud Messaging (gratis). Sin esto la app funciona igual,
solo sin avisos.

1. En <https://console.firebase.google.com> crea un proyecto.
2. Añade una app **Android** con el paquete `uml2.a5` y descarga
   `google-services.json`. Colócalo en `mobile/android/app/google-services.json`
   (está en `.gitignore`).
3. En _Configuración del proyecto → Cuentas de servicio → Generar nueva clave
   privada_ descarga el JSON de la cuenta de servicio.
4. En el servidor, define `FIREBASE_SERVICE_ACCOUNT_JSON` en el `.env` con ese
   JSON (en una línea o en base64: `base64 -w0 cuenta.json`) y reinicia `api`.
5. Recompila el APK con `flutter build apk --release`.

El servidor avisa a los **demás** miembros del proyecto (no a quien edita) cuando
alguien cambia tablas, campos o relaciones, tanto desde la web como desde el
móvil. Mover tarjetas en el lienzo no avisa, y se agrupan los avisos de la misma
persona en la misma pizarra (uno cada 20 s).

## Desplegar el backend actualizado

Hay cambios en el backend (migración nueva `notificaciones_push`, rutas
`/devices` y `/boards/:id/commands`, y `/internal/apply` en collab). Hay que
reconstruir y desplegar `api` y `collab` (la migración se aplica con el flujo
habitual de `migrate`).
