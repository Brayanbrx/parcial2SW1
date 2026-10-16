# Despliegue en AWS EC2, Azure, Google Cloud o un VPS con Docker

Esta configuración despliega una instancia de API, colaboración y PostgreSQL en una máquina Linux. Caddy publica HTTPS y WebSocket seguro. Es portable a una VM de AWS, Google Cloud, Azure o cualquier proveedor con Docker; no es una configuración de ECS, Kubernetes ni un servicio de alta disponibilidad.

Para Google Cloud, la [guía de Compute Engine](GOOGLE-CLOUD.md) detalla la VM, firewall, IP fija y copias en Cloud Storage.

La VM **no necesita** Java, Maven, Flutter ni Android SDK: la plataforma emite el código como ZIP y lo compila quien lo descarga, en su PC. Ver [Descargas y espacio en disco](#descargas-y-espacio-en-disco).

## Preparación

- Ubuntu 24.04 LTS, Docker Engine y Compose **2.24.4 o posterior**. Punto de partida orientativo para pocos usuarios: 2 vCPU, 4 GiB de RAM y 30 GiB de disco; medir uso real y ampliar, especialmente al construir imágenes. No es una capacidad certificada.
- Dominio con DNS A apuntando a la IP pública estable de la VM. Configurar AAAA solo si IPv6 funciona de extremo a extremo.
- Entrada TCP 80 y 443 pública; SSH 22 únicamente desde la IP administrativa. No abrir 3001, 3002, 5432/5433, 8080 ni el administrador de Caddy.
- Un remitente verificado en Brevo y su clave API para recuperación de contraseñas.
- Bucket privado S3 o compatible, con cifrado, bloqueo de acceso público y regla de retención. Recomendación inicial: retener copias 30 días y activar versionado; la retención local es de 7 días. El script nunca elimina objetos del bucket. Sin bucket, `BACKUP_S3_URI=local-only` deja las copias en la VM (ver abajo).
- Una versión de Git confirmada y subida. Los cambios locales y la base de datos de tu PC no viajan con `git clone`.

### Notas por proveedor

| Proveedor | Red y puertos | IP fija | Copias externas |
| --- | --- | --- | --- |
| **AWS EC2** | Security group: 80 y 443 desde `0.0.0.0/0`, 22 solo desde tu IP. | Elastic IP asociada a la instancia. | Rol IAM de instancia con la política de `aws/backup-policy.json` (sustituir el bucket). IMDSv2 obligatorio con hop limit 2 para que el contenedor de backup lea el rol. Sin claves permanentes en la VM. El rol de escritura no borra ni descarga; usar otro con `s3:GetObject` para recuperar. Con SSE-KMS, permisos de la clave KMS. |
| **Azure VM** | Network Security Group: reglas de entrada 80 y 443; SSH restringido. | IP pública con asignación **estática** (la dinámica cambia al reiniciar). | Azure Blob no habla S3. Opciones: un almacenamiento compatible con S3 (Cloudflare R2, Backblaze B2, MinIO) con `AWS_ENDPOINT_URL` y claves limitadas, o `local-only`. |
| **Google Cloud Compute Engine** | Regla de firewall VPC para `tcp:80,443` con etiqueta de red en la VM. | Dirección externa **estática** reservada. | Cloud Storage admite la API S3 con claves HMAC: `AWS_ENDPOINT_URL=https://storage.googleapis.com` y las claves HMAC de una cuenta de servicio limitada. O `local-only`. |
| **VPS (DigitalOcean, Hetzner, Linode, Contabo…)** | Cortafuegos del panel o `ufw allow 80,443/tcp`, `ufw allow from TU_IP to any port 22`. | Suelen ser fijas por defecto. | Spaces, Object Storage o cualquier S3 compatible con `AWS_ENDPOINT_URL`. O `local-only`. |

`BACKUP_S3_URI=local-only` arranca sin bucket: las copias diarias quedan en el volumen `backups` de la VM, con la misma retención de 7 días, y el script de despliegue lo avisa en cada comprobación. Protege de una migración mal aplicada, no de perder la VM. Para datos que importan, configurar un bucket antes de abrir la plataforma a otras personas.

## Primera instalación

Clonar el repositorio en `/opt/uml`. Instalar Git si la imagen no lo incluye:

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

Sustituir todos los ejemplos antes de arrancar:

| Campo | Valor |
| --- | --- |
| `DOMAIN` | `uml.tu-dominio.com`, sin protocolo, puerto ni ruta. |
| `WEB_ORIGIN` | `https://uml.tu-dominio.com`, sin barra final. |
| `ACME_EMAIL` | Correo operativo para certificados. |
| `POSTGRES_PASSWORD` | Generar con `openssl rand -hex 32`. |
| `JWT_SECRET` | Generar con `openssl rand -hex 48`. Compose entrega el mismo valor a API y colaboración. |
| `MAIL_FROM`, `BREVO_API_KEY` | Remitente verificado y clave real de Brevo. |
| `BACKUP_S3_URI` | `s3://mi-bucket-privado/uml`, prefijo exclusivo de este despliegue. |
| `AWS_DEFAULT_REGION` | Región del bucket. |

`NODE_ENV=production`, `COOKIE_SECURE=true`, correo real, límites de peticiones y confianza en un único proxy se establecen en el Compose de producción. La API rechaza configuraciones inseguras. Los secretos se mantienen fuera del repositorio con permisos 600; quien administra Docker puede ver el entorno del contenedor y debe considerarse administrador del servidor.

La plantilla deja la IA en `mock` para arrancar sin contratar un proveedor. Para IA real, copiar al archivo de producción las variables necesarias de `infra/.env.example`: proveedor/modelo de texto, visión y voz, credenciales y respaldos. Todas las variables de IA del Compose base se conservan. No copiar cuentas de demostración ni ejecutar `npm run seed` en producción.

```bash
sudo bash scripts/production.sh deploy
sudo bash scripts/production.sh ps
sudo bash scripts/production.sh smoke
```

El despliegue exige un checkout limpio. Usa el commit actual como etiqueta de imágenes, construye los cinco componentes, valida configuración y Caddy, inicia PostgreSQL y exige una copia externa exitosa **antes** de aplicar las migraciones. Después arranca los servicios y comprueba las rutas públicas con validación TLS. Guarda la versión exitosa en `/root/.local/state/uml-deploy` al ejecutar con sudo. No borra volúmenes.

El servidor necesita acceso saliente a DNS, registros de imágenes, certificados, S3, correo y proveedores de IA. Si la copia externa o un paso falla, el script termina con error; revisar la causa antes de reintentar. Un fallo posterior a una migración puede requerir intervención: el despliegue de una única VM admite una breve interrupción y no promete rollback automático de datos.

## Verificación funcional antes de compartir el enlace

1. Abrir el dominio con certificado válido; confirmar redirección HTTP a HTTPS.
2. Registrar una cuenta real, **activarla desde el enlace del correo** —sin activar, el login responde 403— y verificar después login y renovación de sesión. Este paso comprueba de paso la entrega real de Brevo.
3. Abrir la misma pizarra con dos usuarios y comprobar `En vivo`, cambios y reconexión.
4. Importar/exportar XMI; probar una imagen con el proveedor de visión elegido.
5. Generar y descargar un ZIP desde una pizarra válida.
6. Solicitar recuperación de contraseña y comprobar entrega real del correo.
7. Ejecutar una copia después de crear datos y probar restauración:

```bash
sudo bash scripts/production.sh backup
sudo bash scripts/production.sh restore-check
```

La segunda orden restaura la última copia local en un PostgreSQL temporal, comprueba que hay tablas y destruye únicamente ese contenedor temporal. La base de producción permanece intacta. Si la copia programada coincide con la manual, el bloqueo evita dos dumps simultáneos; reintentar al terminar la primera.

## Copias externas y recuperación

El servicio `backup` ejecuta `pg_dump -Fc`, valida el índice con `pg_restore --list`, sube el resultado a S3 y solo entonces marca éxito. Repite cada 24 horas y reintenta cada cinco minutos si falla. La comprobación de salud falla si la última copia supera el intervalo más dos horas. Las copias viven en un volumen aparte y en el bucket. Supervisar ese estado: un contenedor `unhealthy` por sí solo no envía una alerta.

Para recuperar desde S3 tras perder la VM:

1. Detener escrituras o recuperar en una VM nueva. Guardar la base actual antes de sustituirla.
2. Descargar la copia con un rol de recuperación; verificar origen y fecha. Mantener los permisos privados del archivo.
3. Restaurar **en una base vacía aislada** usando PostgreSQL 17: `pg_restore --exit-on-error --no-owner --no-acl --dbname URL_DE_BASE_DESTINO copia.dump`. No ejecutar el comando contra la base viva.
4. Comprobar cuentas, proyectos, pizarras y snapshots; arrancar la versión de la aplicación correspondiente a la copia. Aplicar migraciones posteriores solo después de verificar compatibilidad.
5. Cambiar el tráfico a la instancia recuperada y repetir pruebas funcionales.

Ensayar también este procedimiento desde una copia descargada del bucket. La prueba automatizada local verifica formato y restauración, pero no acredita tu cuenta, IAM, conectividad o retención S3. Para migrar las pizarras del PC se usa el mismo procedimiento de dump/restauración en la nueva base antes de habilitar usuarios.

## Descargas y espacio en disco

**Dónde se descarga.** En la pizarra, pestaña **Generar**: al terminar aparecen los botones **Descargar backend** y, si se marcó la opción Flutter, **Descargar Android + backend**. El historial de abajo conserva un botón de descarga por cada generación anterior, para cualquier miembro del proyecto, también los de solo lectura. La descarga va por `/api/generations/{id}/download?target=spring|mobile`, autenticada con la sesión.

**Qué contiene.** El ZIP trae el proyecto Spring Boot con su `compose.yaml` y, en el objetivo Android, la app Flutter con `apk.bat` / `apk.sh`. **El APK no se compila en el servidor**: lo compila quien descarga, en su PC, con `.\apk.bat build` (necesita Flutter y Android SDK) y queda en `mobile/dist/`. Compilar Android tarda minutos y pesa gigabytes de SDK; hacerlo en la VM obligaría a una máquina mucho más grande sin ganar nada para la defensa.

**Qué se guarda en el servidor.** Ningún ZIP ni APK. Generar congela una copia del diagrama (una fila JSON en `board_snapshots`, unos KB) y registra un manifiesto en `generations`; al descargar se vuelve a emitir desde esa copia y se comprueba que el SHA-256 coincide con el registrado (ADR-018). Por eso el mismo enlace da los mismos bytes semanas después, y por eso mil generaciones ocupan megabytes, no gigabytes.

**Cómo eliminar.** En el historial de la pestaña Generar, **Eliminar** (solo OWNER y EDITOR) borra el registro y su copia congelada; esa generación deja de poder descargarse. Borrar una pizarra o un proyecto arrastra todas sus generaciones. Desde la API: `DELETE /api/generations/{id}`.

**Qué ocupa espacio de verdad en la VM**, de mayor a menor:

| Qué | Dónde | Cómo se controla |
| --- | --- | --- |
| Imágenes Docker, una por versión desplegada | `docker images` | `sudo bash scripts/production.sh prune` conserva la versión actual y la anterior (para rollback) y borra el resto más la caché de construcción. |
| Base de datos | volumen `db-data` | Crece con pizarras, documentos colaborativos, auditoría y generaciones. `disk` muestra el desglose. |
| Copias locales | volumen `backups` | Retención `BACKUP_KEEP_DAYS` (7 por defecto); el bucket externo tiene la suya. |
| Registros de contenedores | json-file | Rotación fijada en el Compose de producción: 3 archivos de 10 MB por servicio. |
| Certificados | `caddy-data` | Despreciable. |

```bash
sudo bash scripts/production.sh disk    # disco, Docker, tamaño de cada tabla, copias locales
sudo bash scripts/production.sh prune   # imágenes antiguas y caché; nunca volúmenes
```

El monitor avisa cuando el disco supera el 85 %. Nunca ejecutar `docker system prune --volumes` ni `down -v` sobre producción: borra la base y las copias locales.

## Supervisión y alertas

```bash
sudo cp infra/systemd/uml-monitor.service infra/systemd/uml-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now uml-monitor.timer
sudo systemctl start uml-monitor.service
sudo journalctl -u uml-monitor.service --no-pager -n 30
```

Cada cinco minutos comprueba HTTPS, `/api/ready` (base de datos y servicio colaborativo), antigüedad del backup y disco por debajo del 85 %. Si falla, deja error en systemd. Para recibir notificaciones configurar `/etc/uml/monitor.env` con permisos 600 y `ALERT_WEBHOOK_URL=https://...`: debe aceptar JSON `{"text":"..."}`. Sin ese destino no se envían avisos externos. Añadir también un monitor externo de `/api/ready` o una alarma de AWS para detectar una VM totalmente apagada, que no puede avisar por sí misma. Configurar alarmas de facturación en la cuenta cloud.

## Actualización y rollback

```bash
cd /opt/uml
sudo git pull --ff-only
sudo bash scripts/production.sh deploy
```

No utilizar solo `docker compose restart`: no carga variables nuevas ni recompila el código. Cambiar JWT invalida sesiones y requiere actualizar API y colaboración conjuntamente; el script siempre considera ambos servicios. Cambiar `POSTGRES_PASSWORD` en dotenv **no cambia** la contraseña de una base ya inicializada: requiere una rotación coordinada en PostgreSQL.

Si una nueva versión falla y no hubo cambios de migraciones:

```bash
sudo bash scripts/production.sh rollback HASH_DE_VERSION_EXITOSA_ANTERIOR
```

Reutiliza imágenes locales conservadas; no recompila código nuevo bajo una etiqueta antigua. Rechaza el rollback si la huella de migraciones difiere. Si cambiaron migraciones o configuración incompatible, usar recuperación validada y valorar los datos posteriores a la copia. No podar imágenes de versiones necesarias ni ejecutar `down -v` sobre producción. El rollback cubre API, colaboración y web; no revierte secretos, Caddy, backups ni el esquema.

## Pruebas reproducibles y límites

Desde un equipo de desarrollo con Node, dependencias instaladas y Docker:

```bash
npm run check
npm run test:api
npm run test:production
```

La última crea un proyecto Docker con nombre aleatorio y volúmenes temporales. Construye imágenes reales, valida que no hay puertos internos publicados y comprueba HTTPS con CA local confiada explícitamente, cookies Secure/HttpOnly, autenticación WSS, un navegador real entrando a una pizarra, límites frente a cabeceras IP falsificadas y restauración de datos. Elimina únicamente sus propios contenedores/volúmenes. Usa los puertos locales 18080/18443. No desactiva la verificación TLS global ni usa credenciales reales; S3 y el envío de correo se verifican posteriormente con tu configuración real. CI ejecuta esta prueba también. Funciona también desde Windows con Docker Desktop.

Los contadores de peticiones están en memoria, acotados por proceso y se reinician al reiniciar API. Este despliegue usa una sola API y un solo servidor colaborativo. Antes de múltiples réplicas se requiere almacenamiento compartido de cuotas y coordinación de documentos; no basta con aumentar `replicas`.

Completar una auditoría de dependencias (`npm audit --omit=dev`) y de imágenes antes de la exposición pública. La consulta npm envía metadatos de dependencias al registro: debe estar autorizada. No se presupone que pruebas funcionales equivalgan a ausencia de vulnerabilidades.

Referencias: [Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Compose para producción](https://docs.docker.com/compose/how-tos/production/), [HTTPS de Caddy](https://caddyserver.com/docs/automatic-https), [roles de EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html), [puertos y security groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html).
