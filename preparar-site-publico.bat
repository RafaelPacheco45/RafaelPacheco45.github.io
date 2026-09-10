@echo off
setlocal
cd /d "%~dp0"
title Preparar site publico - Achado Agora

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  pause
  exit /b 1
)

if not exist "node_modules\playwright-core" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo Falha no npm install.
    pause
    exit /b 1
  )
)

if "%~1"=="" (
  call npm run build:public
) else (
  call npm run build:public -- --url=%~1
)

if errorlevel 1 (
  echo Falha ao preparar o site publico.
  pause
  exit /b 1
)

echo.
echo Pronto. Suba somente a pasta:
echo %~dp0public-site
echo.
echo Se ja tiver uma URL pages.dev, rode:
echo preparar-site-publico.bat https://seu-site.pages.dev
pause
exit /b 0
