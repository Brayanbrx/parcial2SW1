# Google Cloud Compute Engine con Docker

Para la VM **35.255.28.222** y el dominio **uml.asiscarretera.online**, usa el [procedimiento preparado para este despliegue](DEPLOY-UML.md).

La plataforma está preparada para una única VM Linux: Caddy termina HTTPS, la web sirve los archivos estáticos, la API y el servidor colaborativo comparten PostgreSQL. El archivo base debe combinarse con `compose.production.yml`; `npm run up` es para desarrollo. No aumentar réplicas de colaboración: las salas están en memoria y todavía no existe coordinación entre servidores.

## 1. VM y red

En Compute Engine crea una VM con Ubuntu 24.04 LTS. Como punto de partida para pocos usuarios: 2 vCPU, 4 GiB RAM y disco persistente de al menos 30 GiB. Las compilaciones Docker pueden requerir más memoria; dimensiona con métricas reales. Activa protección contra eliminación y revisa la política de conservación del disco al eliminar la VM.

Reserva y asocia una IP externa estática. Crea un registro DNS A, por ejemplo `uml.tu-dominio.com`, dirigido a esa IP. Añade AAAA únicamente si también configuraste IPv6.

Aplica una etiqueta de red exclusiva a la VM y una regla VPC de entrada para TCP 80 y 443 dirigida a esa etiqueta. Limita SSH a tu IP administrativa o a IAP según tu método de acceso. No publiques 3001, 3002, 5432, 5433, 8080 ni 2019. Revisa también reglas amplias heredadas de la red: una regla específica no anula otra que ya permite tráfico.

La VM necesita salida a los registros de Docker/npm, DNS, certificados, Cloud Storage, Brevo y los proveedores de IA elegidos. No requiere Java, Maven ni Flutter: la generación entrega código y la compilación del APK ocurre en el equipo que lo descarga.

Referencias oficiales: [crear una VM](https://docs.cloud.google.com/compute/docs/instances/create-start-instance), [reservar una dirección estática](https://docs.cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address), [acceso seguro a VM](https://docs.cloud.google.com/solutions/connecting-securely).

## 2. Instalar el proyecto

Desde SSH en la VM, sustituye la URL por la de tu repositorio:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone URL_DE_TU_REPOSITORIO /opt/uml
cd /opt/uml
sudo bash scripts/bootstrap-ubuntu.sh
sudo install -d -m 700 /etc/uml
sudo install -m 600 infra/production.env.example /etc/uml/production.env
sudoedit /etc/uml/production.env
```

Configura los siguientes valores reales fuera del repositorio:

| Variable | Configuración |
| --- | --- |
| `DOMAIN` | `uml.tu-dominio.com` |
| `WEB_ORIGIN` | `https://uml.tu-dominio.com`, sin barra final |
| `ACME_EMAIL` | Correo operativo para los certificados |
| `POSTGRES_PASSWORD` | Valor generado con `openssl rand -hex 32` |
| `JWT_SECRET` | Otro valor generado con `openssl rand -hex 48` |
| `MAIL_FROM` | Remitente verificado en Brevo |
| `BREVO_API_KEY` | Clave de Brevo para recuperación de contraseña |
| `AI_LLM_PROVIDER`, `AI_VISION_PROVIDER`, `AI_SPEECH_PROVIDER` | Proveedores reales y sus credenciales/modelos de `infra/.env.example`; `mock` solo simula respuestas |

`production.sh` etiqueta las imágenes con el commit actual. Antes de instalar, confirma y sube los cambios y usa un checkout limpio en la VM. Git no traslada las pizarras locales; su migración requiere dump y restauración de PostgreSQL.

## 3. Copias en Cloud Storage

El contenedor existente usa AWS CLI y la API compatible con S3 de Cloud Storage. Crea un bucket privado y una cuenta de servicio dedicada con permiso para crear objetos en ese bucket (por ejemplo `roles/storage.objectCreator` a nivel de bucket). Genera claves **HMAC** para esa cuenta; no son una clave JSON ni las credenciales OAuth de `gcloud`.

Configura en `/etc/uml/production.env`:

```dotenv
BACKUP_S3_URI=s3://NOMBRE_REAL_DEL_BUCKET/uml
AWS_ENDPOINT_URL=https://storage.googleapis.com
AWS_DEFAULT_REGION=auto
AWS_ACCESS_KEY_ID=ID_HMAC_REAL
AWS_SECRET_ACCESS_KEY=SECRETO_HMAC_REAL
BACKUP_INTERVAL_SECONDS=86400
BACKUP_KEEP_DAYS=7
```

Aunque el bucket sea de Google, la URI debe comenzar con `s3://` porque el cliente es AWS CLI. El endpoint y las claves dirigen la operación a Cloud Storage. Mantén vacía `AWS_SESSION_TOKEN`.

Establece una política de ciclo de vida/retención en el bucket según tus necesidades; la retención local de siete días no elimina copias remotas. Usa una identidad separada con permiso de lectura para recuperar una copia y comprueba una restauración desde un objeto descargado del bucket. `restore-check` valida la copia local y no demuestra por sí solo que puedas recuperar la remota.

Para una prueba sin bucket puedes usar `BACKUP_S3_URI=local-only`. Las copias permanecen en la misma VM; configura y verifica el almacenamiento externo antes de confiarle datos importantes.

La compatibilidad de endpoint, firma y permisos debe comprobarse con la cuenta real mediante `production.sh backup`; la prueba local usa almacenamiento temporal. Documentación oficial: [interoperabilidad de Cloud Storage](https://docs.cloud.google.com/storage/docs/interoperability), [migración compatible con S3](https://docs.cloud.google.com/storage/docs/aws-simple-migration), [gestionar claves HMAC](https://docs.cloud.google.com/storage/docs/authentication/managing-hmackeys).

## 4. Desplegar y verificar

```bash
cd /opt/uml
sudo bash scripts/production.sh deploy
sudo bash scripts/production.sh ps
sudo bash scripts/production.sh smoke
sudo bash scripts/production.sh backup
sudo bash scripts/production.sh restore-check
```

El despliegue construye las imágenes, comprueba variables, realiza una copia antes de migrar, aplica Prisma y espera a que los servicios estén sanos. Caddy obtiene el certificado automáticamente cuando el DNS y los puertos funcionan.

Antes de compartir el dominio, comprueba:

1. Redirección HTTP → HTTPS y `/api/ready` saludable.
2. Registro, ingreso, renovación de sesión y entrega real del correo de recuperación.
3. Dos usuarios en la misma pizarra con estado **En vivo**, edición y reconexión.
4. **Importar → Exportar imagen PNG → Guardar PNG**: abrir el archivo y revisar clases, atributos, multiplicidades y relaciones. La imagen se procesa en el navegador y no requiere permisos de Cloud Storage.
5. Importación/exportación XMI, generación y descarga del ZIP, texto/visión/voz con los proveedores reales que actives.
6. Un objeto de backup nuevo en el bucket y una restauración probada, incluida una copia descargada de Cloud Storage.

Instala el monitor systemd de [DEPLOYMENT.md](DEPLOYMENT.md#supervisión-y-alertas) y añade un chequeo externo de `/api/ready` en Cloud Monitoring para detectar una VM apagada. Configura alertas de presupuesto y vigila RAM/disco. Las actualizaciones y rollback se realizan con los procedimientos de esa misma guía.

## Alcance de la revisión local

Las pruebas del repositorio validan el software y una pila Docker temporal con HTTPS. No certifican la configuración de tu proyecto de Google Cloud, sus credenciales, el DNS, la entrega de Brevo ni los proveedores de IA. El despliegue se considera verificado en tu VM cuando pasan los pasos anteriores con su configuración real.
