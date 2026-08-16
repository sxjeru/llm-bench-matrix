"use client";

import { useId } from "react";
import { SCATTER_HISTORY_DOT_RADIUS, SCATTER_LABEL_FONT_SIZE, SCATTER_LABEL_STROKE } from "./constants";
import { formatScatterHistoryDate, formatScatterHistoryModeLabel } from "./history";
import { buildArrowGeometry } from "./arrow-layer";
import { projectToPixel } from "./projection";
import type { ScatterAxisBounds, ScatterAxisScale, ScatterHistoricalPoint } from "./types";

type ScatterHistoryLayerProps = {
  point: ScatterHistoricalPoint | null;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  plotArea: ScatterAxisBounds | null;
  opacity?: number;
};

function projectHistoryPoint(
  point: { x: number; y: number },
  xDomain: readonly [number, number],
  yDomain: readonly [number, number],
  xScale: ScatterAxisScale,
  yScale: ScatterAxisScale,
  plotArea: ScatterAxisBounds
): { cx: number; cy: number } | null {
  const cx = projectToPixel(point.x, xDomain, xScale, plotArea.left, plotArea.right);
  const cy = projectToPixel(point.y, yDomain, yScale, plotArea.bottom, plotArea.top);
  if (cx === null || cy === null) return null;
  return { cx, cy };
}

/** 空心历史点 + 指向当前点的弧形箭头；不参与帕累托或标签排版。 */
export function ScatterHistoryLayer({
  point,
  xDomain,
  yDomain,
  xScale,
  yScale,
  plotArea,
  opacity = 1
}: ScatterHistoryLayerProps) {
  const idPrefix = useId().replaceAll(":", "");
  if (!point || !plotArea) return null;

  const from = projectHistoryPoint(point, xDomain, yDomain, xScale, yScale, plotArea);
  const to = projectHistoryPoint(
    { x: point.currentX, y: point.currentY },
    xDomain,
    yDomain,
    xScale,
    yScale,
    plotArea
  );
  if (!from || !to) return null;

  const isInsidePlot = (projected: { cx: number; cy: number }) =>
    projected.cx >= plotArea.left &&
    projected.cx <= plotArea.right &&
    projected.cy >= plotArea.top &&
    projected.cy <= plotArea.bottom;
  if (!isInsidePlot(from) || !isInsidePlot(to)) return null;

  const geometry = buildArrowGeometry(
    { x: from.cx, y: from.cy },
    { x: to.cx, y: to.cy }
  );
  const gradientId = `${idPrefix}-history-gradient`;
  const markerId = `${idPrefix}-history-marker`;
  const isBest = point.mode === "best";
  const strokeDasharray = isBest ? undefined : "4 3";
  const label = formatScatterHistoryModeLabel(point.mode);
  const dateLabel = formatScatterHistoryDate(point.xBenchTime);

  return (
    <g
      className="scatter-history-layer"
      pointerEvents="none"
      opacity={opacity}
      data-model-name={point.modelName}
      data-history-mode={point.mode}
      aria-label={`${point.modelName} 的${label}`}
    >
      {geometry ? (
        <g className="scatter-history-arrow">
          <defs>
            <linearGradient
              id={gradientId}
              x1={geometry.start.x}
              y1={geometry.start.y}
              x2={geometry.end.x}
              y2={geometry.end.y}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor={point.color} stopOpacity={isBest ? 0.95 : 0.7} />
              <stop offset="1" stopColor={point.color} />
            </linearGradient>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 L 2.5 5 Z" fill={point.color} />
            </marker>
          </defs>
          <path
            className="scatter-arrow-backdrop"
            d={geometry.path}
            fill="none"
            stroke="rgba(11, 16, 32, 0.72)"
            strokeWidth={6}
            strokeLinecap="round"
            opacity={0.75}
          />
          <path
            className="scatter-arrow-path scatter-history-arrow-path"
            d={geometry.path}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2.4}
            strokeLinecap="round"
            pathLength={1}
            markerEnd={`url(#${markerId})`}
          />
        </g>
      ) : null}

      <circle
        className="scatter-history-halo"
        cx={from.cx}
        cy={from.cy}
        r={SCATTER_HISTORY_DOT_RADIUS + 4}
        fill={point.color}
        opacity={0.12}
      />
      <circle
        className="scatter-history-ring-outer"
        cx={from.cx}
        cy={from.cy}
        r={SCATTER_HISTORY_DOT_RADIUS}
        fill="none"
        stroke={point.color}
        strokeWidth={2.2}
        strokeDasharray={strokeDasharray}
      />
      <circle
        className="scatter-history-ring-inner"
        cx={from.cx}
        cy={from.cy}
        r={SCATTER_HISTORY_DOT_RADIUS - 3}
        fill="none"
        stroke="rgba(11, 16, 32, 0.78)"
        strokeWidth={1.25}
      />
      <text
        className="scatter-history-label"
        x={from.cx}
        y={from.cy - SCATTER_HISTORY_DOT_RADIUS - 8}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize={SCATTER_LABEL_FONT_SIZE}
        fill={point.color}
        fontWeight={700}
        stroke={SCATTER_LABEL_STROKE}
        strokeWidth={2.25}
        paintOrder="stroke"
        strokeLinejoin="round"
      >
        {label}
      </text>
      <text
        className="scatter-history-date"
        x={from.cx}
        y={from.cy + SCATTER_HISTORY_DOT_RADIUS + 12}
        textAnchor="middle"
        dominantBaseline="hanging"
        fontSize={10}
        fill="rgba(169, 179, 201, 0.92)"
      >
        {dateLabel}
      </text>
    </g>
  );
}
