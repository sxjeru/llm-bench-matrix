export const SOURCE_ALL = "__ALL__";
export const SOURCE_EMPTY = "__EMPTY__";

export function getSourceKey(source: string | null | undefined): string {
  const cleaned = source?.trim();
  return cleaned ? cleaned : SOURCE_EMPTY;
}

export function getSourceLabel(sourceKey: string): string {
  if (sourceKey === SOURCE_EMPTY) {
    return "未标注";
  }
  return sourceKey;
}

export function sourceTabDisplayLabel(sourceKey: string): string {
  const rawLabel = getSourceLabel(sourceKey);
  const colonIndex = rawLabel.indexOf(":");
  if (colonIndex < 0) return rawLabel;

  const stripped = rawLabel.slice(colonIndex + 1).trim();
  return stripped.length > 0 ? stripped : rawLabel;
}

const ARTIFICIAL_ANALYSIS_SOURCE_CACHE_LIMIT = 4096;
const artificialAnalysisSourceCache = new Map<string, boolean>();

/** 按记录/页签的 source 识别 Artificial Analysis，不依赖当前打开的是哪个页签 */
export function isArtificialAnalysisSource(source: string | null | undefined): boolean {
  if (!source) return false;

  const cached = artificialAnalysisSourceCache.get(source);
  if (cached !== undefined) return cached;

  const sourceKey = source.trim().toLowerCase();
  const result =
    sourceKey === "artificial analysis"
    || sourceKey === "text:artificial analysis"
    || sourceTabDisplayLabel(source).trim().toLowerCase() === "artificial analysis";

  if (artificialAnalysisSourceCache.size >= ARTIFICIAL_ANALYSIS_SOURCE_CACHE_LIMIT) {
    artificialAnalysisSourceCache.clear();
  }
  artificialAnalysisSourceCache.set(source, result);
  return result;
}

const AA_SECONDARY_CATEGORY_SET = new Set(["cost", "performance"]);

export function isAaSecondaryCategory(category: string): boolean {
  return category.split(" / ").some((part) => AA_SECONDARY_CATEGORY_SET.has(part.trim().toLowerCase()));
}

export function normalizeTextImportSource(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("text:")) {
    const plain = trimmed.slice(5).trim();
    return plain ? `text:${plain}` : "text:";
  }

  return `text:${trimmed}`;
}

export function buildSourceLookupCandidates(source: string): string[] {
  const raw = source.trim();
  const normalized = normalizeTextImportSource(raw);
  const candidates = new Set<string>();

  if (raw) candidates.add(raw);
  if (normalized) {
    candidates.add(normalized);
    const unprefixed = normalized.slice(5).trim();
    if (unprefixed) candidates.add(unprefixed);
  }

  return Array.from(candidates);
}
