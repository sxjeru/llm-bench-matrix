const HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export type ModelDedupeRule = {
  lowercase: boolean;
  removeHyphen: boolean;
  removeSpace: boolean;
  removeDot: boolean;
};

export const DEFAULT_MODEL_DEDUPE_RULE: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: true,
  removeSpace: true,
  removeDot: false
};

export function normalizeModelDedupeRule(raw: unknown): ModelDedupeRule {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MODEL_DEDUPE_RULE };
  }

  const candidate = raw as Partial<ModelDedupeRule>;
  return {
    lowercase: typeof candidate.lowercase === "boolean" ? candidate.lowercase : DEFAULT_MODEL_DEDUPE_RULE.lowercase,
    removeHyphen: typeof candidate.removeHyphen === "boolean" ? candidate.removeHyphen : DEFAULT_MODEL_DEDUPE_RULE.removeHyphen,
    removeSpace: typeof candidate.removeSpace === "boolean" ? candidate.removeSpace : DEFAULT_MODEL_DEDUPE_RULE.removeSpace,
    removeDot: typeof candidate.removeDot === "boolean" ? candidate.removeDot : DEFAULT_MODEL_DEDUPE_RULE.removeDot
  };
}

export function normalizeModelNameForDedupe(modelName: string, rule: ModelDedupeRule = DEFAULT_MODEL_DEDUPE_RULE): string {
  let normalized = modelName.trim();

  normalized = normalized.replace(HYPHEN_VARIANT_REGEX, "-");

  if (rule.lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (rule.removeHyphen) {
    normalized = normalized.replace(/-/g, "");
  }
  if (rule.removeSpace) {
    normalized = normalized.replace(/\s+/g, "");
  }
  if (rule.removeDot) {
    normalized = normalized.replace(/\./g, "");
  }

  return normalized;
}

export function normalizeTextByDedupeRule(input: string, rule: ModelDedupeRule = DEFAULT_MODEL_DEDUPE_RULE): string {
  return normalizeModelNameForDedupe(input, rule);
}

export function toProviderSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildModelCanonicalKey(modelName: string, rule: ModelDedupeRule = DEFAULT_MODEL_DEDUPE_RULE): string {
  return normalizeModelNameForDedupe(modelName, rule);
}

export function buildBenchmarkCanonicalKey(
  benchmarkName: string,
  benchmarkType: string,
  rule: ModelDedupeRule = DEFAULT_MODEL_DEDUPE_RULE
): string {
  return `${normalizeTextByDedupeRule(benchmarkName, rule)}:${normalizeTextByDedupeRule(benchmarkType, rule)}`;
}
