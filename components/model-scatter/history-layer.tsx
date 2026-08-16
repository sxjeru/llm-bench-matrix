"use client";

import { useId } from "react";
import {
  SCATTER_CURSOR_DASH,
  SCATTER_CURSOR_STROKE,
  SCATTER_CURSOR_WIDTH,
  SCATTER_HISTORY_DOT_RADIUS,
  SCATTER_LABEL_FONT_SIZE,
  SCATTER_LABEL_STROKE
} from "./constants";
import { formatScatterHistoryDate, formatScatterHistoryModeLabel } from "./history";
import {
  arrowHeadMarkerSize,
  buildArrowGeometry,
  SCATTER_ARROW_HEAD_PATH,
  SCATTER_ARROW_HEAD_REF_X,
  SCATTER_ARROW_HEAD_REF_Y,
  SCATTER_ARROW_HEAD_VIEWBOX,
  type ArrowObstacle
} from "./arrow-layer";
import { formatScatterValue } from "./metrics";
import { getPlacedLabelBox } from "./label-layout";
import { projectToPixel } from "./projection";
import type {
  ScatterAxisBounds,
  ScatterAxisScale,
  ScatterHistoricalPoint,
  ScatterMetric,
  ScatterPlacedLabel
} from "./types";

type ScatterHistoryTooltipProps = {
  point: ScatterHistoricalPoint;
  xMetric: Pick<ScatterMetric, "label" | "unit">;
  yMetric: Pick<ScatterMetric, "label" | "unit">;
  left: number;
  top: number;
  placement: "left" | "right";
};

export function ScatterHistoryTooltip({
  point,
  xMetric,
  yMetric,
  left,
  top,
  placement
}: ScatterHistoryTooltipProps) {
  const label = formatScatterHistoryModeLabel(point.mode);

  return (
    <div
      className="scatter-history-tooltip-anchor"
      style={{ left, top }}
      data-placement={placement}
    >
      <div className="scatter-tooltip scatter-history-tooltip" role="status">
        <div className="scatter-tooltip-head">
          <span
            className="scatter-tooltip-swatch"
            style={{ backgroundColor: point.color }}
            aria-hidden="true"
          />
          <span className="scatter-tooltip-model">{point.modelName}</span>
        </div>
        <div className="scatter-tooltip-provider">{point.providerName}</div>
        <div className="scatter-tooltip-badge">{label}</div>
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
        <div className="scatter-history-tooltip-date">
          X {formatScatterHistoryDate(point.xBenchTime)} · Y{" "}
          {formatScatterHistoryDate(point.yBenchTime)}
        </div>
      </div>
    </div>
  );
}

type ScatterHistoryLayerProps = {
  point: ScatterHistoricalPoint | null;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  plotArea: ScatterAxisBounds | null;
  placedLabels?: ReadonlyMap<string, ScatterPlacedLabel>;
  isHovered?: boolean;
  onHoverChange?: (isHovered: boolean) => void;
  preferredArrowSign?: 1 | -1;
  arrowCurvatureScale?: number;
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
  placedLabels,
  isHovered = false,
  onHoverChange,
  preferredArrowSign = 1,
  arrowCurvatureScale = 1,
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

  const label = formatScatterHistoryModeLabel(point.mode);
  const dateLabel = formatScatterHistoryDate(point.xBenchTime);
  const labelY = from.cy - SCATTER_HISTORY_DOT_RADIUS - 8;
  const dateY = from.cy + SCATTER_HISTORY_DOT_RADIUS + 12;
  const labelObstacles: ArrowObstacle[] = [
    ...(placedLabels
      ? [...placedLabels.values()].map((placedLabel) => getPlacedLabelBox(placedLabel, SCATTER_LABEL_FONT_SIZE))
      : []),
    getPlacedLabelBox({ text: label, x: from.cx, y: labelY, textAnchor: "middle" }, SCATTER_LABEL_FONT_SIZE),
    getPlacedLabelBox({ text: dateLabel, x: from.cx, y: dateY, textAnchor: "middle" }, 10)
  ];
  const geometry = buildArrowGeometry(
    { x: from.cx, y: from.cy },
    { x: to.cx, y: to.cy },
    labelObstacles,
    { forcedSign: preferredArrowSign, curvatureScale: arrowCurvatureScale }
  );
  const gradientId = `${idPrefix}-history-gradient`;
  const markerId = `${idPrefix}-history-marker`;
  const isBest = point.mode === "best";
  const strokeDasharray = isBest ? undefined : "4 3";

  return (
    <g
      className="scatter-history-layer"
      pointerEvents="none"
      opacity={opacity}
      data-model-name={point.modelName}
      data-history-mode={point.mode}
      data-curve-sign={geometry?.sign}
      data-head-size={geometry?.headSize}
      aria-label={`${point.modelName} 的${label}`}
    >
      {isHovered ? (
        <g className="scatter-history-cursor" pointerEvents="none">
          <line
            className="scatter-history-cursor-x"
            x1={from.cx}
            x2={from.cx}
            y1={plotArea.top}
            y2={plotArea.bottom}
            stroke={SCATTER_CURSOR_STROKE}
            strokeWidth={SCATTER_CURSOR_WIDTH}
            strokeDasharray={SCATTER_CURSOR_DASH}
          />
          <line
            className="scatter-history-cursor-y"
            x1={plotArea.left}
            x2={plotArea.right}
            y1={from.cy}
            y2={from.cy}
            stroke={SCATTER_CURSOR_STROKE}
            strokeWidth={SCATTER_CURSOR_WIDTH}
            strokeDasharray={SCATTER_CURSOR_DASH}
          />
        </g>
      ) : null}

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
              viewBox={SCATTER_ARROW_HEAD_VIEWBOX}
              refX={SCATTER_ARROW_HEAD_REF_X}
              refY={SCATTER_ARROW_HEAD_REF_Y}
              {...arrowHeadMarkerSize(geometry.headSize)}
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
              overflow="visible"
            >
              <path
                d={SCATTER_ARROW_HEAD_PATH}
                fill={point.color}
                stroke="rgba(11, 16, 32, 0.82)"
                strokeWidth={0.65}
                strokeLinejoin="round"
                paintOrder="stroke"
              />
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
        r={SCATTER_HISTORY_DOT_RADIUS - 2}
        fill="none"
        stroke="rgba(11, 16, 32, 0.78)"
        strokeWidth={1.25}
      />
      <text
        className="scatter-history-label"
        x={from.cx}
        y={labelY}
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
        y={dateY}
        textAnchor="middle"
        dominantBaseline="hanging"
        fontSize={10}
        fill="rgba(169, 179, 201, 0.92)"
      >
        {dateLabel}
      </text>

      <circle
        className="scatter-history-hit-target"
        cx={from.cx}
        cy={from.cy}
        r={SCATTER_HISTORY_DOT_RADIUS + 6}
        fill="transparent"
        pointerEvents="all"
        tabIndex={0}
        role="img"
        aria-label={`${point.modelName} ${label}，${dateLabel}`}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
      />

    </g>
  );
}
