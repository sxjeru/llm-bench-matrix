import { parseTimestampMs } from "@/components/benchmark-matrix/utils";
import type {
  ScatterAxisScale,
  ScatterHistoryLookupResult,
  ScatterHistoryMode,
  ScatterHistorySample,
  ScatterHistoryUnavailableReason,
  ScatterMetric,
  ScatterPoint
} from "./types";

const VALUE_EPSILON = 1e-9;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isSameValue(left: number, right: number): boolean {
  return Math.abs(left - right) <= VALUE_EPSILON;
}

function compareHistoryRecency(left: ScatterHistorySample, right: ScatterHistorySample): number {
  const leftTime = parseTimestampMs(left.benchTime);
  const rightTime = parseTimestampMs(right.benchTime);

  if (leftTime !== rightTime) {
    if (leftTime === null) return -1;
    if (rightTime === null) return 1;
    return leftTime - rightTime;
  }

  const leftId = left.recordId;
  const rightId = right.recordId;
  if (leftId !== rightId) {
    if (leftId === null) return -1;
    if (rightId === null) return 1;
    return leftId - rightId;
  }

  return 0;
}

function pickExtremeSample(
  samples: readonly ScatterHistorySample[],
  preferHigher: boolean
): ScatterHistorySample | null {
  let selected: ScatterHistorySample | null = null;

  samples.forEach((sample) => {
    if (!selected) {
      selected = sample;
      return;
    }

    const isBetter = preferHigher ? sample.value > selected.value : sample.value < selected.value;
    if (isBetter || (isSameValue(sample.value, selected.value) && compareHistoryRecency(sample, selected) > 0)) {
      selected = sample;
    }
  });

  return selected;
}

function pickNearestYSample(
  samples: readonly ScatterHistorySample[],
  targetTime: number | null
): ScatterHistorySample | null {
  if (samples.length === 0) return null;
  if (targetTime === null) {
    return samples.reduce((latest, sample) =>
      compareHistoryRecency(sample, latest) > 0 ? sample : latest
    );
  }

  let selected: ScatterHistorySample | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const sampleTime = parseTimestampMs(sample.benchTime);
    if (sampleTime === null) return;

    const distance = Math.abs(sampleTime - targetTime);
    if (!selected) {
      selected = sample;
      selectedDistance = distance;
      return;
    }

    if (distance < selectedDistance) {
      selected = sample;
      selectedDistance = distance;
      return;
    }

    if (distance !== selectedDistance) return;
    if (compareHistoryRecency(selected, sample) > 0) {
      selected = sample;
    }
  });

  return selected;
}

export function canUseScatterHistoryX(metric: Pick<ScatterMetric, "kind"> | null | undefined): boolean {
  return metric?.kind === "benchmark";
}

export function nextScatterHistoryMode(
  current: { modelName: string; mode: ScatterHistoryMode } | null,
  modelName: string
): ScatterHistoryMode | null {
  if (!current || current.modelName !== modelName) return "best";
  if (current.mode === "best") return "worst";
  return null;
}

export function resolveScatterHistoricalPoint(input: {
  current: ScatterPoint;
  mode: ScatterHistoryMode;
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
}): ScatterHistoryLookupResult {
  const { current, mode, xMetric, yMetric, xScale, yScale } = input;
  if (!canUseScatterHistoryX(xMetric)) {
    return { status: "unavailable", reason: "unsupported-x" };
  }

  const xSamples = xMetric.historyByModel.get(current.modelName) ?? [];
  const historicalXSamples = xSamples.filter((sample) => !isSameValue(sample.value, current.x));
  if (historicalXSamples.length === 0) {
    return { status: "unavailable", reason: "no-history" };
  }

  const preferHigher = mode === "best" ? xMetric.higherIsBetter : !xMetric.higherIsBetter;
  const xSample = pickExtremeSample(historicalXSamples, preferHigher);
  if (!xSample) {
    return { status: "unavailable", reason: "no-history" };
  }

  const oppositePreferHigher = mode === "best" ? !xMetric.higherIsBetter : xMetric.higherIsBetter;
  const oppositeSample = pickExtremeSample(historicalXSamples, oppositePreferHigher);
  if (mode === "worst" && oppositeSample && isSameValue(xSample.value, oppositeSample.value)) {
    return { status: "unavailable", reason: "same-extreme" };
  }

  let y = current.y;
  let yBenchTime: string | null = null;
  if (yMetric.kind === "benchmark") {
    const ySamples = yMetric.historyByModel.get(current.modelName) ?? [];
    const ySample = pickNearestYSample(ySamples, parseTimestampMs(xSample.benchTime));
    if (!ySample) {
      return { status: "unavailable", reason: "no-y" };
    }
    y = ySample.value;
    yBenchTime = ySample.benchTime;
  }

  if ((xScale === "log" && !isFinitePositive(xSample.value)) || (yScale === "log" && !isFinitePositive(y))) {
    return { status: "unavailable", reason: "non-positive" };
  }

  return {
    status: "ok",
    point: {
      modelName: current.modelName,
      providerName: current.providerName,
      color: current.color,
      mode,
      x: xSample.value,
      y,
      xBenchTime: xSample.benchTime,
      yBenchTime,
      currentX: current.x,
      currentY: current.y
    }
  };
}

export function formatScatterHistoryModeLabel(mode: ScatterHistoryMode): string {
  return mode === "best" ? "历史最优" : "历史最差";
}

export function formatScatterHistoryDate(value: string | null): string {
  const timestamp = parseTimestampMs(value);
  if (timestamp === null) return "未知日期";
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function describeScatterHistoryUnavailable(reason: ScatterHistoryUnavailableReason | undefined): string {
  switch (reason) {
    case "unsupported-x":
      return "当前 X 轴没有时间历史，无法绘制历史点";
    case "no-history":
      return "该模型没有可用的 X 轴历史记录";
    case "same-extreme":
      return "该模型没有不同的历史最差值";
    case "no-y":
      return "找不到与该历史 X 时间最近的 Y 值";
    case "non-positive":
      return "历史点在对数轴下无法绘制";
    default:
      return "无法绘制历史点";
  }
}
