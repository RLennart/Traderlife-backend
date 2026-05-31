# TraderLife — Secret GARRda Edition 📊

KI-gestütztes Analyse-Tool für Aktien, ETFs und Krypto.  
Mobile-optimiert · Kostenlos hostbar auf Railway · Powered by Gemini 2.5 Flash

---

## Projektstruktur

```
trader life/
├── backend/
│   ├── main.py              # FastAPI Backend (Daten + AI)
│   ├── static/
│   │   └── index.html       # Single-File Frontend (React via CDN)
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── render.yaml
│   ├── check_models.py      # Gemini-Modell Tester
│   └── debug_data.py        # Datenquellen-Debugger
├── STARTEN.bat              # Lokaler Start (Windows)
└── README.md
```

---

## Lokaler Start

Doppelklick auf **`STARTEN.bat`** — installiert Pakete automatisch und öffnet den Browser auf http://localhost:8000

Manuell:
```bash
cd backend
pip install -r requirements.txt
set GEMINI_API_KEY=dein-key
uvicorn main:app --reload
```

---

## Gemini API Key

1. [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → "Create API Key"
2. Key in `backend/.env` eintragen: `GEMINI_API_KEY=dein-key`
3. Oder als Railway Environment Variable setzen

**Free Tier:** Gemini 2.5 Flash — 500 Anfragen/Tag kostenlos.

---

## Deployment (Railway.app)

1. Repo auf GitHub pushen
2. [railway.app](https://railway.app) → "Deploy from GitHub"
3. Variable: `GEMINI_API_KEY` = dein Key
4. Settings → Networking → "Generate Domain"

---

## Features

| Feature | Details |
|---|---|
| **Charts** | Candlestick + SMA20/50, Intervalle 1D/1H/15M/5M/1M |
| **Indikatoren** | RSI(14), MACD(12,26,9), Bollinger Bands, SMA20/50/200 |
| **Fundamentaldaten** | KGV, EPS, Beta, Marktkapitalisierung, Dividende |
| **KI-Signal** | BUY/SELL/HOLD mit Konfidenz, Kursziele, Begründung |
| **News** | Reuters, Yahoo Finance, CNBC, MarketWatch, FT — asset-spezifisch |
| **News-Sentiment** | KI-Bewertung -- bis ++ mit Zeitskala |
| **Assets** | Aktien, ETFs, Krypto (CoinGecko) |
| **AI-Modell** | Gemini 2.5 Flash |

---

## Disclaimer

Keine Anlageberatung. Alle Signale dienen nur zu Informationszwecken. Investitionsentscheidungen auf eigenes Risiko.
