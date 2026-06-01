// ════════════════════════════════════════════════════════════════════════════
//  TraderLife · LIGA — Spiel-Logik, Markt, Speicher  (PRODUKTIONS-VERSION)
//  -------------------------------------------------------------------------
//  Speicher-Schicht ist BACKEND-FIRST mit lokalem Fallback:
//    • Sind die /api/liga/* Endpunkte erreichbar  → echtes geteiltes Spiel.
//    • Sind sie es nicht (z.B. Design-Vorschau)    → localStorage + Demo-Feld.
//  Genauso bei Kursen: live über /api/data wenn verfügbar, sonst Simulation.
//  Die gesamte Spiel-Mathematik bleibt im Frontend (deterministisch).
// ════════════════════════════════════════════════════════════════════════════

(function () {
// ── KONFIGURATION ────────────────────────────────────────────────────────────
const SLOT_SEED   = 100000;   // Jeder Slot startet mit 100.000 $ fiktivem Kapital
const NUM_SLOTS   = 3;        // Max. 3 Positionen gleichzeitig
const LEVERAGES   = [1, 2, 5, 10, 30, 100];

// Asset-Liste — HIER später anpassen / erweitern.
// base = Referenzpreis (Sim-Fallback), vol = Tages-Volatilität (Sim)
const ASSETS = [
  { id: 'solana',   sym: 'SOL',  name: 'Solana',   type: 'crypto', base: 168.0,  vol: 0.10 },
  { id: 'nvidia',   sym: 'NVDA', name: 'NVIDIA',   type: 'stock',  base: 142.5,  vol: 0.055 },
  { id: 'bitcoin',  sym: 'BTC',  name: 'Bitcoin',  type: 'crypto', base: 72400,  vol: 0.05 },
  { id: 'ethereum', sym: 'ETH',  name: 'Ethereum', type: 'crypto', base: 3960,   vol: 0.07 },
  { id: 'tesla',    sym: 'TSLA', name: 'Tesla',    type: 'stock',  base: 262.0,  vol: 0.06 },
  { id: 'apple',    sym: 'AAPL', name: 'Apple',    type: 'stock',  base: 221.0,  vol: 0.03 },
];
const ASSET_BY_ID = Object.fromEntries(ASSETS.map(a => [a.id, a]));

// ── MARKT ────────────────────────────────────────────────────────────────────
//  priceAt(asset, t): deterministische Simulation, reine Funktion der Zeit
//  → alle Geräte berechnen denselben Kurs (wichtig für Fairness ohne Server).
function _hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295; // 0..1
}
function priceAt(assetId, tSec) {
  const a = ASSET_BY_ID[assetId];
  if (!a) return 0;
  const t = (tSec == null ? Date.now() / 1000 : tSec);
  const day = t / 86400;
  const ph = _hash(a.id) * 6.283;
  const slow = Math.sin(day * 0.571 + ph);
  const mid  = Math.sin(day * 2.094 + ph * 1.7);
  const fast = Math.sin(day * 8.7   + ph * 2.3);
  const tick = Math.sin(day * 130   + ph * 3.1);
  const factor = 1 + a.vol * (0.62 * slow + 0.34 * mid + 0.22 * fast + 0.05 * tick);
  return a.base * factor;
}

// Live-Kurs-Cache (gefüllt aus /api/data wenn Backend verfügbar)
const MARKET = { mode: 'sim', live: {} };   // mode: 'sim' | 'live'

async function refreshLivePrices() {
  // Sammel-Endpunkt mit 30s Server-Cache statt 6 paralleler /api/data-Calls
  try {
    const r = await fetch('/api/liga/prices');
    if (!r.ok) return false;
    const d = await r.json();
    const now = Date.now();
    Object.entries(d.prices || {}).forEach(([id, price]) => {
      MARKET.live[id] = { price, ts: now };
    });
    return Object.keys(MARKET.live).length > 0;
  } catch (e) { return false; }
}

// Einheitlicher Kurszugriff für die UI. now nur für die Simulation relevant.
function priceOf(assetId, now) {
  if (MARKET.mode === 'live') {
    const c = MARKET.live[assetId];
    if (c) return c.price;            // letzter bekannter Live-Kurs (lieber alt als falsches Regime)
  }
  return priceAt(assetId, now == null ? Date.now() / 1000 : now);
}

// ── POSITIONS-MATHEMATIK ─────────────────────────────────────────────────────
function liquidationPrice(pos) {
  const f = 1 / pos.leverage;
  return pos.dir === 'long' ? pos.entryPrice * (1 - f) : pos.entryPrice * (1 + f);
}
function positionEquity(pos, p) {
  const move = (p - pos.entryPrice) / pos.entryPrice * (pos.dir === 'long' ? 1 : -1);
  const pnl = pos.notional * move;
  let equity = pos.margin + pnl;
  const liquidated = equity <= 0;
  if (liquidated) equity = 0;
  return { move, pnl, pnlPct: pnl / pos.margin * 100, equity, liquidated };
}
function slotValue(slot, now) {
  if (slot.status === 'open') return positionEquity(slot.position, priceOf(slot.position.assetId, now)).equity;
  if (slot.status === 'liquidated') return 0;
  return slot.cash;
}
function accountValue(player, now) {
  return player.slots.reduce((s, slot) => s + slotValue(slot, now), 0);
}

// ── SETTLEMENT (Auto-Liquidation des eigenen Spielers) ───────────────────────
function settlePlayer(player, now) {
  let changed = false;
  player.slots.forEach((slot, i) => {
    if (slot.status !== 'open') return;
    const eq = positionEquity(slot.position, priceOf(slot.position.assetId, now));
    if (eq.liquidated) {
      player.trades.unshift(_makeTrade(slot.position, liquidationPrice(slot.position), now, 'liquidated'));
      player.slots[i] = { status: 'liquidated', cash: 0, position: null };
      changed = true;
    }
  });
  return changed;
}
function _makeTrade(pos, exitPrice, closedTs, reason) {
  const eq = positionEquity(pos, exitPrice);
  return {
    assetId: pos.assetId, dir: pos.dir, leverage: pos.leverage,
    entryPrice: pos.entryPrice, exitPrice,
    margin: pos.margin, pnl: Math.max(-pos.margin, eq.pnl), pnlPct: eq.pnlPct,
    openedTs: pos.entryTs, closedTs, reason,
  };
}

// ── AKTIONEN (mutieren das Spieler-Objekt) ───────────────────────────────────
function openPosition(player, slotIdx, assetId, dir, leverage, now) {
  const slot = player.slots[slotIdx];
  if (!slot || slot.status === 'open') throw new Error('Slot belegt');
  const margin = slot.status === 'liquidated' ? 0 : slot.cash;
  if (margin <= 0) throw new Error('Kein Kapital in diesem Slot');
  const entryPrice = priceOf(assetId, now);
  slot.status = 'open';
  slot.cash = 0;
  slot.position = { assetId, dir, leverage, margin, notional: margin * leverage, entryPrice, entryTs: now };
}
function closePosition(player, slotIdx, now) {
  const slot = player.slots[slotIdx];
  if (!slot || slot.status !== 'open') throw new Error('Keine offene Position');
  const eq = positionEquity(slot.position, priceOf(slot.position.assetId, now));
  player.trades.unshift(_makeTrade(slot.position, priceOf(slot.position.assetId, now), now, 'closed'));
  slot.status = 'cash';
  slot.cash = eq.equity;
  slot.position = null;
}

function newPlayer(name, pass) {
  return {
    name, pass, createdAt: Date.now() / 1000,
    slots: Array.from({ length: NUM_SLOTS }, () => ({ status: 'cash', cash: SLOT_SEED, position: null })),
    trades: [], isBot: false,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  SPEICHER-SCHICHT — backend-first, lokal als Fallback. Alles async.
// ════════════════════════════════════════════════════════════════════════════
const LigaStore = {
  KEY: 'traderlife_liga_v1',
  mode: 'local',     // 'backend' | 'local' — via detect() gesetzt
  ready: false,

  // Lokaler Cache
  _read() { try { return JSON.parse(localStorage.getItem(this.KEY)) || { players: {} }; } catch { return { players: {} }; } },
  _write(db) { localStorage.setItem(this.KEY, JSON.stringify(db)); },

  // Backend testen + Kurse anstoßen. Einmal beim Start aufrufen.
  async detect() {
    try {
      const r = await fetch('/api/liga/players', { method: 'GET' });
      if (r.ok) {
        this.mode = 'backend';
        if (await refreshLivePrices()) MARKET.mode = 'live';
      }
    } catch (e) { /* offline / Vorschau */ }
    this.ready = true;
    return this.mode;
  },

  async loadAll() {
    if (this.mode === 'backend') {
      try {
        const r = await fetch('/api/liga/players');
        if (r.ok) return await r.json();
      } catch (e) { /* Backend-Aussetzer → lokaler Cache unten */ }
    }
    const db = this._read();
    if (!db.seeded) { seedDemoField(db); db.seeded = true; this._write(db); }
    return db;
  },

  async login(name, pass) {
    if (this.mode === 'backend') {
      const r = await fetch('/api/liga/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pass }),
      });
      if (!r.ok) { let m = 'Login fehlgeschlagen'; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
      return (await r.json()).key;
    }
    // lokal
    const db = this.loadAllSync();
    const key = name.trim().toLowerCase();
    if (!key) throw new Error('Name fehlt');
    let p = db.players[key];
    if (p) { if (p.pass !== pass) throw new Error('Falsches Passwort für diesen Namen'); }
    else { p = newPlayer(name.trim(), pass); db.players[key] = p; this._write(db); }
    return key;
  },

  // eigenen Spielstand speichern
  async saveMe(key, pass, player) {
    if (this.mode === 'backend') {
      await fetch(`/api/liga/players/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass, player }),
      });
      return;
    }
    const db = this._read();
    db.players[key] = player;
    this._write(db);
  },

  // nur lokal genutzt (Seed)
  loadAllSync() {
    const db = this._read();
    if (!db.seeded) { seedDemoField(db); db.seeded = true; this._write(db); }
    return db;
  },
};

// ── DEMO-FELD (nur im lokalen Fallback; im Backend kommen echte Spieler) ─────
function seedDemoField(db) {
  const now = Date.now() / 1000;
  const H = 3600, D = 86400;
  const cur = id => priceOf(id, now);
  const openSlot = (assetId, dir, lev, entryPrice, entryTs) => ({
    status: 'open', cash: 0,
    position: { assetId, dir, leverage: lev, margin: SLOT_SEED, notional: SLOT_SEED * lev, entryPrice, entryTs },
  });
  const cashSlot = (cash) => ({ status: 'cash', cash, position: null });
  const bot = (name, slots, trades) => ({ name, pass: '0000', createdAt: now - 3 * D, slots, trades: trades || [], isBot: true });

  db.players['gerd'] = bot('Gerd das Genie', [
    openSlot('bitcoin', 'long', 5, cur('bitcoin') * 0.90, now - 2 * D),
    openSlot('nvidia',  'long', 2, cur('nvidia')  * 0.95, now - 1.5 * D),
    cashSlot(SLOT_SEED),
  ], [
    { assetId:'apple', dir:'long', leverage:2, entryPrice: cur('apple')*0.94, exitPrice: cur('apple')*1.02, margin:SLOT_SEED, pnl:16000, pnlPct:16, openedTs: now-3*D, closedTs: now-2.2*D, reason:'closed' },
  ]);
  db.players['sven'] = bot('Short-Sven', [
    openSlot('nvidia', 'short', 10, cur('nvidia') * 0.93, now - 20 * H),
    openSlot('solana', 'short',  5, cur('solana') * 0.96, now - 10 * H),
    cashSlot(SLOT_SEED),
  ], [
    { assetId:'bitcoin', dir:'long', leverage:2, entryPrice: cur('bitcoin')*0.97, exitPrice: cur('bitcoin')*0.975, margin:SLOT_SEED, pnl:1000, pnlPct:1, openedTs: now-2*D, closedTs: now-1.9*D, reason:'closed' },
  ]);
  db.players['anita'] = bot('All-In-Anita', [
    openSlot('ethereum', 'long', 30, cur('ethereum') * 1.005, now - 6 * H),
    cashSlot(SLOT_SEED), cashSlot(SLOT_SEED),
  ], [
    { assetId:'solana', dir:'long', leverage:100, entryPrice: cur('solana')*1.0, exitPrice: cur('solana')*0.99, margin:SLOT_SEED, pnl:-SLOT_SEED, pnlPct:-100, openedTs: now-2.5*D, closedTs: now-2.4*D, reason:'liquidated' },
  ]);
  db.players['vera'] = bot('Vorsichtige Vera', [
    openSlot('apple', 'long', 1, cur('apple') * 0.985, now - 2.5 * D),
    cashSlot(SLOT_SEED), cashSlot(SLOT_SEED),
  ], []);
}

// ── EXPORT ───────────────────────────────────────────────────────────────────
Object.assign(window, {
  LIGA: {
    SLOT_SEED, NUM_SLOTS, LEVERAGES, ASSETS, ASSET_BY_ID,
    priceAt, priceOf, MARKET, refreshLivePrices,
    liquidationPrice, positionEquity, slotValue, accountValue,
    settlePlayer, openPosition, closePosition,
    LigaStore, newPlayer,
  },
});
})();
