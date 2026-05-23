import {
  BENCHMARK_NAME_REPLACERS,
  HARDCODED_BENCHMARK_ALIAS_RULES,
  LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX,
  LOWER_IS_BETTER_PREVIEW_RULES,
  OMNIDOCBENCH_15_MATCHER
} from "../constants";

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
