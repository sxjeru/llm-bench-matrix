import {
  BENCHMARK_NAME_REPLACERS,
  HARDCODED_BENCHMARK_ALIAS_RULES,
  LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX,
  LOWER_IS_BETTER_PREVIEW_RULES,
  OMNIDOCBENCH_15_MATCHER
} from "../constants";
import type { MergedRecord } from "../types";

export function getTextImportBenchmarkKey(benchmarkName: string, benchmarkType: string): string {
  return `${benchmarkName}@@${benchmarkType}`;
}

export function getBenchmarkExactLookupKey(benchmarkName: string, benchmarkType: string): string {
  return `${benchmarkName.trim().toLowerCase()}@@${benchmarkType.trim().toLowerCase()}`;
}

export function removeParenthesesContent(input: string): string {
  return input.replace(/\([^)]*\)/g, " ").replace(/（[^）]*）/g, " ").replace(/\s+/g, " ").trim();
}

export function buildBenchmarkCompareKey(input: string): string {
  let normalized = removeParenthesesContent(input).toLowerCase().trim();

  BENCHMARK_NAME_REPLACERS.forEach((pattern) => {
    normalized = normalized.replace(pattern, " ");
  });

  normalized = normalized
    .replace(/[\/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

export function isFleursZhTranslationPreviewBenchmark(benchmarkName: string): boolean {
  if (!/fleurs/i.test(benchmarkName)) return false;

  const normalized = benchmarkName
    .toLowerCase()
    .replace(/\s+/g, "");

  const hasBiDirectionalHint = /(?:⇄|↔|<->|<=>)/.test(normalized);

  return hasBiDirectionalHint;
}

export function isLowerBetterPreviewBenchmark(benchmarkName: string, benchmarkType?: string): boolean {
  if (benchmarkType && LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX.test(benchmarkType)) {
    return true;
  }

  if (/fleurs/i.test(benchmarkName)) {
    return !isFleursZhTranslationPreviewBenchmark(benchmarkName);
  }

  return LOWER_IS_BETTER_PREVIEW_RULES.some((rule) => rule.test(benchmarkName));
}

export function getOmniDocBenchNormalizeHint(benchmarkName: string, rawValue: string): string | null {
  if (!OMNIDOCBENCH_15_MATCHER.test(benchmarkName)) return null;

  const numeric = Number.parseFloat(rawValue.trim().replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 1) return null;

  const normalized = Number(((100 - numeric) / 100).toFixed(6));
  return String(normalized);
}

export function resolveHardcodedBenchmarkAliasTarget(input: string): string | null {
  for (const rule of HARDCODED_BENCHMARK_ALIAS_RULES) {
    if (rule.pattern.test(input)) {
      return rule.targetName;
    }
  }

  return null;
}

export function buildHyphenInsensitiveKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

export function getBenchmarkSearchCandidateIds(
  inputValue: string,
  benchmarkType: string,
  benchmarks: Array<{ id: number; benchmarkName: string; benchmarkType: string }>
): number[] {
  const normalizedInput = inputValue.trim().toLowerCase();
  const inputCompareKey = buildBenchmarkCompareKey(inputValue);
  const inputHyphenInsensitiveKey = buildHyphenInsensitiveKey(inputValue);
  if (!normalizedInput && !inputCompareKey && !inputHyphenInsensitiveKey) return [];

  return benchmarks
    .map((item, index) => {
      const nameLower = item.benchmarkName.toLowerCase();
      const typeLower = item.benchmarkType.toLowerCase();
      const labelLower = `${item.benchmarkName} [${item.benchmarkType}]`.toLowerCase();
      const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
      const hyphenInsensitiveKey = buildHyphenInsensitiveKey(item.benchmarkName);
      let score = 0;

      if (nameLower === normalizedInput && item.benchmarkType === benchmarkType) {
        score += 100;
      } else if (nameLower === normalizedInput) {
        score += 90;
      }

      if (compareKey && inputCompareKey && compareKey === inputCompareKey) {
        score += 80;
      }

      if (hyphenInsensitiveKey && inputHyphenInsensitiveKey && hyphenInsensitiveKey === inputHyphenInsensitiveKey) {
        score += 70;
      }

      if (normalizedInput && labelLower.includes(normalizedInput)) {
        score += 50;
      }

      if (normalizedInput && (nameLower.includes(normalizedInput) || typeLower.includes(normalizedInput))) {
        score += 40;
      }

      if (compareKey && inputCompareKey && (compareKey.includes(inputCompareKey) || inputCompareKey.includes(compareKey))) {
        score += 30;
      }

      if (
        hyphenInsensitiveKey && inputHyphenInsensitiveKey &&
        (hyphenInsensitiveKey.includes(inputHyphenInsensitiveKey) || inputHyphenInsensitiveKey.includes(hyphenInsensitiveKey))
      ) {
        score += 25;
      }

      const hasNameMatch = score > 0;

      if (hasNameMatch && item.benchmarkType === benchmarkType) {
        score += 10;
      }

      return hasNameMatch ? { id: item.id, score, index } : null;
    })
    .filter((item): item is { id: number; score: number; index: number } => item !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 30)
    .map((item) => item.id);
}

export function getMergedBenchmarkRecordsForSourceName(
  inputValue: string,
  mergedRecords: MergedRecord[]
): MergedRecord[] {
  const normalizedInput = inputValue.trim().toLowerCase();
  if (!normalizedInput) return [];

  return mergedRecords.filter((record) => (
    record.entityType === "benchmark"
    && record.sourceName.trim().toLowerCase() === normalizedInput
  ));
}

export function getMergedBenchmarkTargetIdsBySourceName(
  mergedRecords: MergedRecord[]
): Map<string, number[]> {
  const map = new Map<string, number[]>();

  mergedRecords.forEach((record) => {
    if (record.entityType !== "benchmark") return;

    const key = record.sourceName.trim().toLowerCase();
    if (!key) return;

    const existing = map.get(key) ?? [];
    if (!existing.includes(record.targetId)) {
      existing.push(record.targetId);
    }
    map.set(key, existing);
  });

  return map;
}

export function formatMergedBenchmarkCandidateLabel(sourceName: string, targetLabel: string): string {
  return `${sourceName} -> ${targetLabel}`;
}

