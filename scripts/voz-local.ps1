<#
    Voz local (Whisper) para Dictar y Comando de voz cuando el proyecto usa
    "Motor de IA -> Modelo local". Ver ADR-027.

    Que hace:
      1. Descarga whisper.cpp (b5454, binario para CPU) y los DOS modelos:
           small -> ggml-small-q5_1.bin          (181 MB, por defecto: ~1 s un comando)
           turbo -> ggml-large-v3-turbo-q5_0.bin (547 MB, alternativa: ~3 s un comando)
         Medido en un i5-12400 con la ventana ajustada al audio que envia la API.
         Verifica el SHA-256 oficial de cada archivo.
      2. Arranca whisper-server en http://127.0.0.1:8178 con la ruta
         compatible con OpenAI (/v1/audio/transcriptions), en espanol.
         Corre en la CPU: la GPU de 4 GB queda para el modelo de texto.
      3. Mide una transcripcion de prueba.
      4. Escribe AI_LOCAL_SPEECH_* en infra\.env.

    Uso, en PowerShell normal desde cualquier carpeta del proyecto:
        .\scripts\voz-local.ps1                 # instala si falta y arranca con small
        .\scripts\voz-local.ps1 -Modelo turbo   # cambia al otro modelo (y al reves con small)
        .\scripts\voz-local.ps1 -Detener        # apaga el servidor de voz

    whisper-server se apaga al reiniciar Windows: vuelve a ejecutar el script.
    La primera vez, recrea la API para que lea infra\.env:
        docker compose -f infra/compose.yml --env-file infra/.env up -d api
#>
[CmdletBinding()]
param(
    [ValidateSet('turbo', 'small')]
    [string]$Modelo = 'small',
    [int]$Puerto = 8178,
    # Hilos de CPU. 0 = un hilo por nucleo fisico.
    [int]$Hilos = 0,
    [switch]$Detener,
    # No modificar infra\.env.
    [switch]$SaltarEnv,
    # Carpeta con los archivos ya descargados (por ejemplo, copiados desde otro PC).
    [string]$Origen = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$raiz = Split-Path -Parent $PSScriptRoot
$carpeta = Join-Path $env:LOCALAPPDATA 'UmlForge\whisper'
$utf8 = New-Object System.Text.UTF8Encoding $false
$version = 'b5454'
$hf = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
$archivos = @(
    @{ Nombre = 'whisper-bin-x64.zip'; Tamano = 8928640
       Sha = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
       Url = "https://github.com/ggml-org/whisper.cpp/releases/download/$version/whisper-bin-x64.zip" },
    @{ Nombre = 'ggml-large-v3-turbo-q5_0.bin'; Tamano = 574041195
       Sha = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
       Url = "$hf/ggml-large-v3-turbo-q5_0.bin" },
    @{ Nombre = 'ggml-small-q5_1.bin'; Tamano = 190085487
       Sha = 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
       Url = "$hf/ggml-small-q5_1.bin" }
)
$modelos = @{
    turbo = @{ Archivo = 'ggml-large-v3-turbo-q5_0.bin'; Nombre = 'whisper-large-v3-turbo' }
    small = @{ Archivo = 'ggml-small-q5_1.bin'; Nombre = 'whisper-small' }
}

function Escribir-Paso { param([string]$texto) Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Escribir-Aviso { param([string]$texto) Write-Host "    aviso: $texto" -ForegroundColor Yellow }

function Detener-Whisper {
    Get-Process 'whisper-server' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 1
}

function Obtener-Archivo { param($archivo)
    $destino = Join-Path $carpeta $archivo.Nombre
    $marca = "$destino.sha256"
    if ((Test-Path $destino) -and (Test-Path $marca) -and
        (Get-Item $destino).Length -eq $archivo.Tamano -and
        (Get-Content $marca -Raw).Trim() -eq $archivo.Sha) {
        Write-Host "    $($archivo.Nombre): ya estaba"
        return
    }
    $copia = if ($Origen) { Join-Path $Origen $archivo.Nombre } else { '' }
    if ($copia -and (Test-Path $copia)) {
        Write-Host "    $($archivo.Nombre): copiando desde $Origen"
        Copy-Item $copia "$destino.partial" -Force
    } else {
        Write-Host ("    {0}: descargando ({1} MB)" -f $archivo.Nombre, [math]::Round($archivo.Tamano / 1MB))
        $ok = $false
        for ($intento = 1; $intento -le 6 -and -not $ok; $intento++) {
            # -4: algunas redes tienen IPv6 roto y la descarga se cuelga.
            & curl.exe -4 -fL --retry 5 --retry-delay 3 --speed-limit 1024 --speed-time 60 -C - -s -o "$destino.partial" $archivo.Url
            $ok = $LASTEXITCODE -eq 0
            if (-not $ok) { Start-Sleep 3 }
        }
        if (-not $ok) { throw "No se pudo descargar $($archivo.Url)." }
    }
    $hash = (Get-FileHash "$destino.partial" -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $archivo.Sha) {
        Remove-Item "$destino.partial" -Force
        throw "SHA-256 incorrecto en $($archivo.Nombre). Vuelve a ejecutar el script."
    }
    Move-Item "$destino.partial" $destino -Force
    [IO.File]::WriteAllText($marca, $archivo.Sha, $utf8)
}

function Fijar-Variable { param([string]$texto, [string]$clave, [string]$valor, [string]$nl)
    $patron = "(?m)^$([regex]::Escape($clave))=[^\r\n]*"
    if ([regex]::IsMatch($texto, $patron)) { return [regex]::Replace($texto, $patron, "$clave=$valor") }
    if ($texto.Length -gt 0 -and -not $texto.EndsWith("`n")) { $texto += $nl }
    return $texto + "$clave=$valor$nl"
}

$frasePrueba = 'Crea la clase Producto con atributo precio decimal'

# Frase real en espanol con la voz de Windows (WAV de 16 kHz mono). Un tono o
# ruido haria "alucinar" a Whisper y la medicion no serviria. Devuelve $false si
# no hay voz en espanol (o System.Speech, que falta en PowerShell 7).
function Escribir-WavPrueba { param([string]$ruta)
    try {
        Add-Type -AssemblyName System.Speech
        $voz = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $espanol = $voz.GetInstalledVoices() |
            Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'es-*' } | Select-Object -First 1
        if (-not $espanol) { $voz.Dispose(); return $false }
        $voz.SelectVoice($espanol.VoiceInfo.Name)
        $formato = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, `
            ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
        $voz.SetOutputToWaveFile($ruta, $formato)
        $voz.Speak($frasePrueba)
        $voz.Dispose()
        return $true
    } catch {
        return $false
    }
}

if ($Detener) {
    Detener-Whisper
    Write-Host 'Servidor de voz detenido.'
    return
}

# ------------------------------------------------------------------
# 1. Archivos
# ------------------------------------------------------------------

Escribir-Paso "Preparando whisper.cpp $version y los dos modelos en $carpeta"
New-Item -ItemType Directory -Force $carpeta | Out-Null
foreach ($archivo in $archivos) { Obtener-Archivo $archivo }
$servidor = Join-Path $carpeta 'bin\Release\whisper-server.exe'
if (-not (Test-Path $servidor)) {
    Expand-Archive (Join-Path $carpeta 'whisper-bin-x64.zip') (Join-Path $carpeta 'bin') -Force
}
if (-not (Test-Path $servidor)) { throw "El zip de whisper.cpp no trae whisper-server.exe." }

# ------------------------------------------------------------------
# 2. Arranque
# ------------------------------------------------------------------

if ($Hilos -le 0) {
    $Hilos = [int](Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum
    if ($Hilos -le 0) { $Hilos = 4 }
}
$elegido = $modelos[$Modelo]
$archivoModelo = Join-Path $carpeta $elegido.Archivo
Escribir-Paso "Arrancando whisper-server con $($elegido.Nombre) ($Hilos hilos de CPU, puerto $Puerto)"
Detener-Whisper
$argumentos = @(
    '-m', "`"$archivoModelo`"", '-l', 'es', '-t', "$Hilos",
    '--host', '127.0.0.1', '--port', "$Puerto",
    '--inference-path', '/v1/audio/transcriptions'
)
Start-Process -FilePath $servidor -ArgumentList $argumentos -WorkingDirectory (Split-Path $servidor) `
    -WindowStyle Hidden -RedirectStandardError (Join-Path $carpeta 'whisper-server.log') `
    -RedirectStandardOutput (Join-Path $carpeta 'whisper-server.out')
$listo = $false
for ($i = 0; $i -lt 60 -and -not $listo; $i++) {
    try { Invoke-WebRequest "http://127.0.0.1:$Puerto/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $listo = $true }
    catch { Start-Sleep 1 }
}
if (-not $listo) { throw "whisper-server no respondio. Revisa $(Join-Path $carpeta 'whisper-server.log')." }
Write-Host '    whisper-server en marcha'

# ------------------------------------------------------------------
# 3. Prueba
# ------------------------------------------------------------------

$wav = Join-Path $carpeta 'prueba.wav'
if (Escribir-WavPrueba $wav) {
    Escribir-Paso "Midiendo con la frase: `"$frasePrueba`""
    # La API limita la ventana de Whisper a la duracion del audio (audio_ctx); medir igual.
    $segundos = ((Get-Item $wav).Length - 44) / 32000
    $contexto = [math]::Max(128, [math]::Ceiling($segundos * 50) + 64)
    foreach ($vuelta in 1, 2) {
        $salida = $null
        $tiempo = Measure-Command {
            $salida = & curl.exe -s -F "file=@$wav" -F language=es -F response_format=json -F "audio_ctx=$contexto" "http://127.0.0.1:$Puerto/v1/audio/transcriptions"
        }
        $texto = try { (($salida -join '') | ConvertFrom-Json).text.Trim() } catch { "$salida" }
        Write-Host ("    intento {0}: {1:N1} s -> {2}" -f $vuelta, $tiempo.TotalSeconds, $texto)
    }
    if ($tiempo.TotalSeconds -gt 4) {
        $otro = if ($Modelo -eq 'turbo') { 'small' } else { 'turbo' }
        Escribir-Aviso "Mas de 4 s por comando en esta CPU. Si molesta, prueba: .\scripts\voz-local.ps1 -Modelo $otro"
    }
} else {
    Escribir-Aviso 'Sin voz de Windows en espanol (o en PowerShell 7): se omite la medicion. Ejecuta con Windows PowerShell para medir.'
}

# ------------------------------------------------------------------
# 4. infra\.env
# ------------------------------------------------------------------

$ruta_env = Join-Path $raiz 'infra\.env'
if ($SaltarEnv) {
    Escribir-Paso 'infra\.env: sin cambios (-SaltarEnv)'
} elseif (-not (Test-Path $ruta_env)) {
    Escribir-Aviso 'No existe infra\.env. Ejecuta antes scripts\preparar-entorno.ps1 y repite este script.'
} else {
    Escribir-Paso 'Escribiendo AI_LOCAL_SPEECH_* en infra\.env'
    $texto = [IO.File]::ReadAllText($ruta_env)
    $nl = if ($texto.Contains("`r`n")) { "`r`n" } else { "`n" }
    $antes = [regex]::Match($texto, '(?m)^AI_LOCAL_SPEECH_MODEL=([^\r\n]*)').Groups[1].Value
    if (-not [regex]::IsMatch($texto, '(?m)^AI_LOCAL_SPEECH_BASE_URL=')) {
        if ($texto.Length -gt 0 -and -not $texto.EndsWith("`n")) { $texto += $nl }
        $texto += "$nl# Voz local opcional (scripts\voz-local.ps1, ADR-027)$nl"
    }
    $valores = [ordered]@{
        AI_LOCAL_SPEECH_BASE_URL   = "http://host.docker.internal:$Puerto/v1"
        AI_LOCAL_SPEECH_MODEL      = $elegido.Nombre
        AI_LOCAL_SPEECH_TIMEOUT_MS = '30000'
    }
    foreach ($clave in $valores.Keys) {
        $texto = Fijar-Variable $texto $clave $valores[$clave] $nl
        Write-Host "    $clave=$($valores[$clave])"
    }
    [IO.File]::WriteAllText($ruta_env, $texto, $utf8)
    if ($antes -and $antes -ne $elegido.Nombre) {
        Write-Host "    (antes: $antes. La voz ya usa el modelo nuevo; recrear la API solo actualiza el nombre que se muestra)"
    }
}

Write-Host "`nListo. Voz local con $($elegido.Nombre)." -ForegroundColor Green
Write-Host '  - La primera vez, recrea la API: docker compose -f infra/compose.yml --env-file infra/.env up -d api'
Write-Host '  - En la pizarra, como OWNER: Configurar IA -> Motor de IA -> Modelo local.'
Write-Host '  - Para alternar: .\scripts\voz-local.ps1 -Modelo turbo   (o -Modelo small)'
Write-Host '  - Si Whisper local falla, transcriben los proveedores en la nube.'
