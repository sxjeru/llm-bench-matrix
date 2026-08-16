import {
  OVERALL_ROW_KEY,
  PARAMS_ACTIVE_RATIO_ROW_KEY,
  SOURCE_ALL
} from "@/components/benchmark-matrix/constants";
import {
  formatParamsBillions,
  formatPricePerMillion
} from "@/components/benchmark-matrix/formatters";
import { getMatrixRowComparableScore } from "@/components/benchmark-matrix/scoring";
import type { MatrixRow } from "@/components/benchmark-matrix/types";
import {
  AA_SUMMARY_INDEX_LABEL_REGEX,
  DEFAULT_X_METRIC_PREFERENCE,
  DEFAULT_Y_METRIC_PREFERENCE,
  LOG_SCALE_CATEGORIES,
  METRIC_CATEGORY_PRIORITY,
  OVERALL_METRIC_LABEL,
  OVERALL_METRIC_SLUG,
  SUMMARY_CATEGORY_LABEL,
  SYNTHETIC_METRIC_SLUGS
} from "./constants";
import type { MatrixCell, MatrixCellEntry } from "@/components/benchmark-matrix/types";
import type {
  ScatterHistorySample,
  ScatterMetric,
  ScatterMetricGroup,
  ScatterMetricKind,
  ScatterMetricUnit
} from "./types";

/**
 * 方向判定的唯一真源。
 *
 * 不复制 `LOWER_IS_BETTER_RULES` / 价格行取负 之类的规则，而是拿两个探针值
 * 过一遍矩阵自己的可比分函数：`comparable(1) > comparable(0)` 就是「越大越好」。
 * 普通 benchmark 走 `v`、越小越好的走 `100 - v`、价格与参数量行走 `-v`，
 * 三种情况都自动得到正确答案，也就不会与矩阵的热力方向、总评方向脱节。
 */
export function isMetricHigherBetter(
  row: Pick<MatrixRow, "benchmark" | "category" | "higherIsBetter" | "isPriceRow" | "isInfoRow">
): boolean {
  return getMatrixRowComparableScore(row, 1) > getMatrixRowComparableScore(row, 0);
}

/** FNV-1a 32 位哈希，仅用于给 slug 加确定性后缀，不涉及安全性。 */
function hashRowKey(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 7);
}

/**
 * rowKey → URL 安全的稳定 slug。
 *
 * 合成行用固定短名。benchmark 行的 rowKey 形如 `merged::gpqa` 或
 * `raw::Coding::HumanEval+`，直接 slug 化会因中文名清空、也会让
 * `A/B` 与 `A-B` 撞车，所以恒定追加 rowKey 的短哈希保证唯一且稳定。
 */
export function toMetricSlug(rowKey: string): string {
  const synthetic = SYNTHETIC_METRIC_SLUGS[rowKey];
  if (synthetic) return synthetic;

  const readable = rowKey
    .replace(/^(?:merged|raw)::/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return readable ? `${readable}~${hashRowKey(rowKey)}` : `metric~${hashRowKey(rowKey)}`;
}

function resolveMetricKind(row: MatrixRow): ScatterMetricKind {
  if (row.isPriceRow) return "price";
  if (row.isInfoRow) return "params";
  return "benchmark";
}

function resolveMetricUnit(row: MatrixRow): ScatterMetricUnit {
  if (row.isPriceRow) return "usd";
  if (row.isInfoRow) {
    return row.rowKey === PARAMS_ACTIVE_RATIO_ROW_KEY ? "percent" : "billions";
  }
  return "score";
}

function buildValueByModel(row: MatrixRow): Map<string, number> {
  const valueByModel = new Map<string, number>();

  row.cells.forEach((cell, modelName) => {
    const value = cell.valueNum;
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    valueByModel.set(modelName, value);
  });

  return valueByModel;
}

function toHistorySample(entry: MatrixCellEntry): ScatterHistorySample | null {
  const value = entry.valueNum;
  if (value === null || !Number.isFinite(value)) return null;

  return {
    value,
    benchTime: entry.benchTime ?? null,
    recordId: typeof entry.recordId === "number" ? entry.recordId : null
  };
}

function collectHistorySamples(cell: MatrixCell): ScatterHistorySample[] {
  const seen = new Set<string>();
  const samples: ScatterHistorySample[] = [];

  const push = (entry: MatrixCellEntry | undefined) => {
    if (!entry) return;
    const sample = toHistorySample(entry);
    if (!sample) return;

    const key = `${sample.value}::${sample.benchTime ?? ""}::${sample.recordId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push(sample);
  };

  cell.allEntries.forEach(push);
  if (samples.length === 0) {
    push({
      recordId: null,
      valueRaw: cell.valueRaw,
      valueNum: cell.valueNum,
      valueNum2: cell.valueNum2,
      valueNote: cell.valueNote,
      source: cell.source,
      benchTime: cell.benchTime
    });
  }

  return samples;
}

function buildHistoryByModel(row: MatrixRow): Map<string, readonly ScatterHistorySample[]> {
  const historyByModel = new Map<string, readonly ScatterHistorySample[]>();
  if (row.isPriceRow || row.isInfoRow) return historyByModel;

  row.cells.forEach((cell, modelName) => {
    const samples = collectHistorySamples(cell);
    if (samples.length > 0) historyByModel.set(modelName, samples);
  });

  return historyByModel;
}

function resolveScatterMetricCategory(row: Pick<MatrixRow, "benchmark" | "category">): string {
  // AA 复合指数在下拉里并入 Summary，与 Overall Score 放一起
  if (AA_SUMMARY_INDEX_LABEL_REGEX.test(row.benchmark.trim())) {
    return SUMMARY_CATEGORY_LABEL;
  }
  return row.category;
}

export function toScatterMetric(row: MatrixRow): ScatterMetric {
  const unit = resolveMetricUnit(row);
  const category = resolveScatterMetricCategory(row);

  return {
    key: toMetricSlug(row.rowKey),
    rowKey: row.rowKey,
    label: row.benchmark,
    category,
    kind: resolveMetricKind(row),
    higherIsBetter: isMetricHigherBetter(row),
    unit,
    // 价格/参数量，以及分类精确为 Cost、Performance 的指标跨数量级，线性轴会把点挤成一团
    preferLogScale:
      unit === "usd" || unit === "billions" || LOG_SCALE_CATEGORIES.has(row.category),
    valueByModel: buildValueByModel(row),
    historyByModel: buildHistoryByModel(row)
  };
}

export type BuildScatterMetricsInput = {
  benchmarkRows: readonly MatrixRow[];
  priceRows: readonly MatrixRow[];
  paramsRows: readonly MatrixRow[];
  /** 矩阵总评分（rawScore）。传 null 表示不提供总评轴。 */
  overallScoreByModel?: ReadonlyMap<string, number | null> | null;
};

function compareMetricsForSelector(left: ScatterMetric, right: ScatterMetric): number {
  const leftPriority = METRIC_CATEGORY_PRIORITY[left.category] ?? 10;
  const rightPriority = METRIC_CATEGORY_PRIORITY[right.category] ?? 10;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  if (left.category !== right.category) {
    return left.category.localeCompare(right.category, "en", { numeric: true, sensitivity: "base" });
  }

  return left.label.localeCompare(right.label, "en", { numeric: true, sensitivity: "base" });
}

/**
 * 散点 Overall 用的 benchmark 行。
 *
 * All 且未勾选「含低覆盖指标」时，Cost 仍会因 alwaysKeep 留在轴下拉里，
 * 但不计入 Overall（与矩阵默认不把成本类指标混进能力总评一致）。
 */
export function filterMatrixRowsForScatterOverall(
  matrixRows: readonly MatrixRow[],
  showLowCoverageRows: boolean,
  activeSource: string
): MatrixRow[] {
  if (showLowCoverageRows || activeSource !== SOURCE_ALL) {
    return matrixRows as MatrixRow[];
  }

  return matrixRows.filter((row) => row.category !== "Cost");
}

/**
 * 汇总所有可作为坐标轴的指标。
 *
 * 只保留至少有一个模型有数值的指标 —— 空指标出现在下拉里只会制造死路。
 */
export function buildScatterMetrics(input: BuildScatterMetricsInput): ScatterMetric[] {
  const metrics: ScatterMetric[] = [];

  if (input.overallScoreByModel) {
    const valueByModel = new Map<string, number>();
    input.overallScoreByModel.forEach((score, modelName) => {
      if (score === null || !Number.isFinite(score)) return;
      valueByModel.set(modelName, score);
    });

    if (valueByModel.size > 0) {
      metrics.push({
        key: OVERALL_METRIC_SLUG,
        rowKey: OVERALL_ROW_KEY,
        label: OVERALL_METRIC_LABEL,
        category: SUMMARY_CATEGORY_LABEL,
        kind: "overall",
        higherIsBetter: true,
        unit: "score",
        preferLogScale: false,
        valueByModel,
        historyByModel: new Map()
      });
    }
  }

  const rowMetrics = [...input.paramsRows, ...input.priceRows, ...input.benchmarkRows]
    .map(toScatterMetric)
    .filter((metric) => metric.valueByModel.size > 0);

  // slug 理论上唯一，但源数据异常时宁可丢重复项也不要让轴选择器出现两个同 key 项
  const seenKeys = new Set(metrics.map((metric) => metric.key));
  rowMetrics.forEach((metric) => {
    if (seenKeys.has(metric.key)) return;
    seenKeys.add(metric.key);
    metrics.push(metric);
  });

  return metrics.sort(compareMetricsForSelector);
}

export function groupScatterMetrics(metrics: readonly ScatterMetric[]): ScatterMetricGroup[] {
  const groups = new Map<string, ScatterMetric[]>();

  metrics.forEach((metric) => {
    const existing = groups.get(metric.category);
    if (existing) {
      existing.push(metric);
      return;
    }
    groups.set(metric.category, [metric]);
  });

  return Array.from(groups.entries())
    .map(([category, categoryMetrics]) => ({ category, metrics: categoryMetrics }))
    .sort((left, right) => {
      const leftPriority = METRIC_CATEGORY_PRIORITY[left.category] ?? 10;
      const rightPriority = METRIC_CATEGORY_PRIORITY[right.category] ?? 10;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.category.localeCompare(right.category, "en", { numeric: true, sensitivity: "base" });
    });
}

export function findScatterMetric(
  metrics: readonly ScatterMetric[],
  key: string | null | undefined
): ScatterMetric | null {
  if (!key) return null;
  return metrics.find((metric) => metric.key === key) ?? null;
}

function pickByPreference(
  metrics: readonly ScatterMetric[],
  preference: readonly string[],
  excludeKey: string | null
): ScatterMetric | null {
  for (const preferred of preference) {
    const match = metrics.find(
      (metric) =>
        metric.key !== excludeKey &&
        (metric.key === preferred || metric.label === preferred)
    );
    if (match) return match;
  }
  return null;
}

function pickWidestCoverage(
  metrics: readonly ScatterMetric[],
  excludeKey: string | null
): ScatterMetric | null {
  let best: ScatterMetric | null = null;

  metrics.forEach((metric) => {
    if (metric.key === excludeKey) return;
    if (!best || metric.valueByModel.size > best.valueByModel.size) {
      best = metric;
    }
  });

  return best;
}

/**
 * 默认双轴：Y 取总评分、X 优先取 AA Intelligence Index Cost per Task，
 * 没有该项时回落到输出价格；再缺则取覆盖模型数最多的指标。
 */
export function resolveDefaultAxisKeys(metrics: readonly ScatterMetric[]): {
  xKey: string | null;
  yKey: string | null;
} {
  if (metrics.length === 0) {
    return { xKey: null, yKey: null };
  }

  const yMetric =
    pickByPreference(metrics, DEFAULT_Y_METRIC_PREFERENCE, null) ??
    pickWidestCoverage(metrics.filter((metric) => metric.kind === "benchmark"), null) ??
    pickWidestCoverage(metrics, null);
  const yKey = yMetric?.key ?? null;

  const xMetric =
    pickByPreference(metrics, DEFAULT_X_METRIC_PREFERENCE, yKey) ??
    pickWidestCoverage(metrics, yKey);

  return { xKey: xMetric?.key ?? null, yKey };
}

/** 悬浮卡与图例用的完整数值文本。 */
export function formatScatterValue(metric: Pick<ScatterMetric, "unit">, value: number): string {
  if (!Number.isFinite(value)) return "--";

  switch (metric.unit) {
    case "usd":
      return formatPricePerMillion(value);
    case "billions":
      return formatParamsBillions(value);
    case "percent":
      return `${Number(value.toFixed(1)).toString()}%`;
    default:
      return Number(value.toFixed(2)).toString();
  }
}

/** 坐标轴刻度用的紧凑文本，避免长数字撑坏轴。 */
export function formatScatterAxisTick(metric: Pick<ScatterMetric, "unit">, value: number): string {
  if (!Number.isFinite(value)) return "";

  switch (metric.unit) {
    case "usd": {
      const abs = Math.abs(value);
      if (abs >= 1) return `$${Number(value.toFixed(abs >= 10 ? 0 : 1)).toString()}`;
      return `$${Number(value.toFixed(3)).toString()}`;
    }
    case "billions": {
      const abs = Math.abs(value);
      if (abs >= 1000) return `${Number((value / 1000).toFixed(1)).toString()}T`;
      return `${Number(value.toFixed(abs >= 10 ? 0 : 1)).toString()}B`;
    }
    case "percent":
      return `${Number(value.toFixed(Math.abs(value) >= 10 ? 0 : 1)).toString()}%`;
    default:
      return Number(value.toFixed(Math.abs(value) >= 10 ? 0 : 2)).toString();
  }
}

/** 轴标题上的方向提示。 */
export function describeMetricDirection(metric: Pick<ScatterMetric, "higherIsBetter">): string {
  return metric.higherIsBetter ? "越大越好" : "越小越好";
}

export function getMetricAxisLabel(metric: ScatterMetric): string {
  return `${metric.label}（${describeMetricDirection(metric)}）`;
}
