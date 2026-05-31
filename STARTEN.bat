@echo off
title TraderLife
echo.
echo  ====================================
echo    TraderLife - Wird gestartet...
echo  ====================================
echo.

cd /d "%~dp0backend"

python --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Python nicht gefunden!
    echo Bitte von https://python.org herunterladen.
    pause
    exit /b 1
)

:: Alten Prozess auf Port 8000 beenden
echo Stoppe alte Prozesse auf Port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo Prüfe/Installiere Pakete...
pip install fastapi uvicorn yfinance requests google-genai python-dotenv "httpx[socks]" aiofiles feedparser -q
echo.

echo Ermittle bestes Gemini-Modell...
set /p GEMINI_API_KEY="Gemini API Key eingeben: "
python check_models.py
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8000"

echo  App läuft auf: http://localhost:8000
echo  [Fenster offen lassen - Strg+C zum Beenden]
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
