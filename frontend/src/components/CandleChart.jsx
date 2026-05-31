import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function CandleChart({ candles, indicators }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles?.length) return;

    // Alten Chart entfernen
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#030712" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
      height: 320,
    });

    chartRef.current = chart;

    // Candlestick-Serie
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles);

    // SMA-Linien
    const sma20Data = candles
      .map((c, i) => {
        const v = indicators?.series?.sma20?.[i - (candles.length - (indicators?.series?.sma20?.length || 0))];
        return v != null ? { time: c.time, value: v } : null;
      })
      .filter(Boolean);

    if (sma20Data.length) {
      const sma20 = chart.addLineSeries({ color: "#60a5fa", lineWidth: 1, title: "SMA20" });
      sma20.setData(sma20Data);
    }

    // Responsive
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    chart.timeScale().fitContent();

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, indicators]);

  return <div ref={containerRef} className="w-full rounded-xl overflow-hidden" />;
}
