"use client";

import { useXAxisScale, useYAxisScale } from "recharts";
import {
  SCATTER_DOT_RADIUS_PARETO,
  SCATTER_PARETO_LINE_COLOR
} from "./constants";
import { buildParetoStepPoints } from "./pareto";
import type { ScatterParetoLineStyle, ScatterPoint } from "./types";

type ScatterParetoLayerProps = {
  /** 已按支配序排好的前沿点 */
  path: readonly ScatterPoint[];
  lineStyle: ScatterParetoLineStyle;
};

/**
 * 帕累托前沿层。
 *
 * 折线画出「不被任何模型全面压制」的边界；阶梯模式额外还原被支配区域的
 * 真实轮廓（拐点由 buildParetoStepPoints 给出）。前沿点再套一圈光晕，
 * 即使不看线也能认出来。
 */
export function ScatterParetoLayer({ path, lineStyle }: ScatterParetoLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!xScale || !yScale || path.length === 0) return null;

  const dataPoints = lineStyle === "step" ? buildParetoStepPoints(path) : path;

  const polylinePoints = dataPoints
    .map((point) => {
      const x = xScale(point.x);
      const y = yScale(point.y);
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return `${x},${y}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  return (
    <g className="scatter-pareto-layer" pointerEvents="none">
      {polylinePoints ? (
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={SCATTER_PARETO_LINE_COLOR}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.85}
        />
      ) : null}

      {path.map((point) => {
        const x = xScale(point.x);
        const y = yScale(point.y);
        if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }

        return (
          <circle
            key={point.modelName}
            cx={x}
            cy={y}
            r={SCATTER_DOT_RADIUS_PARETO + 3}
            fill="none"
            stroke={SCATTER_PARETO_LINE_COLOR}
            strokeWidth={1.25}
            opacity={0.5}
          />
        );
      })}
    </g>
  );
}
