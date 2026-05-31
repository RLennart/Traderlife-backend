function Stat({ label, value, hint }) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3">
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div className={`font-semibold text-sm ${hint || "text-gray-100"}`}>
        {value != null ? (typeof value === "number" ? value.toLocaleString("de-DE", { maximumFractionDigits: 4 }) : value) : "—"}
      </div>
    </div>
  );
}

function rsiColor(rsi) {
  if (rsi == null) return "";
  if (rsi >= 70) return "text-red-400";
  if (rsi <= 30) return "text-green-400";
  return "text-gray-100";
}

export default function IndicatorPanel({ indicators, fundamentals }) {
  if (!indicators) return null;

  const macdBull = indicators.macd != null && indicators.macdSignal != null && indicators.macd > indicators.macdSignal;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Technische Indikatoren</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="RSI (14)" value={indicators.rsi} hint={rsiColor(indicators.rsi)} />
        <Stat
          label="MACD"
          value={indicators.macd != null ? `${indicators.macd?.toFixed(4)} (${macdBull ? "↑ bullish" : "↓ bearish"})` : null}
          hint={macdBull ? "text-green-400" : "text-red-400"}
        />
        <Stat label="SMA 20" value={indicators.sma20} />
        <Stat label="SMA 50" value={indicators.sma50} />
        <Stat label="SMA 200" value={indicators.sma200} />
        <Stat label="BB Upper" value={indicators.bbUpper} />
        <Stat label="BB Lower" value={indicators.bbLower} />
        <Stat label="Aktueller Preis" value={indicators.currentPrice} hint="text-white font-bold" />
      </div>

      {fundamentals && Object.keys(fundamentals).length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mt-2">Fundamentaldaten</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fundamentals.pe != null && <Stat label="KGV (P/E)" value={fundamentals.pe?.toFixed(2)} />}
            {fundamentals.eps != null && <Stat label="EPS" value={fundamentals.eps?.toFixed(2)} />}
            {fundamentals.beta != null && <Stat label="Beta" value={fundamentals.beta?.toFixed(2)} />}
            {fundamentals.dividendYield != null && (
              <Stat label="Dividendenrendite" value={`${(fundamentals.dividendYield * 100).toFixed(2)}%`} />
            )}
            {fundamentals.marketCap != null && (
              <Stat
                label="Marktkapitalisierung"
                value={
                  fundamentals.marketCap >= 1e12
                    ? `${(fundamentals.marketCap / 1e12).toFixed(2)}T`
                    : fundamentals.marketCap >= 1e9
                    ? `${(fundamentals.marketCap / 1e9).toFixed(2)}B`
                    : `${(fundamentals.marketCap / 1e6).toFixed(0)}M`
                }
              />
            )}
            {fundamentals["52wHigh"] != null && <Stat label="52W Hoch" value={fundamentals["52wHigh"]} />}
            {fundamentals["52wLow"] != null && <Stat label="52W Tief" value={fundamentals["52wLow"]} />}
            {fundamentals.priceChange24h != null && (
              <Stat
                label="24h Änderung"
                value={`${fundamentals.priceChange24h?.toFixed(2)}%`}
                hint={fundamentals.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
