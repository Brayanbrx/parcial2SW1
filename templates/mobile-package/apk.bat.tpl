@echo off
rem Compila, instala o ejecuta el APK generado sin entrar en carpetas.
rem   apk            compila el APK de depuracion  -> mobile\dist\
rem   apk install    compila + instala y abre la app en el telefono por USB
rem   apk run        flutter run con recarga en caliente
rem   apk release    APK de release
rem   apk devices    telefonos conectados
rem   apk doctor     comprueba Flutter, adb y telefono
rem   apk help       todas las opciones (--api=URL, --device=SERIAL, --universal)
setlocal
pushd "%~dp0mobile" || (echo No se encontro la carpeta mobile junto a este archivo. & exit /b 1)
where dart >nul 2>nul || (echo Falta Dart/Flutter en el PATH. Instala Flutter: https://docs.flutter.dev/get-started/install & exit /b 1)
call dart tool\apk.dart %*
set "apkExitCode=%errorlevel%"
popd
endlocal & exit /b %apkExitCode%
