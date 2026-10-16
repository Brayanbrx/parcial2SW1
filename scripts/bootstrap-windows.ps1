#Requires -RunAsAdministrator
<#
    Instala las herramientas del entorno en una maquina Windows 10/11 limpia.
    Las versiones son las de ADR-016 (matriz congelada).

    Uso, en PowerShell como administrador:
        .\scripts\bootstrap-windows.ps1
        .\scripts\bootstrap-windows.ps1 -ConMovil -ConExtras

    Al terminar hay que REINICIAR la maquina (Docker Desktop y WSL lo piden) y
    despues ejecutar scripts\preparar-entorno.ps1, que ya no necesita permisos
    de administrador.
#>
[CmdletBinding()]
param(
    # Android Studio, para compilar el APK de la app Flutter generada.
    [switch]$ConMovil,
    # Visual Studio Code y Postman, para la demostracion.
    [switch]$ConExtras
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$version_node = '22.15.0'

function Escribir-Paso { param([string]$texto) Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Escribir-Aviso { param([string]$texto) Write-Host "    aviso: $texto" -ForegroundColor Yellow }

function Actualizar-Entorno {
    # winget escribe las variables en el registro, no en esta sesion.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    foreach ($nombre in 'NVM_HOME', 'NVM_SYMLINK', 'JAVA_HOME') {
        $valor = [Environment]::GetEnvironmentVariable($nombre, 'Machine')
        if (-not $valor) { $valor = [Environment]::GetEnvironmentVariable($nombre, 'User') }
        if ($valor) { Set-Item -Path "env:$nombre" -Value $valor }
    }
}

function Instalar-Paquete {
    param([string]$Id, [string]$Nombre)

    winget list --id $Id --exact --accept-source-agreements 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    $Nombre ya esta instalado, se omite"
        return
    }

    Escribir-Paso "Instalando $Nombre"
    winget install --id $Id --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget no pudo instalar $Nombre (id $Id). Instalalo a mano y vuelve a ejecutar."
    }
    Actualizar-Entorno
}

# ------------------------------------------------------------------
# 0. Comprobaciones previas
# ------------------------------------------------------------------

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'Falta winget. Instala "Instalador de aplicaciones" desde Microsoft Store y repite.'
}

Escribir-Paso 'Herramientas a instalar'
Write-Host '    Git, NVM para Windows + Node 22.15.0, Docker Desktop, Java 21 (Temurin), Maven'
if ($ConMovil)  { Write-Host '    + Android Studio' }
if ($ConExtras) { Write-Host '    + VS Code y Postman' }

# ------------------------------------------------------------------
# 1. Base
# ------------------------------------------------------------------

Instalar-Paquete -Id 'Git.Git' -Nombre 'Git'

# ------------------------------------------------------------------
# 2. Node 22.15.0 exacto, via NVM para Windows
# ------------------------------------------------------------------

Instalar-Paquete -Id 'CoreyButler.NVMforWindows' -Nombre 'NVM para Windows'

if (Get-Command nvm -ErrorAction SilentlyContinue) {
    Escribir-Paso "Instalando Node $version_node"
    nvm install $version_node
    nvm use $version_node
    Actualizar-Entorno
} else {
    Escribir-Aviso 'nvm no esta todavia en el PATH de esta sesion.'
    Escribir-Aviso "Tras reiniciar, ejecuta: nvm install $version_node; nvm use $version_node"
}

# ------------------------------------------------------------------
# 3. Docker Desktop (necesita WSL 2)
# ------------------------------------------------------------------

Escribir-Paso 'Comprobando WSL 2'
wsl --status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host '    instalando WSL 2 (sin distribucion; Docker trae la suya)'
    wsl --install --no-distribution
    if ($LASTEXITCODE -ne 0) {
        Escribir-Aviso 'No se pudo instalar WSL automaticamente. Actualiza Windows y repite "wsl --install".'
    }
} else {
    Write-Host '    WSL ya esta disponible'
}

Instalar-Paquete -Id 'Docker.DockerDesktop' -Nombre 'Docker Desktop'

# ------------------------------------------------------------------
# 4. Java 21 y Maven: compilan el backend Spring Boot generado
# ------------------------------------------------------------------

Instalar-Paquete -Id 'EclipseAdoptium.Temurin.21.JDK' -Nombre 'Java 21 (Temurin)'
Instalar-Paquete -Id 'Apache.Maven' -Nombre 'Maven'

# ------------------------------------------------------------------
# 5. Opcionales
# ------------------------------------------------------------------

if ($ConMovil) {
    Instalar-Paquete -Id 'Google.AndroidStudio' -Nombre 'Android Studio'
    Escribir-Aviso 'Flutter no se instala con winget de forma fiable: descarga el SDK 3.44.2 (canal estable)'
    Escribir-Aviso 'de https://docs.flutter.dev/get-started/install/windows, descomprimelo en C:\src\flutter'
    Escribir-Aviso 'y anade C:\src\flutter\bin al PATH. Luego: flutter doctor --android-licenses'
}

if ($ConExtras) {
    Instalar-Paquete -Id 'Microsoft.VisualStudioCode' -Nombre 'Visual Studio Code'
    Instalar-Paquete -Id 'Postman.Postman' -Nombre 'Postman'
}

# ------------------------------------------------------------------
# 6. Siguiente paso
# ------------------------------------------------------------------

Escribir-Paso 'Instalacion de herramientas terminada'
Write-Host @'
    1. Reinicia la maquina.
    2. Abre Docker Desktop una vez y espera a que diga "Engine running".
    3. Abre PowerShell (usuario normal) en la carpeta del proyecto y ejecuta:
           .\scripts\preparar-entorno.ps1
'@ -ForegroundColor Green
