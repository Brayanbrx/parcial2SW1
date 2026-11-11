#!/usr/bin/env bash
# Ejecutar como el usuario que ya inició sesión en la IA de la VM.
# Instala Node en la cuenta del usuario y prepara un servicio systemd de usuario.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
CLI=${UML_AI_VM_EXECUTABLE:-${HOME}/.local/bin/codex}
"$CLI" login status >/dev/null 2>&1 || { echo 'Inicia sesión con el usuario actual antes de continuar.' >&2; exit 1; }
HELP=$("$CLI" exec --help)
grep -q -- '--ignore-user-config' <<< "$HELP" || { echo 'Actualiza la instalación de IA de la VM.' >&2; exit 1; }
NODE=$(command -v node || true)
if [[ -z "$NODE" ]] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo 'Arquitectura no soportada por el instalador.' >&2; exit 1 ;; esac
  VERSION=v22.15.0
  NAME="node-${VERSION}-linux-${ARCH}"
  BASE="https://nodejs.org/dist/${VERSION}"
  CACHE=$(mktemp -d)
  trap 'rm -f -- "$CACHE/SHASUMS256.txt" "$CACHE/$NAME.tar.xz"; rmdir -- "$CACHE"' EXIT
  curl --fail --silent --show-error --location "$BASE/SHASUMS256.txt" -o "$CACHE/SHASUMS256.txt"
  curl --fail --silent --show-error --location "$BASE/$NAME.tar.xz" -o "$CACHE/$NAME.tar.xz"
  (cd "$CACHE"; grep " $NAME.tar.xz\$" SHASUMS256.txt | sha256sum --check --status)
  mkdir -p "$HOME/.local/lib"
  tar -xJf "$CACHE/$NAME.tar.xz" -C "$HOME/.local/lib"
  NODE="$HOME/.local/lib/$NAME/bin/node"
fi
CONFIG="$HOME/.config/umlforge-ai"
mkdir -p "$CONFIG" "$HOME/.config/systemd/user"
chmod 700 "$CONFIG"
if [[ ! -f "$CONFIG/vm.env" ]]; then
  umask 077
  cat > "$CONFIG/vm.env" <<EOF
UML_AI_SERVER=https://tu-dominio
UML_AI_VM_TOKEN=
UML_AI_VM_MODEL=
UML_AI_VM_EXECUTABLE=$CLI
UML_AI_CONTEXT_WINDOW=32768
UML_AI_CONCURRENCY=1
EOF
fi
chmod 600 "$CONFIG/vm.env"
# Escapar el especificador de systemd en rutas; nunca se ejecuta el archivo env con shell.
NODE=${NODE//%/%%}
SCRIPT=${ROOT//%/%%}/scripts/ai-connector.mjs
cat > "$HOME/.config/systemd/user/uml-ia-vm.service" <<EOF
[Unit]
Description=UMLForge IA de VM
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/umlforge-ai/vm.env
ExecStart="$NODE" "$SCRIPT" --vm
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=%h/.codex
RestrictSUIDSGID=true

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
echo 'Servicio preparado. Completa ~/.config/umlforge-ai/vm.env con el dominio, secreto compartido y modelo.'
echo 'Después: systemctl --user enable --now uml-ia-vm.service'
echo 'Estado: systemctl --user status uml-ia-vm.service'
echo 'Para mantenerlo tras cerrar SSH: sudo loginctl enable-linger "$USER"'
