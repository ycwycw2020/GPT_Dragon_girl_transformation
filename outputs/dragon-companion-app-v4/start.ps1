$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$env:ELECTRON_RUN_AS_NODE = $null
$electronPath = Join-Path $appRoot 'runtime/electron-44.5.1/electron.exe'
if (-not (Test-Path -LiteralPath $electronPath)) { $electronPath = Join-Path $appRoot 'node_modules/electron/dist/electron.exe' }
if (-not (Test-Path -LiteralPath $electronPath)) {
  throw 'Electron runtime is missing. Extract the complete portable release.'
}
$sessionRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot '../../work/desktop-app-v4'))
New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
$desktopProcess = Start-Process -FilePath $electronPath -ArgumentList ('"' + $appRoot + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $sessionRoot 'desktop.stdout.log') -RedirectStandardError (Join-Path $sessionRoot 'desktop.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $sessionRoot 'desktop.pid') -Value $desktopProcess.Id
Write-Output "Dragon companion started. PID=$($desktopProcess.Id)"
