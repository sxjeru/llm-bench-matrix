"use client";

import { formatScatterValue } from "./metrics";
import type { ScatterMetric, ScatterPoint } from "./types";

type TooltipPayloadEntry = {
  payload?: ScatterPoint;
};

type ScatterTooltipProps = {
  active?: boolean;
  payload?: readonly TooltipPayloadEntry[];
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  showPareto: boolean;
};

/**
 * 散点悬浮卡。
 *
 * Recharts 会把 `active` / `payload` 注入进来，`xMetric` / `yMetric`
 * 由外层显式传入，所以这里不需要再查一次指标表。
 */
export function ScatterTooltip({ active, payload, xMetric, yMetric, showPareto }: ScatterTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

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
          <dd>{formatScatterValue(yMetric, point.y)}</dd>
        </div>
        <div className="scatter-tooltip-row">
          <dt>{xMetric.label}</dt>
          <dd>{formatScatterValue(xMetric, point.x)}</dd>
        </div>
      </dl>

      {showPareto && point.isPareto ? (
        <div className="scatter-tooltip-badge">帕累托前沿</div>
      ) : null}
    </div>
  );
}
