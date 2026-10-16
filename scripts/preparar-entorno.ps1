<#
    Deja la plataforma corriendo en una maquina que ya tiene Node, Docker y Git
    (ver scripts\bootstrap-windows.ps1).

    Hace lo del arranque rapido del README: dependencias del lockfile, infra\.env
    con secretos nuevos, contenedores arriba y cuentas de demostracion.

    Uso, en PowerShell normal desde cualquier carpeta del proyecto:
        .\scripts\preparar-entorno.ps1
        .\scripts\preparar-entorno.ps1 -SaltarSeed
#>
[CmdletBinding()]
param(
    # No crear las cuentas ana@demo.local y beto@demo.local.
    [switch]$SaltarSeed,
    # Reinstalar node_modules aunque ya existan.
    [switch]$Limpiar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Escribir-Paso { param([string]$texto) Write-Host "`n==> $texto" -ForegroundColor Cyan }

function Secreto-Nuevo {
    param([int]$bytes = 48)
    $datos = [byte[]]::new($bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($datos)
    # base64url: sin +, / ni =, para que no rompa una cadena de conexion.
    [Convert]::ToBase64String($datos).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# ------------------------------------------------------------------
# 1. Requisitos presentes
# ------------------------------------------------------------------

Escribir-Paso 'Comprobando requisitos'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Falta Node. Ejecuta antes scripts\bootstrap-windows.ps1 y reinicia.'
}

$version_node = (node --version).TrimStart('v')
$minimo = [version]'22.15.0'
if ([version]($version_node -replace '-.*$', '') -lt $minimo) {
    throw "Node $version_node es anterior a 22.15.0 (package.json engines). Usa: nvm use 22.15.0"
}
Write-Host "    Node $version_node"
Write-Host "    npm  $(npm --version)"

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falta Docker Compose v2. Instala Docker Desktop.' }

docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker esta instalado pero no corriendo. Abre Docker Desktop y espera a "Engine running".' }
Write-Host '    Docker en marcha'

# ------------------------------------------------------------------
# 2. Dependencias exactas del lockfile
# ------------------------------------------------------------------

if ($Limpiar -and (Test-Path node_modules)) {
    Escribir-Paso 'Borrando node_modules'
    Remove-Item -Recurse -Force node_modules
}

Escribir-Paso 'Instalando dependencias (npm ci)'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci fallo.' }

# ------------------------------------------------------------------
# 3. Configuracion local
# ------------------------------------------------------------------

$ruta_env = Join-Path $raiz 'infra\.env'

if (Test-Path $ruta_env) {
    Escribir-Paso 'infra\.env ya existe: se respeta tal cual'
    Write-Host '    (si quieres empezar de cero, borralo y vuelve a ejecutar)'
} else {
    Escribir-Paso 'Creando infra\.env con secretos nuevos'
    Copy-Item (Join-Path $raiz 'infra\.env.example') $ruta_env

    $clave_db = Secreto-Nuevo -bytes 24
    $secreto_jwt = Secreto-Nuevo -bytes 48

    $texto = Get-Content $ruta_env -Raw
    $usuario = ([regex]::Match($texto, '(?m)^POSTGRES_USER=(.*)$')).Groups[1].Value.Trim()
    $base = ([regex]::Match($texto, '(?m)^POSTGRES_DB=(.*)$')).Groups[1].Value.Trim()
    $puerto_db = ([regex]::Match($texto, '(?m)^DB_PORT=(.*)$')).Groups[1].Value.Trim()

    $texto = $texto -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$clave_db"
    $texto = $texto -replace '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secreto_jwt"
    $texto = $texto -replace '(?m)^DATABASE_URL=.*$', `
        "DATABASE_URL=postgresql://${usuario}:${clave_db}@localhost:${puerto_db}/${base}"

    Set-Content -Path $ruta_env -Value $texto -NoNewline -Encoding utf8
    Write-Host '    POSTGRES_PASSWORD, JWT_SECRET y DATABASE_URL generados'
    Write-Host '    Los proveedores de IA quedan en mock: sin claves, el asistente responde igual.'
}

$contenido_env = Get-Content $ruta_env -Raw
$puerto_api = ([regex]::Match($contenido_env, '(?m)^API_PORT=(\d+)$')).Groups[1].Value
$puerto_collab = ([regex]::Match($contenido_env, '(?m)^COLLAB_PORT=(\d+)$')).Groups[1].Value
$puerto_web = ([regex]::Match($contenido_env, '(?m)^WEB_PORT=(\d+)$')).Groups[1].Value
if (-not $puerto_api) { $puerto_api = '3001' }
if (-not $puerto_collab) { $puerto_collab = '3002' }
if (-not $puerto_web) { $puerto_web = '8080' }

# ------------------------------------------------------------------
# 4. Contenedores (db, migraciones, api, collab, web)
# ------------------------------------------------------------------

Escribir-Paso 'Levantando el entorno (la primera vez compila las imagenes: puede tardar)'
npm run up
if ($LASTEXITCODE -ne 0) { throw 'docker compose up fallo. Revisa: npm run ps' }

Escribir-Paso 'Esperando a que la API responda'
$limite = (Get-Date).AddMinutes(5)
$sana = $false
while ((Get-Date) -lt $limite) {
    try {
        $respuesta = Invoke-WebRequest -Uri "http://localhost:$puerto_api/health" -UseBasicParsing -TimeoutSec 3
        if ($respuesta.StatusCode -eq 200) { $sana = $true; break }
    } catch {
        Start-Sleep -Seconds 4
    }
}
if (-not $sana) {
    npm run ps
    throw "La API no respondio en /health. Mira los registros: docker compose -f infra/compose.yml --env-file infra/.env logs api"
}
Write-Host '    API sana'

# ------------------------------------------------------------------
# 5. Datos de demostracion
# ------------------------------------------------------------------

if (-not $SaltarSeed) {
    Escribir-Paso 'Creando cuentas y proyecto de demostracion'
    npm run seed
    if ($LASTEXITCODE -ne 0) { Write-Host '    el seed fallo; puedes repetirlo con: npm run seed' -ForegroundColor Yellow }
}

# ------------------------------------------------------------------
# 6. Resumen
# ------------------------------------------------------------------

Escribir-Paso 'Entorno listo'
Write-Host @"
    Interfaz          http://localhost:$puerto_web
    API               http://localhost:$puerto_api/health
    Colaboracion      http://localhost:$puerto_collab/health

    Cuentas de demostracion (misma clave: demo-plataforma-uml)
      ana@demo.local    propietaria
      beto@demo.local   editor

    Comprobacion rapida   npm run check
    Apagar                npm run down
"@ -ForegroundColor Green
