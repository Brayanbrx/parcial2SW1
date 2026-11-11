@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Conexion SSH a la VM UML en Azure

rem Puedes completar estos valores para no introducirlos en cada conexion.
rem VM_USER es el usuario de Linux en la VM, no necesariamente el de Windows.
rem VM_KEY es la ruta de la clave privada, sin comillas; nunca su contenido.
set "VM_HOST=20.228.139.58"
set "VM_USER=azureuser"
set "VM_KEY="

if /i "%~1"=="--help" goto help
if /i "%~1"=="/?" goto help
if not "%~1"=="" set "VM_USER=%~1"
if not "%~2"=="" set "VM_KEY=%~2"

where ssh.exe >nul 2>&1
if errorlevel 1 goto no_ssh

echo.
echo Conexion SSH a %VM_HOST%
echo Para salir de la VM, escribe exit.
echo.
if defined VM_USER goto key
set /p "VM_USER=Usuario SSH de la VM: "
if not defined VM_USER goto no_user

:key
if defined VM_KEY goto check_key
echo Si usas una clave privada, introduce su ruta sin comillas.
echo Deja vacio para usar el agente SSH, las claves habituales o contrasena.
set /p "VM_KEY=Ruta de la clave privada [opcional]: "
if not defined VM_KEY goto default_auth

:check_key
if not exist "%VM_KEY%" goto no_key
echo.
echo Conectando a %VM_USER%@%VM_HOST%...
ssh.exe -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o IdentitiesOnly=yes -i "%VM_KEY%" "%VM_USER%@%VM_HOST%"
goto result

:default_auth
echo.
echo Conectando a %VM_USER%@%VM_HOST%...
ssh.exe -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "%VM_USER%@%VM_HOST%"

:result
set "SSH_RESULT=%ERRORLEVEL%"
echo.
if "%SSH_RESULT%"=="0" goto finished
echo No se pudo completar la conexion. Codigo: %SSH_RESULT%
echo Si ves Permission denied, revisa el usuario y la clave autorizada en la VM de Azure.
echo Si ves Connection timed out, revisa que la VM este encendida y permita SSH desde tu IP.
goto finished

:no_ssh
echo No se encontro OpenSSH Client en Windows.
echo Instalalo desde Configuracion, Caracteristicas opcionales, Cliente OpenSSH.
set "SSH_RESULT=1"
goto finished

:no_user
echo Debes indicar el usuario SSH de la VM.
set "SSH_RESULT=1"
goto finished

:no_key
echo No existe el archivo de clave indicado: "%VM_KEY%"
set "SSH_RESULT=1"
goto finished

:finished
pause
exit /b %SSH_RESULT%

:help
echo Uso: conectar-vm.bat [usuario_ssh] ["ruta_clave_privada"]
echo.
echo Sin argumentos, usa el usuario %VM_USER% y solicita una clave opcional.
echo Destino: %VM_HOST%, puerto SSH predeterminado 22.
echo Ejemplo: conectar-vm.bat azureuser "C:\Users\braya\Downloads\mi-vm_key.pem"
echo.
echo La clave privada debe corresponder a la clave publica autorizada en la VM de Azure.
echo En la primera conexion, verifica la huella del servidor antes de aceptarla.
exit /b 0
