#!/bin/sh
# Compila, instala o ejecuta el APK generado sin entrar en carpetas.
#   sh apk.sh            compila el APK de depuracion  -> mobile/dist/
#   sh apk.sh install    compila + instala y abre la app en el telefono por USB
#   sh apk.sh run        flutter run con recarga en caliente
#   sh apk.sh release    APK de release
#   sh apk.sh devices    telefonos conectados
#   sh apk.sh doctor     comprueba Flutter, adb y telefono
#   sh apk.sh help       todas las opciones (--api=URL, --device=SERIAL, --universal)
set -e
cd "$(dirname "$0")/mobile" || { echo "No se encontro la carpeta mobile junto a este archivo."; exit 1; }
command -v dart >/dev/null 2>&1 || { echo "Falta Dart/Flutter en el PATH. Instala Flutter: https://docs.flutter.dev/get-started/install"; exit 1; }
exec dart tool/apk.dart "$@"
