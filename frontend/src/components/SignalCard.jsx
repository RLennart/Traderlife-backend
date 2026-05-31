export default function SignalCard({ signal }) {
  if (!signal) return null;

  const colorMap = {
    BUY: "border-green-500 bg-green-950/40",
    SELL: "border-red-500 bg-red-950/40",
    HOLD: "border-yellow-500 bg-yellow-950/40",
  };
  const textMap = {
    BUY: "text-green-400",
    SELL: "text-red-400",
    HOLD: "text-yellow-400",
  };
  const emojiMap = { BUY: "📈", SELL: "📉", HOLD: "⏸️" };

  const s = signal.signal || "HOLD";

  return (
    <div className={`rounded-2xl border-2 p-5 ${colorMap[s] || colorMap.HOLD}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{emojiMap[s]}</span>
          <div>
            <div className={`text-2xl font-black ${textMap[s] || textMap.HOLD}`}>{s}</div>
            <div className="text-gray-400 text-xs">KI-Signal</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{signal.confidence}%</div>
          <div className="text-gray-400 text-xs">Konfidenz</div>
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="w-full bg-gray-800 rounded-full h-2 mb-4">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${
            s === "BUY" ? "bg-green-500" : s === "SELL" ? "bg-red-500" : "bg-yellow-500"
          }`}
          style={{ width: `${signal.confidence}%` }}
        />
      </div>

      <p className="text-gray-300 text-sm leading-relaxed mb-4">{signal.reasoning}</p>

      {signal.targets && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Einstieg", value: signal.targets.entry, color: "text-blue-400" },
            { label: "Take Profit", value: signal.targets.takeProfit, color: "text-green-400" },
            { label: "Stop Loss", value: signal.targets.stopLoss, color: "text-red-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-800/60 rounded-xl p-3 text-center">
              <div className={`font-semibold text-sm ${color}`}>
                {value != null ? value.toLocaleString("de-DE", { maximumFractionDigits: 4 }) : "—"}
              </div>
              <div className="text-gray-500 text-xs mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {signal.keyFactors?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {signal.keyFactors.map((f, i) => (
            <span key={i} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
