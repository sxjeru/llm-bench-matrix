"use client";

import { useMemo } from "react";
import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import {
  SCATTER_DOT_RADIUS,
  SCATTER_LABEL_COLOR,
  SCATTER_LABEL_FONT_SIZE,
  SCATTER_LABEL_GAP
} from "./constants";
import { layoutScatterLabels } from "./label-layout";
import type { ScatterLabelCandidate, ScatterLabelMode, ScatterPoint } from "./types";

type ScatterLabelLayerProps = {
  points: readonly ScatterPoint[];
  mode: ScatterLabelMode;
  yHigherIsBetter: boolean;
  highlightedModel: string | null;
};

/**
 * 标签放置优先级。
 *
 * 钉住的模型必须有名字；其次是前沿点 —— 它们是这张图的结论；
 * 剩下的按 Y 轴表现从好到差争抢剩余空间。
 */
function computePriority(
  point: ScatterPoint,
  yRank: number,
  totalPoints: number,
  highlightedModel: string | null
): number {
  const highlightBonus = point.modelName === highlightedModel ? 1_000_000 : 0;
  const paretoBonus = point.isPareto ? 10_000 : 0;
  return highlightBonus + paretoBonus + (totalPoints - yRank);
}

export function ScatterLabelLayer({
  points,
  mode,
  yHigherIsBetter,
  highlightedModel
}: ScatterLabelLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();

  const candidates = useMemo<ScatterLabelCandidate[]>(() => {
    if (!xScale || !yScale || mode === "none") return [];

    const rankedModels = [...points]
      .sort((left, right) => (yHigherIsBetter ? right.y - left.y : left.y - right.y))
      .map((point) => point.modelName);
    const yRankByModel = new Map(rankedModels.map((modelName, index) => [modelName, index]));

    const result: ScatterLabelCandidate[] = [];

    points.forEach((point) => {
      const cx = xScale(point.x);
      const cy = yScale(point.y);
      if (typeof cx !== "number" || typeof cy !== "number" || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        return;
      }

      result.push({
        key: point.modelName,
        text: point.modelName,
        cx,
        cy,
        priority: computePriority(
          point,
          yRankByModel.get(point.modelName) ?? points.length,
          points.length,
          highlightedModel
        )
      });
    });

    return result;
  }, [points, xScale, yScale, mode, yHigherIsBetter, highlightedModel]);

  const placedLabels = useMemo(() => {
    if (!plotArea || candidates.length === 0) return [];

    return layoutScatterLabels(
      candidates,
      {
        left: plotArea.x,
        top: plotArea.y,
        right: plotArea.x + plotArea.width,
        bottom: plotArea.y + plotArea.height
      },
      {
        fontSize: SCATTER_LABEL_FONT_SIZE,
        dotRadius: SCATTER_DOT_RADIUS,
        gap: SCATTER_LABEL_GAP,
        mode
      }
    );
  }, [candidates, plotArea, mode]);

  if (placedLabels.length === 0) return null;

  return (
    <g className="scatter-label-layer" pointerEvents="none">
      {placedLabels.map((label) => (
        <text
          key={label.key}
          x={label.x}
          y={label.y}
          textAnchor={label.textAnchor}
          dominantBaseline="central"
          fontSize={SCATTER_LABEL_FONT_SIZE}
          fill={label.key === highlightedModel ? "#ffffff" : SCATTER_LABEL_COLOR}
          fontWeight={label.key === highlightedModel ? 700 : 500}
          // 深色底上给文字描一圈底色，压过网格线与散点边缘
          stroke="rgba(11, 16, 32, 0.85)"
          strokeWidth={2.5}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}
