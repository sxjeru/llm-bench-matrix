import { formatLocalDateLabel, formatTooltipTime } from "./formatters";
import { getSourceKey, sourceTabDisplayLabel, SOURCE_ALL } from "@/lib/source-utils";
import type { MatrixCell, MatrixCellEntry } from "./types";

export type CellTrendPoint = {
  timestamp: number;
  dateLabel: string;
  timeLabel: string;
  fullTime: string;
  score: number;
  score2: number | null;
  raw: string;
  note: string | null;
  source: string;
};

export type CellTrendData = {
  benchmark: string;
  category: string;
  modelName: string;
  source: string;
  sourceLabel: string;
  higherIsBetter: boolean;
  points: CellTrendPoint[];
  firstPoint: CellTrendPoint;
  latestPoint: CellTrendPoint;
  minScore: number;
  maxScore: number;
  scoreDelta: number;
};

export type CellTrendPopoverPosition = {
  top: number;
  left: number;
  width: number;
  placement: "above" | "below";
};

const TREND_POPOVER_MAX_WIDTH = 560;
const TREND_POPOVER_MIN_WIDTH = 320;
const TREND_POPOVER_MARGIN = 16;
const TREND_POPOVER_GAP = 8;
export const ESTIMATED_TREND_POPOVER_HEIGHT = 440;

/**
 * 提取单元格中用于时序分析的合法记录。
 * 必须具备有限数值（valueNum）以及合法的 benchTime。
 */
function getValidTrendEntries(cell: MatrixCell, activeSource?: string): {
  entries: MatrixCellEntry[];
  source: string;
} | null {
  const allEntries = cell.allEntries || [];
  if (allEntries.length < 2) return null;

  const validEntries = allEntries.filter((entry) => {
    if (entry.valueNum === null || !Number.isFinite(entry.valueNum)) return false;
    if (!entry.benchTime) return false;
    const time = new Date(entry.benchTime).getTime();
    return !Number.isNaN(time);
  });

  if (validEntries.length < 2) return null;

  // 1. 若用户限定了 activeSource（非 ALL），优先仅提取属于该 activeSource 的记录
  if (activeSource && activeSource !== SOURCE_ALL) {
    const activeEntries = validEntries.filter(
      (e) => getSourceKey(e.source) === activeSource
    );
    if (activeEntries.length >= 2) {
      return {
        entries: activeEntries,
        source: activeSource
      };
    }
    return null;
  }

  // 2. 在全量 (ALL) 视图下，要求所有合法条目完全属于同一个 source（避免不同源混杂对比）
  const distinctSources = Array.from(
    new Set(validEntries.map((e) => getSourceKey(e.source)))
  );

  if (distinctSources.length === 1) {
    return {
      entries: validEntries,
      source: distinctSources[0]!
    };
  }

  return null;
}

/**
 * 判断单元格是否符合展开时间折线图的条件：
 * 有多个值且全部为同一 source（且具备有效的时间戳与数值）。
 */
export function isCellTrendEligible(cell?: MatrixCell | null, activeSource?: string): boolean {
  if (!cell) return false;
  return getValidTrendEntries(cell, activeSource) !== null;
}

/**
 * 构建单元格时间折线图数据集
 */
export function buildCellTrendData(
  matrixRow: { benchmark: string; category: string; higherIsBetter: boolean },
  modelName: string,
  cell: MatrixCell,
  activeSource?: string
): CellTrendData | null {
  const result = getValidTrendEntries(cell, activeSource);
  if (!result) return null;

  const { entries, source } = result;

  // 按时间升序排列
  const sorted = [...entries].sort((a, b) => {
    const timeA = new Date(a.benchTime!).getTime();
    const timeB = new Date(b.benchTime!).getTime();
    return timeA - timeB;
  });

  const dateLabels = sorted.map((entry) => formatLocalDateLabel(entry.benchTime!));
  const hasDuplicateDates = new Set(dateLabels).size < dateLabels.length;
  const hasSpecificTimes = sorted.some((entry) => {
    const d = new Date(entry.benchTime!);
    return d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  });
  const includeTimeInLabel = hasDuplicateDates || hasSpecificTimes;

  const seenLabels = new Map<string, number>();
  const points: CellTrendPoint[] = sorted.map((entry) => {
    const timeObj = new Date(entry.benchTime!);
    const baseLabel = includeTimeInLabel
      ? formatTooltipTime(entry.benchTime!)
      : formatLocalDateLabel(entry.benchTime!);

    const count = (seenLabels.get(baseLabel) ?? 0) + 1;
    seenLabels.set(baseLabel, count);
    const timeLabel = count > 1 ? `${baseLabel} (#${count})` : baseLabel;

    return {
      timestamp: timeObj.getTime(),
      dateLabel: formatLocalDateLabel(entry.benchTime!),
      timeLabel,
      fullTime: count > 1 ? `${formatTooltipTime(entry.benchTime!)} (#${count})` : formatTooltipTime(entry.benchTime!),
      score: entry.valueNum!,
      score2: entry.valueNum2 ?? null,
      raw: entry.valueRaw,
      note: entry.valueNote ?? null,
      source: entry.source ?? source
    };
  });

  const scores = points.map((p) => p.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const firstPoint = points[0]!;
  const latestPoint = points[points.length - 1]!;
  const scoreDelta = latestPoint.score - firstPoint.score;

  return {
    benchmark: matrixRow.benchmark,
    category: matrixRow.category,
    modelName,
    source,
    sourceLabel: sourceTabDisplayLabel(source),
    higherIsBetter: matrixRow.higherIsBetter,
    points,
    firstPoint,
    latestPoint,
    minScore,
    maxScore,
    scoreDelta
  };
}

/**
 * 根据点击的锚点元素计算时间折线图浮层的视口位置
 */
export function getCellTrendPopoverPosition(anchorRect: DOMRect): CellTrendPopoverPosition {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;

  const width = Math.max(
    TREND_POPOVER_MIN_WIDTH,
    Math.min(viewportWidth - TREND_POPOVER_MARGIN * 2, TREND_POPOVER_MAX_WIDTH)
  );

  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const preferredLeft = anchorCenter - width / 2;
  const left = Math.max(
    TREND_POPOVER_MARGIN,
    Math.min(preferredLeft, viewportWidth - width - TREND_POPOVER_MARGIN)
  );

  const spaceBelow = viewportHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const placement = spaceBelow >= ESTIMATED_TREND_POPOVER_HEIGHT || spaceBelow >= spaceAbove ? "below" : "above";

  const top = placement === "below"
    ? Math.min(anchorRect.bottom + TREND_POPOVER_GAP, viewportHeight - TREND_POPOVER_MARGIN)
    : Math.max(anchorRect.top - TREND_POPOVER_GAP, TREND_POPOVER_MARGIN);

  return { top, left, width, placement };
}

/**
 * 计算折线图 X 轴单行展示时的可见刻度索引。
 *
 * 保证：
 * 1. 始终包含首个记录点 (0) 与最后一个记录点 (lastIdx)；
 * 2. 任意两个相邻可见刻度之间的像素距离 >= minTickDistance；
 * 3. 避免末尾刻度与倒数第二个刻度过于靠近导致文字物理重叠；
 * 4. 步长余数在各区间之间均匀平摊，避免刻度间距突兀。
 */
export function calculateVisibleTickIndices(
  dataLength: number,
  plotWidth: number,
  spansMultipleYears: boolean
): number[] {
  const lastIdx = dataLength - 1;
  if (lastIdx <= 0) return [0];

  // 单年格式 MM-DD (约 30px)，跨年格式 YY-MM-DD (约 48px)，预留呼吸间距
  const minTickDistance = spansMultipleYears ? 58 : 46;
  const safePlotWidth = Math.max(120, plotWidth);

  const step = Math.max(
    1,
    Math.ceil((lastIdx * minTickDistance) / safePlotWidth)
  );

  const intervals = Math.floor(lastIdx / step);
  if (intervals <= 0) {
    return [0, lastIdx];
  }

  const remainder = lastIdx - intervals * step;
  const visible: number[] = [];
  for (let j = 0; j <= intervals; j++) {
    const tickIndex = j * step + Math.round((j * remainder) / intervals);
    visible.push(tickIndex);
  }
  return visible;
}
