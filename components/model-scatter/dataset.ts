import {
  SCATTER_LINEAR_DOMAIN_PADDING,
  SCATTER_LOG_DOMAIN_PADDING
} from "./constants";
import { computeParetoFrontier, orderParetoPath } from "./pareto";
import type {
  ScatterAxisScale,
  ScatterMetric,
  ScatterPlotDataset,
  ScatterPoint
} from "./types";

export type BuildScatterDatasetInput = {
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  modelNames: readonly string[];
  providerNameByModel: ReadonlyMap<string, string>;
  colorByModel: ReadonlyMap<string, string>;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
};

const EMPTY_DATASET: ScatterPlotDataset = {
  points: [],
  paretoKeys: new Set<string>(),
  paretoPath: [],
  missingCount: 0,
  nonPositiveCount: 0
};

/**
 * 把两个指标投影成散点集合，并标注帕累托前沿。
 *
 * 缺数与「对数轴下的非正值」分开计数：前者是数据没覆盖到，后者是刻度选择
 * 造成的取舍，提示语要能区分，用户才知道该补数据还是该切回线性轴。
 */
export function buildScatterDataset(input: BuildScatterDatasetInput): ScatterPlotDataset {
  const { xMetric, yMetric, modelNames, providerNameByModel, colorByModel, xScale, yScale } = input;

  if (modelNames.length === 0) {
    return { ...EMPTY_DATASET, paretoKeys: new Set<string>() };
  }

  const points: ScatterPoint[] = [];
  let missingCount = 0;
  let nonPositiveCount = 0;

  modelNames.forEach((modelName) => {
    const x = xMetric.valueByModel.get(modelName);
    const y = yMetric.valueByModel.get(modelName);

    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      missingCount += 1;
      return;
    }

    if ((xScale === "log" && x <= 0) || (yScale === "log" && y <= 0)) {
      nonPositiveCount += 1;
      return;
    }

    points.push({
      modelName,
      providerName: providerNameByModel.get(modelName) ?? "Unknown",
      color: colorByModel.get(modelName) ?? "#5da7ff",
      x,
      y,
      isPareto: false
    });
  });

  const paretoKeys = computeParetoFrontier(
    points.map((point) => ({ key: point.modelName, x: point.x, y: point.y })),
    xMetric.higherIsBetter,
    yMetric.higherIsBetter
  );

  points.forEach((point) => {
    point.isPareto = paretoKeys.has(point.modelName);
  });

  const paretoPath = orderParetoPath(
    points.filter((point) => point.isPareto),
    xMetric.higherIsBetter,
    yMetric.higherIsBetter
  );

  return { points, paretoKeys, paretoPath, missingCount, nonPositiveCount };
}

/**
 * 坐标轴值域。
 *
 * Recharts 的对数刻度必须给显式 domain，否则会退化成从 0 起算而画不出来；
 * 线性轴则统一留 6% 余量，免得极值点贴在边框上。
 */
export function computeAxisDomain(
  values: readonly number[],
  scale: ScatterAxisScale
): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));

  if (scale === "log") {
    const positive = finite.filter((value) => value > 0);
    if (positive.length === 0) return [1, 10];

    const logValues = positive.map((value) => Math.log10(value));
    const minLog = Math.min(...logValues);
    const maxLog = Math.max(...logValues);
    const span = maxLog - minLog;
    const padding = span === 0 ? 0.25 : span * SCATTER_LOG_DOMAIN_PADDING;

    return [10 ** (minLog - padding), 10 ** (maxLog + padding)];
  }

  if (finite.length === 0) return [0, 1];

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  const padding = span === 0 ? Math.abs(min) * 0.1 || 1 : span * SCATTER_LINEAR_DOMAIN_PADDING;

  // 原始数据非负时不要让留白把轴推到负数区，否则价格轴会出现 -$2 这种刻度
  const lowerBound = min >= 0 ? Math.max(0, min - padding) : min - padding;

  return [lowerBound, max + padding];
}

/** 中位数参考线用的分位点。 */
export function computeMedian(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** 相对基准值域的最深放大倍数（跨度缩到 1/40） */
export const MAX_ZOOM_IN_RATIO = 1 / 40;
/** 相对基准值域的最大缩小倍数（跨度撑到 4 倍） */
export const MAX_ZOOM_OUT_RATIO = 4;

/**
 * 以光标位置为锚点缩放坐标轴值域。
 *
 * `anchorRatio` 是光标在该轴上的相对位置（0 = 轴起点，1 = 轴终点）；
 * 锚点两侧按同一比例伸缩，所以光标底下的那个数据点在缩放前后始终贴着光标。
 * 对数轴在 log 空间做同样的运算，视觉上才是等比的。
 */
export function zoomAxisDomain(
  domain: readonly [number, number],
  baseDomain: readonly [number, number],
  scale: ScatterAxisScale,
  anchorRatio: number,
  factor: number
): [number, number] {
  const isLog = scale === "log" && domain[0] > 0 && domain[1] > 0 && baseDomain[0] > 0 && baseDomain[1] > 0;
  const toSpace = (value: number) => (isLog ? Math.log10(value) : value);
  const fromSpace = (value: number) => (isLog ? 10 ** value : value);

  const low = toSpace(domain[0]);
  const high = toSpace(domain[1]);
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return [domain[0], domain[1]];

  const baseSpan = toSpace(baseDomain[1]) - toSpace(baseDomain[0]);
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchor = low + span * ratio;

  let nextSpan = span * factor;
  if (Number.isFinite(baseSpan) && baseSpan > 0) {
    nextSpan = Math.min(baseSpan * MAX_ZOOM_OUT_RATIO, Math.max(baseSpan * MAX_ZOOM_IN_RATIO, nextSpan));
  }

  return [fromSpace(anchor - nextSpan * ratio), fromSpace(anchor + nextSpan * (1 - ratio))];
}

/** 判断当前值域是否已偏离基准（决定要不要显示「重置缩放」）。 */
export function isDomainZoomed(
  domain: readonly [number, number],
  baseDomain: readonly [number, number]
): boolean {
  const epsilon = Math.abs(baseDomain[1] - baseDomain[0]) * 1e-6;
  return (
    Math.abs(domain[0] - baseDomain[0]) > epsilon || Math.abs(domain[1] - baseDomain[1]) > epsilon
  );
}
