import {
  SCATTER_LINEAR_DOMAIN_PADDING,
  SCATTER_LOG_DOMAIN_PADDING
} from "./constants";
import { computeParetoFrontier, orderParetoPath } from "./pareto";
import { computeScatterTrendLine } from "./trend-line";
import { parseTimestampMs } from "@/components/benchmark-matrix/utils";
import {
  formatSnapshotDateLabel,
  pickNearestSampleByTime,
  resolveSampleForSnapshot
} from "./snapshots";
import type {
  ScatterAxisScale,
  ScatterMetric,
  ScatterOverlaySnapshotPoint,
  ScatterPlotDataset,
  ScatterPoint,
  ScatterSnapshotOverlayDataset
} from "./types";

export type BuildScatterDatasetInput = {
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  modelNames: readonly string[];
  providerNameByModel: ReadonlyMap<string, string>;
  colorByModel: ReadonlyMap<string, string>;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  xSnapshot?: string | null;
  ySnapshot?: string | null;
};

const EMPTY_DATASET: ScatterPlotDataset = {
  points: [],
  paretoKeys: new Set<string>(),
  paretoPath: [],
  trendLine: null,
  missingCount: 0,
  nonPositiveCount: 0
};

/**
 * 把两个指标投影成散点集合，并标注帕累托前沿。
 * 支持指定快照时间（xSnapshot / ySnapshot），支持 Y 轴选历史快照而 X 轴就近对齐。
 */
export function buildScatterDataset(input: BuildScatterDatasetInput): ScatterPlotDataset {
  const {
    xMetric,
    yMetric,
    modelNames,
    providerNameByModel,
    colorByModel,
    xScale,
    yScale,
    xSnapshot,
    ySnapshot
  } = input;

  if (modelNames.length === 0) {
    return { ...EMPTY_DATASET, paretoKeys: new Set<string>() };
  }

  const xSnapshotTime = xSnapshot ? parseTimestampMs(xSnapshot) : null;
  const ySnapshotTime = ySnapshot ? parseTimestampMs(ySnapshot) : null;

  const points: ScatterPoint[] = [];
  let missingCount = 0;
  let nonPositiveCount = 0;

  modelNames.forEach((modelName) => {
    // 1. 解析 Y 值及时间
    let y: number | undefined;
    let yBenchTime: string | null = null;

    if (ySnapshotTime !== null) {
      const ySamples = yMetric.historyByModel.get(modelName) ?? [];
      const sample = resolveSampleForSnapshot(ySamples, ySnapshotTime);
      if (sample && Number.isFinite(sample.value)) {
        y = sample.value;
        yBenchTime = sample.benchTime;
      }
    } else if (xSnapshotTime !== null) {
      // Y 轴跟随 X 轴快照时间就近吸附
      const ySamples = yMetric.historyByModel.get(modelName) ?? [];
      if (ySamples.length > 0) {
        const sample = pickNearestSampleByTime(ySamples, xSnapshotTime);
        if (sample && Number.isFinite(sample.value)) {
          y = sample.value;
          yBenchTime = sample.benchTime;
        }
      } else {
        y = yMetric.valueByModel.get(modelName);
      }
    } else {
      y = yMetric.valueByModel.get(modelName);
    }

    if (y === undefined || !Number.isFinite(y)) {
      missingCount += 1;
      return;
    }

    // 2. 解析 X 值及时间（X 轴取最接近 Y 快照时间的值）
    let x: number | undefined;
    let xBenchTime: string | null = null;

    if (xSnapshotTime !== null) {
      const xSamples = xMetric.historyByModel.get(modelName) ?? [];
      const sample = resolveSampleForSnapshot(xSamples, xSnapshotTime);
      if (sample && Number.isFinite(sample.value)) {
        x = sample.value;
        xBenchTime = sample.benchTime;
      }
    } else if (ySnapshotTime !== null) {
      // X 轴按选中的 Y 轴快照时间取就近值
      const xSamples = xMetric.historyByModel.get(modelName) ?? [];
      if (xSamples.length > 0) {
        const sample = pickNearestSampleByTime(xSamples, ySnapshotTime);
        if (sample && Number.isFinite(sample.value)) {
          x = sample.value;
          xBenchTime = sample.benchTime;
        }
      } else {
        x = xMetric.valueByModel.get(modelName);
      }
    } else {
      x = xMetric.valueByModel.get(modelName);
    }

    if (x === undefined || !Number.isFinite(x)) {
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
      xBenchTime,
      yBenchTime,
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

  const trendLine = computeScatterTrendLine(points);

  return { points, paretoKeys, paretoPath, trendLine, missingCount, nonPositiveCount };
}

export type BuildScatterSnapshotOverlayDatasetInput = {
  snapshotId: string;
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  modelNames: readonly string[];
  providerNameByModel: ReadonlyMap<string, string>;
  colorByModel: ReadonlyMap<string, string>;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
};

/**
 * 构建半透明历史快照背景叠加层数据集。
 * 点集将作为背景（叉号显示），并计算出该历史时刻的帕累托前沿。
 */
export function buildScatterSnapshotOverlayDataset(
  input: BuildScatterSnapshotOverlayDatasetInput
): ScatterSnapshotOverlayDataset | null {
  const {
    snapshotId,
    xMetric,
    yMetric,
    modelNames,
    providerNameByModel,
    colorByModel,
    xScale,
    yScale
  } = input;

  const snapshotTime = parseTimestampMs(snapshotId);
  if (snapshotTime === null) return null;

  const snapshotObj =
    yMetric.snapshots.find((s) => s.id === snapshotId) ??
    xMetric.snapshots.find((s) => s.id === snapshotId);
  const snapshotLabel = snapshotObj?.label ?? formatSnapshotDateLabel(snapshotTime);

  const isYSnapshot = yMetric.snapshots.some((s) => s.id === snapshotId);
  const isXSnapshot = xMetric.snapshots.some((s) => s.id === snapshotId);
  const isXPrimary = isXSnapshot && !isYSnapshot;
  const isBothStrict = isXSnapshot && isYSnapshot;

  const points: ScatterOverlaySnapshotPoint[] = [];

  modelNames.forEach((modelName) => {
    // 1. 解析 Y 值及时间
    let y: number | undefined;
    let yBenchTime: string | null = null;
    const ySamples = yMetric.historyByModel.get(modelName) ?? [];

    if (isBothStrict || !isXPrimary) {
      // Y 为主导轴或双轴均匹配快照：严格按快照时间提取
      const ySample = resolveSampleForSnapshot(ySamples, snapshotTime);
      if (ySample && Number.isFinite(ySample.value)) {
        y = ySample.value;
        yBenchTime = ySample.benchTime;
      } else if (yMetric.kind !== "benchmark") {
        y = yMetric.valueByModel.get(modelName);
      }
    } else {
      // X 为主导轴：Y 就近吸附
      if (ySamples.length > 0) {
        const ySample = pickNearestSampleByTime(ySamples, snapshotTime);
        if (ySample && Number.isFinite(ySample.value)) {
          y = ySample.value;
          yBenchTime = ySample.benchTime;
        }
      } else {
        y = yMetric.valueByModel.get(modelName);
      }
    }

    if (y === undefined || !Number.isFinite(y)) return;

    // 2. 解析 X 值及时间
    let x: number | undefined;
    let xBenchTime: string | null = null;
    const xSamples = xMetric.historyByModel.get(modelName) ?? [];

    if (isBothStrict || isXPrimary) {
      // X 为主导轴或双轴均匹配快照：严格按快照时间提取
      const xSample = resolveSampleForSnapshot(xSamples, snapshotTime);
      if (xSample && Number.isFinite(xSample.value)) {
        x = xSample.value;
        xBenchTime = xSample.benchTime;
      } else if (xMetric.kind !== "benchmark") {
        x = xMetric.valueByModel.get(modelName);
      }
    } else {
      // Y 为主导轴：X 就近吸附
      if (xSamples.length > 0) {
        const xSample = pickNearestSampleByTime(xSamples, snapshotTime);
        if (xSample && Number.isFinite(xSample.value)) {
          x = xSample.value;
          xBenchTime = xSample.benchTime;
        }
      } else {
        x = xMetric.valueByModel.get(modelName);
      }
    }

    if (x === undefined || !Number.isFinite(x)) return;

    if ((xScale === "log" && x <= 0) || (yScale === "log" && y <= 0)) return;

    points.push({
      modelName,
      providerName: providerNameByModel.get(modelName) ?? "Unknown",
      color: colorByModel.get(modelName) ?? "#5da7ff",
      x,
      y,
      xBenchTime,
      yBenchTime,
      isPareto: false
    });
  });

  if (points.length === 0) return null;

  const paretoKeys = computeParetoFrontier(
    points.map((p) => ({ key: p.modelName, x: p.x, y: p.y })),
    xMetric.higherIsBetter,
    yMetric.higherIsBetter
  );

  points.forEach((p) => {
    p.isPareto = paretoKeys.has(p.modelName);
  });

  const paretoPath = orderParetoPath(
    points.filter((p) => p.isPareto),
    xMetric.higherIsBetter,
    yMetric.higherIsBetter
  );

  return {
    snapshotId,
    snapshotLabel,
    points,
    paretoPath
  };
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

type AxisSpace = {
  toSpace: (value: number) => number;
  fromSpace: (value: number) => number;
};

function resolveAxisSpace(
  scale: ScatterAxisScale,
  ...domains: ReadonlyArray<readonly [number, number]>
): AxisSpace {
  const isLog = scale === "log" && domains.every((domain) => domain[0] > 0 && domain[1] > 0);

  return isLog
    ? { toSpace: (value) => Math.log10(value), fromSpace: (value) => 10 ** value }
    : { toSpace: (value) => value, fromSpace: (value) => value };
}

/**
 * 缩放坐标轴值域。
 *
 * 放大以光标为锚点：光标底下的那个数据点在缩放前后始终贴着光标，这是最跟手的手感。
 *
 * 缩小则不锚定光标 —— 那会让画面朝光标反方向甩出去，越缩越偏，而且缩到底时停在
 * 一个歪掉的视图上。这里改成「朝基准视图收敛」：跨度每往回退一分，视图中心就朝
 * 初始中心挪一分，跨度退满时恰好精确还原初始视图。既保留了缩放的连续感，
 * 又保证「一直往回滚 = 回到最初那张图」。
 *
 * `anchorRatio` 是光标在该轴上的相对位置（0 = 轴起点，1 = 轴终点）。
 * 对数轴的全部运算都在 log 空间进行，视觉上才是等比的。
 */
export function zoomAxisDomain(
  domain: readonly [number, number],
  baseDomain: readonly [number, number],
  scale: ScatterAxisScale,
  anchorRatio: number,
  factor: number
): [number, number] {
  const { toSpace, fromSpace } = resolveAxisSpace(scale, domain, baseDomain);

  const low = toSpace(domain[0]);
  const high = toSpace(domain[1]);
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return [domain[0], domain[1]];

  const baseLow = toSpace(baseDomain[0]);
  const baseHigh = toSpace(baseDomain[1]);
  const baseSpan = baseHigh - baseLow;
  if (!Number.isFinite(baseSpan) || baseSpan <= 0) return [domain[0], domain[1]];

  // 缩小的尽头就是基准视图本身，不再往外撑
  const nextSpan = Math.min(baseSpan, Math.max(baseSpan * MAX_ZOOM_IN_RATIO, span * factor));

  if (nextSpan <= span) {
    const ratio = Math.min(1, Math.max(0, anchorRatio));
    const anchor = low + span * ratio;
    return [fromSpace(anchor - nextSpan * ratio), fromSpace(anchor + nextSpan * (1 - ratio))];
  }

  // 朝基准收敛：跨度走完剩余距离的多少，中心就朝基准中心挪多少
  const progress = baseSpan === span ? 1 : (nextSpan - span) / (baseSpan - span);
  const center = low + span / 2;
  const baseCenter = baseLow + baseSpan / 2;
  const nextCenter = center + (baseCenter - center) * Math.min(1, Math.max(0, progress));

  return [fromSpace(nextCenter - nextSpan / 2), fromSpace(nextCenter + nextSpan / 2)];
}

/**
 * 拖拽平移。
 *
 * `shiftRatio` 是数据空间上的位移占当前跨度的比例，由调用方按像素位移换算并定好符号，
 * 平移逻辑本身因此与绘图区几何无关。
 */
export function panAxisDomain(
  domain: readonly [number, number],
  scale: ScatterAxisScale,
  shiftRatio: number
): [number, number] {
  if (!Number.isFinite(shiftRatio) || shiftRatio === 0) return [domain[0], domain[1]];

  const { toSpace, fromSpace } = resolveAxisSpace(scale, domain);
  const low = toSpace(domain[0]);
  const high = toSpace(domain[1]);
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return [domain[0], domain[1]];

  const shift = span * shiftRatio;
  return [fromSpace(low + shift), fromSpace(high + shift)];
}

/**
 * 限制平移范围。
 *
 * 视图中心必须留在基准值域之内 —— 再怎么拖也不会把所有点甩出画面、
 * 只剩一片空白让人不知道该往哪拖回来。
 */
export function clampPannedDomain(
  domain: readonly [number, number],
  baseDomain: readonly [number, number],
  scale: ScatterAxisScale
): [number, number] {
  const { toSpace, fromSpace } = resolveAxisSpace(scale, domain, baseDomain);

  const low = toSpace(domain[0]);
  const high = toSpace(domain[1]);
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return [domain[0], domain[1]];

  const baseLow = toSpace(baseDomain[0]);
  const baseHigh = toSpace(baseDomain[1]);
  const center = low + span / 2;
  const clampedCenter = Math.min(baseHigh, Math.max(baseLow, center));
  if (clampedCenter === center) return [domain[0], domain[1]];

  return [fromSpace(clampedCenter - span / 2), fromSpace(clampedCenter + span / 2)];
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
