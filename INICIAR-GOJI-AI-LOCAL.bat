@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Necesitas instalar Node.js 20 o superior.
  echo Descarga Node.js desde https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Instalando dependencias de GOJI AI...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)
start "GOJI AI" "http://127.0.0.1:3000"
call npm run start:local
pause
