"use client";

import { useId } from "react";
import { getPlacedLabelBox } from "./label-layout";
import { SCATTER_LABEL_FONT_SIZE } from "./constants";
import type { ScatterAxisBounds, ScatterAxisScale, ScatterPoint } from "./types";
import type { ScatterPlacedLabel } from "./types";
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
  placedLabels?: ReadonlyMap<string, ScatterPlacedLabel>;
};

type ArrowGeometry = {
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  sign: 1 | -1;
  headSize: number;
  distance: number;
};

type ArrowGeometryOptions = {
  preferredSign?: 1 | -1;
  forcedSign?: 1 | -1;
  curvatureScale?: number;
};

export type ArrowObstacle = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const SCATTER_ARROW_HEAD_PATH = "M 0.6 0.8 L 13 5 L 0.6 9.2 L 4 5 Z";
export const SCATTER_ARROW_HEAD_VIEWBOX = "0 0 13 10";
export const SCATTER_ARROW_HEAD_REF_X = 12.4;
export const SCATTER_ARROW_HEAD_REF_Y = 5;
export const SCATTER_ARROW_HEAD_ASPECT = 10 / 13;

/** 短路径或穿过文字时缩小箭头，避免末端盖住点与标签。 */
export function resolveArrowHeadSize(distance: number, overlapHits = 0): number {
  if (!Number.isFinite(distance) || distance <= 0) return 15;
  const lengthProgress = Math.min(1, Math.max(0, (distance - 28) / 172));
  const lengthSize = 15 + 7 * Math.sqrt(lengthProgress);
  const overlapScale = overlapHits <= 0 ? 1 : Math.max(0.82, 1 - overlapHits * 0.025);
  return Number(Math.max(14, lengthSize * overlapScale).toFixed(2));
}

export function arrowHeadMarkerSize(headSize: number) {
  return {
    markerWidth: headSize,
    markerHeight: Number((headSize * SCATTER_ARROW_HEAD_ASPECT).toFixed(2))
  };
}

type ArrowPoint = { x: number; y: number };

function quadraticPoint(start: ArrowPoint, control: ArrowPoint, end: ArrowPoint, t: number): ArrowPoint {
  const rest = 1 - t;
  return {
    x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
    y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y
  };
}

function scoreArrowObstacles(
  start: ArrowPoint,
  control: ArrowPoint,
  end: ArrowPoint,
  obstacles: readonly ArrowObstacle[]
): number {
  if (obstacles.length === 0) return 0;

  const padding = 4;
  let hits = 0;
  for (let step = 1; step <= 12; step += 1) {
    const point = quadraticPoint(start, control, end, step / 13);
    const blocked = obstacles.some(
      (box) =>
        point.x >= box.left - padding &&
        point.x <= box.right + padding &&
        point.y >= box.top - padding &&
        point.y <= box.bottom + padding
    );
    if (blocked) hits += 1;
  }
  return hits;
}

export function buildArrowGeometry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacles: readonly ArrowObstacle[] = [],
  options: ArrowGeometryOptions = {}
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
  const curvatureScale = Math.max(0.35, options.curvatureScale ?? 1);
  const baseCurvature = Math.min(96, Math.max(12, distance * 0.24 * curvatureScale));
  const approachSlope = 0.72;
  const approachLength = Math.hypot(1, approachSlope);
  const preferredSign = options.forcedSign ?? options.preferredSign ?? 1;
  const oppositeSign: 1 | -1 = preferredSign === 1 ? -1 : 1;
  const signs: readonly (1 | -1)[] = options.forcedSign
    ? [options.forcedSign]
    : [preferredSign, oppositeSign];

  let best: { geometry: ArrowGeometry; score: number; preference: number } | null = null;
  let preference = 0;
  for (const sign of signs) {
    const approachX = (-unitX - unitY * approachSlope * sign) / approachLength;
    const approachY = (-unitY + unitX * approachSlope * sign) / approachLength;
    const pathEnd = {
      x: end.x + approachX * endOffset,
      y: end.y + approachY * endOffset
    };

    for (const factor of [1, 0.65, 1.4, 0.35]) {
      const curvature = baseCurvature * factor;
      const control = {
        x: (pathStart.x + pathEnd.x) / 2 - unitY * curvature * sign,
        y: (pathStart.y + pathEnd.y) / 2 + unitX * curvature * sign
      };
      const score = scoreArrowObstacles(pathStart, control, pathEnd, obstacles);
      const geometry = {
        path: `M ${pathStart.x} ${pathStart.y} Q ${control.x} ${control.y} ${pathEnd.x} ${pathEnd.y}`,
        start: pathStart,
        end: pathEnd,
        sign,
        headSize: resolveArrowHeadSize(distance, score),
        distance
      };
      if (!best || score < best.score || (score === best.score && preference < best.preference)) {
        best = { geometry, score, preference };
      }
      preference += 1;
    }
  }

  return best?.geometry ?? null;
}

/** 用与标签相同的投影算法画弧形箭头，避免依赖图表内部 scale 回传。 */
export function ScatterArrowLayer({
  annotations,
  points,
  xDomain,
  yDomain,
  xScale,
  yScale,
  plotArea,
  placedLabels
}: ScatterArrowLayerProps) {
  const idPrefix = useId().replaceAll(":", "");

  if (!plotArea || annotations.length === 0) return null;

  const labelObstacles: ArrowObstacle[] = placedLabels
    ? [...placedLabels.values()].map((label) => getPlacedLabelBox(label, SCATTER_LABEL_FONT_SIZE))
    : [];

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
      {annotations.map((annotation, annotationIndex) => {
        const from = points.find((point) => point.modelName === annotation.fromModelName);
        const to = points.find((point) => point.modelName === annotation.toModelName);
        const fromPixel = projections.get(annotation.fromModelName);
        const toPixel = projections.get(annotation.toModelName);
        if (!from || !to || !fromPixel || !toPixel) return null;

        const geometry = buildArrowGeometry(
          { x: fromPixel.cx, y: fromPixel.cy },
          { x: toPixel.cx, y: toPixel.cy },
          labelObstacles,
          {
            forcedSign: annotationIndex % 2 === 0 ? 1 : -1,
            curvatureScale: 1 + Math.floor(annotationIndex / 2) * 0.35
          }
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
            data-curve-sign={geometry.sign}
            data-head-size={geometry.headSize}
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
                  fill={to.color}
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
