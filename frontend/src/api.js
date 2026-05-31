const BASE = import.meta.env.VITE_API_URL || "/api";

export async function searchAssets(query) {
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`);
  return r.json();
}

export async function analyzeAsset(type, symbol, period = "6mo") {
  const r = await fetch(`${BASE}/analyze/${type}/${symbol}?period=${period}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
