$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskMobile = Join-Path $taskRoot 'generated-output\primer-app-fix\mobile'
$taskDart = 'C:\flutter\bin\cache\dart-sdk\bin\dart.exe'
$taskLogs = Join-Path $taskRoot 'tmp\phone-connection'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskLog = Join-Path $taskLogs 'usb-watch.log'
Set-Location -LiteralPath $taskMobile
# The Dart watcher locks this specific serial/port to avoid duplicate monitors.
# No credentials, business records, or other connected devices are accessed.
& $taskDart 'tool/apk.dart' 'usb' '--watch' '--device=9L45O7HAS4LBIFCA' '--port=8082' *>> $taskLog
