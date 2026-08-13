"use client";

import { useId } from "react";
import type { ScatterAxisBounds, ScatterAxisScale, ScatterPoint } from "./types";
import { buildPointProjections } from "./projection";

const SCATTER_ARROW_COLOR = "#f4f7ff";

export type ScatterArrowAnnotation = {
  id: number;
  fromModelName: string;
  toModelName: string;
};

type ScatterArrowLayerProps = {
  annotations: readonly ScatterArrowAnnotation[];
  points: readonly ScatterPoint[];
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  plotArea: ScatterAxisBounds | null;
};

type ArrowGeometry = {
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

function buildArrowGeometry(
  start: { x: number; y: number },
  end: { x: number; y: number }
): ArrowGeometry | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1) return null;

  const unitX = dx / distance;
  const unitY = dy / distance;
  const startOffset = Math.min(9, distance * 0.18);
  const endOffset = Math.min(14, distance * 0.25);
  const pathStart = {
    x: start.x + unitX * startOffset,
    y: start.y + unitY * startOffset
  };
  const pathEnd = {
    x: end.x - unitX * endOffset,
    y: end.y - unitY * endOffset
  };
  const curvature = Math.min(72, Math.max(12, distance * 0.24));
  const controlX = (pathStart.x + pathEnd.x) / 2 - unitY * curvature;
  const controlY = (pathStart.y + pathEnd.y) / 2 + unitX * curvature;

  return {
    path: `M ${pathStart.x} ${pathStart.y} Q ${controlX} ${controlY} ${pathEnd.x} ${pathEnd.y}`,
    start: pathStart,
    end: pathEnd
  };
}

/** 用与标签相同的投影算法画弧形箭头，避免依赖图表内部 scale 回传。 */
export function ScatterArrowLayer({
  annotations,
  points,
  xDomain,
  yDomain,
  xScale,
  yScale,
  plotArea
}: ScatterArrowLayerProps) {
  const idPrefix = useId().replaceAll(":", "");

  if (!plotArea || annotations.length === 0) return null;

  const projections = buildPointProjections({
    points,
    xDomain,
    yDomain,
    xScale,
    yScale,
    plotArea
  });

  return (
    <g className="scatter-arrow-layer" pointerEvents="none">
      {annotations.map((annotation) => {
        const from = points.find((point) => point.modelName === annotation.fromModelName);
        const to = points.find((point) => point.modelName === annotation.toModelName);
        const fromPixel = projections.get(annotation.fromModelName);
        const toPixel = projections.get(annotation.toModelName);
        if (!from || !to || !fromPixel || !toPixel) return null;

        const geometry = buildArrowGeometry(
          { x: fromPixel.cx, y: fromPixel.cy },
          { x: toPixel.cx, y: toPixel.cy }
        );
        if (!geometry) return null;

        const gradientId = `${idPrefix}-gradient-${annotation.id}`;
        const markerId = `${idPrefix}-marker-${annotation.id}`;

        return (
          <g
            key={annotation.id}
            className="scatter-arrow-annotation"
            data-from-model={from.modelName}
            data-to-model={to.modelName}
            aria-label={`${from.modelName} 到 ${to.modelName} 的标注箭头`}
          >
            <defs>
              <linearGradient
                id={gradientId}
                x1={geometry.start.x}
                y1={geometry.start.y}
                x2={geometry.end.x}
                y2={geometry.end.y}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor={from.color} />
                <stop offset="0.55" stopColor={SCATTER_ARROW_COLOR} />
                <stop offset="1" stopColor={to.color} />
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
                <path d="M 0 0 L 10 5 L 0 10 L 2.5 5 Z" fill={to.color} />
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
              className="scatter-arrow-path"
              d={geometry.path}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={2.4}
              strokeLinecap="round"
              pathLength={1}
              markerEnd={`url(#${markerId})`}
            />
          </g>
        );
      })}
    </g>
  );
}
