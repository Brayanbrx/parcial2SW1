# Despliegue de uml.asiscarretera.online

Destino preparado: **https://uml.asiscarretera.online**, VM **35.255.28.222**.
El registro A público fue comprobado el 18 de septiembre de 2026.

## Configuración entregada

Respaldos IA y resultados de pruebas reales: [AI-BACKUPS.md](AI-BACKUPS.md). Usa el archivo privado actualizado; incluye NVIDIA para texto y Cohere Command A+ para imágenes en el perfil de demostración.

- `infra/google-cloud.env.example`: plantilla pública, sin credenciales.
- `output/google-cloud/production.env`: archivo privado preparado en este equipo. Está excluido de Git y del contexto Docker; no aparecerá al clonar el repositorio. Contiene la clave Brevo y las configuraciones/credenciales IA de `infra/.env`, con contraseñas nuevas para PostgreSQL y JWT de esta VM. No reemplaza la configuración local.
- `DOMAIN=uml.asiscarretera.online` y `WEB_ORIGIN=https://uml.asiscarretera.online`.
- CORS admite únicamente ese origen; incluye `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` y `OPTIONS`, con Authorization y Content-Type. Permite leer Content-Disposition para descargas y Retry-After para límites. No habilita el dominio raíz, otros subdominios, HTTP ni la IP como orígenes del navegador. CORS no sustituye la autenticación de la API.
- Cookie de renovación Secure, HttpOnly y SameSite=Lax, limitada al host. El proxy de producción añade HSTS y CSP y redirige HTTP a HTTPS.
- API pública en `/api`, colaboración en `wss://uml.asiscarretera.online/collab`. La interfaz deriva ambas rutas del dominio actual; no requiere recompilar URLs específicas.
- Solo Caddy publica puertos 80/443; API, colaboración y PostgreSQL quedan en la red Docker. Migraciones, comprobaciones de salud, límites, volúmenes y rotación de logs ya están en el Compose de producción.

## 1. Antes de arrancar

1. Reserva **35.255.28.222** como IP estática de la VM. El registro A `uml` debe apuntar a ella. No cambies el dominio raíz ni sus MX.
2. En el firewall VPC permite TCP **80 y 443** a esta VM. Restringe SSH a tu IP administrativa o a IAP. No abras 3001/3002/5432/8080. Si hay firewall del sistema operativo, debe permitir también HTTP y HTTPS.
3. Confirma y sube los cambios del código. `production.sh deploy` requiere checkout limpio. El archivo privado se transfiere por separado.
4. En Brevo autoriza la IP de salida de la nueva VM. Habitualmente será **35.255.28.222** si no hay Cloud NAT u otro proxy; verifica la IP que Brevo reporte. El bloqueo anterior desde el PC era para **166.114.170.75**. Valida el dominio remitente `asiscarretera.online` y `info@asiscarretera.online` en Brevo.

## 2. Preparar la VM por SSH

Para Ubuntu 24.04, sustituye `URL_DEL_REPOSITORIO`:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone URL_DEL_REPOSITORIO /opt/uml
cd /opt/uml
sudo bash scripts/bootstrap-ubuntu.sh
```

Si el repositorio ya existe, actualízalo al commit que incluye esta configuración y conserva `/opt/uml` como directorio de trabajo.

## 3. Transferir la configuración privada

Desde PowerShell en tu PC, sustituye `USUARIO_VM` por tu usuario SSH y usa la misma clave SSH con la que accedes a la VM:

```powershell
scp "C:\Users\braya\Desktop\Practicas\Examen1SW1\output\google-cloud\production.env" USUARIO_VM@35.255.28.222:~/uml-production.env
```

También puedes transferir el archivo mediante la opción de subida de tu sesión SSH del navegador de Google Cloud.

Después, en la VM:

```bash
sudo install -d -m 700 /etc/uml
sudo install -m 600 "$HOME/uml-production.env" /etc/uml/production.env
rm -- "$HOME/uml-production.env"
cd /opt/uml
sudo bash scripts/production.sh deploy
sudo bash scripts/production.sh ps
sudo bash scripts/production.sh smoke
```

El script obtiene el commit para etiquetar imágenes, valida la configuración, hace una copia previa, migra la base y arranca los servicios. Caddy obtiene el certificado cuando el DNS y los puertos son accesibles. Este archivo es para una base nueva: no cambies con él la contraseña de un volumen PostgreSQL ya inicializado.

## 4. Comprobar el despliegue real

Los nuevos registros requieren activar la cuenta por correo antes de iniciar sesión.
Brevo envía un enlace a `https://uml.asiscarretera.online/activar#token=…`, válido
durante 24 horas y de un solo uso. La pantalla de acceso permite reenviarlo (máximo
un envío por minuto por cuenta, además del límite por IP). La migración conserva
el acceso de las cuentas anteriores. Si falla el envío inicial, la cuenta queda
pendiente y la interfaz permite solicitar otro enlace.

Comprueba la entrega real en Brevo y en el buzón antes de abrir el registro público:
una clave configurada no garantiza que el proveedor acepte el envío desde la VM.
En desarrollo, `MAIL_PROVIDER=log` escribe el enlace en los logs de la API.
Las pruebas E2E locales usan ese adaptador; la prueba de producción captura los
correos en un adaptador temporal sin enviar mensajes reales.

Abre `https://uml.asiscarretera.online`. Confirma registro/login, recarga de sesión, dos usuarios con estado **En vivo**, descarga PNG/ZIP y recuperación de contraseña con entrega real del correo y enlace al subdominio correcto.

```bash
curl -fsS https://uml.asiscarretera.online/api/ready
curl -i -X OPTIONS https://uml.asiscarretera.online/api/projects \
  -H 'Origin: https://uml.asiscarretera.online' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
sudo bash scripts/production.sh backup
sudo bash scripts/production.sh restore-check
```

El preflight debe responder **204**, `Access-Control-Allow-Origin: https://uml.asiscarretera.online`, credenciales habilitadas y PATCH entre los métodos. La respuesta genérica del formulario de recuperación no acredita entrega: revisa Brevo y el buzón.

## Copias y operación

El archivo preparado usa **BACKUP_S3_URI=local-only**, ya que no se proporcionó un bucket. Permite iniciar y conserva copias diarias en la VM, pero no protege de perderla. Antes de almacenar datos importantes configura las copias externas de [GOOGLE-CLOUD.md](GOOGLE-CLOUD.md#3-copias-en-cloud-storage).

Monitorización, actualización y rollback: [DEPLOYMENT.md](DEPLOYMENT.md). No uses `npm run up` para este despliegue: ese comando ejecuta el perfil de desarrollo.

La preparación y las pruebas locales no modifican la VM, el firewall de Google Cloud ni la lista de IP autorizadas de Brevo. Esas acciones y la aceptación pública se completan en la cuenta del proveedor.

Validación local del 18 de septiembre: `npm run check` aprobado (578 pruebas), perfil privado validado con Docker Compose, y `npm run test:production` aprobado con CORS a través del proxy HTTPS, cookies seguras, WebSocket, descarga PNG y restauración. Los recursos de la prueba eran temporales y se eliminaron al finalizar.
