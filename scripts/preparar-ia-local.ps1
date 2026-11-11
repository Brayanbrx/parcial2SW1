<#
    Deja lista la IA local opcional (solo texto) en una maquina Windows con GPU
    NVIDIA. Pensado para la portatil de la defensa (ASUS TUF F15 FX506HC:
    RTX 3050 Laptop de 4 GB, i5-11400H, 16 GB de RAM). Ver ADR-027.

    Que hace:
      1. Comprueba la GPU y avisa si la portatil esta con bateria.
      2. Instala Ollama con winget si falta.
      3. Ajusta Ollama para 4 GB de VRAM: margen de VRAM de 512 MiB
         (LLAMA_ARG_FIT_TARGET) y modelo siempre cargado (OLLAMA_KEEP_ALIVE).
      4. Descarga gemma4:e4b. Si `ollama pull` falla (por ejemplo, una red
         con IPv6 roto), lo descarga por IPv4 con curl y verifica cada SHA-256.
      5. Crea gemma4-texto:e4b: el mismo modelo sin el proyector de imagenes,
         que en modo texto no se usa y ocupa ~1 GB de VRAM, con contexto 16384.
      6. Escribe las variables AI_LOCAL_* en infra\.env.
      7. Carga el modelo, mide una respuesta JSON y muestra cuantas capas
         quedaron en la GPU.

    Uso, en PowerShell normal desde cualquier carpeta del proyecto:
        .\scripts\preparar-ia-local.ps1
        .\scripts\preparar-ia-local.ps1 -KeepAlive 30m     # descargar si queda 30 min sin uso
        .\scripts\preparar-ia-local.ps1 -SaltarEnv         # no tocar infra\.env

    Despues hay que recrear la API para que lea infra\.env:
        docker compose -f infra/compose.yml --env-file infra/.env up -d api
#>
[CmdletBinding()]
param(
    # Modelo base del registro de Ollama.
    [string]$Modelo = 'gemma4:e4b',
    # Nombre de la variante solo texto que usa la plataforma.
    [string]$Nombre = 'gemma4-texto:e4b',
    # Contexto del modelo. La API reserva 4096 para la respuesta y su
    # estimador cuenta un token por byte: con menos de 16384 Instruir no cabe.
    [ValidateRange(16384, 131072)]
    [int]$Contexto = 16384,
    # VRAM (MiB) que llama-server deja libre. El valor de fabrica, 1024, deja
    # menos capas en una GPU de 4 GB.
    [ValidateRange(128, 4096)]
    [int]$MargenVram = 512,
    # Tiempo que Ollama mantiene el modelo cargado sin uso. -1 = siempre,
    # para que la primera pregunta de la defensa no espere la carga (~15 s).
    [string]$KeepAlive = '-1',
    # No modificar infra\.env.
    [switch]$SaltarEnv
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$raiz = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false
$api_ollama = 'http://127.0.0.1:11434'   # no localhost: PowerShell 5.1 prueba antes ::1 y agota la espera

function Escribir-Paso { param([string]$texto) Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Escribir-Aviso { param([string]$texto) Write-Host "    aviso: $texto" -ForegroundColor Yellow }

function Ruta-Ollama {
    $comando = Get-Command ollama -ErrorAction SilentlyContinue
    if ($comando) { return $comando.Source }
    $local = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $local) { return $local }
    return $null
}

function Esperar-Ollama {
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-RestMethod "$api_ollama/api/version" -TimeoutSec 2 | Out-Null; return } catch { Start-Sleep 1 }
    }
    throw "Ollama no respondio en $api_ollama. Abrelo desde el menu Inicio y vuelve a ejecutar."
}

function Modelo-Instalado { param([string]$nombre)
    try {
        $lista = Invoke-RestMethod "$api_ollama/api/tags" -TimeoutSec 10
        return [bool]($lista.models | Where-Object { $_.name -eq $nombre })
    } catch { return $false }
}

# Mismo formato que `ollama pull`: blobs por digest y manifiesto por etiqueta.
function Descargar-PorIPv4 { param([string]$modelo)
    $nombre, $etiqueta = $modelo.Split(':')
    if (-not $etiqueta) { $etiqueta = 'latest' }
    $carpeta = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama\models' }
    $blobs = Join-Path $carpeta 'blobs'
    $manifiestos = Join-Path $carpeta "manifests\registry.ollama.ai\library\$nombre"
    New-Item -ItemType Directory -Force $blobs, $manifiestos | Out-Null
    $registro = "https://registry.ollama.ai/v2/library/$nombre"
    $temporal = Join-Path $manifiestos ".$etiqueta.tmp"
    & curl.exe -4 -fsSL --retry 5 -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' "$registro/manifests/$etiqueta" -o $temporal
    if ($LASTEXITCODE -ne 0) { throw "No se pudo leer el manifiesto de $modelo." }
    $manifiesto = Get-Content $temporal -Raw | ConvertFrom-Json
    foreach ($capa in @($manifiesto.config) + @($manifiesto.layers)) {
        $archivo = Join-Path $blobs ($capa.digest -replace ':', '-')
        if ((Test-Path $archivo) -and (Get-Item $archivo).Length -eq $capa.size) { continue }
        Write-Host ("    descargando {0} ({1} MB)" -f $capa.digest.Substring(7, 12), [math]::Round($capa.size / 1MB))
        $ok = $false
        for ($intento = 1; $intento -le 8 -and -not $ok; $intento++) {
            & curl.exe -4 -fL --retry 5 --retry-delay 3 --speed-limit 1024 --speed-time 60 -C - -s -o "$archivo.partial" "$registro/blobs/$($capa.digest)"
            $ok = $LASTEXITCODE -eq 0
            if (-not $ok) { Start-Sleep 3 }
        }
        if (-not $ok) { throw "No se pudo descargar $($capa.digest)." }
        $hash = (Get-FileHash "$archivo.partial" -Algorithm SHA256).Hash.ToLower()
        if ("sha256:$hash" -ne $capa.digest) {
            Remove-Item "$archivo.partial" -Force
            throw "SHA-256 incorrecto en $($capa.digest). Vuelve a ejecutar el script."
        }
        Move-Item "$archivo.partial" $archivo -Force
    }
    Move-Item $temporal (Join-Path $manifiestos $etiqueta) -Force
}

function Fijar-Variable { param([string]$texto, [string]$clave, [string]$valor, [string]$nl)
    $patron = "(?m)^$([regex]::Escape($clave))=[^\r\n]*"
    if ([regex]::IsMatch($texto, $patron)) { return [regex]::Replace($texto, $patron, "$clave=$valor") }
    if ($texto.Length -gt 0 -and -not $texto.EndsWith("`n")) { $texto += $nl }
    return $texto + "$clave=$valor$nl"
}

# ------------------------------------------------------------------
# 1. GPU y energia
# ------------------------------------------------------------------

Escribir-Paso 'Comprobando GPU y energia'
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
    $gpu = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader) -join '; '
    Write-Host "    GPU: $gpu"
} else {
    Escribir-Aviso 'No se encontro una GPU NVIDIA (nvidia-smi). El modelo correra en CPU y sera lento; la plataforma usara los proveedores si tarda mas de 60 s.'
}
$bateria = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($bateria -and $bateria.BatteryStatus -ne 2) {
    Escribir-Aviso 'La portatil esta usando la bateria: conecta el cargador. Con bateria la GPU baja mucho su rendimiento.'
}

# ------------------------------------------------------------------
# 2. Ollama instalado
# ------------------------------------------------------------------

Escribir-Paso 'Comprobando Ollama'
$ollama = Ruta-Ollama
if (-not $ollama) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Falta Ollama y no hay winget. Instalalo desde https://ollama.com/download/windows y vuelve a ejecutar.'
    }
    Write-Host '    Instalando Ollama con winget...'
    & winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
    $ollama = Ruta-Ollama
    if (-not $ollama) { throw 'winget termino pero no se encuentra ollama.exe. Instalalo desde https://ollama.com/download/windows.' }
}
Write-Host "    $(& $ollama --version)"

# ------------------------------------------------------------------
# 3. Ajustes para 4 GB de VRAM y reinicio
# ------------------------------------------------------------------

Escribir-Paso "Ajustando Ollama (margen de VRAM $MargenVram MiB, modelo cargado: $KeepAlive)"
$ajustes = @{
    LLAMA_ARG_FIT_TARGET  = "$MargenVram"
    OLLAMA_KEEP_ALIVE     = $KeepAlive
    OLLAMA_CONTEXT_LENGTH = "$Contexto"
}
foreach ($clave in $ajustes.Keys) {
    [Environment]::SetEnvironmentVariable($clave, $ajustes[$clave], 'User')
    Set-Item "env:$clave" $ajustes[$clave]
    Write-Host "    $clave=$($ajustes[$clave])"
}
Get-Process 'ollama app', 'ollama', 'llama-server' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
$app = Join-Path (Split-Path $ollama) 'ollama app.exe'
if (Test-Path $app) { Start-Process $app } else { Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden }
Esperar-Ollama
Write-Host '    Ollama reiniciado con los ajustes'

# ------------------------------------------------------------------
# 4. Descarga del modelo base
# ------------------------------------------------------------------

Escribir-Paso "Descargando $Modelo (solo la primera vez; gemma4:e4b pesa 6.6 GB)"
if (Modelo-Instalado $Modelo) {
    Write-Host '    Ya estaba descargado'
} else {
    & $ollama pull $Modelo
    if ($LASTEXITCODE -ne 0 -or -not (Modelo-Instalado $Modelo)) {
        Escribir-Aviso '`ollama pull` fallo; se reintenta por IPv4 con curl.'
        Descargar-PorIPv4 $Modelo
        if (-not (Modelo-Instalado $Modelo)) { throw "Ollama no ve $Modelo despues de descargarlo." }
    }
}

# ------------------------------------------------------------------
# 5. Variante solo texto
# ------------------------------------------------------------------

Escribir-Paso "Creando $Nombre (sin proyector de imagenes, contexto $Contexto)"
$base = & $ollama show $Modelo --modelfile
if ($LASTEXITCODE -ne 0) { throw "No se pudo leer el Modelfile de $Modelo." }
$lineas = New-Object System.Collections.Generic.List[string]
$froms = 0
foreach ($linea in $base) {
    if ($linea -match '^FROM ') {
        $froms++
        # El primer FROM son los pesos; los siguientes, el proyector de imagenes.
        if ($froms -gt 1) { continue }
    }
    if ($linea -match '^PARAMETER num_ctx ') { continue }
    $lineas.Add($linea)
}
$lineas.Add("PARAMETER num_ctx $Contexto")
$modelfile = Join-Path $env:TEMP 'umlforge-ia-local.Modelfile'
[IO.File]::WriteAllLines($modelfile, $lineas, $utf8)
& $ollama create $Nombre -f $modelfile
if ($LASTEXITCODE -ne 0) { throw "ollama create $Nombre fallo." }
Remove-Item $modelfile -Force
$detalle = (& $ollama show $Nombre) -join "`n"
if ($detalle -match '(?m)^\s+vision\s*$') { Escribir-Aviso "$Nombre todavia declara vision: revisa el Modelfile." }
else { Write-Host "    $Nombre listo (sin vision; los pesos se comparten con $Modelo, no ocupa disco extra)" }

# ------------------------------------------------------------------
# 6. infra\.env
# ------------------------------------------------------------------

$ruta_env = Join-Path $raiz 'infra\.env'
if ($SaltarEnv) {
    Escribir-Paso 'infra\.env: sin cambios (-SaltarEnv)'
} elseif (-not (Test-Path $ruta_env)) {
    Escribir-Aviso 'No existe infra\.env. Ejecuta antes scripts\preparar-entorno.ps1 y repite este script.'
} else {
    Escribir-Paso 'Escribiendo AI_LOCAL_* en infra\.env'
    $texto = [IO.File]::ReadAllText($ruta_env)
    $nl = if ($texto.Contains("`r`n")) { "`r`n" } else { "`n" }
    if (-not [regex]::IsMatch($texto, '(?m)^AI_LOCAL_MODEL=')) {
        if ($texto.Length -gt 0 -and -not $texto.EndsWith("`n")) { $texto += $nl }
        $texto += "$nl# IA local opcional (scripts\preparar-ia-local.ps1, ADR-027)$nl"
    }
    $valores = [ordered]@{
        AI_LOCAL_BASE_URL          = 'http://host.docker.internal:11434/v1'
        AI_LOCAL_MODEL             = $Nombre
        AI_LOCAL_TIMEOUT_MS        = '300000'
        AI_LOCAL_CONTEXT_WINDOW    = "$Contexto"
        AI_LOCAL_MAX_OUTPUT_TOKENS = '4096'
        AI_LOCAL_REASONING         = 'none'
    }
    foreach ($clave in $valores.Keys) {
        $texto = Fijar-Variable $texto $clave $valores[$clave] $nl
        Write-Host "    $clave=$($valores[$clave])"
    }
    [IO.File]::WriteAllText($ruta_env, $texto, $utf8)
}

# ------------------------------------------------------------------
# 7. Carga y prueba
# ------------------------------------------------------------------

Escribir-Paso 'Cargando el modelo en la GPU y probando una respuesta JSON'
$carga = Measure-Command {
    Invoke-RestMethod "$api_ollama/api/generate" -Method Post -ContentType 'application/json' -TimeoutSec 300 `
        -Body (@{ model = $Nombre; prompt = 'hola'; stream = $false; think = $false; options = @{ num_predict = 1 } } | ConvertTo-Json)
}
Write-Host ("    carga: {0:N1} s" -f $carga.TotalSeconds)
$cuerpo = @{
    model            = $Nombre
    temperature      = 0
    max_tokens       = 40
    reasoning_effort = 'none'
    response_format  = @{ type = 'json_object' }
    messages         = @(@{ role = 'user'; content = 'Responde solo este JSON: {"listo": true}' })
} | ConvertTo-Json -Depth 5
$respuesta = $null
$prueba = Measure-Command {
    $respuesta = Invoke-RestMethod "$api_ollama/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $cuerpo -TimeoutSec 120
}
Write-Host ("    respuesta en {0:N1} s: {1}" -f $prueba.TotalSeconds, $respuesta.choices[0].message.content.Trim())

$registro = Join-Path $env:LOCALAPPDATA 'Ollama\server.log'
if (Test-Path $registro) {
    # El modelo borrador (MTP) tambien registra sus capas (5/5): tomar la del principal.
    $capas = Select-String -Path $registro -Pattern 'offloaded (\d+)/(\d+) layers to GPU' |
        Where-Object { [int]$_.Matches[0].Groups[2].Value -ge 10 } | Select-Object -Last 1
    if ($capas) {
        $en_gpu = [int]$capas.Matches[0].Groups[1].Value
        $total = [int]$capas.Matches[0].Groups[2].Value
        Write-Host "    capas en la GPU: $en_gpu de $total"
        if ($en_gpu -lt [math]::Floor($total * 0.6)) {
            Escribir-Aviso 'Pocas capas en la GPU: cierra juegos o programas que usen la GPU y vuelve a ejecutar. Revisar puede tardar mas de 30 s.'
        }
    }
}
& $ollama ps

Write-Host "`nListo. Siguientes pasos:" -ForegroundColor Green
Write-Host '  1. Recrear la API para que lea infra\.env:'
Write-Host '       docker compose -f infra/compose.yml --env-file infra/.env up -d api'
Write-Host '  2. En una pizarra, como OWNER: Configurar IA -> Motor de IA -> Modelo local.'
Write-Host '  Si el modelo local falla o tarda mas de 60 s, responden los proveedores en la nube.'
Write-Host '  Para la voz local (Whisper): .\scripts\voz-local.ps1'
