import { DEFAULT_MODEL_DEDUPE_RULE, MODEL_HYPHEN_VARIANT_REGEX } from "../constants";
import type { MergedRecord, ModelDedupeRule } from "../types";

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
  const inputVariants = Array.from(new Set([
    input.trim(),
    input.replace(/[（(][^()（）]*[)）]/g, " ").replace(/\s+/g, " ").trim()
  ]))
    .map((value) => ({
      normalized: value.toLowerCase(),
      compare: buildModelCompareKey(value)
    }))
    .filter((value) => value.normalized || value.compare);

  if (inputVariants.length === 0) {
    return [];
  }

  return models
    .map((model) => {
      const normalizedName = model.modelName.trim().toLowerCase();
      const compareName = buildModelCompareKey(model.modelName);

      const score = inputVariants.reduce((bestScore, variant, variantIndex) => {
        let matchScore = Number.POSITIVE_INFINITY;
        if (normalizedName === variant.normalized || compareName === variant.compare) {
          matchScore = 0;
        } else if (normalizedName.startsWith(variant.normalized)) {
          matchScore = 1;
        } else if (variant.compare && compareName.startsWith(variant.compare)) {
          matchScore = 2;
        } else if (normalizedName.includes(variant.normalized)) {
          matchScore = 3;
        } else if (variant.compare && compareName.includes(variant.compare)) {
          matchScore = 4;
        }

        return Math.min(bestScore, matchScore * inputVariants.length + variantIndex);
      }, Number.POSITIVE_INFINITY);

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

export function getMergedModelRecordsForSourceName(
  inputValue: string,
  mergedRecords: MergedRecord[]
): MergedRecord[] {
  const normalizedInput = inputValue.trim().toLowerCase();
  if (!normalizedInput) return [];

  return mergedRecords.filter((record) => (
    record.entityType === "model"
    && record.sourceName.trim().toLowerCase() === normalizedInput
  ));
}

export function getMergedModelTargetIdsBySourceName(
  mergedRecords: MergedRecord[]
): Map<string, number[]> {
  const map = new Map<string, number[]>();

  mergedRecords.forEach((record) => {
    if (record.entityType !== "model") return;

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

export function formatMergedModelCandidateLabel(sourceName: string, targetLabel: string): string {
  return `${sourceName} -> ${targetLabel}`;
}
