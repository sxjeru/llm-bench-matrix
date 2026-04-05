function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
  removeDot: true
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

export function toProviderSlug(name: string): string {
  return normalizeToken(name);
}

export function buildModelCanonicalKey(modelName: string, rule: ModelDedupeRule = DEFAULT_MODEL_DEDUPE_RULE): string {
  return normalizeModelNameForDedupe(modelName, rule);
}

export function buildBenchmarkCanonicalKey(benchmarkName: string, benchmarkType: string): string {
  return `${normalizeToken(benchmarkName)}:${normalizeToken(benchmarkType)}`;
}
