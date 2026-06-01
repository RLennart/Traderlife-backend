// ════════════════════════════════════════════════════════════════════════════
//  TraderLife · LIGA — UI-Komponenten (React via CDN)  (PRODUKTIONS-VERSION)
//  Gleicher Stil wie static/index.html (React.createElement, kein Babel).
//  Speicher-/KI-Aufrufe sind async und backend-first mit Fallback.
// ════════════════════════════════════════════════════════════════════════════
(function () {
const { useState, useEffect, useRef } = React;
const e = React.createElement;
const L = window.LIGA;

// ── FORMAT-HELFER ────────────────────────────────────────────────────────────
const fmtMoney = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' $';
const fmtPrice = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: v >= 100 ? 2 : 4 });
const fmtPct = (v) => (v >= 0 ? '+' : '') + Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '%';
const pnlCls = (v) => v > 0.0001 ? 'text-green-400' : v < -0.0001 ? 'text-red-400' : 'text-gray-300';
const assetOf = (id) => L.ASSET_BY_ID[id] || { sym: id, name: id, type: 'stock' };
const dirBadge = (dir) => dir === 'long'
  ? e('span', { className: 'text-xs font-bold px-2 py-0.5 rounded-md bg-green-950 text-green-400 border border-green-800' }, '▲ LONG')
  : e('span', { className: 'text-xs font-bold px-2 py-0.5 rounded-md bg-red-950 text-red-400 border border-red-800' }, '▼ SHORT');
const levCls = (l) => l >= 100 ? 'text-red-400' : l >= 30 ? 'text-orange-400' : l >= 10 ? 'text-yellow-400' : 'text-gray-300';

function AssetDot({ id }) {
  const a = assetOf(id);
  const bg = a.type === 'crypto' ? 'bg-orange-900 text-orange-300' : 'bg-blue-900 text-blue-300';
  return e('span', { className: `text-xs px-2 py-0.5 rounded-md font-semibold ${bg}` }, a.sym);
}

// ── LOGIN-GATE ───────────────────────────────────────────────────────────────
function LoginGate({ onLogin }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr('Bitte einen Namen eingeben');
    if (!pass.trim()) return setErr('Bitte ein kurzes Passwort setzen');
    setBusy(true);
    try {
      const key = await L.LigaStore.login(name, pass);
      onLogin(key, pass);
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  }

  return e('div', { className: 'max-w-sm mx-auto pt-6' },
    e('div', { className: 'text-center mb-6' },
      e('div', { className: 'text-5xl mb-3' }, '🏆'),
      e('h1', { className: 'text-2xl font-black text-white mb-1' }, 'TraderLife Liga'),
      e('p', { className: 'text-gray-400 text-sm' }, 'Eröffne fiktive Positionen, heble bis 100x und kämpf dich an die Spitze. 3 Slots × 100.000 $.')
    ),
    e('div', { className: 'bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3' },
      e('div', null,
        e('label', { className: 'text-xs text-gray-500 mb-1 block' }, 'Spielername'),
        e('input', {
          className: 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500',
          placeholder: 'z.B. Lennart', value: name, maxLength: 24,
          onChange: ev => setName(ev.target.value),
          onKeyDown: ev => ev.key === 'Enter' && submit(),
        })
      ),
      e('div', null,
        e('label', { className: 'text-xs text-gray-500 mb-1 block' }, 'Kurzes Passwort'),
        e('input', {
          className: 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500',
          placeholder: 'z.B. 1234', value: pass, type: 'text', maxLength: 16,
          onChange: ev => setPass(ev.target.value),
          onKeyDown: ev => ev.key === 'Enter' && submit(),
        }),
        e('p', { className: 'text-xs text-gray-600 mt-1' }, 'Keine echte Anmeldung — nur damit niemand deinen Namen kapert.')
      ),
      err && e('div', { className: 'bg-red-950 border border-red-800 rounded-xl p-3 text-red-300 text-xs' }, err),
      e('button', {
        onClick: submit, disabled: busy,
        className: `w-full py-3 rounded-xl font-semibold text-sm transition-colors ${busy ? 'bg-gray-700 text-gray-500' : 'bg-blue-600 hover:bg-blue-500 text-white'}`
      }, busy ? '…' : 'Einsteigen / Fortsetzen')
    ),
    e('p', { className: 'text-center text-gray-600 text-xs mt-4' }, 'Bekannter Name + richtiges Passwort = dein altes Depot. Neuer Name = neues Depot.')
  );
}

// ── LIVE-KURS-LEISTE ─────────────────────────────────────────────────────────
function PriceTicker({ now }) {
  const openRef = useRef({});
  return e('div', { className: 'flex gap-2 overflow-x-auto pb-1 -mx-1 px-1' },
    L.ASSETS.map(a => {
      const p = L.priceOf(a.id, now);
      if (openRef.current[a.id] == null) openRef.current[a.id] = p; // Sitzungs-Eröffnung
      const base = L.MARKET.mode === 'sim' ? L.priceAt(a.id, now - 3600) : openRef.current[a.id];
      const ch = base ? (p - base) / base * 100 : 0;
      const lbl = L.MARKET.mode === 'sim' ? ' /1h' : '';
      return e('div', { key: a.id, className: 'flex-shrink-0 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 min-w-[92px]' },
        e('div', { className: 'flex items-center gap-1.5 mb-0.5' }, e(AssetDot, { id: a.id })),
        e('div', { className: 'text-sm font-bold text-white' }, fmtPrice(p)),
        e('div', { className: `text-xs font-medium ${pnlCls(ch)}` }, fmtPct(ch) + lbl)
      );
    })
  );
}

// ── POSITIONS-SLOT-KARTE ─────────────────────────────────────────────────────
function SlotCard({ slot, idx, now, onOpen, onClose }) {
  if (slot.status === 'liquidated') {
    return e('div', { className: 'rounded-2xl border border-red-900/60 bg-red-950/20 p-4 flex items-center justify-between' },
      e('div', null,
        e('div', { className: 'text-sm font-bold text-red-400' }, '💀 Liquidiert'),
        e('div', { className: 'text-xs text-gray-500' }, `Slot ${idx + 1} · Kapital verloren`)
      ),
      e('div', { className: 'text-right' }, e('div', { className: 'text-lg font-black text-red-400' }, '0 $'))
    );
  }
  if (slot.status === 'cash') {
    return e('div', { className: 'rounded-2xl border border-gray-800 bg-gray-900 p-4 flex items-center justify-between' },
      e('div', null,
        e('div', { className: 'text-xs text-gray-500 mb-0.5' }, `Slot ${idx + 1} · frei`),
        e('div', { className: 'text-lg font-black text-white' }, fmtMoney(slot.cash)),
        e('div', { className: 'text-xs text-gray-500' }, 'Bereit zum Investieren')
      ),
      e('button', {
        onClick: () => onOpen(idx),
        className: 'px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors'
      }, '+ Position')
    );
  }
  const pos = slot.position;
  const a = assetOf(pos.assetId);
  const price = L.priceOf(pos.assetId, now);
  const eq = L.positionEquity(pos, price);
  const liq = L.liquidationPrice(pos);
  const health = Math.max(0, Math.min(100, eq.equity / pos.margin * 100));
  const healthCls = health > 60 ? 'bg-green-500' : health > 30 ? 'bg-yellow-500' : 'bg-red-500';
  const distToLiq = Math.abs((price - liq) / price * 100);

  return e('div', { className: 'rounded-2xl border border-gray-800 bg-gray-900 p-4 space-y-3' },
    e('div', { className: 'flex items-start justify-between gap-2' },
      e('div', { className: 'flex items-center gap-2 flex-wrap' },
        e(AssetDot, { id: pos.assetId }),
        e('span', { className: 'text-sm font-bold text-white' }, a.name),
        dirBadge(pos.dir),
        e('span', { className: `text-xs font-bold ${levCls(pos.leverage)}` }, pos.leverage + '×')
      ),
      e('div', { className: 'text-right' },
        e('div', { className: `text-lg font-black ${pnlCls(eq.pnl)}` }, fmtMoney(eq.equity)),
        e('div', { className: `text-xs font-bold ${pnlCls(eq.pnl)}` }, fmtPct(eq.pnlPct) + ' (' + (eq.pnl >= 0 ? '+' : '') + fmtMoney(eq.pnl) + ')')
      )
    ),
    e('div', null,
      e('div', { className: 'w-full bg-gray-800 rounded-full h-1.5 overflow-hidden' },
        e('div', { className: `h-1.5 rounded-full ${healthCls}`, style: { width: health + '%', transition: 'width 0.5s' } })
      ),
      e('div', { className: 'flex justify-between text-xs text-gray-500 mt-1.5' },
        e('span', null, 'Einstieg ', e('span', { className: 'text-gray-300' }, fmtPrice(pos.entryPrice))),
        e('span', null, 'Jetzt ', e('span', { className: 'text-white font-semibold' }, fmtPrice(price))),
        e('span', { className: distToLiq < 15 ? 'text-red-400' : '' }, '💀 ', fmtPrice(liq))
      )
    ),
    e('button', {
      onClick: () => onClose(idx),
      className: 'w-full py-2 rounded-xl text-sm font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors'
    }, 'Position schließen → ' + fmtMoney(eq.equity) + ' sichern')
  );
}

// ── POSITION-ERÖFFNEN-SHEET ──────────────────────────────────────────────────
function OpenSheet({ slotIdx, cash, now, onConfirm, onCancel }) {
  const [assetId, setAssetId] = useState(L.ASSETS[0].id);
  const [dir, setDir] = useState('long');
  const [lev, setLev] = useState(2);

  const price = L.priceOf(assetId, now);
  const liqMovePct = 100 / lev;
  const liqPrice = dir === 'long' ? price * (1 - 1 / lev) : price * (1 + 1 / lev);
  const notional = cash * lev;

  return e('div', { className: 'fixed inset-0 z-[60] flex items-end sm:items-center justify-center', style: { background: 'rgba(0,0,0,0.65)' }, onClick: onCancel },
    e('div', {
      className: 'w-full sm:max-w-md bg-gray-900 border-t sm:border border-gray-700 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto',
      onClick: ev => ev.stopPropagation()
    },
      e('div', { className: 'flex items-center justify-between' },
        e('h3', { className: 'text-lg font-black text-white' }, `Slot ${slotIdx + 1} · Position eröffnen`),
        e('button', { onClick: onCancel, className: 'text-gray-500 hover:text-white text-xl leading-none' }, '✕')
      ),
      e('div', { className: 'text-xs text-gray-500' }, 'Einsatz (Margin): ', e('span', { className: 'text-white font-semibold' }, fmtMoney(cash))),

      e('div', null,
        e('div', { className: 'text-xs text-gray-500 mb-1.5' }, 'Wert wählen'),
        e('div', { className: 'grid grid-cols-3 gap-2' },
          L.ASSETS.map(a => e('button', {
            key: a.id, onClick: () => setAssetId(a.id),
            className: `rounded-xl px-2 py-2 border text-left transition-colors ${assetId === a.id ? 'bg-blue-950 border-blue-600' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`
          },
            e('div', { className: 'flex items-center justify-between' }, e(AssetDot, { id: a.id }),
              assetId === a.id && e('span', { className: 'text-blue-400 text-xs' }, '✓')),
            e('div', { className: 'text-xs text-gray-400 mt-1 truncate' }, a.name),
            e('div', { className: 'text-xs font-semibold text-white' }, fmtPrice(L.priceOf(a.id, now)))
          ))
        )
      ),

      e('div', null,
        e('div', { className: 'text-xs text-gray-500 mb-1.5' }, 'Richtung'),
        e('div', { className: 'grid grid-cols-2 gap-2' },
          e('button', {
            onClick: () => setDir('long'),
            className: `py-3 rounded-xl font-bold text-sm border transition-colors ${dir === 'long' ? 'bg-green-950 border-green-600 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`
          }, '▲ LONG · steigt'),
          e('button', {
            onClick: () => setDir('short'),
            className: `py-3 rounded-xl font-bold text-sm border transition-colors ${dir === 'short' ? 'bg-red-950 border-red-600 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`
          }, '▼ SHORT · fällt')
        )
      ),

      e('div', null,
        e('div', { className: 'text-xs text-gray-500 mb-1.5' }, 'Hebel'),
        e('div', { className: 'grid grid-cols-6 gap-1.5' },
          L.LEVERAGES.map(l => e('button', {
            key: l, onClick: () => setLev(l),
            className: `py-2.5 rounded-lg font-bold text-sm border transition-colors ${lev === l ? 'bg-blue-600 border-blue-500 text-white' : `bg-gray-800 border-gray-700 ${levCls(l)} hover:border-gray-600`}`
          }, l + '×'))
        )
      ),

      e('div', { className: `rounded-xl p-3 border ${lev >= 30 ? 'bg-red-950/30 border-red-800' : 'bg-gray-800 border-gray-700'}` },
        e('div', { className: 'grid grid-cols-2 gap-y-1 text-xs' },
          e('span', { className: 'text-gray-500' }, 'Positionsgröße'),
          e('span', { className: 'text-right text-white font-semibold' }, fmtMoney(notional)),
          e('span', { className: 'text-gray-500' }, 'Liquidation bei'),
          e('span', { className: 'text-right text-red-400 font-semibold' }, `${dir === 'long' ? '−' : '+'}${liqMovePct.toFixed(liqMovePct < 10 ? 1 : 0)}%  →  ${fmtPrice(liqPrice)}`)
        ),
        lev >= 30 && e('div', { className: 'text-xs text-red-400 mt-2 font-medium' },
          lev >= 100 ? '☠️ 100× — schon 1% gegen dich und der Slot ist Geschichte.' : '⚠️ Hoher Hebel — eine kleine Gegenbewegung reicht zur Liquidation.')
      ),

      e('button', {
        onClick: () => onConfirm(slotIdx, assetId, dir, lev),
        className: `w-full py-3.5 rounded-xl font-bold text-sm transition-colors ${dir === 'long' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'} text-white`
      }, `${dir === 'long' ? 'LONG' : 'SHORT'} eröffnen · ${fmtMoney(cash)} @ ${lev}×`)
    )
  );
}

// ── DEPOT-ANSICHT ────────────────────────────────────────────────────────────
function PortfolioView({ me, now, onOpen, onClose }) {
  const av = L.accountValue(me, now);
  const totalPnl = av - L.SLOT_SEED * L.NUM_SLOTS;
  const totalPct = totalPnl / (L.SLOT_SEED * L.NUM_SLOTS) * 100;

  return e('div', { className: 'space-y-4' },
    e('div', { className: `rounded-2xl border border-gray-800 p-5 bg-gradient-to-br ${totalPnl >= 0 ? 'from-green-950/40' : 'from-red-950/40'} to-gray-900` },
      e('div', { className: 'flex items-end justify-between' },
        e('div', null,
          e('div', { className: 'text-xs text-gray-400 uppercase tracking-wider mb-1' }, 'Kontostand'),
          e('div', { className: 'text-3xl font-black text-white' }, fmtMoney(av)),
        ),
        e('div', { className: 'text-right' },
          e('div', { className: `text-lg font-black ${pnlCls(totalPnl)}` }, fmtPct(totalPct)),
          e('div', { className: `text-xs font-medium ${pnlCls(totalPnl)}` }, (totalPnl >= 0 ? '+' : '') + fmtMoney(totalPnl))
        )
      ),
      e('div', { className: 'text-xs text-gray-500 mt-2' }, 'Start: ' + fmtMoney(L.SLOT_SEED * L.NUM_SLOTS) + ' · realisiert + unrealisiert')
    ),
    e('div', { className: 'space-y-2.5' },
      me.slots.map((slot, i) => e(SlotCard, { key: i, slot, idx: i, now, onOpen, onClose }))
    )
  );
}

// ── RANGLISTE ────────────────────────────────────────────────────────────────
function LeaderboardView({ db, meKey, now }) {
  const rows = Object.entries(db.players)
    .map(([key, p]) => ({ key, p, av: L.accountValue(p, now), pct: (L.accountValue(p, now) - L.SLOT_SEED * L.NUM_SLOTS) / (L.SLOT_SEED * L.NUM_SLOTS) * 100 }))
    .sort((a, b) => b.av - a.av);
  const medal = ['🥇', '🥈', '🥉'];

  return e('div', { className: 'space-y-2.5' },
    e('div', { className: 'text-xs text-gray-500 px-1 mb-1' }, `${rows.length} Trader · Rang nach Kontostand`),
    rows.map((r, i) => {
      const isMe = r.key === meKey;
      return e('div', {
        key: r.key,
        className: `rounded-2xl border p-4 flex items-center gap-3 ${isMe ? 'border-blue-600 bg-blue-950/30' : 'border-gray-800 bg-gray-900'}`
      },
        e('div', { className: 'w-8 text-center text-lg font-black flex-shrink-0' }, medal[i] || e('span', { className: 'text-gray-500 text-sm' }, '#' + (i + 1))),
        e('div', { className: 'flex-1 min-w-0' },
          e('div', { className: 'flex items-center gap-2' },
            e('span', { className: 'font-bold text-white truncate' }, r.p.name),
            isMe && e('span', { className: 'text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded' }, 'DU'),
            r.p.isBot && e('span', { className: 'text-xs text-gray-600' }, '🤖')
          ),
          e('div', { className: 'flex items-center gap-1.5 mt-0.5 flex-wrap' },
            ...r.p.slots.filter(s => s.status === 'open').map((s, j) =>
              e('span', { key: j, className: 'text-xs text-gray-500 flex items-center gap-0.5' },
                e(AssetDot, { id: s.position.assetId }),
                e('span', { className: levCls(s.position.leverage) }, s.position.leverage + '×'),
                e('span', { className: s.position.dir === 'long' ? 'text-green-500' : 'text-red-500' }, s.position.dir === 'long' ? '▲' : '▼')
              )
            ),
            r.p.slots.every(s => s.status !== 'open') && e('span', { className: 'text-xs text-gray-600' }, 'keine offene Position')
          )
        ),
        e('div', { className: 'text-right flex-shrink-0' },
          e('div', { className: 'font-black text-white' }, fmtMoney(r.av)),
          e('div', { className: `text-xs font-bold ${pnlCls(r.pct)}` }, fmtPct(r.pct))
        )
      );
    })
  );
}

// ── VERLAUF ──────────────────────────────────────────────────────────────────
function HistoryView({ me }) {
  if (!me.trades.length) return e('div', { className: 'bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center' },
    e('div', { className: 'text-4xl mb-3' }, '🧾'),
    e('p', { className: 'text-gray-400 text-sm' }, 'Noch keine abgeschlossenen Trades.')
  );
  return e('div', { className: 'space-y-2' },
    me.trades.map((t, i) =>
      e('div', { key: i, className: 'rounded-2xl border border-gray-800 bg-gray-900 p-3.5 flex items-center justify-between gap-3' },
        e('div', { className: 'flex items-center gap-2 flex-wrap min-w-0' },
          e(AssetDot, { id: t.assetId }),
          dirBadge(t.dir),
          e('span', { className: `text-xs font-bold ${levCls(t.leverage)}` }, t.leverage + '×'),
          t.reason === 'liquidated' && e('span', { className: 'text-xs text-red-400 font-bold' }, '💀 liquidiert')
        ),
        e('div', { className: 'text-right flex-shrink-0' },
          e('div', { className: `font-bold ${pnlCls(t.pnl)}` }, (t.pnl >= 0 ? '+' : '') + fmtMoney(t.pnl)),
          e('div', { className: `text-xs ${pnlCls(t.pnl)}` }, fmtPct(t.pnlPct))
        )
      )
    )
  );
}

// ── KI-ZUSAMMENFASSUNG (Stammtisch-Roast) ────────────────────────────────────
const ROAST_HEAD = `Du bist ein schonungsloser Börsen-Stammtisch-Kommentator. Schreibe auf DEUTSCH eine bissige, lustige Zusammenfassung des aktuellen Stands eines fiktiven Trading-Wettbewerbs. Derber Stammtisch-Humor, aber clever — keine Beleidigungen gegen echte Gruppen, nur liebevoller Spott über das Trading-Verhalten.

Roaste besonders:
- wer mit absurdem Hebel (30×, 100×) zockt und liquidiert wurde
- wer SHORT gegangen ist, während der Kurs steigt (oder LONG während er fällt)
- wer aus Angst Gewinner zu früh verkauft hat
- wer feige nur 1× Hebel fährt und quasi nichts tut
- den aktuellen Letzten

Lobe kurz und ironisch den Führenden.

STAND:
`;
const ROAST_FOOT = `

Schreibe 3–4 kurze Absätze. Beginne mit einer Schlagzeile in **fett**. Sprich die Trader direkt mit Namen an. Nutze gern 1-2 passende Emojis.`;

function SummaryView({ db, now }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  function buildBriefing() {
    return Object.values(db.players).map(p => {
      const av = L.accountValue(p, now);
      const positions = p.slots.filter(s => s.status === 'open').map(s => {
        const eq = L.positionEquity(s.position, L.priceOf(s.position.assetId, now));
        return `${assetOf(s.position.assetId).name} ${s.position.dir.toUpperCase()} ${s.position.leverage}× (${fmtPct(eq.pnlPct)})`;
      });
      const liqs = p.trades.filter(t => t.reason === 'liquidated').length;
      const closed = p.trades.filter(t => t.reason === 'closed').length;
      return { name: p.name, av, pct: (av - 300000) / 300000 * 100, positions, liqs, closed };
    }).sort((a, b) => b.av - a.av)
      .map((r, i) => `${i + 1}. ${r.name} — Konto ${fmtMoney(r.av)} (${fmtPct(r.pct)}). Offen: ${r.positions.join('; ') || 'nichts'}. Liquidationen: ${r.liqs}. Geschlossene Trades: ${r.closed}.`)
      .join('\n');
  }

  async function generate() {
    setLoading(true); setErr(null); setText(null);
    const briefing = buildBriefing();
    try {
      let out = null;
      // 1) Bevorzugt: Backend (Gemini)
      try {
        const r = await fetch('/api/liga/roast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ briefing }),
        });
        if (r.ok) out = (await r.json()).text;
      } catch (e) { /* kein Backend → Fallback */ }
      // 2) Fallback: Claude (z.B. in der Design-Vorschau)
      if (!out && window.claude && window.claude.complete) {
        out = await window.claude.complete(ROAST_HEAD + briefing + ROAST_FOOT);
      }
      if (!out) throw new Error('Keine KI erreichbar');
      setText(out);
    } catch (ex) {
      setErr('KI nicht erreichbar (' + ex.message + ').');
    }
    setLoading(false);
  }

  const render = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>');

  return e('div', { className: 'space-y-4' },
    e('div', { className: 'bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3' },
      e('div', { className: 'flex items-center justify-between gap-2 flex-wrap' },
        e('div', null,
          e('div', { className: 'text-xs font-semibold text-gray-400 uppercase tracking-wider' }, '🍻 Stammtisch-Analyse'),
          e('div', { className: 'text-xs text-gray-600 mt-0.5' }, 'KI roastet das ganze Feld auf Basis des aktuellen Stands.')
        ),
        e('button', {
          onClick: generate, disabled: loading,
          className: `text-sm px-4 py-2.5 rounded-xl font-semibold transition-colors ${loading ? 'bg-gray-700 text-gray-500' : 'bg-purple-700 hover:bg-purple-600 text-white'}`
        }, loading ? '⏳ schreibt…' : '🤖 Zusammenfassung generieren')
      ),
      err && e('div', { className: 'bg-red-950 border border-red-800 rounded-xl p-3 text-red-300 text-xs' }, err)
    ),
    loading && e('div', { className: 'flex flex-col items-center justify-center py-10 gap-3' },
      e('div', { className: 'spinner' }),
      e('p', { className: 'text-gray-500 text-sm' }, 'Der Kommentator holt Luft…')
    ),
    text && e('div', { className: 'bg-gradient-to-br from-purple-950/30 to-gray-900 border border-purple-900/50 rounded-2xl p-5' },
      e('div', { className: 'text-sm text-gray-200 leading-relaxed whitespace-pre-wrap', dangerouslySetInnerHTML: { __html: render(text) } })
    ),
    !text && !loading && e('div', { className: 'text-center py-8 text-gray-600 text-sm' }, '↑ Button drücken für den Spott des Tages')
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  LIGA-APP (Wurzelkomponente des neuen Tabs) — async, backend-first
// ════════════════════════════════════════════════════════════════════════════
function LigaApp() {
  const [meKey, setMeKey] = useState(() => localStorage.getItem('traderlife_liga_me') || null);
  const [pass, setPass] = useState(() => localStorage.getItem('traderlife_liga_pass') || '');
  const [db, setDb] = useState(null);
  const [tab, setTab] = useState('portfolio');
  const [now, setNow] = useState(Date.now() / 1000);
  const [sheet, setSheet] = useState(null);
  const [booting, setBooting] = useState(true);
  const live = useRef(false);

  // Eigenen Spieler holen, settlen, ggf. speichern, State setzen
  async function reload() {
    const fresh = await L.LigaStore.loadAll();
    const k = localStorage.getItem('traderlife_liga_me');
    if (k && fresh.players[k]) {
      if (L.settlePlayer(fresh.players[k], Date.now() / 1000)) {
        await L.LigaStore.saveMe(k, localStorage.getItem('traderlife_liga_pass') || '', fresh.players[k]);
      }
    }
    setDb(fresh); setNow(Date.now() / 1000);
  }

  // Start: Backend erkennen + erstes Laden
  useEffect(() => {
    (async () => {
      await L.LigaStore.detect();
      live.current = L.LigaStore.mode === 'backend';
      await reload();
      setBooting(false);
    })();
  }, []);

  // Live-Tick
  useEffect(() => {
    const iv = setInterval(async () => {
      if (live.current && L.MARKET.mode === 'live') { try { await L.refreshLivePrices(); } catch (e) {} }
      reload();
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  const me = (db && meKey) ? db.players[meKey] : null;

  function handleLogin(key, pw) {
    localStorage.setItem('traderlife_liga_me', key);
    localStorage.setItem('traderlife_liga_pass', pw);
    setMeKey(key); setPass(pw); setTab('portfolio'); reload();
  }
  function logout() {
    localStorage.removeItem('traderlife_liga_me');
    localStorage.removeItem('traderlife_liga_pass');
    setMeKey(null);
  }

  function onOpen(slotIdx) { setSheet({ slotIdx, cash: me.slots[slotIdx].cash }); }

  async function confirmOpen(slotIdx, assetId, dir, lev) {
    setSheet(null);
    const fresh = await L.LigaStore.loadAll();
    const p = fresh.players[meKey];
    try { L.openPosition(p, slotIdx, assetId, dir, lev, Date.now() / 1000); await L.LigaStore.saveMe(meKey, pass, p); }
    catch (ex) { alert(ex.message); }
    reload();
  }
  async function onClose(slotIdx) {
    const fresh = await L.LigaStore.loadAll();
    const p = fresh.players[meKey];
    try { L.closePosition(p, slotIdx, Date.now() / 1000); await L.LigaStore.saveMe(meKey, pass, p); }
    catch (ex) { alert(ex.message); }
    reload();
  }

  if (booting || !db) {
    return e('div', { className: 'max-w-4xl mx-auto px-4 py-20 flex flex-col items-center gap-4' },
      e('div', { className: 'spinner' }), e('p', { className: 'text-gray-500 text-sm' }, 'Liga lädt…'));
  }
  if (!meKey || !me) {
    return e('div', { className: 'max-w-4xl mx-auto px-4 py-6' }, e(LoginGate, { onLogin: handleLogin }));
  }

  const TABS = [['portfolio', '💼 Depot'], ['board', '🏆 Rangliste'], ['history', '🧾 Verlauf'], ['summary', '🍻 Roast']];

  return e('div', { className: 'max-w-4xl mx-auto px-4 py-5 space-y-4' },
    e('div', { className: 'flex items-center justify-between' },
      e('div', null,
        e('div', { className: 'text-xs text-gray-500' }, 'Eingeloggt als' + (L.LigaStore.mode === 'backend' ? '' : ' (lokal)')),
        e('div', { className: 'text-base font-bold text-white' }, me.name)
      ),
      e('button', { onClick: logout, className: 'text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded-lg px-3 py-1.5' }, 'Wechseln')
    ),
    e(PriceTicker, { now }),
    e('div', { className: 'flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800' },
      TABS.map(([id, label]) => e('button', {
        key: id, onClick: () => setTab(id),
        className: `flex-1 py-2 px-1 rounded-lg text-xs sm:text-sm font-medium transition-colors ${tab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`
      }, label))
    ),
    tab === 'portfolio' && e(PortfolioView, { me, now, onOpen, onClose }),
    tab === 'board' && e(LeaderboardView, { db, meKey, now }),
    tab === 'history' && e(HistoryView, { me }),
    tab === 'summary' && e(SummaryView, { db, now }),
    sheet && e(OpenSheet, { slotIdx: sheet.slotIdx, cash: sheet.cash, now, onConfirm: confirmOpen, onCancel: () => setSheet(null) })
  );
}

window.LigaApp = LigaApp;
})();
