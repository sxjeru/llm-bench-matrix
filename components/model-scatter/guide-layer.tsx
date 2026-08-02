"use client";

import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import {
  SCATTER_BEST_QUADRANT_FILL,
  SCATTER_CURSOR_DASH,
  SCATTER_CURSOR_STROKE,
  SCATTER_CURSOR_WIDTH,
  SCATTER_GUIDE_LINE_COLOR
} from "./constants";

export type ScatterGuideEmphasis = "median" | "pinned";

type ScatterGuideLayerProps = {
  /** 十字与象限的中心 X 值；null 表示该轴不画参考线 */
  xCenter: number | null;
  /** 十字与象限的中心 Y 值；null 表示该轴不画参考线 */
  yCenter: number | null;
  xHigherIsBetter: boolean;
  yHigherIsBetter: boolean;
  /**
   * 中位参考线用淡虚线；钉住点用更亮的十字（与悬浮定位十字同档），
   * 表示「这是点选留下的固定参考」而不是全局中位。
   */
  emphasis?: ScatterGuideEmphasis;
};

/**
 * 参考十字与最优象限。
 *
 * 十字把绘图区切成四象限；两根轴都落在更优一侧的那个象限铺一层浅绿。
 * 中心可以是全体中位数，也可以是被钉住的模型坐标。
 * 该层画在散点之前，只作底色，不遮挡任何数据。
 */
export function ScatterGuideLayer({
  xCenter,
  yCenter,
  xHigherIsBetter,
  yHigherIsBetter,
  emphasis = "median"
}: ScatterGuideLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();

  if (!xScale || !yScale || !plotArea) return null;

  const xPixelRaw = xCenter === null ? undefined : xScale(xCenter);
  const yPixelRaw = yCenter === null ? undefined : yScale(yCenter);
  const xPixel = typeof xPixelRaw === "number" && Number.isFinite(xPixelRaw) ? xPixelRaw : null;
  const yPixel = typeof yPixelRaw === "number" && Number.isFinite(yPixelRaw) ? yPixelRaw : null;

  const plotLeft = plotArea.x;
  const plotRight = plotArea.x + plotArea.width;
  const plotTop = plotArea.y;
  const plotBottom = plotArea.y + plotArea.height;

  const isPinned = emphasis === "pinned";
  const stroke = isPinned ? SCATTER_CURSOR_STROKE : SCATTER_GUIDE_LINE_COLOR;
  const strokeWidth = isPinned ? SCATTER_CURSOR_WIDTH : 1;
  const strokeDasharray = isPinned ? SCATTER_CURSOR_DASH : "5 5";

  // 最优象限：X 更优的一侧 × Y 更优的一侧。像素 y 向下增长，所以「更大更好」对应更小的 y
  const bestQuadrant = (() => {
    if (xPixel === null || yPixel === null) return null;

    const left = xHigherIsBetter ? xPixel : plotLeft;
    const right = xHigherIsBetter ? plotRight : xPixel;
    const top = yHigherIsBetter ? plotTop : yPixel;
    const bottom = yHigherIsBetter ? yPixel : plotBottom;

    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  })();

  return (
    <g
      className={`scatter-guide-layer${isPinned ? " is-pinned" : ""}`}
      pointerEvents="none"
      data-emphasis={emphasis}
    >
      {bestQuadrant ? (
        <rect
          className="scatter-best-quadrant"
          x={bestQuadrant.x}
          y={bestQuadrant.y}
          width={bestQuadrant.width}
          height={bestQuadrant.height}
          fill={SCATTER_BEST_QUADRANT_FILL}
        />
      ) : null}

      {xPixel !== null ? (
        <line
          className="scatter-guide-line scatter-guide-line-x"
          x1={xPixel}
          y1={plotTop}
          x2={xPixel}
          y2={plotBottom}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      ) : null}

      {yPixel !== null ? (
        <line
          className="scatter-guide-line scatter-guide-line-y"
          x1={plotLeft}
          y1={yPixel}
          x2={plotRight}
          y2={yPixel}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      ) : null}
    </g>
  );
}

/**
 * 相对某个中心点，判断另一点是否落在「两轴都更差」的最差象限。
 * 边界上（任一轴相等）不算最差象限。
 */
export function isInWorstQuadrant(
  point: { x: number; y: number },
  center: { x: number; y: number },
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean
): boolean {
  const worseOnX = xHigherIsBetter ? point.x < center.x : point.x > center.x;
  const worseOnY = yHigherIsBetter ? point.y < center.y : point.y > center.y;
  return worseOnX && worseOnY;
}
