@echo off
echo ========================================
echo   TraderLife - Backend starten
echo ========================================
echo.

cd /d "%~dp0backend"

:: Python prüfen
python --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Python nicht gefunden!
    echo Bitte installiere Python von https://python.org
    pause
    exit /b 1
)

:: Abhängigkeiten installieren (nur beim ersten Mal)
if not exist ".installed" (
    echo Installiere Abhängigkeiten (einmalig)...
    pip install fastapi uvicorn yfinance requests google-genai python-dotenv httpx[socks]
    echo. > .installed
)

echo.
echo Backend startet auf http://localhost:8000
echo Lass dieses Fenster offen!
echo.
set /p GEMINI_API_KEY="Gemini API Key eingeben: "
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

pause
