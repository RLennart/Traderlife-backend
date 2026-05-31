import { useState } from "react";
import SearchBar from "./components/SearchBar";
import CandleChart from "./components/CandleChart";
import SignalCard from "./components/SignalCard";
import IndicatorPanel from "./components/IndicatorPanel";
import { analyzeAsset } from "./api";

const PERIODS = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1J", value: "1y" },
  { label: "2J", value: "2y" },
];

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("6mo");
  const [activeAsset, setActiveAsset] = useState(null);
  const [tab, setTab] = useState("chart");

  async function load(asset, p = period) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeAsset(asset.type, asset.id, p);
      setData(result);
      setActiveAsset(asset);
    } catch (e) {
      setError("Fehler beim Laden der Daten. Bitte versuche es erneut.");
    }
    setLoading(false);
  }

  async function changePeriod(p) {
    setPeriod(p);
    if (activeAsset) await load(activeAsset, p);
  }

  const s = data?.signal;
  const signalBg = s?.signal === "BUY" ? "from-green-950/20" : s?.signal === "SELL" ? "from-red-950/20" : "from-gray-950";

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4 sticky top-0 bg-gray-950/95 backdrop-blur z-40">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <div className="text-xl font-black tracking-tight">
            <span className="text-blue-400">Trader</span>
            <span className="text-white">Life</span>
          </div>
          <SearchBar onSelect={(a) => load(a)} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Startscreen */}
        {!data && !loading && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📊</div>
            <h1 className="text-2xl font-bold mb-2">KI-gestützte Marktanalyse</h1>
            <p className="text-gray-400 text-sm max-w-sm mx-auto">
              Suche nach einer Aktie, ETF oder Kryptowährung um technische Indikatoren und KI-Handelssignale zu erhalten.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                { type: "stock", id: "AAPL", name: "Apple" },
                { type: "stock", id: "NVDA", name: "NVIDIA" },
                { type: "crypto", id: "bitcoin", name: "Bitcoin" },
                { type: "crypto", id: "ethereum", name: "Ethereum" },
                { type: "stock", id: "SPY", name: "S&P 500 ETF" },
              ].map((a) => (
                <button
                  key={a.id}
                  onClick={() => load(a)}
                  className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded-full transition-colors"
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ladeanimation */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Analysiere Marktdaten mit KI…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {data && !loading && (
          <>
            {/* Asset-Header */}
            <div className={`rounded-2xl bg-gradient-to-br ${signalBg} to-gray-900 border border-gray-800 p-5`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-black">{data.fundamentals?.name || data.symbol || data.coin}</h2>
                  <p className="text-gray-400 text-sm">
                    {data.fundamentals?.sector || (activeAsset?.type === "crypto" ? "Kryptowährung" : "Aktie")}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black">
                    {data.indicators?.currentPrice?.toLocaleString("de-DE", { maximumFractionDigits: 4 })}
                  </div>
                  <div className={`text-sm font-medium ${
                    (data.fundamentals?.priceChange24h ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {data.fundamentals?.priceChange24h != null
                      ? `${data.fundamentals.priceChange24h >= 0 ? "+" : ""}${data.fundamentals.priceChange24h.toFixed(2)}%`
                      : ""}
                  </div>
                </div>
              </div>

              {/* Zeitraum-Auswahl */}
              <div className="flex gap-1 mt-4">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => changePeriod(p.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      period === p.value ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab-Navigation */}
            <div className="flex gap-1 bg-gray-900 rounded-xl p-1">
              {[
                { id: "chart", label: "📊 Chart" },
                { id: "signal", label: "🤖 KI-Signal" },
                { id: "indicators", label: "📈 Indikatoren" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    tab === t.id ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab-Inhalte */}
            {tab === "chart" && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
                <CandleChart candles={data.candles} indicators={data.indicators} />
              </div>
            )}

            {tab === "signal" && <SignalCard signal={data.signal} />}

            {tab === "indicators" && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
                <IndicatorPanel indicators={data.indicators} fundamentals={data.fundamentals} />
              </div>
            )}

            {/* Analyse erneut starten */}
            <button
              onClick={() => load(activeAsset)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              🔄 Neue KI-Analyse
            </button>
          </>
        )}
      </main>

      <footer className="text-center text-gray-700 text-xs py-6">
        TraderLife · Keine Anlageberatung · Auf eigenes Risiko
      </footer>
    </div>
  );
}
