"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ChartSize = {
  width: number;
  height: number;
};

/**
 * 图表宽度测量宿主。
 *
 * 与 `components/charts.tsx` 的 ChartPanel 同一套路：用 ResizeObserver 量出
 * 实际宽度后再把显式尺寸交给 Recharts。测量与绘制分离，`ScatterCanvas`
 * 因此可以在测试里直接被喂固定宽高，不必 mock ResizeObserver。
 */
export function ScatterChartHost({
  height,
  children
}: {
  height: number;
  children: (size: ChartSize) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const measure = () => {
      const nextWidth = Math.floor(node.getBoundingClientRect().width);
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="scatter-chart-host" style={{ width: "100%", height, minWidth: 0 }}>
      {width > 0 ? (
        children({ width, height })
      ) : (
        <div className="scatter-chart-placeholder">图表正在稳定布局…</div>
      )}
    </div>
  );
}
