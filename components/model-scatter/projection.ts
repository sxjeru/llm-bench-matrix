import type { ScatterAxisBounds, ScatterAxisScale, ScatterPoint } from "./types";

export type ScatterChartMargin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * 绘图区矩形。
 *
 * 坐标轴尺寸一律显式指定（不用 `width="auto"`），Recharts 的布局因此完全可预测，
 * 我们就能在图表之外同步算出绘图区 —— 不必再从图表内部把布局回传上来。
 * 那条回传链正是标签卡顿与死循环的根源：回传触发重渲染、重渲染又触发回传。
 */
export function computePlotArea(input: {
  width: number;
  height: number;
  margin: ScatterChartMargin;
  yAxisWidth: number;
  xAxisHeight: number;
}): ScatterAxisBounds | null {
  const { width, height, margin, yAxisWidth, xAxisHeight } = input;

  const left = margin.left + yAxisWidth;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom - xAxisHeight;

  if (!(right > left) || !(bottom > top)) return null;

  return { left, top, right, bottom };
}

/**
 * 数值 → 像素。
 *
 * 与 Recharts 对 `type="number"` + 显式 domain 的处理一致：线性轴走 d3 scaleLinear、
 * 对数轴走 scaleLog，值域两端映射到绘图区两端。
 */
export function projectToPixel(
  value: number,
  domain: readonly [number, number],
  scale: ScatterAxisScale,
  pixelStart: number,
  pixelEnd: number
): number | null {
  if (!Number.isFinite(value)) return null;

  const isLog = scale === "log" && domain[0] > 0 && domain[1] > 0;
  if (isLog && value <= 0) return null;

  const toSpace = (input: number) => (isLog ? Math.log10(input) : input);
  const low = toSpace(domain[0]);
  const high = toSpace(domain[1]);
  const span = high - low;
  if (!Number.isFinite(span) || span === 0) return null;

  const ratio = (toSpace(value) - low) / span;
  return pixelStart + ratio * (pixelEnd - pixelStart);
}

export type ScatterPointProjection = {
  cx: number;
  cy: number;
};

/**
 * 把所有落点投影到像素坐标。
 *
 * Y 轴像素向下增长而数值向上增长，所以起点取绘图区底边、终点取顶边。
 */
export function buildPointProjections(input: {
  points: readonly ScatterPoint[];
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  plotArea: ScatterAxisBounds | null;
}): Map<string, ScatterPointProjection> {
  const { points, xDomain, yDomain, xScale, yScale, plotArea } = input;
  const projections = new Map<string, ScatterPointProjection>();
  if (!plotArea) return projections;

  points.forEach((point) => {
    const cx = projectToPixel(point.x, xDomain, xScale, plotArea.left, plotArea.right);
    const cy = projectToPixel(point.y, yDomain, yScale, plotArea.bottom, plotArea.top);
    if (cx === null || cy === null) return;

    projections.set(point.modelName, { cx, cy });
  });

  return projections;
}

/** 像素 → 该轴上的相对位置（0 = 轴起点，1 = 轴终点），供滚轮缩放定位锚点。 */
export function pixelToAxisRatio(
  pixel: number,
  pixelStart: number,
  pixelEnd: number
): number {
  const span = pixelEnd - pixelStart;
  if (span === 0) return 0;
  return (pixel - pixelStart) / span;
}
