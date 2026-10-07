@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "GPT_NIANG_EXE=%~dp0runtime\electron-44.5.1\electron.exe"
if not exist "%GPT_NIANG_EXE%" set "GPT_NIANG_EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%GPT_NIANG_EXE%" (
  echo GPT companion runtime is missing. Restore the complete portable package.
  exit /b 1
)
start "" /D "%~dp0." "%GPT_NIANG_EXE%" "%~dp0."
