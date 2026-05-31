@echo off
title TraderLife - Deploy
echo.
echo  Deploying TraderLife zu Google Cloud Run...
echo.

gcloud --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Google Cloud CLI nicht installiert.
    echo Download: https://cloud.google.com/sdk/docs/install
    pause
    exit /b 1
)

cd /d "%~dp0backend"

gcloud run deploy traderlife ^
  --source . ^
  --region europe-west1 ^
  --platform managed ^
  --allow-unauthenticated ^
  --set-env-vars GEMINI_API_KEY=%GEMINI_API_KEY% ^
  --memory 512Mi ^
  --project trader-life-1

echo.
echo  Fertig! Deine URL steht oben als "Service URL".
pause
