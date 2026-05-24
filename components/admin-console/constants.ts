import type { ModelDedupeRule } from "./types";

export const DEFAULT_MODEL_DEDUPE_RULE: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: true,
  removeSpace: true,
  removeDot: false
};

export const BENCHMARK_SUSPECT_KEYWORDS = ["last exam"];
export const BENCHMARK_NAME_REPLACERS = [/\bno\s*tools?\b/gi, /\bwith\s*search\b/gi, /\bw\/?\s*tools?\b/gi, /\bwith\s*tools?\b/gi];
export const HARDCODED_BENCHMARK_ALIAS_RULES: Array<{ pattern: RegExp; targetName: string }> = [
  { pattern: /^\s*hle\s+with\s+tools?\s*$/i, targetName: "HLE w/ tool" }
];
export const LOWER_IS_BETTER_PREVIEW_RULES = [/omnidocbench\s*1\.5/i, /\b(?:r?mse)\b/i];
export const LOWER_IS_BETTER_PREVIEW_ASR_TYPE_REGEX = /\basr\b/i;
export const OMNIDOCBENCH_15_MATCHER = /omnidocbench\s*1\.5/i;
export const MULTIMODAL_HINT_PATTERN = /(\bmultimodal(?:ity)?\b|\bmulti[\s-_]?modal(?:ity)?\b|多模态)/i;
export const MODEL_HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
export const PAIR_NOTE_HISTORY_STORAGE_KEY = "admin-console:pair-note-history";
export const STAR_NOTE_HISTORY_STORAGE_KEY = "admin-console:star-note-history";
export const MODALITY_OPTIONS = ["Text", "Vision", "Audio", "Video", "Multimodal"] as const;
export const RENAME_LIST_ROW_HEIGHT = 38;
export const RENAME_LIST_VIEWPORT_HEIGHT = 320;
export const RENAME_LIST_OVERSCAN = 8;
