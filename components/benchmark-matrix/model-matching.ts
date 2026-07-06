import { MODEL_FLASH_LITE_PATTERN, MODEL_SIZE_TOKEN_PATTERN, MODEL_VERSION_TOKEN_PATTERN, MATCH_HYPHEN_VARIANT_REGEX } from "./constants";
import type { ModelScaleToken, ModelTierToken, ModelVariantToken, ModelVersionToken } from "./types";
import { sourceTabDisplayLabel } from "./utils";

const MODEL_TIER_PRIORITY: Record<ModelTierToken["tier"], number> = {
  mythos: 5,
  fable: 4,
  opus: 3,
  sonnet: 2,
  haiku: 1
};

function normalizePreviewOrderToken(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparePreviewModelOrder(left: string, right: string): number {
  const leftNormalized = normalizePreviewOrderToken(left);
  const rightNormalized = normalizePreviewOrderToken(right);
  const leftIsPreview = /\bpreview\b/.test(leftNormalized);
  const rightIsPreview = /\bpreview\b/.test(rightNormalized);

  if (leftIsPreview === rightIsPreview) {
    return 0;
  }

  const leftBase = leftNormalized.replace(/\bpreview\b/g, " ").replace(/\s+/g, " ").trim();
  const rightBase = rightNormalized.replace(/\bpreview\b/g, " ").replace(/\s+/g, " ").trim();
  if (!leftBase || leftBase !== rightBase) {
    return 0;
  }

  return leftIsPreview ? 1 : -1;
}

export function extractModelVersionToken(modelName: string): ModelVersionToken | null {
  const trimmed = modelName.trim();
  const match = MODEL_VERSION_TOKEN_PATTERN.exec(trimmed)
    ?? /^([A-Za-z][A-Za-z\s_-]*?)(\d+(?:\.\d+)?)(?=\D|$)/.exec(trimmed);
  if (!match) {
    return null;
  }

  const [, family, versionText] = match;
  const version = Number.parseFloat(versionText);
  if (!Number.isFinite(version)) {
    return null;
  }

  const familyKey = family
    .replace(/[\s_-]+$/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!familyKey) {
    return null;
  }

  return {
    familyKey,
    version
  };
}

export function compareSourceTabKeysByVersion(leftKey: string, rightKey: string): number {
  const leftLabel = sourceTabDisplayLabel(leftKey);
  const rightLabel = sourceTabDisplayLabel(rightKey);

  const leftVersionToken = extractModelVersionToken(leftLabel);
  const rightVersionToken = extractModelVersionToken(rightLabel);
  const tierCompare = compareTieredModelByVersionThenTier(leftLabel, rightLabel);
  if (tierCompare !== 0) {
    return tierCompare;
  }

  if (
    leftVersionToken &&
    rightVersionToken &&
    leftVersionToken.familyKey === rightVersionToken.familyKey
  ) {
    if (rightVersionToken.version !== leftVersionToken.version) {
      return rightVersionToken.version - leftVersionToken.version;
    }

    const leftVariantToken = extractModelVariantToken(leftLabel);
    const rightVariantToken = extractModelVariantToken(rightLabel);
    if (
      leftVariantToken &&
      rightVariantToken &&
      leftVariantToken.familyKey.length > 0 &&
      leftVariantToken.familyKey === rightVariantToken.familyKey
    ) {
      const variantCompare = compareModelVariantPriority(leftVariantToken.variant, rightVariantToken.variant);
      if (variantCompare !== 0) {
        return variantCompare;
      }
    }

    const scaleCompare = compareModelScaleSize(leftLabel, rightLabel);
    if (scaleCompare !== 0) {
      return scaleCompare;
    }

    const previewCompare = comparePreviewModelOrder(leftLabel, rightLabel);
    if (previewCompare !== 0) {
      return previewCompare;
    }
  }

  const labelCompare = leftLabel.localeCompare(rightLabel, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  if (labelCompare !== 0) return labelCompare;

  return leftKey.localeCompare(rightKey, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function extractModelScaleToken(modelName: string): ModelScaleToken | null {
  const match = MODEL_SIZE_TOKEN_PATTERN.exec(modelName);
  if (!match) {
    return null;
  }

  const [, estimatePrefix, sizeText] = match;
  const sizeInBillions = Number.parseFloat(sizeText);
  if (!Number.isFinite(sizeInBillions)) {
    return null;
  }

  const prefixKey = modelName
    .slice(0, match.index)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return {
    prefixKey,
    sizeInBillions,
    isEstimated: estimatePrefix.toLowerCase() === "e"
  };
}

function compareModelScaleSize(left: string, right: string): number {
  const leftScaleToken = extractModelScaleToken(left);
  const rightScaleToken = extractModelScaleToken(right);

  if (
    !leftScaleToken ||
    !rightScaleToken ||
    leftScaleToken.prefixKey.length === 0 ||
    leftScaleToken.prefixKey !== rightScaleToken.prefixKey
  ) {
    return 0;
  }

  if (rightScaleToken.sizeInBillions !== leftScaleToken.sizeInBillions) {
    return rightScaleToken.sizeInBillions - leftScaleToken.sizeInBillions;
  }

  if (leftScaleToken.isEstimated !== rightScaleToken.isEstimated) {
    return leftScaleToken.isEstimated ? 1 : -1;
  }

  return 0;
}

export function extractModelVariantToken(modelName: string): ModelVariantToken | null {
  const normalized = modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const variant: ModelVariantToken["variant"] = (() => {
    if (/\bultra\b/.test(normalized)) return "ultra";
    if (/\bsuper\b/.test(normalized)) return "super";
    if (/\bpro\b/.test(normalized)) return "pro";
    if (MODEL_FLASH_LITE_PATTERN.test(normalized)) return "flash-lite";
    if (/\bflash\b/.test(normalized)) return "flash";
    if (/\bmini\b/.test(normalized)) return "mini";
    if (/\bnano\b/.test(normalized)) return "nano";
    return "base";
  })();

  const variantMatch = normalized.match(MODEL_FLASH_LITE_PATTERN) ?? normalized.match(/\b(?:ultra|super|pro|flash|mini|nano)\b/);

  const familyKey = normalized
    .slice(0, variantMatch?.index ?? normalized.length)
    .replace(/\b\d+(?:\.\d+)+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!familyKey) return null;

  return {
    familyKey,
    variant
  };
}

export function compareModelVariantPriority(
  leftVariant: ModelVariantToken["variant"],
  rightVariant: ModelVariantToken["variant"]
): number {
  const priority: Record<ModelVariantToken["variant"], number> = {
    ultra: 8,
    super: 7,
    pro: 6,
    base: 5,
    flash: 4,
    mini: 3,
    nano: 2,
    "flash-lite": 1
  };

  return priority[rightVariant] - priority[leftVariant];
}

export function extractModelTierToken(modelName: string): ModelTierToken | null {
  const normalized = modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tierMatch = normalized.match(/\b(mythos|fable|opus|sonnet|haiku)\b/);
  if (!tierMatch) return null;

  const familyKey = normalized
    .slice(0, tierMatch.index)
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!familyKey) return null;

  return {
    familyKey,
    tier: tierMatch[1] as ModelTierToken["tier"]
  };
}

export function compareModelTierPriority(leftTier: ModelTierToken["tier"], rightTier: ModelTierToken["tier"]): number {
  return MODEL_TIER_PRIORITY[rightTier] - MODEL_TIER_PRIORITY[leftTier];
}

function compareTieredModelByVersionThenTier(left: string, right: string): number {
  const leftTierToken = extractModelTierToken(left);
  const rightTierToken = extractModelTierToken(right);

  if (
    !leftTierToken ||
    !rightTierToken ||
    leftTierToken.familyKey !== rightTierToken.familyKey
  ) {
    return 0;
  }

  const leftVersionToken = extractModelVersionToken(left);
  const rightVersionToken = extractModelVersionToken(right);

  if (leftVersionToken && rightVersionToken && rightVersionToken.version !== leftVersionToken.version) {
    return rightVersionToken.version - leftVersionToken.version;
  }
  if (leftVersionToken && !rightVersionToken) {
    return -1;
  }
  if (!leftVersionToken && rightVersionToken) {
    return 1;
  }

  return compareModelTierPriority(leftTierToken.tier, rightTierToken.tier);
}

export function getModelFamilyMatchKey(modelName: string): string {
  const normalized = modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const compact = normalized.replace(/\s+/g, "");

  // Special handling for Anthropic/Claude tiers: if the name contains mythos, fable, opus, sonnet, or haiku,
  // we extract the prefix before that tier as the family key.
  const tierIndex = compact.search(/(mythos|fable|opus|sonnet|haiku)/);
  if (tierIndex !== -1) {
    const familyKey = compact.slice(0, tierIndex).replace(/\d+$/g, "");
    if (familyKey) return familyKey;
  }

  const compactVersionMatch = compact.match(/^([a-z]+?)(?:[a-z]?\d)/);
  if (compactVersionMatch?.[1]) {
    return compactVersionMatch[1];
  }

  const words = normalized.split(" ");
  const firstWord = words[0] ?? "";
  if (!firstWord) return "";

  const alphaPrefix = firstWord.match(/^[a-z]+/)?.[0] ?? "";
  if (!alphaPrefix) return "";

  return alphaPrefix;
}

export function compareModelNameByColumnOrder(left: string, right: string, collator: Intl.Collator): number {
  const leftVersionToken = extractModelVersionToken(left);
  const rightVersionToken = extractModelVersionToken(right);
  const tierCompare = compareTieredModelByVersionThenTier(left, right);
  if (tierCompare !== 0) {
    return tierCompare;
  }

  const leftVariantToken = extractModelVariantToken(left);
  const rightVariantToken = extractModelVariantToken(right);

  if (
    leftVariantToken &&
    rightVariantToken &&
    leftVariantToken.familyKey.length > 0 &&
    leftVariantToken.familyKey === rightVariantToken.familyKey
  ) {
    const variantCompare = compareModelVariantPriority(leftVariantToken.variant, rightVariantToken.variant);
    if (variantCompare !== 0) {
      return variantCompare;
    }
  }

  if (
    leftVersionToken &&
    rightVersionToken &&
    leftVersionToken.familyKey === rightVersionToken.familyKey &&
    rightVersionToken.version !== leftVersionToken.version
  ) {
    return rightVersionToken.version - leftVersionToken.version;
  }

  const scaleCompare = compareModelScaleSize(left, right);
  if (scaleCompare !== 0) {
    return scaleCompare;
  }

  const previewCompare = comparePreviewModelOrder(left, right);
  if (previewCompare !== 0) {
    return previewCompare;
  }

  const leftFamily = getModelFamilyMatchKey(left);
  const rightFamily = getModelFamilyMatchKey(right);

  if (leftFamily && rightFamily && leftFamily === rightFamily) {
    if (leftVersionToken && !rightVersionToken) {
      return -1;
    }
    if (!leftVersionToken && rightVersionToken) {
      return 1;
    }
  }

  return collator.compare(right, left);
}

function normalizeHeaderPrefixMatchToken(input: string): string {
  return input
    .toLowerCase()
    .replace(MATCH_HYPHEN_VARIANT_REGEX, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function isSourceHeaderPrefixMatch(modelName: string, sourceLabel: string): boolean {
  const normalizedSourceLabel = normalizeHeaderPrefixMatchToken(sourceLabel);
  if (!normalizedSourceLabel) return false;

  const normalizedModelName = normalizeHeaderPrefixMatchToken(modelName);
  if (!normalizedModelName) return false;

  return normalizedModelName.startsWith(normalizedSourceLabel);
}
