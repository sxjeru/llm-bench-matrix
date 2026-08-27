import {
  Eye,
  Headphones,
  Layers,
  Video
} from "lucide-react";
import { isImportValueEmptyMarker } from "@/lib/import/value-patterns";
import {
  normalizeModalityList as normalizeModalityListShared,
  normalizeModalityName
} from "@/lib/modality";
import {
  getSourceKey,
  getSourceLabel,
  isAaSecondaryCategory,
  isArtificialAnalysisSource,
  sourceTabDisplayLabel
} from "@/lib/source-utils";
import type { CompareDirection, MatrixCellEntry, MatrixInputRow } from "./types";
import { SOURCE_ALL } from "./constants";
import { blendColor } from "./colors";
import { getMatrixCellDisplayValue, hasMatrixCellPairRawValue } from "./scoring";

export { normalizeModalityName };
export {
  getSourceKey,
  getSourceLabel,
  isAaSecondaryCategory,
  isArtificialAnalysisSource,
  sourceTabDisplayLabel
};

type SourceValueDisplayItem = {
  displayValue: string;
};

export function enqueueStateUpdate(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

export function applySourceMeta(row: MatrixInputRow): MatrixInputRow {
  const sourceBenchmarkType = row.sourceBenchmarkType?.trim();
  const nextBenchmarkType = sourceBenchmarkType || row.benchmarkType;
  const nextModalities = row.sourceModalities ?? row.modalities;
  if (nextBenchmarkType === row.benchmarkType && nextModalities === row.modalities) {
    return row;
  }

  return {
    ...row,
    benchmarkType: nextBenchmarkType,
    modalities: nextModalities
  };
}

export function getModelColumnWidthKey(modelName: string): string {
  return `model:${modelName}`;
}

export function getColumnWidthOverrideKey(sourceKey: string, columnKey: string): string {
  return `${sourceKey}::${columnKey}`;
}

export function clampColumnWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function normalizeColumnWidthBySource(input: unknown): Record<string, Record<string, number>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalizedBySource: Record<string, Record<string, number>> = {};

  Object.entries(input as Record<string, unknown>).forEach(([sourceKey, widthMapRaw]) => {
    if (!widthMapRaw || typeof widthMapRaw !== "object" || Array.isArray(widthMapRaw)) return;

    const normalizedMap: Record<string, number> = {};

    Object.entries(widthMapRaw as Record<string, unknown>).forEach(([columnKey, value]) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      normalizedMap[columnKey] = Math.max(1, Math.round(value));
    });

    normalizedBySource[sourceKey] = normalizedMap;
  });

  return normalizedBySource;
}

export function areColumnWidthMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) return false;

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) return false;
  }

  return true;
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function getPreferredMatrixCellEntry(entries: MatrixCellEntry[], higherIsBetter = true): MatrixCellEntry | null {
  if (entries.length === 0) return null;

  return entries.reduce((preferred, entry) => {
    if (entry.valueNum === null || !Number.isFinite(entry.valueNum)) return preferred;
    if (preferred.valueNum === null || !Number.isFinite(preferred.valueNum)) return entry;

    const isBetter = higherIsBetter
      ? entry.valueNum > preferred.valueNum
      : entry.valueNum < preferred.valueNum;

    return isBetter ? entry : preferred;
  });
}

export type MatrixCellAggregateValues = {
  /** 中位数对应的那条真实记录，raw / note / source / benchTime 都应跟着它走，避免数值与展示串到不同记录上 */
  entry: MatrixCellEntry | null;
  valueNum: number | null;
  valueNum2: number | null;
};

export type MatrixCellAggregateMode = "median" | "latest";
export type SourceValueMode = "latest" | "max";

function isPairMatrixCellEntry(entry: MatrixCellEntry): boolean {
  return entry.valueNum2 !== null || hasMatrixCellPairRawValue(entry.valueRaw);
}

export function resolveMatrixCellAggregateMode(source: string | null | undefined): MatrixCellAggregateMode {
  return isArtificialAnalysisSource(source) ? "latest" : "median";
}

export function resolveMatrixCellAggregateModeFromEntries(
  entries: ReadonlyArray<{ source?: string | null }>
): MatrixCellAggregateMode {
  const sources = entries
    .map((entry) => entry.source)
    .filter((source): source is string => typeof source === "string" && source.trim().length > 0);
  if (sources.length === 0) return "median";
  return sources.every((source) => isArtificialAnalysisSource(source)) ? "latest" : "median";
}

/** 同一 AA source 的多次导入只保留最新一条，再与其他 source 一起聚合 */
function collapseArtificialAnalysisEntries(entries: MatrixCellEntry[]): MatrixCellEntry[] {
  const aaEntries: MatrixCellEntry[] = [];
  const otherEntries: MatrixCellEntry[] = [];

  for (const entry of entries) {
    if (isArtificialAnalysisSource(entry.source)) {
      aaEntries.push(entry);
    } else {
      otherEntries.push(entry);
    }
  }

  if (aaEntries.length === 0) return entries;

  const latestAa = getLatestMatrixCellEntry(aaEntries);
  return latestAa ? [...otherEntries, latestAa] : otherEntries;
}

/**
 * 普通单值或单双值混合取中位数；偶数条时取指标方向上「更优」的那个中间值
 * （越大越优取较大者，越小越优取较小者），因此结果始终是真实存在的记录。
 * 双值只拿前值参与排序；纯双值集合仍整条记录择优，避免拼出不存在的数值对。
 * Artificial Analysis 按 source 取最新一次同步值，与当前页签无关。
 */
export function aggregateMatrixCellEntries(
  entries: MatrixCellEntry[],
  higherIsBetter = true,
  mode?: MatrixCellAggregateMode
): MatrixCellAggregateValues {
  const collapsedEntries = collapseArtificialAnalysisEntries(entries);
  const effectiveMode = mode ?? resolveMatrixCellAggregateModeFromEntries(collapsedEntries);

  if (collapsedEntries.length === 0) {
    return { entry: null, valueNum: null, valueNum2: null };
  }

  if (effectiveMode === "latest") {
    return aggregateLatestMatrixCellEntry(collapsedEntries);
  }

  return aggregateMedianMatrixCellEntries(collapsedEntries, higherIsBetter);
}

function aggregateLatestMatrixCellEntry(entries: MatrixCellEntry[]): MatrixCellAggregateValues {
  const latest = getLatestMatrixCellEntry(entries);
  if (!latest) {
    return { entry: null, valueNum: null, valueNum2: null };
  }

  const latestValueNum = latest.valueNum;
  const latestValueNum2 = latest.valueNum2;

  return {
    entry: latest,
    valueNum: latestValueNum !== null && Number.isFinite(latestValueNum) ? latestValueNum : null,
    valueNum2: latestValueNum2 !== null && Number.isFinite(latestValueNum2) ? latestValueNum2 : null
  };
}

function aggregateMedianMatrixCellEntries(
  entries: MatrixCellEntry[],
  higherIsBetter: boolean
): MatrixCellAggregateValues {
  const numericEntries = entries.filter(
    (entry) => entry.valueNum !== null && Number.isFinite(entry.valueNum)
  );

  if (numericEntries.length === 0) {
    return { entry: null, valueNum: null, valueNum2: null };
  }

  if (numericEntries.every(isPairMatrixCellEntry)) {
    const preferred = getPreferredMatrixCellEntry(numericEntries, higherIsBetter);
    const preferredValueNum = preferred?.valueNum ?? null;
    const preferredValueNum2 = preferred?.valueNum2 ?? null;

    return {
      entry: preferred,
      valueNum: preferredValueNum !== null && Number.isFinite(preferredValueNum) ? preferredValueNum : null,
      valueNum2: preferredValueNum2 !== null && Number.isFinite(preferredValueNum2) ? preferredValueNum2 : null
    };
  }

  const sorted = [...numericEntries].sort((left, right) => {
    if (left.valueNum !== right.valueNum) {
      return (left.valueNum as number) - (right.valueNum as number);
    }
    // 数值相同时取更新的一条，让 source / benchTime 归属落在最新记录上
    return compareMatrixCellEntryRecency(right, left);
  });

  // 奇数条时两个下标重合；偶数条时按指标方向偏向更优的一侧
  const medianIndex = higherIsBetter
    ? Math.floor(sorted.length / 2)
    : Math.ceil(sorted.length / 2) - 1;
  const medianEntry = sorted[medianIndex];
  const medianValueNum2 = medianEntry.valueNum2;

  return {
    entry: medianEntry,
    valueNum: medianEntry.valueNum,
    valueNum2: medianValueNum2 !== null && Number.isFinite(medianValueNum2) ? medianValueNum2 : null
  };
}

export function compareMatrixCellEntryRecency(left: MatrixCellEntry, right: MatrixCellEntry): number {
  const leftTime = parseTimestampMs(left.benchTime);
  const rightTime = parseTimestampMs(right.benchTime);

  if (leftTime !== rightTime) {
    if (leftTime === null) return -1;
    if (rightTime === null) return 1;
    return leftTime - rightTime;
  }

  const leftId = typeof left.recordId === "number" ? left.recordId : null;
  const rightId = typeof right.recordId === "number" ? right.recordId : null;

  if (leftId !== rightId) {
    if (leftId === null) return -1;
    if (rightId === null) return 1;
    return leftId - rightId;
  }

  return 0;
}

export function getLatestMatrixCellEntry(entries: MatrixCellEntry[]): MatrixCellEntry | null {
  if (entries.length === 0) return null;

  // 占位记录（"-"、"N/A" 等）不应遮住更早的有效值，全是占位时才回退到全量
  const meaningful = entries.filter((entry) => hasMeaningfulMatrixRawValue(entry.valueRaw));
  const candidates = meaningful.length > 0 ? meaningful : entries;

  return candidates.reduce((latest, entry) =>
    compareMatrixCellEntryRecency(entry, latest) > 0 ? entry : latest
  );
}

export function getSourceValueEntry(
  entries: MatrixCellEntry[],
  activeSource: string,
  higherIsBetter = true,
  mode: SourceValueMode = "latest"
): MatrixCellEntry | null {
  if (activeSource === SOURCE_ALL) {
    return getPreferredMatrixCellEntry(entries, higherIsBetter);
  }
  const filtered = entries.filter((item) => getSourceKey(item.source) === activeSource);
  if (mode === "max") {
    return filtered.reduce<MatrixCellEntry | null>((maximum, entry) => {
      if (entry.valueNum === null || !Number.isFinite(entry.valueNum)) return maximum;
      if (!maximum || maximum.valueNum === null || !Number.isFinite(maximum.valueNum)) return entry;
      return entry.valueNum > maximum.valueNum ? entry : maximum;
    }, null) ?? getLatestMatrixCellEntry(filtered);
  }
  // 同一 source 下多次导入时取最新一次，而非指标方向上的最优值
  return getLatestMatrixCellEntry(filtered);
}

export function getSourceValueDeltaRaw(
  entries: MatrixCellEntry[],
  activeSource: string,
  higherIsBetter = true,
  mode: SourceValueMode = "latest"
): number | null {
  const sourceEntry = getSourceValueEntry(entries, activeSource, higherIsBetter, mode);
  const aggregate = aggregateMatrixCellEntries(entries, higherIsBetter);

  if (!sourceEntry || sourceEntry.valueNum === null || aggregate.valueNum === null) {
    return null;
  }

  const delta = sourceEntry.valueNum - aggregate.valueNum;
  if (!Number.isFinite(delta) || Math.abs(delta) < Number.EPSILON) {
    return null;
  }

  return delta;
}

export function getSourceValueDisplayItem(
  entries: MatrixCellEntry[],
  activeSource: string,
  higherIsBetter = true,
  mode: SourceValueMode = "latest"
): SourceValueDisplayItem | null {
  const entry = getSourceValueEntry(entries, activeSource, higherIsBetter, mode);

  if (!entry) {
    return null;
  }

  const displayValue = getMatrixCellDisplayValue(entry.valueNum, entry.valueNum2, entry.valueRaw, entry.valueNote);

  return {
    displayValue
  };
}

export function parseTimestampMs(value?: string | null): number | null {
  if (!value) return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}


export function normalizeBenchmarkKeyFallback(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SUPERSCRIPT_SUBSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX = new RegExp(`[${SUPERSCRIPT_SUBSCRIPT_DIGITS}]`, "g");
const SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (let index = 0; index < SUPERSCRIPT_SUBSCRIPT_DIGITS.length; index += 1) {
    map[SUPERSCRIPT_SUBSCRIPT_DIGITS[index]!] = String(index % 10);
  }
  return map;
})();

export function normalizeBenchmarkDuplicateToken(input: string): string {
  const normalizedDigits = input.replace(
    SUPERSCRIPT_SUBSCRIPT_DIGIT_REGEX,
    (val) => SUPERSCRIPT_SUBSCRIPT_DIGIT_MAP[val] ?? val
  );

  return normalizedDigits
    .trim()
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9().@^]+/g, "");
}

export function pickPreferredBenchmarkDisplayName(current: string, candidate: string): string {
  const currentTrimmed = current.trim();
  const candidateTrimmed = candidate.trim();
  if (!currentTrimmed) return candidateTrimmed;
  if (!candidateTrimmed) return currentTrimmed;

  const currentHasParentheses = /[（(][^()（）]+[)）]/.test(currentTrimmed);
  const candidateHasParentheses = /[（(][^()（）]+[)）]/.test(candidateTrimmed);

  if (currentHasParentheses !== candidateHasParentheses) {
    return currentHasParentheses ? candidateTrimmed : currentTrimmed;
  }

  return currentTrimmed.length <= candidateTrimmed.length ? currentTrimmed : candidateTrimmed;
}

export function getBenchmarkDuplicateKey(canonicalKey: string | null | undefined, benchmarkName: string): string {
  const normalizedCanonical = canonicalKey?.trim().toLowerCase() ?? "";
  if (normalizedCanonical.length > 0) {
    const splitIndex = normalizedCanonical.indexOf(":");
    if (splitIndex > 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical.slice(0, splitIndex));
      if (token.length > 0) return token;
    }
    if (splitIndex < 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical);
      if (token.length > 0) return token;
    }
  }

  const fallbackToken = normalizeBenchmarkDuplicateToken(benchmarkName);
  if (fallbackToken.length > 0) {
    return fallbackToken;
  }

  const fallback = normalizeBenchmarkKeyFallback(benchmarkName);
  return fallback.length > 0 ? fallback : benchmarkName.trim().toLowerCase();
}

/**
 * merged 分组键的两级缓存。
 *
 * 一次渲染链里有六七个 selector 各自把全量行遍历一遍求分组键，而键只由
 * (benchmarkCanonicalKey, benchmarkName) 决定 —— 两万行里通常只有几百个唯一组合，
 * 且 getBenchmarkDuplicateKey 走的是多个正则替换，重复求值代价明显。
 *
 * 第一级按 row 对象引用命中，省掉拼接缓存键的开销；未命中时回落到第二级按字段值命中，
 * 让不同 row（含 applySourceMeta 投影出的副本）之间也能复用同一次计算。
 * 这两个字段在 toMatrixInputRow / applySourceMeta 里都是构造新对象时写入、从不原地改写，
 * 所以按对象引用缓存不会读到过期值。
 */
const mergedGroupingKeyByRow = new WeakMap<object, string>();
const mergedGroupingKeyByBenchmark = new Map<string, string>();
/** 仅作无界增长兜底：benchmark 种类天然有限，真触到上限就整表丢弃重建 */
const MERGED_GROUPING_KEY_CACHE_LIMIT = 20000;

function getMergedGroupingKey(
  row: Pick<MatrixInputRow, "benchmarkName" | "benchmarkCanonicalKey">
): string {
  const cachedByRow = mergedGroupingKeyByRow.get(row);
  if (cachedByRow !== undefined) return cachedByRow;

  const canonicalKey = row.benchmarkCanonicalKey ?? "";
  // 用长度前缀而不是分隔符拼接，既避免 ("a","bc") 与 ("ab","c") 撞车，
  // 也不必往源码里塞不可见字符
  const cacheKey = `${canonicalKey.length}:${canonicalKey}${row.benchmarkName}`;
  let groupingKey = mergedGroupingKeyByBenchmark.get(cacheKey);

  if (groupingKey === undefined) {
    groupingKey = `merged::${getBenchmarkDuplicateKey(canonicalKey, row.benchmarkName)}`;
    if (mergedGroupingKeyByBenchmark.size >= MERGED_GROUPING_KEY_CACHE_LIMIT) {
      mergedGroupingKeyByBenchmark.clear();
    }
    mergedGroupingKeyByBenchmark.set(cacheKey, groupingKey);
  }

  mergedGroupingKeyByRow.set(row, groupingKey);
  return groupingKey;
}

export function getMatrixGroupingKey(
  row: Pick<MatrixInputRow, "benchmarkType" | "benchmarkName" | "benchmarkCanonicalKey">,
  showDuplicateRows: boolean
): string {
  if (showDuplicateRows) {
    const category = row.benchmarkType || "General";
    return `raw::${category}::${row.benchmarkName}`;
  }

  return getMergedGroupingKey(row);
}

export function normalizeModalityList(input: string[] | undefined, benchmarkType: string): string[] {
  return normalizeModalityListShared(input, benchmarkType);
}

export function renderModalityBadge(modalityInput: string, key: string) {
  const modality = normalizeModalityName(modalityInput);

  if (modality === "Text") {
    return (
      <span key={key} className="inline-flex items-center rounded-md px-1 text-[10px] opacity-70" title="Text">
        T
      </span>
    );
  }

  if (modality === "Vision") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title="Vision">
        <Eye size={11} />
      </span>
    );
  }

  if (modality === "Audio") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-purple-500/15 px-1.5 py-0.5 text-purple-300" title="Audio">
        <Headphones size={11} />
      </span>
    );
  }

  if (modality === "Video") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300" title="Video">
        <Video size={11} />
      </span>
    );
  }

  return (
    <span
      key={key}
      className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
      title="Multimodal"
    >
      <Layers size={11} />
    </span>
  );
}

const MATCH_TOKEN_CACHE_LIMIT = 4096;
const matchTokenCache = new Map<string, string>();

/**
 * 页签配色、来源匹配等热路径会在成千上万行上反复问同一批模型名，
 * 而这里的正则替换本身会分配临时字符串。唯一输入只有几百个，缓存即可摊平。
 */
export function normalizeMatchToken(input: string): string {
  const cached = matchTokenCache.get(input);
  if (cached !== undefined) return cached;

  const result = input.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (matchTokenCache.size >= MATCH_TOKEN_CACHE_LIMIT) {
    matchTokenCache.clear();
  }
  matchTokenCache.set(input, result);
  return result;
}

export function hasMeaningfulMatrixRawValue(rawValue: string): boolean {
  const normalized = rawValue.trim();
  if (!normalized) return false;

  return !isImportValueEmptyMarker(normalized);
}

export function getMatrixCellValueIdentity(entry: MatrixCellEntry): string {
  if (entry.valueNum !== null || entry.valueNum2 !== null) {
    return `num:${entry.valueNum ?? ""}|${entry.valueNum2 ?? ""}`;
  }

  return `raw:${entry.valueRaw}`;
}

export function getMatrixCellSourceValueDedupKey(entry: MatrixCellEntry): string {
  return `${entry.source ?? ""}__${getMatrixCellValueIdentity(entry)}`;
}

export function isCompareModifierClick(event: Pick<React.MouseEvent<HTMLElement>, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}

export function isSelectionModifierClick(event: Pick<React.MouseEvent<HTMLElement>, "shiftKey">): boolean {
  return event.shiftKey;
}

export function clampCompareIntensity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getCompareDeltaBadgeStyle(
  direction: CompareDirection,
  intensity: number,
  exportMode: boolean
): {
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  separatorColor: string;
  boxShadow: string;
  textShadow: string;
  textStroke: string;
} {
  const safeIntensity = clampCompareIntensity(intensity);

  if (direction === "flat") {
    const borderAlpha = exportMode ? 0.74 : 0.62;
    const color = "rgba(236, 241, 249, 0.98)";
    return {
      textColor: color,
      borderColor: `rgba(148, 163, 184, ${borderAlpha})`,
      backgroundColor: "rgba(19, 28, 45, 0.9)",
      separatorColor: "rgba(148, 163, 184, 0.58)",
      boxShadow: exportMode
        ? "0 0 0 1px rgba(148, 163, 184, 0.24), 0 1px 2px rgba(2, 6, 23, 0.64)"
        : "0 1px 2px rgba(2, 6, 23, 0.62), 0 0 8px rgba(2, 6, 23, 0.24)",
      textShadow: "0 1px 1px rgba(2, 6, 23, 0.9)",
      textStroke: "0.2px rgba(2, 6, 23, 0.8)"
    };
  }

  const bgStart = direction === "up" ? ([22, 76, 56] as const) : ([108, 26, 36] as const);
  const bgEnd = direction === "up" ? ([7, 94, 69] as const) : ([126, 19, 31] as const);
  const borderStart = direction === "up" ? ([45, 180, 132] as const) : ([241, 92, 113] as const);
  const borderEnd = direction === "up" ? ([52, 211, 153] as const) : ([248, 113, 113] as const);
  const textColor = direction === "up" ? "rgba(236, 253, 245, 0.98)" : "rgba(255, 241, 242, 0.98)";

  const [bgR, bgG, bgB] = blendColor(bgStart, bgEnd, safeIntensity);
  const [bdR, bdG, bdB] = blendColor(borderStart, borderEnd, safeIntensity);
  const borderAlpha = exportMode ? 0.9 : 0.84;
  const separatorAlpha = exportMode ? 0.78 : 0.65;
  const glowAlpha = exportMode ? 0.12 : 0.22;

  return {
    textColor,
    borderColor: `rgba(${bdR}, ${bdG}, ${bdB}, ${borderAlpha})`,
    backgroundColor: `rgba(${bgR}, ${bgG}, ${bgB}, 0.93)`,
    separatorColor: `rgba(${bdR}, ${bdG}, ${bdB}, ${separatorAlpha})`,
    boxShadow: exportMode
      ? `0 0 0 1px rgba(${bdR}, ${bdG}, ${bdB}, 0.22), 0 1px 2px rgba(2, 6, 23, 0.66)`
      : `0 1px 2px rgba(2, 6, 23, 0.62), 0 0 8px rgba(${bdR}, ${bdG}, ${bdB}, ${glowAlpha})`,
    textShadow: "0 1px 1px rgba(2, 6, 23, 0.88)",
    textStroke: "0.2px rgba(2, 6, 23, 0.85)"
  };
}
