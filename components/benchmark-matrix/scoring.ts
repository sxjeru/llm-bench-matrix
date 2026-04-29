import { LOWER_IS_BETTER_ASR_TYPE_REGEX, LOWER_IS_BETTER_RULES } from "./constants";
import type { OverallScoreDisplayItem } from "./types";
import { formatValueNumForDisplay } from "./formatters";

function isFleursZhTranslationBenchmark(benchmarkName: string): boolean {
  if (!/fleurs/i.test(benchmarkName)) return false;

  const normalized = benchmarkName
    .toLowerCase()
    .replace(/\s+/g, "");

  const hasBiDirectionalHint = /(?:⇄|↔|<->|<=>)/.test(normalized);

  return hasBiDirectionalHint;
}

export function isLowerBetterBenchmark(benchmarkName: string, benchmarkType?: string, higherIsBetter?: boolean): boolean {
  if (typeof higherIsBetter === "boolean") {
    return !higherIsBetter;
  }

  if (benchmarkType && LOWER_IS_BETTER_ASR_TYPE_REGEX.test(benchmarkType)) {
    return true;
  }

  if (/fleurs/i.test(benchmarkName)) {
    return !isFleursZhTranslationBenchmark(benchmarkName);
  }

  return LOWER_IS_BETTER_RULES.some((rule) => rule.test(benchmarkName));
}

export function getBenchmarkComparableScore(
  benchmarkName: string,
  valueNum: number,
  benchmarkType?: string,
  higherIsBetter?: boolean
): number {
  if (isLowerBetterBenchmark(benchmarkName, benchmarkType, higherIsBetter)) {
    return 100 - valueNum;
  }

  return valueNum;
}

export function getSortedQuantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;

  const clampedQ = Math.min(1, Math.max(0, q));
  const position = (sortedValues.length - 1) * clampedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  if (lowerIndex === upperIndex) return lower;

  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

export function buildDenseRankMap(
  items: Array<{ modelName: string; score: number | null }>,
  precision = 2
): Map<string, number> {
  const factor = 10 ** precision;

  const validItems = items
    .filter((item): item is { modelName: string; score: number } => item.score !== null && Number.isFinite(item.score))
    .map((item) => ({
      modelName: item.modelName,
      normalizedScore: Math.round(item.score * factor) / factor
    }))
    .sort((a, b) => b.normalizedScore - a.normalizedScore);

  const rankMap = new Map<string, number>();
  let rank = 0;
  let previousScore: number | null = null;

  validItems.forEach((item) => {
    if (previousScore === null || item.normalizedScore !== previousScore) {
      rank += 1;
      previousScore = item.normalizedScore;
    }

    rankMap.set(item.modelName, rank);
  });

  return rankMap;
}

export function buildOverallScoreDisplayDecimalsMap(items: OverallScoreDisplayItem[]): Map<string, 1 | 2> {
  const decimalsMap = new Map<string, 1 | 2>();
  const groupedByOneDecimal = new Map<string, OverallScoreDisplayItem[]>();

  items.forEach((item) => {
    decimalsMap.set(item.modelName, 1);

    if (item.rawScore === null || item.rawRank === null || !Number.isFinite(item.rawScore)) return;

    const oneDecimalKey = item.rawScore.toFixed(1);
    if (!groupedByOneDecimal.has(oneDecimalKey)) {
      groupedByOneDecimal.set(oneDecimalKey, []);
    }
    groupedByOneDecimal.get(oneDecimalKey)!.push(item);
  });

  groupedByOneDecimal.forEach((groupItems) => {
    if (groupItems.length < 2) return;

    const distinctRanks = new Set(groupItems.map((item) => item.rawRank));
    if (distinctRanks.size > 1) {
      groupItems.forEach((item) => {
        decimalsMap.set(item.modelName, 2);
      });
    }
  });

  return decimalsMap;
}

export function __buildOverallScoreDisplayDecimalsMapForTest(items: OverallScoreDisplayItem[]): Map<string, 1 | 2> {
  return buildOverallScoreDisplayDecimalsMap(items);
}

export function getMatrixCellDisplayValue(
  valueNum: number | null,
  valueNum2: number | null,
  rawValue: string,
  valueNote: string | null
): string {
  const raw = rawValue.trim();
  if (!raw) return "--";

  const hasStarMarker = /[*∗﹡✱✳✻]/.test(raw);
  const pairMatch = raw.match(
    /^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );

  if (pairMatch) {
    const [, first, second] = pairMatch;
    const hasCurrencySymbol = /[$¥€£]/.test(first) || /[$¥€£]/.test(second);

    if (hasCurrencySymbol) {
      return `${first.trim()} / ${second.trim()}`;
    }

    const firstNumeric = formatValueNumForDisplay(valueNum);
    const secondNumeric = formatValueNumForDisplay(valueNum2);

    if (firstNumeric !== null && secondNumeric !== null) {
      return `${firstNumeric} / ${secondNumeric}`;
    }

    return `${first.trim()} / ${second.trim()}`;
  }

  const currencySingleMatch = raw.match(/^((?:[$¥€£]\s*)[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (currencySingleMatch) {
    const [, value, tail] = currencySingleMatch;
    const tailText = tail.trim();

    if (!tailText) return value.trim();
    if (tailText === "*" || tailText.startsWith("*")) return `${value.trim()}*`;
    if (valueNote && valueNote.trim().length > 0) return value.trim();

    return `${value.trim()}${tailText}`;
  }

  const numericDisplay = formatValueNumForDisplay(valueNum);
  if (numericDisplay !== null) {
    const hasHashPrefix = /^[#＃]/.test(raw);
    const prefix = hasHashPrefix ? raw.match(/^[#＃]+/)?.[0] ?? "" : "";
    return hasStarMarker ? `${prefix}${numericDisplay}*` : `${prefix}${numericDisplay}`;
  }

  const singleMatch = raw.match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (singleMatch) {
    const [, value, tail] = singleMatch;
    const tailText = tail.trim();

    if (!tailText) return value;
    if (tailText === "*" || tailText.startsWith("*")) return `${value}*`;
    if (valueNote && valueNote.trim().length > 0) return value;

    return `${value}${tailText}`;
  }

  return raw;
}
