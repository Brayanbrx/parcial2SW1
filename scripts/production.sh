#!/usr/bin/env bash
# Linux host entry point. Does not source dotenv files as executable shell code.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
ENV_FILE=${UML_ENV_FILE:-/etc/uml/production.env}
PROJECT=${UML_PROJECT:-plataforma-uml-production}
STATE_DIR=${UML_STATE_DIR:-${HOME}/.local/state/uml-deploy}
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'UML_PROJECT inválido' >&2; exit 2; }
test -f "$ENV_FILE" || { echo "Falta configuración: $ENV_FILE" >&2; exit 2; }
export APP_VERSION=${APP_VERSION:-$(git rev-parse --short=12 HEAD)}
[[ "$APP_VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 2
compose() {
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" \
    -f infra/compose.yml -f infra/compose.production.yml "$@"
}
schema_hash() { find backend/prisma/migrations -name migration.sql -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1; }
check() {
  compose config --quiet
  compose run --rm --no-deps api node --input-type=module -e '
    import {loadConfig} from "./backend/api/dist/config.js";
    const c = loadConfig();
    if (decodeURIComponent(new URL(c.DATABASE_URL).password).length < 32) throw Error("POSTGRES_PASSWORD requiere 32 caracteres aleatorios o mas");
    console.log("Configuracion de API validada");'
  compose run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile
  compose run --rm --no-deps --entrypoint sh backup -ec '
    case "$BACKUP_S3_URI" in
      local-only) echo "AVISO: las copias se quedan en la VM (BACKUP_S3_URI=local-only). Configura un bucket S3 compatible antes de admitir datos importantes." >&2 ;;
      s3://*/*) ;;
      *) echo "BACKUP_S3_URI debe ser s3://bucket/prefijo o local-only" >&2; exit 1;;
    esac
    case "$BACKUP_S3_URI" in *YOUR_PRIVATE_BUCKET*) echo "Sustituye el bucket de ejemplo" >&2; exit 1;; esac'
}
smoke() {
  compose exec -T api node --input-type=module -e '
    for (const path of ["/", "/api/health", "/api/ready", "/collab/health"]) {
      const r = await fetch(process.env.WEB_ORIGIN + path, {signal:AbortSignal.timeout(15000)});
      if (!r.ok) throw Error(path + " -> " + r.status);
      console.log(path + " OK");
    }'
}
notify_failure() {
  echo 'La monitorización de UML detectó un fallo. Revisa journalctl -u uml-monitor.service' >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl --fail --silent --show-error --max-time 15 \
      -H 'Content-Type: application/json' \
      --data '{"text":"UML: fallo de disponibilidad, copia de seguridad o espacio en disco. Revisar servidor."}' \
      "$ALERT_WEBHOOK_URL" || true
  fi
}

case "${1:-help}" in
  build) compose config --quiet; compose build --pull api collab web migrate backup ;;
  check) check ;;
  deploy)
    if [ -n "$(git status --porcelain)" ]; then
      echo 'Confirma y sube los cambios antes de desplegar; la versión debe ser reproducible.' >&2; exit 1
    fi
    mkdir -p "$STATE_DIR"
    exec 9>"$STATE_DIR/deploy.lock"
    flock -n 9 || { echo 'Hay otro despliegue en curso' >&2; exit 1; }
    compose config --quiet
    compose build --pull api collab web migrate backup
    check
    compose up -d --wait --wait-timeout 120 db
    # A remote copy must succeed before any migration is applied.
    compose run --rm --no-deps backup once
    compose run --rm --no-deps migrate
    compose up -d --wait --wait-timeout 300
    smoke
    schema_hash > "$STATE_DIR/$APP_VERSION.schema"
    if [ -f "$STATE_DIR/current" ]; then cp "$STATE_DIR/current" "$STATE_DIR/previous"; fi
    printf '%s\n' "$APP_VERSION" > "$STATE_DIR/current"
    echo "Desplegado: $APP_VERSION. Ejecuta restore-check para comprobar recuperación."
    ;;
  rollback)
    test -n "${2:-}" || { echo 'Uso: production.sh rollback VERSION' >&2; exit 2; }
    export APP_VERSION=$2
    [[ "$APP_VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 2
    test -f "$STATE_DIR/$APP_VERSION.schema"
    if [ "$(cat "$STATE_DIR/$APP_VERSION.schema")" != "$(schema_hash)" ]; then
      echo 'Las migraciones cambiaron: rollback automático rechazado. Usa el procedimiento de restauración.' >&2; exit 1
    fi
    for service in api collab web; do docker image inspect "uml-$service:$APP_VERSION" >/dev/null; done
    compose up -d --no-deps --no-build --wait api collab web
    smoke
    printf '%s\n' "$APP_VERSION" > "$STATE_DIR/current"
    ;;
  backup) compose run --rm --no-deps backup once ;;
  restore-check)
    db_id=$(compose ps -q db)
    test -n "$db_id"
    network=$(docker inspect "$db_id" --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}')
    restore_name="$PROJECT-restore-$(date +%s)-$$"
    restore_password=$(openssl rand -hex 24)
    trap 'docker rm -f -v "$restore_name" >/dev/null 2>&1 || true' EXIT
    docker run --detach --name "$restore_name" --network "$network" \
      --memory 512m --label uml.restore-check=true \
      -e POSTGRES_USER=restore_check -e POSTGRES_DB=restore_check \
      -e "POSTGRES_PASSWORD=$restore_password" postgres:17-alpine >/dev/null
    ready=false
    for attempt in $(seq 1 60); do
      if docker exec "$restore_name" pg_isready -U restore_check -d restore_check >/dev/null 2>&1; then ready=true; break; fi
      sleep 2
    done
    "$ready" || { echo 'PostgreSQL temporal no está listo' >&2; exit 1; }
    compose run --rm --no-deps --entrypoint sh \
      -e "RESTORE_HOST=$restore_name" -e "RESTORE_PASSWORD=$restore_password" backup -ec '
      file=$(ls -t /backups/uml-*.dump | head -n 1)
      test -n "$file"
      export PGHOST="$RESTORE_HOST" PGUSER=restore_check PGPASSWORD="$RESTORE_PASSWORD" PGDATABASE=restore_check
      pg_restore --exit-on-error --no-owner --no-acl --dbname "$PGDATABASE" "$file"
      count=$(psql -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\''")
      test "$count" -gt 0
      echo "Restauración aislada correcta: $count tablas"'
    ;;
  smoke) smoke ;;
  monitor)
    trap notify_failure ERR
    smoke
    compose exec -T backup sh /opt/backup.sh health
    used=$(df -P "$ROOT" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
    test "$used" -lt 85 || { echo "Disco ocupado: $used%" >&2; exit 1; }
    ;;
  ps) compose ps ;;
  logs) compose logs --tail 100 "${2:-api}" ;;
  disk)
    # Que ocupa espacio en la VM. Los ZIP generados no aparecen: no se guardan,
    # se regeneran desde la version congelada que vive en PostgreSQL.
    echo '== Disco de la VM =='; df -h "$ROOT" | tail -n 1
    echo; echo '== Docker (imagenes, cache de construccion, volumenes) =='; docker system df
    echo; echo '== Imagenes de la plataforma por version =='
    docker images --filter 'reference=uml-*' --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
    echo; echo '== Base de datos =='
    compose exec -T db sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "
      SELECT '"'"'base completa: '"'"' || pg_size_pretty(pg_database_size(current_database()))
      UNION ALL SELECT '"'"'versiones congeladas de pizarras (generaciones): '"'"' || pg_size_pretty(pg_total_relation_size('"'"'board_snapshots'"'"'))
      UNION ALL SELECT '"'"'generaciones registradas: '"'"' || count(*) FROM generations
      UNION ALL SELECT '"'"'documentos colaborativos: '"'"' || pg_size_pretty(pg_total_relation_size('"'"'board_documents'"'"'))
      UNION ALL SELECT '"'"'auditoria: '"'"' || pg_size_pretty(pg_total_relation_size('"'"'audit_operations'"'"'))"'
    echo; echo '== Copias locales =='
    compose exec -T backup sh -c 'ls -lh /backups/uml-*.dump 2>/dev/null || echo "sin copias locales"'
    ;;
  prune)
    # Borra imagenes de versiones que ya no sirven para rollback (se conservan
    # la actual y la anterior), imagenes colgantes y cache de construccion.
    # Nunca toca volumenes: ni la base, ni las copias, ni los certificados.
    current=$(cat "$STATE_DIR/current" 2>/dev/null || echo "$APP_VERSION")
    previous=$(cat "$STATE_DIR/previous" 2>/dev/null || echo "$current")
    docker images --filter 'reference=uml-*' --format '{{.Repository}}:{{.Tag}}' \
      | grep -v -e ":$current\$" -e ":$previous\$" | xargs -r docker image rm
    docker image prune --force
    docker builder prune --force --keep-storage 2g
    echo "Conservadas las versiones $current y $previous."
    ;;
  *) echo 'Uso: bash scripts/production.sh build|check|deploy|smoke|backup|restore-check|monitor|ps|logs [servicio]|disk|prune|rollback VERSION' ;;
esac
