import type { HeatmapPaletteHex } from "./types";

export const LOWER_IS_BETTER_RULES: RegExp[] = [
  /omnidocbench\s*1\.5/i,
  /\b(?:r?mse)\b/i
];
export const LOWER_IS_BETTER_ASR_TYPE_REGEX = /\basr\b/i;

export const SOURCE_ALL = "__ALL__";
export const SOURCE_EMPTY = "__EMPTY__";
export const MODALITY_OPTIONS = ["Text", "Vision", "Audio", "Video", "Multimodal"] as const;
export const SHOW_CATEGORY_STORAGE_KEY = "benchmark-matrix:show-category";
export const SHOW_DUPLICATE_STORAGE_KEY = "benchmark-matrix:show-duplicate";
export const SHOW_SOURCE_VALUES_STORAGE_KEY = "benchmark-matrix:show-source-values";
export const MODEL_SELECTION_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:model-selection-by-source";
export const MODEL_ORDER_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:model-order-by-source";
export const COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:column-width-by-source";
export const HEATMAP_PALETTE_STORAGE_KEY = "benchmark-matrix:heatmap-palette";
export const EXPORT_PRESET_STORAGE_KEY = "benchmark-matrix:export-preset";
export const CATEGORY_COLUMN_WIDTH_KEY = "__CATEGORY__";
export const BENCHMARK_COLUMN_WIDTH_KEY = "__BENCHMARK__";
export const DEFAULT_CATEGORY_COLUMN_WIDTH = 150;
export const DEFAULT_BENCHMARK_COLUMN_WIDTH = 180;
export const MIN_CATEGORY_COLUMN_WIDTH = 120;
export const MAX_CATEGORY_COLUMN_WIDTH = 420;
export const MIN_BENCHMARK_COLUMN_WIDTH = 140;
export const MAX_BENCHMARK_COLUMN_WIDTH = 560;
export const DEFAULT_MODEL_COLUMN_BASELINE_WIDTH = 88;
export const MIN_MODEL_COLUMN_RESIZE_WIDTH = 24;
export const COMPARE_BASELINE_DEFAULT_EXPANDED_WIDTH = 86;
export const COMPARE_BADGE_DEFAULT_EXPANDED_WIDTH = 100;
export const MAX_MODEL_COLUMN_WIDTH = 320;
export const COLUMN_WIDTH_STORAGE_DEBOUNCE_MS = 250;
export const ALL_SOURCE_ROW_COVERAGE_THRESHOLD = 0.4;
export const ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD = 0.2;
export const PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT = 8;
export const SOURCE_MATCH_FRAME_COLOR = "rgba(93, 167, 255, 0.42)";
export const COMPARE_BASELINE_FRAME_COLOR = "rgba(250, 211, 106, 0.74)";
export const COMPARE_BASELINE_FRAME_EXPORT_COLOR = "rgba(250, 211, 106, 0.92)";
export const WEBP_EXPORT_QUALITY = 0.94;
export const AVIF_EXPORT_QUALITY = 0.9;

export const HEATMAP_PRESETS = {
  classic: {
    label: "经典红黄绿",
    low: "#ff9b80",
    mid: "#ffee6f",
    high: "#a1d48c"
  },
  coolwarm: {
    label: "冷暖蓝橙",
    low: "#7aa8ff",
    mid: "#f0f5ff",
    high: "#ffb07f"
  },
  mintsun: {
    label: "薄荷暖阳",
    low: "#8bc5ff",
    mid: "#f9f2b1",
    high: "#74d8b4"
  },
  colorblind: {
    label: "色盲友好",
    low: "#8ea4ff",
    mid: "#d8d8d8",
    high: "#ffb55e"
  }
} as const;

export const DEFAULT_HEATMAP_PRESET_KEY = "classic" as const;
export const DEFAULT_HEATMAP_ALPHA = 0.55;
export const MIN_HEATMAP_ALPHA = 0.24;
export const MAX_HEATMAP_ALPHA = 0.92;

export const EXPORT_PRESET_MAP = {
  "1x-png": { label: "1x PNG", scale: 1, format: "png", mimeType: "image/png" },
  "2x-png": { label: "2x PNG", scale: 2, format: "png", mimeType: "image/png" },
  "3x-png": { label: "3x PNG", scale: 3, format: "png", mimeType: "image/png" },
  "1x-webp": { label: "1x WEBP", scale: 1, format: "webp", mimeType: "image/webp" },
  "2x-webp": { label: "2x WEBP", scale: 2, format: "webp", mimeType: "image/webp" },
  "3x-webp": { label: "3x WEBP", scale: 3, format: "webp", mimeType: "image/webp" },
  "1x-avif": { label: "1x AVIF", scale: 1, format: "avif", mimeType: "image/avif" },
  "2x-avif": { label: "2x AVIF", scale: 2, format: "avif", mimeType: "image/avif" },
  "3x-avif": { label: "3x AVIF", scale: 3, format: "avif", mimeType: "image/avif" }
} as const;

export const DEFAULT_EXPORT_PRESET = "2x-webp" as const;

export const DEFAULT_HEATMAP_PALETTE_HEX: HeatmapPaletteHex = {
  low: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].low,
  mid: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].mid,
  high: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].high
};

export const MATCH_HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export const MODEL_SIZE_TOKEN_PATTERN = /\b(E?)(\d+(?:\.\d+)?)B\b/i;
export const MODEL_VERSION_TOKEN_PATTERN = /^([A-Za-z]+)[\s-_]*([0-9]+(?:\.\d+)?)/i;
export const MODEL_FLASH_LITE_PATTERN = /\bflash[\s-_]*lite\b/i;
