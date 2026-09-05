import { parseTimestampMs } from "@/components/benchmark-matrix/utils";
import type {
  ScatterHistorySample,
  ScatterMetricSnapshot
} from "./types";

/** 属于同一快照批次的最大允许时间差（4 小时） */
const SNAPSHOT_CLUSTER_WINDOW_MS = 4 * 60 * 60 * 1000;

/** 格式化日期为 YYYY-MM-DD */
export function formatSnapshotDateLabel(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "未知时间";
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 格式化日期为 YYYY-MM-DD HH:mm（供同一天多次导入区分） */
export function formatSnapshotDateTimeLabel(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "未知时间";
  const date = new Date(timestampMs);
  const datePart = formatSnapshotDateLabel(timestampMs);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${datePart} ${hours}:${minutes}`;
}

type RawTimestampEntry = {
  modelName: string;
  timestamp: number;
  sample: ScatterHistorySample;
};

/**
 * 从指标的历史记录中提取并聚类出历史时间快照（公共时间片段）。
 *
 * 算法：
 * 1. 汇集所有模型的历史样本时间戳；
 * 2. 降序排列后，将时间差在 4 小时以内的点聚类为同一快照；
 * 3. 统计每个快照覆盖的不同模型数量（modelCount）；
 * 4. 若同一天内有多个批次，附加时间（HH:mm）以示区分；
 * 5. 若指标仅有 1 个快照（只有初始导入），则返回空数组，避免无意义的下拉展示；
 *    若存在 >= 2 个快照，最新的一项标为 isLatest: true。
 */
export function extractMetricSnapshots(
  historyByModel: ReadonlyMap<string, readonly ScatterHistorySample[]>
): ScatterMetricSnapshot[] {
  const rawEntries: RawTimestampEntry[] = [];

  historyByModel.forEach((samples, modelName) => {
    samples.forEach((sample) => {
      const timeMs = parseTimestampMs(sample.benchTime);
      if (timeMs === null) return;
      rawEntries.push({ modelName, timestamp: timeMs, sample });
    });
  });

  if (rawEntries.length === 0) return [];

  // 按时间降序排列
  rawEntries.sort((a, b) => b.timestamp - a.timestamp);

  // 聚类
  type Cluster = {
    timestamps: number[];
    models: Set<string>;
  };

  const clusters: Cluster[] = [];

  rawEntries.forEach((entry) => {
    const existing = clusters.find((cluster) => {
      const maxTime = cluster.timestamps[0] ?? 0;
      const minTime = cluster.timestamps[cluster.timestamps.length - 1] ?? 0;
      return (
        Math.abs(entry.timestamp - maxTime) <= SNAPSHOT_CLUSTER_WINDOW_MS ||
        Math.abs(entry.timestamp - minTime) <= SNAPSHOT_CLUSTER_WINDOW_MS
      );
    });

    if (existing) {
      existing.timestamps.push(entry.timestamp);
      existing.models.add(entry.modelName);
    } else {
      clusters.push({
        timestamps: [entry.timestamp],
        models: new Set([entry.modelName])
      });
    }
  });

  // 如果聚类后总批次数 <= 1，说明没有历史批次可供回溯
  if (clusters.length <= 1) {
    return [];
  }

  const totalModels = historyByModel.size;

  // 检查是否有同日聚类需要附加时间
  const dayCounts = new Map<string, number>();
  clusters.forEach((cluster) => {
    const repTime = cluster.timestamps[0] ?? 0;
    const day = formatSnapshotDateLabel(repTime);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  });

  return clusters.map((cluster, index) => {
    // 聚类中代表时间取最大值（最新时间）
    const repTime = Math.max(...cluster.timestamps);
    const day = formatSnapshotDateLabel(repTime);
    const hasMultipleInDay = (dayCounts.get(day) ?? 0) > 1;
    const label = hasMultipleInDay ? formatSnapshotDateTimeLabel(repTime) : day;
    const isLatest = index === 0;
    const modelCount = cluster.models.size;

    return {
      id: new Date(repTime).toISOString(),
      timestamp: repTime,
      label,
      modelCount,
      isLatest,
      isBatchSnapshot: modelCount >= 3 || (totalModels > 0 && modelCount / totalModels >= 0.25)
    };
  });
}

/**
 * 根据快照 ID 或快照代表时间，在模型的样本中找到属于该快照的样本。
 */
export function resolveSampleForSnapshot(
  samples: readonly ScatterHistorySample[],
  targetTimestampMs: number,
  toleranceMs = SNAPSHOT_CLUSTER_WINDOW_MS * 2
): ScatterHistorySample | null {
  if (samples.length === 0) return null;

  let best: ScatterHistorySample | null = null;
  let minDiff = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const timeMs = parseTimestampMs(sample.benchTime);
    if (timeMs === null) return;
    const diff = Math.abs(timeMs - targetTimestampMs);
    if (diff <= toleranceMs && diff < minDiff) {
      minDiff = diff;
      best = sample;
    }
  });

  return best;
}

/**
 * 从一组样本中选择与目标时间最接近的样本（就近吸附）。
 * 若 targetTime 为 null，返回最新的样本。
 * 若存在两个时间差完全相同的样本，优先选取较早的一个（更保守的基准）。
 */
export function pickNearestSampleByTime(
  samples: readonly ScatterHistorySample[],
  targetTimeMs: number | null
): ScatterHistorySample | null {
  if (samples.length === 0) return null;

  if (targetTimeMs === null) {
    // 取最新
    let latest: ScatterHistorySample = samples[0]!;
    let latestTime = parseTimestampMs(latest.benchTime) ?? 0;

    for (let i = 1; i < samples.length; i += 1) {
      const sample = samples[i]!;
      const sampleTime = parseTimestampMs(sample.benchTime) ?? 0;
      if (sampleTime > latestTime) {
        latest = sample;
        latestTime = sampleTime;
      }
    }
    return latest;
  }

  let selected: ScatterHistorySample | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  samples.forEach((sample) => {
    const sampleTime = parseTimestampMs(sample.benchTime);
    if (sampleTime === null) return;

    const distance = Math.abs(sampleTime - targetTimeMs);
    if (!selected || distance < selectedDistance) {
      selected = sample;
      selectedDistance = distance;
      return;
    }

    if (distance === selectedDistance) {
      // 等距时选时间较早的
      const currentSelectedTime = parseTimestampMs(selected.benchTime) ?? 0;
      if (sampleTime < currentSelectedTime) {
        selected = sample;
      }
    }
  });

  return selected;
}

/**
 * 计算两个时间之间的友好天数差距描述。
 */
export function formatTimeDifferenceDays(fromTimeMs: number, toTimeMs: number): string {
  const diffHours = Math.round(Math.abs(fromTimeMs - toTimeMs) / (60 * 60 * 1000));
  if (diffHours < 24) {
    return diffHours === 0 ? "同批次" : `相差 ${diffHours} 小时`;
  }
  const days = Math.round(diffHours / 24);
  return `相差 ${days} 天`;
}

