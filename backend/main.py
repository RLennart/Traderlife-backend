from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import pathlib
import yfinance as yf
import requests
import feedparser
import re
from google import genai
from google.genai import types
import os
from datetime import datetime, timedelta
import json
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="TraderLife API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# Bestes verfügbares Modell ermitteln
_cache = pathlib.Path(__file__).parent / "best_model.json"
try:
    ACTIVE_MODEL = json.loads(_cache.read_text()).get("best_model") or "gemini-2.5-flash"
except Exception:
    ACTIVE_MODEL = "gemini-2.5-flash"
print(f"[TraderLife] Aktives Modell: {ACTIVE_MODEL}")

# Statische Dateien (Frontend)
STATIC = pathlib.Path(__file__).parent / "static"
if STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(str(STATIC / "index.html"))


# ─── MARKTDATEN ───────────────────────────────────────────────────────────────

@app.get("/api/stock/{symbol}")
def get_stock(symbol: str, period: str = "3mo", interval: str = "1d"):
    """Aktien & ETF OHLCV + Fundamentaldaten via yfinance"""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        if hist.empty:
            raise HTTPException(404, f"Keine Daten für {symbol}")

        candles = [
            {
                "time": int(row.Index.timestamp()),
                "open": round(row.Open, 4),
                "high": round(row.High, 4),
                "low": round(row.Low, 4),
                "close": round(row.Close, 4),
                "volume": int(row.Volume),
            }
            for row in hist.itertuples()
        ]

        info = ticker.info
        fundamentals = {
            "name": info.get("longName", symbol),
            "sector": info.get("sector"),
            "pe": info.get("trailingPE"),
            "eps": info.get("trailingEps"),
            "marketCap": info.get("marketCap"),
            "52wHigh": info.get("fiftyTwoWeekHigh"),
            "52wLow": info.get("fiftyTwoWeekLow"),
            "dividendYield": info.get("dividendYield"),
            "beta": info.get("beta"),
        }

        return {"symbol": symbol.upper(), "candles": candles, "fundamentals": fundamentals}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/crypto/{coin_id}")
def get_crypto(coin_id: str, days: int = 90):
    """Krypto OHLCV via CoinGecko (kostenlos, kein API-Key nötig)"""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
        params = {"vs_currency": "usd", "days": days}
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        raw = r.json()

        candles = [
            {"time": int(item[0] / 1000), "open": item[1], "high": item[2], "low": item[3], "close": item[4]}
            for item in raw
        ]

        # Marktdaten
        meta_url = f"https://api.coingecko.com/api/v3/coins/{coin_id}?localization=false&tickers=false&community_data=false&developer_data=false"
        meta = requests.get(meta_url, timeout=10).json()
        market = meta.get("market_data", {})

        fundamentals = {
            "name": meta.get("name", coin_id),
            "symbol": meta.get("symbol", "").upper(),
            "marketCap": market.get("market_cap", {}).get("usd"),
            "volume24h": market.get("total_volume", {}).get("usd"),
            "priceChange24h": market.get("price_change_percentage_24h"),
            "ath": market.get("ath", {}).get("usd"),
            "atl": market.get("atl", {}).get("usd"),
            "circulatingSupply": market.get("circulating_supply"),
        }

        return {"coin": coin_id, "candles": candles, "fundamentals": fundamentals}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/search")
def search_assets(q: str):
    """Suche nach Aktien/ETFs und Krypto"""
    results = []

    # yfinance Suche
    try:
        yf_results = yf.Search(q).quotes
        for item in yf_results[:5]:
            results.append({
                "type": "stock",
                "id": item.get("symbol", ""),
                "name": item.get("longname") or item.get("shortname", ""),
                "exchange": item.get("exchange", ""),
            })
    except Exception:
        pass

    # CoinGecko Suche
    try:
        r = requests.get(
            "https://api.coingecko.com/api/v3/search",
            params={"query": q},
            timeout=8,
        )
        coins = r.json().get("coins", [])[:5]
        for c in coins:
            results.append({
                "type": "crypto",
                "id": c.get("id", ""),
                "name": c.get("name", ""),
                "symbol": c.get("symbol", "").upper(),
            })
    except Exception:
        pass

    return {"results": results}


# ─── NEWS ─────────────────────────────────────────────────────────────────────

# RSS-Feeds von etablierten Finanz-Nachrichtenquellen
NEWS_FEEDS = {
    "reuters_business":  "https://feeds.reuters.com/reuters/businessNews",
    "reuters_tech":      "https://feeds.reuters.com/reuters/technologyNews",
    "yahoo_finance":     "https://finance.yahoo.com/rss/topstories",
    "marketwatch":       "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "seeking_alpha":     "https://seekingalpha.com/market_currents.xml",
    "investing_com":     "https://www.investing.com/rss/news.rss",
    "ft_markets":        "https://www.ft.com/rss/home/uk",
    "cnbc_finance":      "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    "bloomberg_markets": "https://feeds.bloomberg.com/markets/news.rss",
}

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()

def fetch_news(symbol: str, name: str = "", max_articles: int = 8) -> list[dict]:
    """
    Holt aktuelle Nachrichten zu einem Asset aus mehreren RSS-Feeds.
    Filtert nach Relevanz (Symbol oder Name im Titel/Beschreibung).
    """
    keywords = [kw.lower() for kw in [symbol, name] if kw]
    # Generische Begriffe für breite Suche wenn kein spezifischer Treffer
    broad_keywords = keywords + ["market", "stock", "crypto", "economy", "fed", "inflation"]

    articles = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; TraderLife/1.0)"}

    for source, url in NEWS_FEEDS.items():
        try:
            feed = feedparser.parse(url, request_headers=headers)
            for entry in feed.entries[:20]:
                title = _strip_html(entry.get("title", ""))
                summary = _strip_html(entry.get("summary", entry.get("description", "")))[:300]
                published = entry.get("published", entry.get("updated", ""))
                link = entry.get("link", "")
                text_lower = (title + " " + summary).lower()

                # Relevanz-Score
                score = 0
                for kw in keywords:
                    if kw in text_lower: score += 10
                for kw in broad_keywords:
                    if kw in text_lower: score += 1

                if score > 0:
                    articles.append({
                        "title": title,
                        "summary": summary,
                        "published": published,
                        "link": link,
                        "source": source.replace("_", " ").title(),
                        "score": score,
                    })
        except Exception:
            continue

    # Nach Relevanz sortieren, Duplikate entfernen
    seen = set()
    unique = []
    for a in sorted(articles, key=lambda x: x["score"], reverse=True):
        key = a["title"][:60].lower()
        if key not in seen:
            seen.add(key)
            unique.append(a)

    # Fallback: generelle Marktmeldungen wenn nichts spezifisches
    if not unique:
        for source, url in list(NEWS_FEEDS.items())[:3]:
            try:
                feed = feedparser.parse(url, request_headers=headers)
                for entry in feed.entries[:3]:
                    title = _strip_html(entry.get("title", ""))
                    summary = _strip_html(entry.get("summary", ""))[:300]
                    unique.append({
                        "title": title,
                        "summary": summary,
                        "published": entry.get("published", ""),
                        "link": entry.get("link", ""),
                        "source": source.replace("_", " ").title(),
                        "score": 1,
                    })
                    if len(unique) >= max_articles:
                        break
            except Exception:
                continue

    return [{k: v for k, v in a.items() if k != "score"} for a in unique[:max_articles]]


@app.get("/api/news/{symbol}")
def get_news(symbol: str, name: str = ""):
    """Aktuelle Nachrichten zu einem Asset von mehreren Finanz-Newsquellen"""
    articles = fetch_news(symbol, name)
    return {"symbol": symbol, "articles": articles, "count": len(articles)}


# ─── INDIKATOREN ──────────────────────────────────────────────────────────────

def compute_indicators(candles: list[dict]) -> dict:
    """RSI, MACD, Bollinger Bands, SMA20/50/200"""
    closes = [c["close"] for c in candles]
    n = len(closes)

    def sma(data, period):
        return [
            round(sum(data[i - period:i]) / period, 4) if i >= period else None
            for i in range(1, len(data) + 1)
        ]

    def ema(data, period):
        result = [None] * (period - 1)
        k = 2 / (period + 1)
        e = sum(data[:period]) / period
        result.append(round(e, 4))
        for price in data[period:]:
            e = price * k + e * (1 - k)
            result.append(round(e, 4))
        return result

    def rsi(data, period=14):
        gains, losses = [], []
        for i in range(1, len(data)):
            diff = data[i] - data[i - 1]
            gains.append(max(diff, 0))
            losses.append(max(-diff, 0))
        result = [None] * period
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            rs = avg_gain / avg_loss if avg_loss != 0 else 100
            result.append(round(100 - 100 / (1 + rs), 2))
        return result

    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    sma200 = sma(closes, 200)
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)

    macd_line = [
        round(e12 - e26, 4) if e12 and e26 else None
        for e12, e26 in zip(ema12, ema26)
    ]
    macd_values = [v for v in macd_line if v is not None]
    signal_raw = ema(macd_values, 9) if len(macd_values) >= 9 else []
    signal_line = [None] * (len(macd_line) - len(signal_raw)) + signal_raw

    rsi_values = rsi(closes)

    # Bollinger Bands (20, 2)
    bb_upper, bb_lower, bb_mid = [], [], []
    for i in range(n):
        if i >= 19:
            window = closes[i - 19:i + 1]
            mid = sum(window) / 20
            std = (sum((x - mid) ** 2 for x in window) / 20) ** 0.5
            bb_upper.append(round(mid + 2 * std, 4))
            bb_lower.append(round(mid - 2 * std, 4))
            bb_mid.append(round(mid, 4))
        else:
            bb_upper.append(None)
            bb_lower.append(None)
            bb_mid.append(None)

    return {
        "sma20": sma20[-1],
        "sma50": sma50[-1],
        "sma200": sma200[-1],
        "rsi": rsi_values[-1] if rsi_values else None,
        "macd": macd_line[-1],
        "macdSignal": signal_line[-1],
        "bbUpper": bb_upper[-1],
        "bbLower": bb_lower[-1],
        "bbMid": bb_mid[-1],
        "currentPrice": closes[-1] if closes else None,
        # Letzte 50 Werte für Charts
        "series": {
            "sma20": sma20[-50:],
            "sma50": sma50[-50:],
            "rsi": rsi_values[-50:],
            "macd": macd_line[-50:],
            "macdSignal": signal_line[-50:],
        },
    }


# ─── AI SIGNAL ────────────────────────────────────────────────────────────────

@app.post("/api/signal")
def generate_signal(payload: dict):
    """
    Erwartet: { symbol, type (stock|crypto), candles, fundamentals, indicators }
    Gibt zurück: { signal, confidence, reasoning, targets }
    """
    if not gemini_client:
        return {
            "signal": "HOLD",
            "confidence": 50,
            "reasoning": "Kein Gemini API Key gesetzt – bitte GEMINI_API_KEY als Umgebungsvariable hinterlegen.",
            "targets": {},
        }

    symbol = payload.get("symbol", "")
    asset_type = payload.get("type", "stock")
    ind = payload.get("indicators", {})
    fund = payload.get("fundamentals", {})
    candles = payload.get("candles", [])
    price = ind.get("currentPrice") or (candles[-1]["close"] if candles else "?")

    # ── Preisverlauf der letzten 20 Kerzen (Datum + Close + Volumen)
    recent = candles[-20:] if len(candles) >= 20 else candles
    price_history = "\n".join(
        f"  {datetime.utcfromtimestamp(c['time']).strftime('%Y-%m-%d')}: "
        f"Close={c['close']:.4f}  Vol={c.get('volume', '?')}"
        for c in recent
    )

    # ── Trendanalyse aus den Daten ableiten
    closes = [c["close"] for c in candles]
    if len(closes) >= 20:
        trend_5d  = ((closes[-1] - closes[-5])  / closes[-5]  * 100) if len(closes) >= 5  else None
        trend_20d = ((closes[-1] - closes[-20]) / closes[-20] * 100) if len(closes) >= 20 else None
        trend_60d = ((closes[-1] - closes[-60]) / closes[-60] * 100) if len(closes) >= 60 else None
    else:
        trend_5d = trend_20d = trend_60d = None

    def fmt(v, suffix=""):
        return f"{v:+.2f}{suffix}" if v is not None else "n/a"

    # ── SMA-Kreuzungen
    sma20, sma50, sma200 = ind.get("sma20"), ind.get("sma50"), ind.get("sma200")
    sma_context = []
    if sma20 and sma50:
        sma_context.append("SMA20 > SMA50 (bullish)" if sma20 > sma50 else "SMA20 < SMA50 (bearish)")
    if sma50 and sma200:
        sma_context.append("Golden Cross (SMA50 > SMA200)" if sma50 > sma200 else "Death Cross (SMA50 < SMA200)")
    if price and sma200:
        sma_context.append(f"Preis {'ÜBER' if float(price) > sma200 else 'UNTER'} SMA200")

    # ── RSI-Kontext
    rsi = ind.get("rsi")
    rsi_context = ""
    if rsi:
        if rsi >= 70: rsi_context = f"RSI={rsi:.1f} → ÜBERKAUFT (Verkaufsdruck möglich)"
        elif rsi <= 30: rsi_context = f"RSI={rsi:.1f} → ÜBERVERKAUFT (Erholung möglich)"
        elif rsi >= 60: rsi_context = f"RSI={rsi:.1f} → Starker Aufwärtstrend"
        elif rsi <= 40: rsi_context = f"RSI={rsi:.1f} → Schwäche, Abwärtsdruck"
        else: rsi_context = f"RSI={rsi:.1f} → Neutral"

    # ── MACD-Kontext
    macd, macd_sig = ind.get("macd"), ind.get("macdSignal")
    macd_context = ""
    if macd is not None and macd_sig is not None:
        diff = macd - macd_sig
        if diff > 0: macd_context = f"MACD={macd:.4f} > Signal={macd_sig:.4f} → Bullisches Momentum (+{diff:.4f})"
        else: macd_context = f"MACD={macd:.4f} < Signal={macd_sig:.4f} → Bärisches Momentum ({diff:.4f})"

    # ── Bollinger-Kontext
    bbu, bbl, bbm = ind.get("bbUpper"), ind.get("bbLower"), ind.get("bbMid")
    bb_context = ""
    if bbu and bbl and price:
        p = float(price)
        bb_width = (bbu - bbl) / bbm * 100 if bbm else 0
        if p >= bbu: bb_context = f"Preis am OBEREN Band (={bbu:.4f}) → Überkauft/Ausbruch"
        elif p <= bbl: bb_context = f"Preis am UNTEREN Band (={bbl:.4f}) → Überverkauft/Breakdown"
        else:
            pct = (p - bbl) / (bbu - bbl) * 100
            bb_context = f"Preis bei {pct:.0f}% des BB-Bandes (Breite: {bb_width:.1f}%)"

    # ── Fundamentaldaten formatiert
    fund_lines = []
    field_map = {
        "name": "Name", "sector": "Sektor", "pe": "KGV (P/E)", "eps": "EPS",
        "beta": "Beta", "dividendYield": "Dividendenrendite",
        "marketCap": "Marktkapitalisierung", "52wHigh": "52W-Hoch",
        "52wLow": "52W-Tief", "priceChange24h": "24h-Änderung (%)",
        "volume24h": "24h-Volumen", "circulatingSupply": "Umlaufmenge",
    }
    for k, label in field_map.items():
        v = fund.get(k)
        if v is not None:
            if k == "dividendYield": v = f"{v*100:.2f}%"
            elif k == "marketCap": v = f"{v/1e9:.2f}B USD" if v >= 1e9 else f"{v/1e6:.0f}M USD"
            fund_lines.append(f"  {label}: {v}")

    prompt = f"""Du bist ein professioneller Wertpapieranalyst mit 20 Jahren Erfahrung in technischer und fundamentaler Analyse. Analysiere die folgenden ECHTEN Marktdaten und erstelle eine faktenbasierte Einschätzung.

════════════════════════════════════════
ASSET: {symbol.upper()} ({asset_type.upper()})
Aktueller Preis: {price}
════════════════════════════════════════

── PREISTREND ──────────────────────────
5-Tage-Performance:  {fmt(trend_5d, "%")}
20-Tage-Performance: {fmt(trend_20d, "%")}
60-Tage-Performance: {fmt(trend_60d, "%")}

── TRENDSTRUKTUR (Moving Averages) ─────
{chr(10).join(sma_context) or "Nicht genug Daten"}
SMA20={f'{sma20:.4f}' if sma20 else 'n/a'} | SMA50={f'{sma50:.4f}' if sma50 else 'n/a'} | SMA200={f'{sma200:.4f}' if sma200 else 'n/a'}

── MOMENTUM ────────────────────────────
{rsi_context}
{macd_context}

── VOLATILITÄT (Bollinger Bands) ───────
{bb_context}
BB Upper={f'{bbu:.4f}' if bbu else 'n/a'} | Mid={f'{bbm:.4f}' if bbm else 'n/a'} | Lower={f'{bbl:.4f}' if bbl else 'n/a'}

── PREISVERLAUF (letzte 20 Handelstage) ─
{price_history}

── FUNDAMENTALDATEN ────────────────────
{chr(10).join(fund_lines) if fund_lines else "  Keine Fundamentaldaten verfügbar"}

── AKTUELLE NACHRICHTEN (aus Reuters, Yahoo Finance, CNBC, MarketWatch) ─
{chr(10).join(f"  [{a['source']}] {a['title']} — {a['summary'][:150]}" for a in payload.get("news", [])[:6]) or "  Keine aktuellen Nachrichten gefunden"}
{f"{chr(10)}── SPEZIFISCHE FRAGE DES NUTZERS ───────────────{chr(10)}  {payload.get('userContext')}" if payload.get('userContext') else ""}
════════════════════════════════════════
AUFGABE: Bewerte auf Basis der obigen Daten UND der aktuellen Nachrichtenlage.{" Gehe besonders auf die spezifische Frage des Nutzers ein." if payload.get('userContext') else ""}
- Identifiziere klare Stärken und Schwächen
- Berechne realistische Kursziele aus den Daten (z.B. nächste Unterstützung/Widerstand, ATR-basiert)
- Sei ehrlich: wenn die Datenlage kein klares Signal liefert, sage HOLD mit niedriger Konfidenz
- Keine Spekulation über externe Faktoren die nicht in den Daten stehen

Antworte NUR als valides JSON (kein Markdown, keine Erklärungen davor oder danach):
{{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0-100,
  "reasoning": "Faktenbasierte Begründung in 4-6 Sätzen auf Deutsch. Beziehe dich auf konkrete Zahlen aus den Daten.",
  "targets": {{
    "entry": <konkreter Einstiegspreis als Zahl oder null>,
    "takeProfit": <realistisches Kursziel als Zahl oder null>,
    "stopLoss": <Stop-Loss Niveau als Zahl oder null>
  }},
  "keyFactors": [
    "Konkreter Faktor 1 mit Zahl",
    "Konkreter Faktor 2 mit Zahl",
    "Konkreter Faktor 3 mit Zahl"
  ],
  "timeframe": "kurzfristig (1-2 Wochen)" | "mittelfristig (1-3 Monate)" | "langfristig (3-12 Monate)"
}}"""

    try:
        model_id = payload.get("model", ACTIVE_MODEL)
        response = gemini_client.models.generate_content(
            model=model_id,
            contents=prompt,
        )
        text = response.text.strip()
        # JSON aus Markdown-Code-Block extrahieren
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        raise HTTPException(500, f"Gemini Fehler: {e}")


@app.get("/api/data/{asset_type}/{symbol}")
def get_data(asset_type: str, symbol: str, period: str = "6mo"):
    """Nur Marktdaten + Indikatoren + News — kein KI-Call"""
    if asset_type == "stock":
        data = get_stock(symbol, period=period)
    elif asset_type == "crypto":
        data = get_crypto(symbol, days=180)
    else:
        raise HTTPException(400, "asset_type muss 'stock' oder 'crypto' sein")

    indicators = compute_indicators(data["candles"])
    asset_name = data["fundamentals"].get("name", symbol)
    news = fetch_news(symbol, asset_name, max_articles=6)

    return {**data, "indicators": indicators, "news": news}


@app.post("/api/signal/{asset_type}/{symbol}")
def get_signal(asset_type: str, symbol: str, payload: dict):
    """KI-Analyse auf Abruf. Body: { period, model, userContext, candles, fundamentals, indicators, news }"""
    candles = payload.get("candles", [])
    fundamentals = payload.get("fundamentals", {})
    indicators = payload.get("indicators", {})
    news = payload.get("news", [])
    user_context = payload.get("userContext", "").strip()
    model = payload.get("model") or ACTIVE_MODEL

    signal = generate_signal({
        "symbol": symbol,
        "type": asset_type,
        "candles": candles,
        "fundamentals": fundamentals,
        "indicators": indicators,
        "news": news,
        "userContext": user_context,
        "model": model,
    })
    return signal


@app.get("/api/analyze/{asset_type}/{symbol}")
def full_analysis(asset_type: str, symbol: str, period: str = "6mo", model: str = None):
    """Legacy: Daten + KI in einem Call"""
    data = get_data(asset_type, symbol, period=period)
    signal_data = generate_signal({
        "symbol": symbol,
        "type": asset_type,
        "candles": data["candles"],
        "fundamentals": data["fundamentals"],
        "indicators": data["indicators"],
        "news": data["news"],
        "model": model or ACTIVE_MODEL,
    })
    return {**data, "signal": signal_data}


@app.get("/api/models")
def list_models():
    """Verfügbare Gemini-Modelle die generateContent unterstützen"""
    if not gemini_client:
        return {"models": []}
    try:
        models = []
        for m in gemini_client.models.list():
            short = m.name.replace("models/", "")
            if any(x in short for x in ["exp", "preview", "learnlm", "thinking"]):
                continue
            models.append({"id": short, "name": getattr(m, "display_name", None) or short})
        return {"models": models, "active": ACTIVE_MODEL}
    except Exception as e:
        return {"models": [], "active": ACTIVE_MODEL, "error": str(e)}


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
