"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import {
  SCATTER_DOT_RADIUS,
  SCATTER_LABEL_FONT_SIZE,
  SCATTER_LABEL_GAP
} from "./constants";
import { layoutScatterLabels } from "./label-layout";
import type {
  ScatterAxisBounds,
  ScatterLabelCandidate,
  ScatterLabelMode,
  ScatterPlacedLabel,
  ScatterPoint
} from "./types";

export type ScatterOverlayResolution = {
  plotArea: ScatterAxisBounds | null;
  labels: ScatterPlacedLabel[];
};

type ScatterOverlayProbeProps = {
  points: readonly ScatterPoint[];
  mode: ScatterLabelMode;
  yHigherIsBetter: boolean;
  highlightedModel: string | null;
  onResolve: (resolution: ScatterOverlayResolution) => void;
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

function signLabels(plotArea: ScatterAxisBounds | null, labels: readonly ScatterPlacedLabel[]): string {
  const areaKey = plotArea
    ? `${plotArea.left.toFixed(1)},${plotArea.top.toFixed(1)},${plotArea.right.toFixed(1)},${plotArea.bottom.toFixed(1)}`
    : "none";

  return `${areaKey}#${labels
    .map((label) => `${label.key}:${label.x.toFixed(1)}:${label.y.toFixed(1)}:${label.textAnchor}`)
    .join("|")}`;
}

/**
 * 绘图区与标签布局的探针。
 *
 * 比例尺与绘图区只有图表内部才拿得到，但标签要渲染进 `<Scatter>` 的自定义
 * shape 里（这样鼠标移到文字上也能触发 Recharts 的浮窗与十字光标），滚轮缩放
 * 又需要在图表外侧换算像素到数值。所以这个组件自己不画东西，只把算好的结果
 * 回传给上层。带签名去重，避免回传 → 重渲染 → 再回传的循环。
 */
export function ScatterOverlayProbe({
  points,
  mode,
  yHigherIsBetter,
  highlightedModel,
  onResolve
}: ScatterOverlayProbeProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();
  const lastSignatureRef = useRef<string | null>(null);

  const bounds = useMemo<ScatterAxisBounds | null>(() => {
    if (!plotArea) return null;
    return {
      left: plotArea.x,
      top: plotArea.y,
      right: plotArea.x + plotArea.width,
      bottom: plotArea.y + plotArea.height
    };
  }, [plotArea]);

  const labels = useMemo<ScatterPlacedLabel[]>(() => {
    if (!xScale || !yScale || !bounds || mode === "none") return [];

    const rankedModels = [...points]
      .sort((left, right) => (yHigherIsBetter ? right.y - left.y : left.y - right.y))
      .map((point) => point.modelName);
    const yRankByModel = new Map(rankedModels.map((modelName, index) => [modelName, index]));

    const candidates: ScatterLabelCandidate[] = [];

    points.forEach((point) => {
      const cx = xScale(point.x);
      const cy = yScale(point.y);
      if (typeof cx !== "number" || typeof cy !== "number" || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        return;
      }

      candidates.push({
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

    return layoutScatterLabels(candidates, bounds, {
      fontSize: SCATTER_LABEL_FONT_SIZE,
      dotRadius: SCATTER_DOT_RADIUS,
      gap: SCATTER_LABEL_GAP,
      mode
    });
  }, [points, xScale, yScale, bounds, mode, yHigherIsBetter, highlightedModel]);

  useEffect(() => {
    const signature = signLabels(bounds, labels);
    if (lastSignatureRef.current === signature) return;

    lastSignatureRef.current = signature;
    onResolve({ plotArea: bounds, labels });
  }, [bounds, labels, onResolve]);

  return null;
}
