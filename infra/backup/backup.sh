#!/bin/sh
set -eu
umask 077
export PGCONNECT_TIMEOUT=10

backup() (
  # Kernel lock releases even after a crash; no stale lock can block all future copies.
  exec 9>/backups/backup.lock
  flock -n 9 || { echo 'Otra copia está en curso' >&2; return 1; }
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  partial=$(mktemp "/backups/uml-$stamp-XXXXXX")
  file="$partial.dump"
  pg_dump --format=custom --no-owner --no-acl --file="$partial"
  pg_restore --list "$partial" >/dev/null
  mv "$partial" "$file"
  # `local-only`: la copia se queda en el volumen del servidor. Sirve para una
  # VM sin bucket (Azure, GCP, un VPS cualquiera) pero no protege de perder la
  # VM; se avisa en cada copia para que no pase desapercibido.
  case "${BACKUP_S3_URI:-}" in
    '') ;;
    local-only) echo 'AVISO: copia solo local (BACKUP_S3_URI=local-only); perder la VM es perder las copias' >&2 ;;
    s3://*/*) aws s3 cp "$file" "${BACKUP_S3_URI%/}/$(basename "$file")" --only-show-errors ;;
    *) echo 'BACKUP_S3_URI requiere s3://bucket/prefijo o local-only' >&2; return 1 ;;
  esac
  # Mark success only after the off-host upload also succeeds.
  date +%s > /backups/last-success
  find /backups -maxdepth 1 -type f -name 'uml-*.dump' -mtime "+${BACKUP_KEEP_DAYS:-7}" -exec rm -f '{}' \;
  echo "Copia verificada: $(basename "$file")"
)

case "${1:-loop}" in
  once) backup ;;
  health)
    test -f /backups/last-success
    age=$(( $(date +%s) - $(cat /backups/last-success) ))
    test "$age" -lt "$(( ${BACKUP_INTERVAL_SECONDS:-86400} + 7200 ))"
    ;;
  loop)
    while :; do
      # A failed upload retries soon and leaves health stale, rather than waiting a day.
      if (backup); then sleep "${BACKUP_INTERVAL_SECONDS:-86400}"; else
        echo 'Copia fallida; reintento en cinco minutos' >&2
        sleep 300
      fi
    done
    ;;
  *) echo 'Uso: backup.sh once|loop|health' >&2; exit 2 ;;
esac
