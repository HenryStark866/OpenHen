@echo off
title OpenHen Bot 24/7
echo ============================================
echo   OpenHen Bot - Auto-Restart Mode
echo   Presiona Ctrl+C para detener
echo ============================================
echo.

:loop
echo [%date% %time%] Iniciando OpenHen Bot...
node dist/index.js

if %errorlevel% neq 0 (
    echo.
    echo [%date% %time%] ERROR: El bot se detuvo con codigo %errorlevel%
    echo [%date% %time%] Reiniciando en 5 segundos...
    timeout /t 5 /nobreak >nul
    goto loop
) else (
    echo.
    echo [%date% %time%] Bot detenido limpiamente.
    echo Presiona cualquier tecla para salir o cierra esta ventana.
    pause
    exit /b 0
)
