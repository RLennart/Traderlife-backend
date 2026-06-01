# ─────────────────────────────────────────────────────────────────────────────
#  TraderLife · LIGA — Backend-Endpunkte
#  -------------------------------------------------------------------------
#  Speichert das Feld in SQLite (liga_data.db) neben main.py.
#  Railway: Datei ist ohne Volume ephemer — Volume unter /data mounten und
#  DB_PATH-Env-Var setzen (z.B. /data/liga_data.db).
#
#  Deployment-Entscheidungen (HANDOFF §6–9):
#   1. Kurs-Cache: GET /api/liga/prices liefert alle Liga-Kurse mit 30s TTL.
#      store.js refreshLivePrices() nutzt diesen Sammel-Endpunkt.
#   2. Server-Settlement: Daemon-Thread alle 60 s — liquidiert Positionen
#      auch für Spieler, die die App nicht offen haben.
#   3. Persistenz: SQLite statt JSON (atomic, crash-safe). API unverändert.
# ─────────────────────────────────────────────────────────────────────────────
import json
import os
import pathlib
import sqlite3
import threading
import time
from datetime import datetime, timezone

import requests
import yfinance as yf
from fastapi import HTTPException

# ── Datenbank ─────────────────────────────────────────────────────────────────
_DB_PATH = pathlib.Path(os.getenv("DB_PATH", str(pathlib.Path(__file__).parent / "liga_data.db")))
_LOCK = threading.Lock()

SLOT_SEED = 100_000
NUM_SLOTS = 3

# Liga-Assets (muss mit ASSETS in store.js übereinstimmen)
_CRYPTO_IDS   = ["solana", "bitcoin", "ethereum"]
_STOCK_SYMS   = {"nvidia": "NVDA", "tesla": "TSLA", "apple": "AAPL"}
_ALL_ASSET_IDS = _CRYPTO_IDS + list(_STOCK_SYMS.keys())


def _db_connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    con.execute(
        "CREATE TABLE IF NOT EXISTS players "
        "(key TEXT PRIMARY KEY, data TEXT NOT NULL)"
    )
    con.commit()
    return con


def _load() -> dict:
    try:
        con = _db_connect()
        rows = con.execute("SELECT key, data FROM players").fetchall()
        con.close()
        return {"players": {k: json.loads(v) for k, v in rows}}
    except Exception:
        return {"players": {}}


def _save(db: dict):
    con = _db_connect()
    for key, player in db.get("players", {}).items():
        con.execute(
            "INSERT INTO players(key, data) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET data=excluded.data",
            (key, json.dumps(player, ensure_ascii=False)),
        )
    con.commit()
    con.close()


def _save_player(key: str, player: dict):
    """Schreibt nur einen Spieler — effizienter als ganzes Feld."""
    con = _db_connect()
    con.execute(
        "INSERT INTO players(key, data) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET data=excluded.data",
        (key, json.dumps(player, ensure_ascii=False)),
    )
    con.commit()
    con.close()


def _new_player(name: str, pwd: str) -> dict:
    return {
        "name": name,
        "pass": pwd,
        "createdAt": datetime.now(timezone.utc).timestamp(),
        "slots": [
            {"status": "cash", "cash": SLOT_SEED, "position": None}
            for _ in range(NUM_SLOTS)
        ],
        "trades": [],
        "isBot": False,
    }


# ── Kurs-Cache (30 s TTL) ─────────────────────────────────────────────────────
_PRICE_CACHE: dict = {}          # { assetId: {"price": float, "ts": float} }
_PRICE_LOCK  = threading.Lock()
_PRICE_TTL   = 30.0              # Sekunden


def _fetch_prices_fresh() -> dict[str, float]:
    """Holt aktuelle Kurse für alle Liga-Assets (ein CoinGecko-Call + ein yfinance-Call)."""
    prices: dict[str, float] = {}

    # Crypto: ein CoinGecko-Call für alle drei
    try:
        ids_param = ",".join(_CRYPTO_IDS)
        r = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": ids_param, "vs_currencies": "usd"},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        for cid in _CRYPTO_IDS:
            p = data.get(cid, {}).get("usd")
            if p:
                prices[cid] = float(p)
    except Exception:
        pass

    # Stocks: yfinance batch-Download
    try:
        syms = list(_STOCK_SYMS.values())
        info = yf.download(syms, period="1d", interval="1m", progress=False, auto_adjust=True)
        closes = info["Close"].iloc[-1] if not info.empty else {}
        for asset_id, sym in _STOCK_SYMS.items():
            try:
                p = float(closes[sym])
                if p and p > 0:
                    prices[asset_id] = p
            except Exception:
                pass
    except Exception:
        pass

    # Fallback für fehlende Stocks via Ticker (langsamer aber zuverlässig)
    for asset_id, sym in _STOCK_SYMS.items():
        if asset_id not in prices:
            try:
                t = yf.Ticker(sym)
                p = t.info.get("regularMarketPrice") or t.info.get("currentPrice")
                if p:
                    prices[asset_id] = float(p)
            except Exception:
                pass

    return prices


def _get_cached_prices(force: bool = False) -> dict[str, float]:
    now = time.time()
    with _PRICE_LOCK:
        # Stale wenn ältester Eintrag > TTL oder Cache leer
        if (
            force
            or not _PRICE_CACHE
            or any(now - v["ts"] > _PRICE_TTL for v in _PRICE_CACHE.values())
        ):
            fresh = _fetch_prices_fresh()
            for aid, p in fresh.items():
                _PRICE_CACHE[aid] = {"price": p, "ts": now}
        return {k: v["price"] for k, v in _PRICE_CACHE.items()}


# ── Server-seitiges Settlement ────────────────────────────────────────────────
def _position_equity(pos: dict, current_price: float) -> float:
    """Entspricht positionEquity() in store.js."""
    entry  = pos["entryPrice"]
    margin = pos["margin"]
    lev    = pos["leverage"]
    if pos["dir"] == "long":
        pnl_pct = (current_price - entry) / entry
    else:
        pnl_pct = (entry - current_price) / entry
    equity = margin + margin * lev * pnl_pct
    return max(equity, 0.0)


def _settle_all():
    """Prüft alle offenen Positionen gegen gecachte Kurse und liquidiert."""
    prices = _get_cached_prices()
    if not prices:
        return

    with _LOCK:
        db = _load()
        changed = False

        for key, player in db["players"].items():
            for slot in player.get("slots", []):
                if slot.get("status") != "open":
                    continue
                pos = slot.get("position")
                if not pos:
                    continue
                asset_id = pos.get("assetId")
                price = prices.get(asset_id)
                if price is None:
                    continue

                equity = _position_equity(pos, price)
                if equity <= 0:
                    # Liquidation
                    trade = {
                        "assetId":    asset_id,
                        "dir":        pos["dir"],
                        "leverage":   pos["leverage"],
                        "entryPrice": pos["entryPrice"],
                        "exitPrice":  price,
                        "margin":     pos["margin"],
                        "pnl":        -pos["margin"],
                        "pnlPct":     -100.0,
                        "openedTs":   pos.get("entryTs", 0),
                        "closedTs":   time.time(),
                        "reason":     "liquidated",
                    }
                    player["trades"] = [trade] + player.get("trades", [])
                    slot["status"]   = "liquidated"
                    slot["cash"]     = 0
                    slot["position"] = None
                    changed = True

        if changed:
            _save(db)


def _settlement_loop():
    """Daemon-Thread: Settlement alle 60 Sekunden."""
    while True:
        time.sleep(60)
        try:
            _settle_all()
        except Exception:
            pass


# ── FastAPI-Endpunkte ─────────────────────────────────────────────────────────
def register_liga(app, get_gemini=lambda: None, get_model=lambda: "gemini-2.5-flash"):
    """Registriert die /api/liga/* Endpunkte auf der bestehenden FastAPI-App.

    get_gemini / get_model sind Callables, damit der jeweils aktuelle Client/
    das aktuelle Modell aus main.py gelesen wird (kein Snapshot beim Import).
    """
    # DB initialisieren
    _db_connect().close()

    # Settlement-Daemon starten
    t = threading.Thread(target=_settlement_loop, daemon=True, name="liga-settlement")
    t.start()

    # ── Gesamtes Feld ────────────────────────────────────────────────────────
    @app.get("/api/liga/players")
    def liga_players():
        return _load()

    # ── Gecachte Kurse für alle Liga-Assets (30 s TTL) ───────────────────────
    @app.get("/api/liga/prices")
    def liga_prices():
        """Ein einziger Endpunkt für alle Liga-Kurse statt 6 × /api/data."""
        prices = _get_cached_prices()
        return {"prices": prices, "ts": time.time()}

    # ── Login / Registrierung ────────────────────────────────────────────────
    @app.post("/api/liga/login")
    def liga_login(payload: dict):
        name = (payload.get("name") or "").strip()
        pwd  = payload.get("pass") or ""
        key  = name.lower()
        if not key:
            raise HTTPException(400, "Name fehlt")
        with _LOCK:
            db = _load()
            p  = db["players"].get(key)
            if p:
                if p.get("pass") != pwd:
                    raise HTTPException(403, "Falsches Passwort für diesen Namen")
            else:
                p = _new_player(name, pwd)
                _save_player(key, p)
        return {"key": key, "player": p}

    # ── Spielstand speichern ─────────────────────────────────────────────────
    @app.put("/api/liga/players/{key}")
    def liga_save(key: str, payload: dict):
        pwd    = payload.get("pass") or ""
        player = payload.get("player") or {}
        with _LOCK:
            db       = _load()
            existing = db["players"].get(key)
            if existing and existing.get("pass") != pwd:
                raise HTTPException(403, "Falsches Passwort")
            player["pass"] = pwd          # Server bleibt Quelle der Wahrheit
            _save_player(key, player)
        return {"ok": True}

    # ── KI-Roast via Gemini ──────────────────────────────────────────────────
    @app.post("/api/liga/roast")
    def liga_roast(payload: dict):
        client = get_gemini()
        if not client:
            raise HTTPException(503, "Kein Gemini API Key")
        briefing = payload.get("briefing") or ""
        if not briefing.strip():
            raise HTTPException(400, "Kein Briefing")
        prompt = (
            "Du bist ein schonungsloser Börsen-Stammtisch-Kommentator. "
            "Schreibe auf DEUTSCH eine bissige, lustige Zusammenfassung eines fiktiven "
            "Trading-Wettbewerbs. Derber Stammtisch-Humor, aber clever — keine "
            "Beleidigungen gegen echte Gruppen, nur liebevoller Spott über das "
            "Trading-Verhalten.\n\n"
            "Roaste besonders: absurden Hebel (30x/100x) der liquidiert wurde; "
            "SHORT während der Kurs steigt (oder LONG während er fällt); "
            "Gewinner aus Angst zu früh verkauft; feiges Nichtstun mit 1x; "
            "und den Letzten. Lobe kurz & ironisch den Führenden.\n\n"
            f"STAND:\n{briefing}\n\n"
            "Schreibe 3-4 kurze Absätze. Beginne mit einer Schlagzeile in **fett**. "
            "Sprich die Trader direkt mit Namen an. Nutze gern 1-2 Emojis."
        )
        try:
            r = client.models.generate_content(model=get_model(), contents=prompt)
            return {"text": r.text.strip()}
        except Exception as ex:
            raise HTTPException(500, f"Gemini Fehler: {ex}")
