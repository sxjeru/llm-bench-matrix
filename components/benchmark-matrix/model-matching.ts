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

  const leftVariantToken = extractModelVariantToken(leftLabel);
  const rightVariantToken = extractModelVariantToken(rightLabel);
  if (
    leftVariantToken &&
    rightVariantToken &&
    leftVariantToken.familyKey.length > 0 &&
    leftVariantToken.familyKey === rightVariantToken.familyKey
  ) {
    if (
      leftVersionToken &&
      rightVersionToken &&
      leftVersionToken.familyKey === rightVersionToken.familyKey &&
      rightVersionToken.version !== leftVersionToken.version
    ) {
      return rightVersionToken.version - leftVersionToken.version;
    }

    const variantCompare = compareModelVariantPriority(leftVariantToken.variant, rightVariantToken.variant);
    if (variantCompare !== 0) {
      return variantCompare;
    }
  }

  if (
    leftVersionToken &&
    rightVersionToken &&
    leftVersionToken.familyKey === rightVersionToken.familyKey
  ) {
    if (rightVersionToken.version !== leftVersionToken.version) {
      return rightVersionToken.version - leftVersionToken.version;
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

  const leftFamily = getModelFamilyMatchKey(leftLabel);
  const rightFamily = getModelFamilyMatchKey(rightLabel);
  if (leftFamily && rightFamily && leftFamily === rightFamily) {
    if (leftVersionToken && !rightVersionToken) {
      return -1;
    }
    if (!leftVersionToken && rightVersionToken) {
      return 1;
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

  const isGpt = normalized.includes("gpt");

  const variant: ModelVariantToken["variant"] = (() => {
    if (isGpt) {
      if (/\bastra\b/.test(normalized)) return "astra";
      if (/\bsol\s+ultra\b/.test(normalized)) return "sol-ultra";
      if (/\bsol\b/.test(normalized)) return "sol";
      if (/\bterra\b/.test(normalized)) return "terra";
      if (/\bluna\b/.test(normalized)) return "luna";
    }
    if (/\bultra\b/.test(normalized)) return "ultra";
    if (/\bsuper\b/.test(normalized)) return "super";
    if (/\bmax\b/.test(normalized)) return "max";
    if (/\bpro\b/.test(normalized)) return "pro";
    if (MODEL_FLASH_LITE_PATTERN.test(normalized)) return "flash-lite";
    if (/\bflash\b/.test(normalized)) return "flash";
    if (/\bmini\b/.test(normalized)) return "mini";
    if (/\bnano\b/.test(normalized)) return "nano";
    return "base";
  })();

  const variantMatch = (isGpt
    ? (normalized.match(/\bastra\b/) ??
       normalized.match(/\bsol\s+ultra\b/) ??
       normalized.match(/\bsol\b/) ??
       normalized.match(/\bterra\b/) ??
       normalized.match(/\bluna\b/))
    : null) ??
    normalized.match(MODEL_FLASH_LITE_PATTERN) ??
    normalized.match(/\b(?:ultra|super|max|pro|flash|mini|nano)\b/);

  const familyKey = normalized
    .slice(0, variantMatch?.index ?? normalized.length)
    .replace(/(?<=\D|^)\d+(?:\.\d+)+(?=\D|$)/g, " ")
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
    "sol-ultra": 9,
    ultra: 8,
    max: 7.5,
    super: 7,
    pro: 6,
    astra: 5.9,
    sol: 5.8,
    terra: 5.5,
    luna: 5.2,
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

  // Handle Claude "mythos preview" special case
  if (leftTierToken.familyKey === "claude") {
    const isLeftMythosPreview = left.toLowerCase().includes("mythos") && left.toLowerCase().includes("preview");
    const isRightMythosPreview = right.toLowerCase().includes("mythos") && right.toLowerCase().includes("preview");

    if (isLeftMythosPreview && !isRightMythosPreview) {
      const rightTier = rightTierToken.tier;
      if (rightTier === "mythos" || rightTier === "fable") {
        return 1; // "mythos preview" comes after mythos and fable
      }
      return -1; // "mythos preview" comes before others (opus, sonnet, haiku)
    }
    if (!isLeftMythosPreview && isRightMythosPreview) {
      const leftTier = leftTierToken.tier;
      if (leftTier === "mythos" || leftTier === "fable") {
        return -1; // mythos and fable come before "mythos preview"
      }
      return 1; // others come after "mythos preview"
    }
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

const MODEL_FAMILY_MATCH_KEY_CACHE_LIMIT = 4096;
const modelFamilyMatchKeyCache = new Map<string, string>();

export function getModelFamilyMatchKey(modelName: string): string {
  const cached = modelFamilyMatchKeyCache.get(modelName);
  if (cached !== undefined) return cached;

  const result = computeModelFamilyMatchKey(modelName);

  if (modelFamilyMatchKeyCache.size >= MODEL_FAMILY_MATCH_KEY_CACHE_LIMIT) {
    modelFamilyMatchKeyCache.clear();
  }
  modelFamilyMatchKeyCache.set(modelName, result);
  return result;
}

function computeModelFamilyMatchKey(modelName: string): string {
  const normalized = modelName
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const compact = normalized.replace(/\s+/g, "");

  if (compact.startsWith("musespark")) {
    return "musespark";
  }

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

const EXPAND_SOURCE_COMPOUND_NAMES_CACHE_LIMIT = 4096;
const expandSourceCompoundNamesCache = new Map<string, readonly string[]>();

const KNOWN_MODEL_VARIANTS = new Set([
  "mythos",
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "astra",
  "sol",
  "terra",
  "luna",
  "ultra",
  "super",
  "max",
  "pro",
  "flash",
  "mini",
  "nano",
  "base",
  "turbo",
  "plus",
  "lite"
]);

function isScaleToken(token: string): boolean {
  return /^[eE]?\d+(?:\.\d+)?[bB]$|^\d+x\d+[bB]$/.test(token);
}

function isVersionToken(token: string): boolean {
  return /^[vV]?\d+(?:\.\d+)*$|^[rR]\d+$/.test(token);
}

function isVariantWord(token: string): boolean {
  const clean = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  return KNOWN_MODEL_VARIANTS.has(clean) || isScaleToken(token) || isVersionToken(token);
}

function findVariantSpan(tokens: readonly string[]): { index: number; length: number } | null {
  // 1. Multi-word variants (e.g. sol ultra, flash lite)
  for (let i = 0; i < tokens.length - 1; i++) {
    const w1 = tokens[i].toLowerCase().replace(/[^a-z0-9]/g, "");
    const w2 = tokens[i + 1].toLowerCase().replace(/[^a-z0-9]/g, "");
    if ((w1 === "sol" && w2 === "ultra") || (w1 === "flash" && w2 === "lite")) {
      return { index: i, length: 2 };
    }
  }

  // 2. Known model variants (tiers, named variants like sol, luna, pro, etc.)
  for (let i = 0; i < tokens.length; i++) {
    const clean = tokens[i].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (KNOWN_MODEL_VARIANTS.has(clean)) {
      return { index: i, length: 1 };
    }
  }

  // 3. Scale tokens (e.g. 8B, 70B)
  for (let i = 0; i < tokens.length; i++) {
    if (isScaleToken(tokens[i])) {
      return { index: i, length: 1 };
    }
  }

  // 4. Version tokens (e.g. V3, R1) - only if preceded by family name
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (isVersionToken(tokens[i])) {
      return { index: i, length: 1 };
    }
  }

  return null;
}

export function expandSourceCompoundNames(sourceLabel: string): string[] {
  const cached = expandSourceCompoundNamesCache.get(sourceLabel);
  if (cached !== undefined) return [...cached];

  const cleanLabel = sourceTabDisplayLabel(sourceLabel).trim();
  if (!cleanLabel) return [];

  const setCacheAndReturn = (result: readonly string[]): string[] => {
    if (expandSourceCompoundNamesCache.size >= EXPAND_SOURCE_COMPOUND_NAMES_CACHE_LIMIT) {
      expandSourceCompoundNamesCache.clear();
    }
    const frozen = Object.freeze([...result]);
    expandSourceCompoundNamesCache.set(sourceLabel, frozen);
    return [...frozen];
  };

  // Check if string contains compound delimiter
  const delimiterRegex = /\s*[/|／｜]\s*/;
  if (!delimiterRegex.test(cleanLabel)) {
    return setCacheAndReturn([cleanLabel]);
  }

  // Check repo-style path: org/repo with no spaces and no variant tokens
  if (
    /^[a-zA-Z0-9_\.\-]+[/][a-zA-Z0-9_\.\-]+$/.test(cleanLabel) &&
    !cleanLabel.includes(" ")
  ) {
    const [leftPart, rightPart] = cleanLabel.split("/");
    const leftHasVariant = isVariantWord(leftPart);
    const rightHasVariant = isVariantWord(rightPart);
    if (!leftHasVariant && !rightHasVariant) {
      return setCacheAndReturn([cleanLabel]);
    }
  }

  const rawSegments = cleanLabel
    .split(delimiterRegex)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSegments.length <= 1) {
    return setCacheAndReturn([cleanLabel]);
  }

  const s0 = rawSegments[0];
  const tokens0 = s0.split(/\s+/);
  const span0 = findVariantSpan(tokens0);

  const prefixTokens0 = span0 ? tokens0.slice(0, span0.index) : tokens0.slice(0, Math.max(1, tokens0.length - 1));
  const suffixTokens0 = span0 ? tokens0.slice(span0.index + span0.length) : [];

  const results: string[] = [];
  let s0WithSuffix: string | null = null;

  for (let i = 1; i < rawSegments.length; i++) {
    const sI = rawSegments[i];
    const tokensI = sI.split(/\s+/);

    // Case 1: sI already starts with prefixTokens0
    if (
      prefixTokens0.length > 0 &&
      tokensI.length >= prefixTokens0.length &&
      tokensI.slice(0, prefixTokens0.length).join(" ").toLowerCase() === prefixTokens0.join(" ").toLowerCase()
    ) {
      results.push(sI);
      continue;
    }

    // Case 2: sI starts with a sub-slice of prefixTokens0 (e.g. "3.5 Haiku" after "Claude 3.5 Sonnet")
    let sharedSubPrefixIndex = -1;
    for (let p = 1; p < prefixTokens0.length; p++) {
      const subPrefix = prefixTokens0.slice(p).join(" ").toLowerCase();
      if (tokensI.join(" ").toLowerCase().startsWith(subPrefix)) {
        sharedSubPrefixIndex = p;
        break;
      }
    }
    if (sharedSubPrefixIndex > 0) {
      const missingPrefix = prefixTokens0.slice(0, sharedSubPrefixIndex);
      results.push([...missingPrefix, ...tokensI].join(" "));
      continue;
    }

    // Case 3: Structure-aware expansion based on variant & suffix
    const spanI = findVariantSpan(tokensI);
    if (spanI) {
      const prefixI = tokensI.slice(0, spanI.index);
      const variantI = tokensI.slice(spanI.index, spanI.index + spanI.length);
      const suffixI = tokensI.slice(spanI.index + spanI.length);

      // If sI has a suffix but s0 has none, propagate suffix to s0
      if (suffixI.length > 0 && suffixTokens0.length === 0 && !s0WithSuffix) {
        s0WithSuffix = [...tokens0, ...suffixI].join(" ");
      }

      const effectivePrefix = prefixI.length > 0 ? prefixI : prefixTokens0;
      const effectiveSuffix = suffixI.length > 0 ? suffixI : suffixTokens0;

      results.push([...effectivePrefix, ...variantI, ...effectiveSuffix].join(" "));
      continue;
    }

    // Case 4: General token-count fallback
    if (suffixTokens0.length > 0) {
      results.push([...prefixTokens0, ...tokensI, ...suffixTokens0].join(" "));
    } else {
      results.push([...prefixTokens0, ...tokensI].join(" "));
    }
  }

  const initialExpanded: string[] = [];
  if (s0WithSuffix) {
    initialExpanded.push(s0WithSuffix);
  }
  initialExpanded.push(s0);
  initialExpanded.push(...results);

  // Return deduplicated results
  const seen = new Set<string>();
  const finalResults: string[] = [];
  for (const item of initialExpanded) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      finalResults.push(trimmed);
    }
  }

  return setCacheAndReturn(finalResults);
}

function normalizeHeaderPrefixMatchToken(input: string): string {
  return input
    .toLowerCase()
    .replace(MATCH_HYPHEN_VARIANT_REGEX, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function isSourceHeaderPrefixMatch(modelName: string, sourceLabel: string): boolean {
  if (!modelName || !sourceLabel) return false;

  const normalizedModelName = normalizeHeaderPrefixMatchToken(modelName);
  if (!normalizedModelName) return false;

  const targetLabels = expandSourceCompoundNames(sourceLabel);
  return targetLabels.some((target) => {
    const normalizedTarget = normalizeHeaderPrefixMatchToken(target);
    if (!normalizedTarget) return false;
    return normalizedModelName.startsWith(normalizedTarget);
  });
}
