import type { ScatterAxisScale, ScatterPoint, ScatterTrendLine } from "./types";

/** 对当前可绘制点做最小二乘线性回归；对数轴在变换后的坐标空间中拟合。 */
export function computeScatterTrendLine(
  points: readonly Pick<ScatterPoint, "x" | "y">[],
  xScale: ScatterAxisScale = "linear",
  yScale: ScatterAxisScale = "linear"
): ScatterTrendLine | null {
  const finitePoints = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      (xScale !== "log" || point.x > 0) &&
      (yScale !== "log" || point.y > 0)
  );
  if (finitePoints.length < 2) return null;

  function transform(value: number, scale: ScatterAxisScale) {
    return scale === "log" ? Math.log10(value) : value;
  }

  // 先居中再计算，避免日期轴等绝对值很大、相对差值很小的数据丢失精度。
  const transformed = finitePoints.map(({ x, y }) => ({ x: transform(x, xScale), y: transform(y, yScale) }));
  const meanX = transformed.reduce((sum, point) => sum + point.x, 0) / transformed.length;
  const meanY = transformed.reduce((sum, point) => sum + point.y, 0) / transformed.length;

  let covariance = 0;
  let variance = 0;
  for (const { x, y } of transformed) {
    const deltaX = x - meanX;
    covariance += deltaX * (y - meanY);
    variance += deltaX * deltaX;
  }
  if (variance === 0 || !Number.isFinite(variance) || transformed.every(({ x }) => x === transformed[0].x)) {
    return null;
  }

  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;

  return { slope, intercept };
}
