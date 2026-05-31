# TraderLife 📊

KI-gestütztes Analyse-Tool für Aktien, ETFs und Krypto.  
Mobile-optimiert · Kostenlos hostbar

---

## Schnellstart (lokal testen)

### 1. Backend starten

```bash
cd backend
pip install -r requirements.txt
set GEMINI_API_KEY=dein-key-hier   # Windows
# export GEMINI_API_KEY=dein-key  # Mac/Linux
uvicorn main:app --reload
```

Backend läuft auf http://localhost:8000

### 2. Frontend starten

```bash
cd frontend
npm install
npm run dev
```

Frontend läuft auf http://localhost:5173

---

## Gemini API Key holen (kostenlos)

1. Gehe zu https://aistudio.google.com/app/apikey
2. Klicke "Create API Key"
3. Kopiere den Key und setze ihn als Umgebungsvariable (s.o.)

Das **Gemini 1.5 Flash** Modell ist kostenlos: 1 Million Tokens/Tag, 15 Anfragen/Minute.

---

## Deployment (kostenlos, vom Handy erreichbar)

### Backend → Render.com

1. GitHub-Account erstellen (falls nicht vorhanden)
2. Repo erstellen und den `backend/`-Ordner hochladen
3. Auf https://render.com einloggen
4. "New Web Service" → GitHub-Repo auswählen
5. Build Command: `pip install -r requirements.txt`
6. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
7. Environment Variable hinzufügen: `GEMINI_API_KEY` = dein Key
8. Deploy klicken → du bekommst eine URL wie `https://traderlife-api.onrender.com`

### Frontend → Vercel.com

1. Den `frontend/`-Ordner in ein eigenes GitHub-Repo pushen
2. Auf https://vercel.com einloggen (kostenlos mit GitHub)
3. "Add New Project" → Repo auswählen
4. Environment Variable setzen: `VITE_API_URL` = `https://traderlife-api.onrender.com/api`
5. Deploy → du bekommst eine URL, die vom Handy erreichbar ist

---

## Projektstruktur

```
trader life/
├── backend/
│   ├── main.py          # FastAPI Backend (Daten + AI)
│   ├── requirements.txt
│   └── render.yaml      # Render-Konfiguration
└── frontend/
    ├── src/
    │   ├── App.jsx           # Haupt-App
    │   ├── api.js            # API-Aufrufe
    │   └── components/
    │       ├── SearchBar.jsx     # Asset-Suche
    │       ├── CandleChart.jsx   # TradingView Chart
    │       ├── SignalCard.jsx    # KI-Signal Anzeige
    │       └── IndicatorPanel.jsx # Indikatoren
    ├── package.json
    └── vite.config.js
```

## Features

- **Candlestick Chart** mit SMA20 (TradingView Lightweight Charts)
- **KI-Signal**: BUY / SELL / HOLD mit Konfidenz, Begründung, Kursziele (Gemini Flash)
- **Technische Indikatoren**: RSI, MACD, Bollinger Bands, SMA20/50/200
- **Fundamentaldaten**: KGV, EPS, Beta, Marktkapitalisierung, Dividende
- **Suche**: Aktien, ETFs und Krypto
- **Mobile-first** Design

## Disclaimer

Keine Anlageberatung. Alle Signale sind algorithmisch generiert und dienen nur zu Informationszwecken.
