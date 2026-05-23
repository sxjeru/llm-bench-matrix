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
