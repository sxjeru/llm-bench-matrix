import { MODEL_FLASH_LITE_PATTERN, MODEL_SIZE_TOKEN_PATTERN, MODEL_VERSION_TOKEN_PATTERN, MATCH_HYPHEN_VARIANT_REGEX } from "./constants";
import type { ModelScaleToken, ModelVariantToken, ModelVersionToken } from "./types";
import { sourceTabDisplayLabel } from "./utils";

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

  if (
    leftVersionToken &&
    rightVersionToken &&
    leftVersionToken.familyKey === rightVersionToken.familyKey &&
    rightVersionToken.version !== leftVersionToken.version
  ) {
    return rightVersionToken.version - leftVersionToken.version;
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

export function extractModelVariantToken(modelName: string): ModelVariantToken | null {
  const normalized = modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const variant: ModelVariantToken["variant"] = (() => {
    if (/\bpro\b/.test(normalized)) return "pro";
    if (MODEL_FLASH_LITE_PATTERN.test(normalized)) return "flash-lite";
    if (/\bflash\b/.test(normalized)) return "flash";
    if (/\bmini\b/.test(normalized)) return "mini";
    if (/\bnano\b/.test(normalized)) return "nano";
    return "base";
  })();

  const variantMatch = normalized.match(MODEL_FLASH_LITE_PATTERN) ?? normalized.match(/\b(?:pro|flash|mini|nano)\b/);

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
    pro: 6,
    base: 5,
    flash: 4,
    mini: 3,
    nano: 2,
    "flash-lite": 1
  };

  return priority[rightVariant] - priority[leftVariant];
}

export function compareModelNameByColumnOrder(left: string, right: string, collator: Intl.Collator): number {
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

  const leftVersionToken = extractModelVersionToken(left);
  const rightVersionToken = extractModelVersionToken(right);

  if (
    leftVersionToken &&
    rightVersionToken &&
    leftVersionToken.familyKey === rightVersionToken.familyKey &&
    rightVersionToken.version !== leftVersionToken.version
  ) {
    return rightVersionToken.version - leftVersionToken.version;
  }

  const leftScaleToken = extractModelScaleToken(left);
  const rightScaleToken = extractModelScaleToken(right);

  if (
    leftScaleToken &&
    rightScaleToken &&
    leftScaleToken.prefixKey.length > 0 &&
    leftScaleToken.prefixKey === rightScaleToken.prefixKey
  ) {
    if (rightScaleToken.sizeInBillions !== leftScaleToken.sizeInBillions) {
      return rightScaleToken.sizeInBillions - leftScaleToken.sizeInBillions;
    }

    if (leftScaleToken.isEstimated !== rightScaleToken.isEstimated) {
      return leftScaleToken.isEstimated ? 1 : -1;
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
