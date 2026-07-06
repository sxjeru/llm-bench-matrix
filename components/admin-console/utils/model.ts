import { DEFAULT_MODEL_DEDUPE_RULE, MODEL_HYPHEN_VARIANT_REGEX } from "../constants";
import type { ModelDedupeRule } from "../types";

export function normalizeModelDedupeRule(raw: unknown): ModelDedupeRule {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MODEL_DEDUPE_RULE };
  }

  const candidate = raw as Partial<ModelDedupeRule>;
  return {
    lowercase:
      typeof candidate.lowercase === "boolean"
        ? candidate.lowercase
        : DEFAULT_MODEL_DEDUPE_RULE.lowercase,
    removeHyphen:
      typeof candidate.removeHyphen === "boolean"
        ? candidate.removeHyphen
        : DEFAULT_MODEL_DEDUPE_RULE.removeHyphen,
    removeSpace:
      typeof candidate.removeSpace === "boolean"
        ? candidate.removeSpace
        : DEFAULT_MODEL_DEDUPE_RULE.removeSpace,
    removeDot:
      typeof candidate.removeDot === "boolean"
        ? candidate.removeDot
        : DEFAULT_MODEL_DEDUPE_RULE.removeDot
  };
}

export function buildModelCompareKey(input: string): string {
  return input
    .toLowerCase()
    .replace(MODEL_HYPHEN_VARIANT_REGEX, "")
    .replace(/[\s\.]/g, "")
    .trim();
}

export function getModelSearchCandidateIds(
  input: string,
  models: Array<{ id: number; modelName: string }>,
  limit = 30
): number[] {
  const normalizedInput = input.trim().toLowerCase();
  const compareInput = buildModelCompareKey(input);

  if (!normalizedInput && !compareInput) {
    return [];
  }

  return models
    .map((model) => {
      const normalizedName = model.modelName.trim().toLowerCase();
      const compareName = buildModelCompareKey(model.modelName);

      let score = Number.POSITIVE_INFINITY;
      if (normalizedName === normalizedInput || compareName === compareInput) {
        score = 0;
      } else if (normalizedName.startsWith(normalizedInput)) {
        score = 1;
      } else if (compareInput && compareName.startsWith(compareInput)) {
        score = 2;
      } else if (normalizedName.includes(normalizedInput)) {
        score = 3;
      } else if (compareInput && compareName.includes(compareInput)) {
        score = 4;
      }

      return { model, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.model.modelName.localeCompare(b.model.modelName, "zh-Hans-CN");
    })
    .slice(0, limit)
    .map((item) => item.model.id);
}

export function normalizeModelNameByDedupeRule(input: string, rule: ModelDedupeRule): string {
  let normalized = input.trim().replace(MODEL_HYPHEN_VARIANT_REGEX, "-");

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
