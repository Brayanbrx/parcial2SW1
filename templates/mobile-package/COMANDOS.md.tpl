# APK y autodespliegue

Abrir PowerShell en esta carpeta después de extraer el ZIP. Requisitos: Flutter en PATH y Android SDK. Para el backend local, iniciar Docker Desktop. En Linux/macOS sustituir `.\apk.bat` por `sh apk.sh`.

```powershell
# Comprobar el entorno y ver el celular conectado.
.\apk.bat doctor
.\apk.bat devices

# Crear el APK instalable (Android 8+, ARM64).
.\apk.bat build

# Instalar el APK ya compilado y abrirlo.
.\apk.bat install --skip-build

# Autodespliegue local completo: backend + PostgreSQL + USB + APK.
.\apk.bat deploy

# Probar con recarga en caliente (r); backend previamente iniciado.
.\apk.bat run --usb

# Comprobar código y pruebas Flutter.
.\apk.bat check
```

El APK se guarda en `mobile/dist/`. Para instalar sin PC, copiar ese archivo al teléfono y abrirlo. Para instalar por USB, activar **Opciones de desarrollador → Depuración USB** y aceptar la autorización RSA en el celular. Si aparecen varios dispositivos, agregar `--device=SERIAL` a la orden. `install` compila antes de instalar; `install --skip-build` reutiliza el archivo actual.

La app permite login y CRUD local con **admin / admin**, sin internet. Para usar el backend de la PC después de `deploy`, activar **Conectar a un servidor**: la URL inicial será `http://127.0.0.1:8082` (o el puerto real de Docker) y las credenciales son las de `backend/.env`. No se transfieren automáticamente los registros entre modo local y servidor.

```powershell
# Levantar solo el servidor; conserva .env si ya existe.
.\apk.bat backend

# Reconectar el acceso USB después de quitar el cable, sin recompilar.
.\apk.bat usb --port=8082

# Backend nuevo en otro puerto; el .env existente tiene prioridad.
.\apk.bat backend --port=9090
.\apk.bat run --usb --port=9090

# Usar un backend remoto ya desplegado.
.\apk.bat install --api=https://tu-backend.example

# Ver registros o detener el backend local (conserva los datos).
docker compose --project-directory backend logs --tail=100 api
docker compose --project-directory backend stop
```

`deploy` instala en el teléfono y levanta el servidor en esta PC; la publicación remota se explica en `mobile/docs/extension-and-deployment.md`. El APK debug es para instalación y pruebas. `release` usa la firma configurada en Android (inicialmente la firma debug); publicar requiere firma propia y backend HTTPS.

La conexión USB usa [ADB reverse](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server) y el flujo de compilación sigue la [documentación Android de Flutter](https://docs.flutter.dev/deployment/android).
