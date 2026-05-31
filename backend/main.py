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
import os
from datetime import datetime
import json
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="TraderLife API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Static files
STATIC = pathlib.Path(__file__).parent / "static"
if STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

@app.get("/", include_in_schema=False)
def root():
    return FileResponse(str(STATIC / "index.html"))

# Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

_cache = pathlib.Path(__file__).parent / "best_model.json"
try:
    ACTIVE_MODEL = json.loads(_cache.read_text()).get("best_model") or "gemini-2.5-flash"
except Exception:
    ACTIVE_MODEL = "gemini-2.5-flash"
print(f"[TraderLife] Modell: {ACTIVE_MODEL}")


# ── MARKTDATEN ────────────────────────────────────────────────────────────────

def _yahoo_direct(symbol: str, period: str = "6mo", interval: str = "1d") -> list:
    range_map = {"1d":"1d","5d":"5d","1mo":"1mo","3mo":"3mo","6mo":"6mo","1y":"1y","2y":"2y","5y":"5y"}
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {"interval": interval, "range": range_map.get(period, "6mo")}
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    r = requests.get(url, params=params, headers=headers, timeout=15)
    r.raise_for_status()
    result = r.json().get("chart", {}).get("result", [])
    if not result:
        return []
    res = result[0]
    timestamps = res.get("timestamp", [])
    q = res.get("indicators", {}).get("quote", [{}])[0]
    candles = []
    for i, t in enumerate(timestamps):
        o, h, l, c, v = q.get("open", [])[i] if i < len(q.get("open",[])) else None, \
                         q.get("high", [])[i] if i < len(q.get("high",[])) else None, \
                         q.get("low",  [])[i] if i < len(q.get("low", [])) else None, \
                         q.get("close",[])[i] if i < len(q.get("close",[])) else None, \
                         q.get("volume",[])[i] if i < len(q.get("volume",[])) else 0
        if None in (o, h, l, c):
            continue
        candles.append({"time": int(t), "open": round(o,4), "high": round(h,4),
                         "low": round(l,4), "close": round(c,4), "volume": int(v or 0)})
    return candles


@app.get("/api/stock/{symbol}")
def get_stock(symbol: str, period: str = "3mo", interval: str = "1d"):
    candles = []
    fundamentals = {"name": symbol}
    errors = []

    # Versuch 1: yfinance
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        if not hist.empty:
            candles = [{"time": int(r.Index.timestamp()), "open": round(r.Open,4),
                        "high": round(r.High,4), "low": round(r.Low,4),
                        "close": round(r.Close,4), "volume": int(r.Volume)}
                       for r in hist.itertuples()]
            info = ticker.info
            fundamentals = {
                "name": info.get("longName", symbol), "sector": info.get("sector"),
                "pe": info.get("trailingPE"), "eps": info.get("trailingEps"),
                "marketCap": info.get("marketCap"), "52wHigh": info.get("fiftyTwoWeekHigh"),
                "52wLow": info.get("fiftyTwoWeekLow"), "dividendYield": info.get("dividendYield"),
                "beta": info.get("beta"),
            }
    except Exception as ex:
        errors.append(f"yfinance: {ex}")

    # Versuch 2: Yahoo Direct
    if not candles:
        try:
            candles = _yahoo_direct(symbol, period, interval)
            if candles:
                fundamentals["name"] = symbol
        except Exception as ex:
            errors.append(f"yahoo_direct: {ex}")

    if not candles:
        raise HTTPException(404, f"Keine Daten fuer {symbol}. {'; '.join(errors)}")
    return {"symbol": symbol.upper(), "candles": candles, "fundamentals": fundamentals}


@app.get("/api/crypto/{coin_id}")
def get_crypto(coin_id: str, days: int = 90):
    try:
        r = requests.get(f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc",
                         params={"vs_currency": "usd", "days": days}, timeout=10)
        r.raise_for_status()
        candles = [{"time": int(x[0]/1000), "open": x[1], "high": x[2], "low": x[3], "close": x[4]}
                   for x in r.json()]
        meta = requests.get(
            f"https://api.coingecko.com/api/v3/coins/{coin_id}?localization=false&tickers=false&community_data=false&developer_data=false",
            timeout=10).json()
        market = meta.get("market_data", {})
        fundamentals = {
            "name": meta.get("name", coin_id),
            "symbol": meta.get("symbol", "").upper(),
            "marketCap": market.get("market_cap", {}).get("usd"),
            "volume24h": market.get("total_volume", {}).get("usd"),
            "priceChange24h": market.get("price_change_percentage_24h"),
            "ath": market.get("ath", {}).get("usd"),
            "circulatingSupply": market.get("circulating_supply"),
        }
        return {"coin": coin_id, "candles": candles, "fundamentals": fundamentals}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/search")
def search_assets(q: str):
    results = []
    try:
        for item in yf.Search(q).quotes[:5]:
            results.append({"type": "stock", "id": item.get("symbol",""),
                            "name": item.get("longname") or item.get("shortname",""),
                            "exchange": item.get("exchange","")})
    except Exception:
        pass
    try:
        r = requests.get("https://api.coingecko.com/api/v3/search", params={"query": q}, timeout=8)
        for c in r.json().get("coins", [])[:5]:
            results.append({"type": "crypto", "id": c.get("id",""),
                            "name": c.get("name",""), "symbol": c.get("symbol","").upper()})
    except Exception:
        pass
    return {"results": results}


# ── NEWS ──────────────────────────────────────────────────────────────────────

NEWS_FEEDS = {
    "Reuters Business":  "https://feeds.reuters.com/reuters/businessNews",
    "Reuters Tech":      "https://feeds.reuters.com/reuters/technologyNews",
    "Yahoo Finance":     "https://finance.yahoo.com/rss/topstories",
    "MarketWatch":       "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "CNBC Finance":      "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    "Investing.com":     "https://www.investing.com/rss/news.rss",
    "FT Markets":        "https://www.ft.com/rss/home/uk",
}

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()

def _parse_date(entry) -> datetime:
    for field in ("published_parsed", "updated_parsed"):
        t = entry.get(field)
        if t:
            try:
                return datetime(*t[:6])
            except Exception:
                pass
    return datetime(2000, 1, 1)


def fetch_news(symbol: str, name: str = "", max_articles: int = 10) -> list:
    sym_lower = symbol.lower()
    name_tokens = [t.lower() for t in (name or "").split() if len(t) > 2]
    strict_kw = [sym_lower] + name_tokens

    articles = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; TraderLife/1.0)"}

    for source, url in NEWS_FEEDS.items():
        try:
            feed = feedparser.parse(url, request_headers=headers)
            for entry in feed.entries[:30]:
                title = _strip_html(entry.get("title", ""))
                summary = _strip_html(entry.get("summary", entry.get("description", "")))[:400]
                text_lower = (title + " " + summary).lower()
                if not any(kw in text_lower for kw in strict_kw):
                    continue
                articles.append({
                    "title": title, "summary": summary,
                    "published": entry.get("published", entry.get("updated", "")),
                    "published_dt": _parse_date(entry),
                    "link": entry.get("link", ""), "source": source,
                })
        except Exception:
            continue

    seen = set()
    unique = []
    for a in articles:
        key = a["title"][:60].lower()
        if key not in seen:
            seen.add(key)
            unique.append(a)

    unique.sort(key=lambda x: x["published_dt"], reverse=True)
    return [{k: v for k, v in a.items() if k != "published_dt"} for a in unique[:max_articles]]


@app.get("/api/news/{symbol}")
def get_news(symbol: str, name: str = ""):
    articles = fetch_news(symbol, name)
    return {"symbol": symbol, "articles": articles, "count": len(articles)}


@app.post("/api/news-sentiment/{symbol}")
def news_sentiment(symbol: str, payload: dict):
    if not gemini_client:
        raise HTTPException(503, "Kein Gemini API Key")
    articles = payload.get("articles", [])
    name = payload.get("name", symbol)
    model_id = payload.get("model", ACTIVE_MODEL)
    if not articles:
        raise HTTPException(400, "Keine Artikel")

    news_text = "\n".join(
        f"[{a['source']}] {a['title']} -- {a.get('summary','')[:200]}"
        for a in articles[:10]
    )
    prompt = f"""Finanzanalyst: Bewerte die Nachrichtenlage fuer {name} ({symbol}).

NACHRICHTEN:
{news_text}

Antworte NUR als JSON:
{{
  "sentiment": "--" | "-" | "_" | "+" | "++",
  "sentimentLabel": "Stark Bearish" | "Bearish" | "Neutral" | "Bullish" | "Stark Bullisch",
  "timeframe": "kurzfristig (Stunden)" | "mittelfristig (1-3 Tage)" | "langfristig (Wochen)" | "fundamental (dauerhafte Aenderung)",
  "summary": "2-3 Saetze zur Nachrichtenlage auf Deutsch.",
  "keyPoints": ["Punkt 1", "Punkt 2", "Punkt 3"]
}}"""

    try:
        r = gemini_client.models.generate_content(model=model_id, contents=prompt)
        text = r.text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception as ex:
        raise HTTPException(500, f"Gemini Fehler: {ex}")


# ── INDIKATOREN ───────────────────────────────────────────────────────────────

def compute_indicators(candles: list) -> dict:
    closes = [c["close"] for c in candles]
    n = len(closes)

    def sma(data, p):
        return [round(sum(data[i-p:i])/p, 4) if i >= p else None for i in range(1, len(data)+1)]

    def ema(data, p):
        res = [None] * (p - 1)
        k = 2 / (p + 1)
        e = sum(data[:p]) / p
        res.append(round(e, 4))
        for price in data[p:]:
            e = price * k + e * (1 - k)
            res.append(round(e, 4))
        return res

    def rsi_calc(data, p=14):
        gains, losses = [], []
        for i in range(1, len(data)):
            d = data[i] - data[i-1]
            gains.append(max(d, 0))
            losses.append(max(-d, 0))
        res = [None] * p
        ag = sum(gains[:p]) / p
        al = sum(losses[:p]) / p
        for i in range(p, len(gains)):
            ag = (ag * (p-1) + gains[i]) / p
            al = (al * (p-1) + losses[i]) / p
            rs = ag / al if al != 0 else 100
            res.append(round(100 - 100/(1+rs), 2))
        return res

    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    sma200 = sma(closes, 200)
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    macd_line = [round(e12-e26, 4) if e12 and e26 else None for e12, e26 in zip(ema12, ema26)]
    mv = [v for v in macd_line if v is not None]
    sig_raw = ema(mv, 9) if len(mv) >= 9 else []
    signal_line = [None] * (len(macd_line) - len(sig_raw)) + sig_raw
    rsi_vals = rsi_calc(closes)

    bb_upper, bb_lower, bb_mid = [], [], []
    for i in range(n):
        if i >= 19:
            w = closes[i-19:i+1]
            mid = sum(w) / 20
            std = (sum((x-mid)**2 for x in w) / 20) ** 0.5
            bb_upper.append(round(mid + 2*std, 4))
            bb_lower.append(round(mid - 2*std, 4))
            bb_mid.append(round(mid, 4))
        else:
            bb_upper.append(None); bb_lower.append(None); bb_mid.append(None)

    return {
        "sma20": sma20[-1], "sma50": sma50[-1], "sma200": sma200[-1],
        "rsi": rsi_vals[-1] if rsi_vals else None,
        "macd": macd_line[-1], "macdSignal": signal_line[-1],
        "bbUpper": bb_upper[-1], "bbLower": bb_lower[-1], "bbMid": bb_mid[-1],
        "currentPrice": closes[-1] if closes else None,
        "series": {
            "sma20": sma20[-100:], "sma50": sma50[-100:],
            "rsi": rsi_vals[-100:], "macd": macd_line[-100:], "macdSignal": signal_line[-100:],
        },
    }


# -- AI SIGNAL -----------------------------------------------------------------

def generate_signal(payload: dict) -> dict:
    if not gemini_client:
        return {"signal": "HOLD", "confidence": 50, "reasoning": "Kein Gemini API Key.", "targets": {}}

    symbol = payload.get("symbol", "")
    asset_type = payload.get("type", "stock")
    ind = payload.get("indicators", {})
    fund = payload.get("fundamentals", {})
    candles = payload.get("candles", [])
    price = ind.get("currentPrice") or (candles[-1]["close"] if candles else "?")

    recent = candles[-20:] if len(candles) >= 20 else candles
    price_history = "\n".join(
        f"  {datetime.utcfromtimestamp(c['time']).strftime('%Y-%m-%d')}: Close={c['close']:.4f}  Vol={c.get('volume','?')}"
        for c in recent
    )
    closes = [c["close"] for c in candles]
    def pct(a, b): return (a-b)/b*100 if b else None
    def fmt(v, s=""): return f"{v:+.2f}{s}" if v is not None else "n/a"
    t5  = pct(closes[-1], closes[-5])  if len(closes) >= 5  else None
    t20 = pct(closes[-1], closes[-20]) if len(closes) >= 20 else None
    t60 = pct(closes[-1], closes[-60]) if len(closes) >= 60 else None

    sma20, sma50, sma200 = ind.get("sma20"), ind.get("sma50"), ind.get("sma200")
    sma_ctx = []
    if sma20 and sma50:  sma_ctx.append("SMA20>SMA50 bullish" if sma20>sma50 else "SMA20<SMA50 bearish")
    if sma50 and sma200: sma_ctx.append("Golden Cross" if sma50>sma200 else "Death Cross")
    if price and sma200: sma_ctx.append(f"Preis {'UEBER' if float(price)>sma200 else 'UNTER'} SMA200")

    rsi = ind.get("rsi")
    rsi_ctx = f"RSI={rsi:.1f} {'UEBERKAUFT' if rsi>=70 else 'UEBERVERKAUFT' if rsi<=30 else 'neutral'}" if rsi else ""
    macd, msig = ind.get("macd"), ind.get("macdSignal")
    macd_ctx = f"MACD={macd:.4f} {'>' if macd>msig else '<'} Signal={msig:.4f}" if macd is not None and msig is not None else ""
    bbu, bbl, bbm = ind.get("bbUpper"), ind.get("bbLower"), ind.get("bbMid")
    bb_ctx = ""
    if bbu and bbl and price:
        p = float(price)
        if p >= bbu: bb_ctx = f"Preis am OBEREN Band ({bbu:.4f})"
        elif p <= bbl: bb_ctx = f"Preis am UNTEREN Band ({bbl:.4f})"
        else: bb_ctx = f"Preis bei {(p-bbl)/(bbu-bbl)*100:.0f}% des BB-Bandes"

    fund_lines = []
    for k, label in [("name","Name"),("sector","Sektor"),("pe","KGV"),("eps","EPS"),
                     ("beta","Beta"),("marketCap","Marktkapital."),("52wHigh","52W-Hoch"),
                     ("52wLow","52W-Tief"),("priceChange24h","24h-Aenderung")]:
        v = fund.get(k)
        if v is not None:
            if k == "dividendYield": v = f"{v*100:.2f}%"
            elif k == "marketCap": v = f"{v/1e9:.2f}B" if v>=1e9 else f"{v/1e6:.0f}M"
            fund_lines.append(f"  {label}: {v}")

    user_ctx = payload.get("userContext", "").strip()
    prompt = f"""Professioneller Wertpapieranalyst. Analysiere ECHTE Marktdaten.

ASSET: {symbol.upper()} ({asset_type.upper()}) | Preis: {price}
TREND: 5T={fmt(t5,'%')} | 20T={fmt(t20,'%')} | 60T={fmt(t60,'%')}
MOVING AVG: {' | '.join(sma_ctx) or 'n/a'}
  SMA20={f'{sma20:.4f}' if sma20 else 'n/a'} SMA50={f'{sma50:.4f}' if sma50 else 'n/a'} SMA200={f'{sma200:.4f}' if sma200 else 'n/a'}
MOMENTUM: {rsi_ctx} | {macd_ctx}
VOLATILITAET: {bb_ctx}
PREISVERLAUF (letzte 20 Tage):
{price_history}
FUNDAMENTALS:
{chr(10).join(fund_lines) or '  n/a'}
NACHRICHTEN:
{chr(10).join(f"  [{a['source']}] {a['title']}" for a in payload.get("news",[])[:5]) or '  keine'}
{f"FRAGE: {user_ctx}" if user_ctx else ""}

Antworte NUR als JSON:
{{
  "signal": "BUY"|"SELL"|"HOLD",
  "confidence": 0-100,
  "reasoning": "4-6 Saetze auf Deutsch mit konkreten Zahlen.",
  "targets": {{"entry": null, "takeProfit": null, "stopLoss": null}},
  "keyFactors": ["Faktor 1","Faktor 2","Faktor 3"],
  "timeframe": "kurzfristig (1-2 Wochen)"|"mittelfristig (1-3 Monate)"|"langfristig (3-12 Monate)"
}}"""

    try:
        model_id = payload.get("model", ACTIVE_MODEL)
        r = gemini_client.models.generate_content(model=model_id, contents=prompt)
        text = r.text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"): text = text[4:]
        return json.loads(text)
    except Exception as e:
        raise HTTPException(500, f"Gemini Fehler: {e}")


# -- ENDPOINTS -----------------------------------------------------------------

@app.get("/api/data/{asset_type}/{symbol}")
def get_data(asset_type: str, symbol: str, period: str = "6mo", interval: str = "1d"):
    if asset_type == "stock":
        data = get_stock(symbol, period=period, interval=interval)
    elif asset_type == "crypto":
        days_map = {"1d":1,"5d":5,"1mo":30,"3mo":90,"6mo":180,"1y":365,"2y":730}
        data = get_crypto(symbol, days=days_map.get(period, 180))
    else:
        raise HTTPException(400, "asset_type: stock oder crypto")
    indicators = compute_indicators(data["candles"])
    news = fetch_news(symbol, data["fundamentals"].get("name", symbol), max_articles=10)
    return {**data, "indicators": indicators, "news": news}


@app.post("/api/signal/{asset_type}/{symbol}")
def get_signal(asset_type: str, symbol: str, payload: dict):
    return generate_signal({**payload, "symbol": symbol, "type": asset_type})


@app.get("/api/analyze/{asset_type}/{symbol}")
def full_analysis(asset_type: str, symbol: str, period: str = "6mo", model: str = None):
    data = get_data(asset_type, symbol, period=period)
    signal_data = generate_signal({
        "symbol": symbol, "type": asset_type,
        "candles": data["candles"], "fundamentals": data["fundamentals"],
        "indicators": data["indicators"], "news": data["news"],
        "model": model or ACTIVE_MODEL,
    })
    return {**data, "signal": signal_data}


@app.get("/api/models")
def list_models():
    if not gemini_client:
        return {"models": [], "active": ACTIVE_MODEL}
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
    return {"status": "ok", "model": ACTIVE_MODEL, "timestamp": datetime.utcnow().isoformat()}
