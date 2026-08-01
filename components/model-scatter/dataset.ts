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
