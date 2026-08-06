import type { ScatterPoint, ScatterTrendLine } from "./types";

/** 对当前可绘制点做最小二乘线性回归。 */
export function computeScatterTrendLine(points: readonly Pick<ScatterPoint, "x" | "y">[]): ScatterTrendLine | null {
  const finitePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finitePoints.length < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  finitePoints.forEach((point) => {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  });

  const count = finitePoints.length;
  const denominator = count * sumXX - sumX * sumX;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < Number.EPSILON) return null;

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;

  const xValues = finitePoints.map((point) => point.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);

  return {
    slope,
    intercept,
    start: { x: minX, y: slope * minX + intercept },
    end: { x: maxX, y: slope * maxX + intercept }
  };
}