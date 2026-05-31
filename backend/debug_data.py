"""
Testet alle Datenquellen. Auf dem Server ausführen um zu sehen was funktioniert.
python debug_data.py
"""
import requests, json

SYMBOLS = ["AAPL", "MSFT", "SPY", "NVDA"]
CRYPTO = ["bitcoin", "ethereum"]

print("=" * 50)
print("TEST 1: yfinance")
print("=" * 50)
try:
    import yfinance as yf
    for sym in SYMBOLS:
        try:
            t = yf.Ticker(sym)
            hist = t.history(period="5d", interval="1d")
            if not hist.empty:
                print(f"  ✓ {sym}: {len(hist)} Kerzen, letzter Close: {hist['Close'].iloc[-1]:.2f}")
            else:
                print(f"  ✗ {sym}: Keine Daten")
        except Exception as ex:
            print(f"  ✗ {sym}: {ex}")
except Exception as ex:
    print(f"  ✗ yfinance Import-Fehler: {ex}")

print()
print("=" * 50)
print("TEST 2: CoinGecko (Krypto)")
print("=" * 50)
for coin in CRYPTO:
    try:
        r = requests.get(
            f"https://api.coingecko.com/api/v3/coins/{coin}/ohlc",
            params={"vs_currency": "usd", "days": 7},
            timeout=10
        )
        if r.status_code == 200:
            data = r.json()
            print(f"  ✓ {coin}: {len(data)} Kerzen")
        else:
            print(f"  ✗ {coin}: HTTP {r.status_code}")
    except Exception as ex:
        print(f"  ✗ {coin}: {ex}")

print()
print("=" * 50)
print("TEST 3: Yahoo Finance direkt (Fallback)")
print("=" * 50)
for sym in SYMBOLS[:2]:
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
        params = {"interval": "1d", "range": "5d"}
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, params=params, headers=headers, timeout=10)
        if r.status_code == 200:
            result = r.json().get("chart", {}).get("result", [])
            if result:
                closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                print(f"  ✓ {sym}: {len(closes)} Datenpunkte via Yahoo Direct API")
            else:
                print(f"  ✗ {sym}: Leere Antwort")
        else:
            print(f"  ✗ {sym}: HTTP {r.status_code}")
    except Exception as ex:
        print(f"  ✗ {sym}: {ex}")

print()
print("=" * 50)
print("TEST 4: Stooq (kostenloser Fallback)")
print("=" * 50)
for sym in SYMBOLS[:2]:
    try:
        url = f"https://stooq.com/q/d/l/?s={sym.lower()}.us&i=d"
        r = requests.get(url, timeout=10)
        lines = r.text.strip().split("\n")
        if len(lines) > 2:
            print(f"  ✓ {sym}: {len(lines)-1} Tage via Stooq")
        else:
            print(f"  ✗ {sym}: {r.text[:100]}")
    except Exception as ex:
        print(f"  ✗ {sym}: {ex}")

print()
print("Fertig.")
