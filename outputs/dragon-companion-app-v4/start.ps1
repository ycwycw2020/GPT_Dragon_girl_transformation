param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
if ($CheckOnly) {
  $nodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
  & $nodePath (Join-Path $appRoot '../live2d-preview-v4/verify-models.mjs') --model working_thinking
  exit $LASTEXITCODE
}
$electronPath = Join-Path $appRoot 'runtime/electron-44.5.1/electron.exe'
if (-not (Test-Path -LiteralPath $electronPath)) { $electronPath = Join-Path $appRoot 'node_modules/electron/dist/electron.exe' }
if (-not (Test-Path -LiteralPath $electronPath)) {
  throw 'Electron is not installed locally. Run install-runtime.ps1 in this folder.'
}
$sessionRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot '../../work/desktop-app-v4'))
New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
$desktopProcess = Start-Process -FilePath $electronPath -ArgumentList ('"' + $appRoot + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $sessionRoot 'desktop.stdout.log') -RedirectStandardError (Join-Path $sessionRoot 'desktop.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $sessionRoot 'desktop.pid') -Value $desktopProcess.Id
Write-Output "Dragon companion started. PID=$($desktopProcess.Id)"
