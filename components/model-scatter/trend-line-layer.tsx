"use client";

import { useXAxisScale, useYAxisScale } from "recharts";
import { SCATTER_TREND_LINE_COLOR } from "./constants";
import type { ScatterAxisScale, ScatterTrendLine } from "./types";

type ScatterTrendLineLayerProps = {
  line: ScatterTrendLine | null;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xScaleType: ScatterAxisScale;
  yScaleType: ScatterAxisScale;
};

/** 回归在显示坐标中是直线，取它与可视值域相交的线段。 */
export function ScatterTrendLineLayer({
  line,
  xDomain,
  yDomain,
  xScaleType,
  yScaleType
}: ScatterTrendLineLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!line || !xScale || !yScale) return null;

  let [startX, endX] = xScaleType === "log" ? xDomain.map(Math.log10) : xDomain;
  const [minY, maxY] = yScaleType === "log" ? yDomain.map(Math.log10) : yDomain;
  const { slope, intercept } = line;

  if (slope === 0) {
    if (intercept < minY || intercept > maxY) return null;
  } else {
    const xAtMinY = (minY - intercept) / slope;
    const xAtMaxY = (maxY - intercept) / slope;
    startX = Math.max(startX, Math.min(xAtMinY, xAtMaxY));
    endX = Math.min(endX, Math.max(xAtMinY, xAtMaxY));
    if (startX >= endX) return null;
  }

  const projectX = (value: number) => xScale(xScaleType === "log" ? 10 ** value : value);
  const projectY = (x: number) => {
    const value = Math.max(minY, Math.min(maxY, slope * x + intercept));
    return yScale(yScaleType === "log" ? 10 ** value : value);
  };

  const x1 = projectX(startX);
  const x2 = projectX(endX);
  const y1 = projectY(startX);
  const y2 = projectY(endX);

  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

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
