"use client";

import { usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import { SCATTER_GUIDE_LINE_COLOR } from "./constants";

type ScatterGuideLayerProps = {
  xMedian: number | null;
  yMedian: number | null;
};

/**
 * 中位数参考十字。
 *
 * 把绘图区切成四象限，一眼能看出「比一半模型更好 / 更差」的分界，
 * 比逐个读坐标快得多。
 */
export function ScatterGuideLayer({ xMedian, yMedian }: ScatterGuideLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();

  if (!xScale || !yScale || !plotArea) return null;

  const xPixel = xMedian === null ? undefined : xScale(xMedian);
  const yPixel = yMedian === null ? undefined : yScale(yMedian);

  return (
    <g className="scatter-guide-layer" pointerEvents="none">
      {typeof xPixel === "number" && Number.isFinite(xPixel) ? (
        <line
          x1={xPixel}
          y1={plotArea.y}
          x2={xPixel}
          y2={plotArea.y + plotArea.height}
          stroke={SCATTER_GUIDE_LINE_COLOR}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      ) : null}

      {typeof yPixel === "number" && Number.isFinite(yPixel) ? (
        <line
          x1={plotArea.x}
          y1={yPixel}
          x2={plotArea.x + plotArea.width}
          y2={yPixel}
          stroke={SCATTER_GUIDE_LINE_COLOR}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      ) : null}
    </g>
  );
}
