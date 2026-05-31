import { useState, useCallback, useRef } from "react";
import { searchAssets } from "../api";

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchAssets(q);
        setResults(data.results || []);
      } catch {}
      setLoading(false);
    }, 400);
  }, []);

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-4 py-3">
        <span className="text-gray-400">🔍</span>
        <input
          className="flex-1 bg-transparent outline-none text-sm placeholder-gray-500"
          placeholder="Aktie, ETF oder Krypto suchen... (z.B. AAPL, bitcoin)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
        />
        {loading && <span className="text-gray-500 text-xs animate-pulse">…</span>}
      </div>

      {results.length > 0 && (
        <ul className="absolute z-50 mt-2 w-full bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-2xl">
          {results.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-700 cursor-pointer transition-colors"
              onClick={() => {
                onSelect(r);
                setQuery(r.name || r.id);
                setResults([]);
              }}
            >
              <div>
                <span className="font-semibold text-sm">{r.name}</span>
                <span className="ml-2 text-gray-400 text-xs">{r.id || r.symbol}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                r.type === "crypto" ? "bg-orange-900/50 text-orange-300" : "bg-blue-900/50 text-blue-300"
              }`}>
                {r.type === "crypto" ? "Krypto" : "Aktie"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
