export const HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeNameParenthesisSpacing(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(HYPHEN_VARIANT_REGEX, "-")
    .replace(/([^\s（(])([（(])/g, "$1 $2")
    .replace(/\s+([（(])/g, " $1");
}

/**
 * 查重槽位键（`model::benchmark`）。
 * 同一个 benchmark 只有一条实体，benchmarkType 只是分类标注，不参与查重。
 */
export function buildDuplicateNameSlotKey(modelName: string, benchmarkName: string): string {
  const normModel = normalizeNameParenthesisSpacing(modelName).trim().toLowerCase();
  const normBench = normalizeNameParenthesisSpacing(benchmarkName).trim().toLowerCase();
  return `${normModel}::${normBench}`;
}

export function normalizeImportSourceKey(source: string | null | undefined): string {
  if (!source) return "";
  const trimmed = source.trim().toLowerCase();
  if (trimmed.startsWith("text:")) {
    return trimmed.slice(5).trim();
  }
  return trimmed;
}

export function isSameImportSource(
  sourceA: string | null | undefined,
  sourceB: string | null | undefined
): boolean {
  return normalizeImportSourceKey(sourceA) === normalizeImportSourceKey(sourceB);
}

