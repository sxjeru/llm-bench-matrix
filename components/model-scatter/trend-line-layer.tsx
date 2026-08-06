"use client";

import { useXAxisScale, useYAxisScale } from "recharts";
import { SCATTER_TREND_LINE_COLOR } from "./constants";
import type { ScatterTrendLine } from "./types";

type ScatterTrendLineLayerProps = {
  line: ScatterTrendLine | null;
  xDomain: readonly [number, number];
};

/** 在当前可视 X 值域内绘制回归线，缩放和平移后仍覆盖整个绘图区。 */
export function ScatterTrendLineLayer({ line, xDomain }: ScatterTrendLineLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!line || !xScale || !yScale) return null;

  const [startX, endX] = xDomain;
  const startY = line.slope * startX + line.intercept;
  const endY = line.slope * endX + line.intercept;
  const x1 = xScale(startX);
  const y1 = yScale(startY);
  const x2 = xScale(endX);
  const y2 = yScale(endY);

  if (![x1, y1, x2, y2].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }

  return (
    <g className="scatter-trend-line-layer" pointerEvents="none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={SCATTER_TREND_LINE_COLOR}
        strokeWidth={1.75}
        strokeDasharray="6 4"
        strokeLinecap="round"
        opacity={0.9}
      />
    </g>
  );
}