@echo off
setlocal
cd /d "%~dp0"
title Achado Agora Autoblog

if /i "%~1"=="login" goto login
if /i "%~1"=="gemini" goto gemini
if /i "%~1"=="gimini" goto gemini
if /i "%~1"=="mercadolivre" goto mercadolivre
if /i "%~1"=="ml" goto mercadolivre
if /i "%~1"=="facebook" goto facebook
if /i "%~1"=="diagnostico" goto diagnostico
if /i "%~1"=="diagnostics" goto diagnostico
if /i "%~1"=="check" goto check
if /i "%~1"=="ajuda" goto ajuda
if /i "%~1"=="help" goto ajuda

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node antes de iniciar.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm nao encontrado. Reinstale o Node com npm habilitado.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo package.json nao encontrado. Rode este arquivo dentro da pasta do projeto.
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

echo.
echo Iniciando Achado Agora Autoblog...
echo Site: http://127.0.0.1:4177/
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul && start "" "http://127.0.0.1:4177/""
call npm run dev
pause
exit /b %errorlevel%

:login
call npm run login
pause
exit /b %errorlevel%

:gemini
call npm run login -- gemini
pause
exit /b %errorlevel%

:mercadolivre
call npm run login -- mercadolivre
pause
exit /b %errorlevel%

:facebook
call npm run login -- facebook
pause
exit /b %errorlevel%

:diagnostico
call npm run diagnostics
pause
exit /b %errorlevel%

:check
call npm run check
pause
exit /b %errorlevel%

:ajuda
echo Uso:
echo   iniciar-sistema.bat              inicia servidor e abre painel
echo   iniciar-sistema.bat login        abre Chrome para logar ML/Gemini/Facebook
echo   iniciar-sistema.bat gemini       abre somente o Gemini
echo   iniciar-sistema.bat ml           abre somente Mercado Livre Afiliados
echo   iniciar-sistema.bat facebook     abre somente Facebook
echo   iniciar-sistema.bat diagnostico  roda diagnostico local
echo   iniciar-sistema.bat check        valida sintaxe dos arquivos
pause
exit /b 0
