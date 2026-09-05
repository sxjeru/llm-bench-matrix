"use client";

import { useXAxisScale, useYAxisScale } from "recharts";
import type { ScatterOverlaySnapshotPoint, ScatterSnapshotOverlayDataset } from "./types";

export const SCATTER_OVERLAY_PARETO_LINE_COLOR = "#f59e0b";
export const SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK = "#fbbf24";

type ScatterSnapshotOverlayLayerProps = {
  overlay: ScatterSnapshotOverlayDataset | null;
  hoveredModelName?: string | null;
  onHoverPoint?: (
    point: ScatterOverlaySnapshotPoint | null,
    coords?: { x: number; y: number }
  ) => void;
};

/**
 * 历史快照半透明背景叠加图层。
 *
 * 绘制内容：
 * 1. 历史帕累托折线（琥珀橙色虚线）；
 * 2. 所有历史模型点渲染为叉号（✕，半透明）；
 * 3. 处于历史帕累托前沿的叉号带有光圈，并标注模型名称文本标签。
 */
export function ScatterSnapshotOverlayLayer({
  overlay,
  hoveredModelName,
  onHoverPoint
}: ScatterSnapshotOverlayLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();

  if (!overlay || !xScale || !yScale || overlay.points.length === 0) {
    return null;
  }

  const r = 4.5; // 叉号臂长半径

  // 1. 历史帕累托折线坐标
  const paretoPolylinePoints = overlay.paretoPath
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
    <g className="scatter-snapshot-overlay-layer">
      {/* 历史帕累托虚线 */}
      {paretoPolylinePoints ? (
        <polyline
          points={paretoPolylinePoints}
          fill="none"
          stroke={SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK}
          strokeWidth={1.8}
          strokeDasharray="4 3"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.75}
          pointerEvents="none"
        />
      ) : null}

      {/* 历史点（叉号 ✕）与历史帕累托标签 */}
      {overlay.points.map((point) => {
        const cx = xScale(point.x);
        const cy = yScale(point.y);
        if (typeof cx !== "number" || typeof cy !== "number" || !Number.isFinite(cx) || !Number.isFinite(cy)) {
          return null;
        }

        const isHovered = point.modelName === hoveredModelName;
        const isPareto = point.isPareto;
        const opacity = isHovered ? 1 : 0.55;

        // 叉号 path 坐标
        const crossPath = `M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}`;

        return (
          <g key={`overlay-${point.modelName}`} className="scatter-overlay-cross-group" opacity={opacity}>
            {/* 前沿点琥珀光圈 */}
            {isPareto ? (
              <circle
                cx={cx}
                cy={cy}
                r={r + 3.5}
                fill="none"
                stroke={SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK}
                strokeWidth={1.25}
                opacity={0.65}
                pointerEvents="none"
              />
            ) : null}

            {/* 叉号 */}
            <path
              d={crossPath}
              fill="none"
              stroke={isPareto ? SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK : point.color}
              strokeWidth={isPareto ? 2.4 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />

            {/* 历史帕累托前沿上的叉标签 */}
            {isPareto ? (
              <text
                x={cx}
                y={cy + 13}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10.5}
                fontWeight={600}
                fill={SCATTER_OVERLAY_PARETO_LINE_COLOR_DARK}
                stroke="rgba(11, 16, 32, 0.9)"
                strokeWidth={2.5}
                paintOrder="stroke"
                strokeLinejoin="round"
                pointerEvents="none"
              >
                {point.modelName}
              </text>
            ) : null}

            {/* 隐形命中检测区域 */}
            <circle
              cx={cx}
              cy={cy}
              r={r + 6}
              fill="transparent"
              cursor="pointer"
              pointerEvents="all"
              onMouseEnter={() => {
                onHoverPoint?.(point, { x: cx, y: cy });
              }}
              onMouseLeave={() => {
                onHoverPoint?.(null);
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

