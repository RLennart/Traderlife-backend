@echo off
echo ========================================
echo   TraderLife - Frontend starten
echo ========================================
echo.

cd /d "%~dp0frontend"

:: Node.js prüfen
node --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js nicht gefunden!
    echo Bitte installiere Node.js von https://nodejs.org
    pause
    exit /b 1
)

:: npm install (nur wenn node_modules fehlt)
if not exist "node_modules" (
    echo Installiere npm Pakete (einmalig)...
    npm install
)

echo.
echo Frontend startet auf http://localhost:5173
echo Öffne http://localhost:5173 im Browser!
echo.
npm run dev

pause
