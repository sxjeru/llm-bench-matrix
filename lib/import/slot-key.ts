export const HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeNameParenthesisSpacing(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(HYPHEN_VARIANT_REGEX, "-")
    .replace(/([^\s（(])([（(])/g, "$1 $2")
    .replace(/\s+([（(])/g, " $1");
}

export function buildDuplicateSlotKey(modelName: string, benchmarkName: string): string {
  const normModel = normalizeNameParenthesisSpacing(modelName).trim().toLowerCase();
  const normBench = normalizeNameParenthesisSpacing(benchmarkName).trim().toLowerCase();
  return `${normModel}::${normBench}`;
}

