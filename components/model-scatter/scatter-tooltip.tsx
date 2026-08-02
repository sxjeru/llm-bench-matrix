"use client";

import { useMemo } from "react";
import { formatScatterValue } from "./metrics";
import { getScatterRankColor } from "./rank-color";
import type { ScatterAxisScale, ScatterMetric, ScatterPoint } from "./types";

type TooltipPayloadEntry = {
  payload?: ScatterPoint;
};

type ScatterTooltipProps = {
  active?: boolean;
  payload?: readonly TooltipPayloadEntry[];
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  showPareto: boolean;
  /** 当前图上全部有值点，用作排名边界 */
  points: readonly ScatterPoint[];
};

/**
 * 散点悬浮卡。
 *
 * Recharts 会把 `active` / `payload` 注入进来，`xMetric` / `yMetric`
 * 由外层显式传入，所以这里不需要再查一次指标表。
 * X/Y 数值按内置红黄绿排名上色；对数轴在 log 空间取色。
 */
export function ScatterTooltip({
  active,
  payload,
  xMetric,
  yMetric,
  xScale,
  yScale,
  showPareto,
  points
}: ScatterTooltipProps) {
  const xValues = useMemo(() => points.map((item) => item.x), [points]);
  const yValues = useMemo(() => points.map((item) => item.y), [points]);

  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  const xColor = getScatterRankColor(point.x, xValues, xMetric.higherIsBetter, xScale);
  const yColor = getScatterRankColor(point.y, yValues, yMetric.higherIsBetter, yScale);

  return (
    <div className="scatter-tooltip">
      <div className="scatter-tooltip-head">
        <span className="scatter-tooltip-swatch" style={{ backgroundColor: point.color }} aria-hidden="true" />
        <span className="scatter-tooltip-model">{point.modelName}</span>
      </div>
      <div className="scatter-tooltip-provider">{point.providerName}</div>

      <dl className="scatter-tooltip-rows">
        <div className="scatter-tooltip-row">
          <dt>{yMetric.label}</dt>
          <dd style={yColor ? { color: yColor } : undefined}>{formatScatterValue(yMetric, point.y)}</dd>
        </div>
        <div className="scatter-tooltip-row">
          <dt>{xMetric.label}</dt>
          <dd style={xColor ? { color: xColor } : undefined}>{formatScatterValue(xMetric, point.x)}</dd>
        </div>
      </dl>

      {showPareto && point.isPareto ? (
        <div className="scatter-tooltip-badge">帕累托前沿</div>
      ) : null}
    </div>
  );
}
