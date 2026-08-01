"use client";

import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import { SCATTER_BEST_QUADRANT_FILL, SCATTER_GUIDE_LINE_COLOR } from "./constants";

type ScatterGuideLayerProps = {
  xMedian: number | null;
  yMedian: number | null;
  xHigherIsBetter: boolean;
  yHigherIsBetter: boolean;
};

/**
 * 中位数参考十字与最优象限。
 *
 * 十字把绘图区切成四象限，一眼能看出「比一半模型更好 / 更差」的分界；
 * 两根轴都落在更优一侧的那个象限铺一层浅绿，读图时不必再逐轴回忆方向。
 * 该层画在散点之前，只作底色，不遮挡任何数据。
 */
export function ScatterGuideLayer({
  xMedian,
  yMedian,
  xHigherIsBetter,
  yHigherIsBetter
}: ScatterGuideLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();

  if (!xScale || !yScale || !plotArea) return null;

  const xPixelRaw = xMedian === null ? undefined : xScale(xMedian);
  const yPixelRaw = yMedian === null ? undefined : yScale(yMedian);
  const xPixel = typeof xPixelRaw === "number" && Number.isFinite(xPixelRaw) ? xPixelRaw : null;
  const yPixel = typeof yPixelRaw === "number" && Number.isFinite(yPixelRaw) ? yPixelRaw : null;

  const plotLeft = plotArea.x;
  const plotRight = plotArea.x + plotArea.width;
  const plotTop = plotArea.y;
  const plotBottom = plotArea.y + plotArea.height;

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
    <g className="scatter-guide-layer" pointerEvents="none">
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
          x1={xPixel}
          y1={plotTop}
          x2={xPixel}
          y2={plotBottom}
          stroke={SCATTER_GUIDE_LINE_COLOR}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      ) : null}

      {yPixel !== null ? (
        <line
          x1={plotLeft}
          y1={yPixel}
          x2={plotRight}
          y2={yPixel}
          stroke={SCATTER_GUIDE_LINE_COLOR}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      ) : null}
    </g>
  );
}
