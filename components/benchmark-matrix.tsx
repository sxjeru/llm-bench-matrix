"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Expand,
  Eye,
  EyeOff,
  Filter,
  Headphones,
  ImageDown,
  Layers,
  Minimize2,
  TriangleAlert,
  Video
} from "lucide-react";

type MatrixInputRow = {
  recordId?: number | null;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkCanonicalKey?: string | null;
  modalities?: string[];
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2?: number | null;
  valueNote: string | null;
  source: string | null;
};

type MatrixCellEntry = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
};

type MatrixCell = {
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
  allEntries: MatrixCellEntry[];
  hasMultipleValues: boolean;
  uniqueEntries: MatrixCellEntry[];
  noteText: string;
  displayValue: string;
  hasMeaningfulMultipleValues: boolean;
  shouldShowQuestionMark: boolean;
};

type IndexedMatrixInputRow = {
  row: MatrixInputRow;
  matrixKey: string;
};

type MatrixRow = {
  rowKey: string;
  category: string;
  benchmark: string;
  modalities: string[];
  cells: Map<string, MatrixCell>;
  firstSeenIndex: number;
  sourceOrderKey: number | null;
  rowDataCount: number;
  rowNumericCount: number;
  minComparable: number | null;
  maxComparable: number | null;
  minComparable2: number | null;
  maxComparable2: number | null;
  minNum: number | null;
  maxNum: number | null;
  minNum2: number | null;
  maxNum2: number | null;
};

type OverallModelSummary = {
  rawScore: number | null;
  rawRank: number | null;
  correctedScore: number | null;
  correctedRank: number | null;
  coverage: number;
  coveredRows: number;
  totalRows: number;
  correctionFactor: number;
};

type RowSortColumn = "category" | "benchmark";
type RowSortMode = "source" | "alpha" | "data";

const LOWER_IS_BETTER_RULES: RegExp[] = [
  /omnidocbench\s*1\.5/i
];
const LOWER_IS_BETTER_ASR_TYPE_REGEX = /\basr\b/i;

function isFleursZhTranslationBenchmark(benchmarkName: string): boolean {
  if (!/fleurs/i.test(benchmarkName)) return false;

  const normalized = benchmarkName
    .toLowerCase()
    .replace(/\s+/g, "");

  const hasBiDirectionalHint = /(?:⇄|↔|<->|<=>)/.test(normalized);

  return hasBiDirectionalHint;
}

function isLowerBetterBenchmark(benchmarkName: string, benchmarkType?: string): boolean {
  if (benchmarkType && LOWER_IS_BETTER_ASR_TYPE_REGEX.test(benchmarkType)) {
    return true;
  }

  if (/fleurs/i.test(benchmarkName)) {
    return !isFleursZhTranslationBenchmark(benchmarkName);
  }

  return LOWER_IS_BETTER_RULES.some((rule) => rule.test(benchmarkName));
}

function getBenchmarkComparableScore(benchmarkName: string, valueNum: number, benchmarkType?: string): number {
  if (isLowerBetterBenchmark(benchmarkName, benchmarkType)) {
    return 100 - valueNum;
  }

  return valueNum;
}

type Props = {
  rows: MatrixInputRow[];
  allRows?: MatrixInputRow[];
  sourceOptions?: string[];
};

const SOURCE_ALL = "__ALL__";
const SOURCE_EMPTY = "__EMPTY__";
const MODALITY_OPTIONS = ["Text", "Vision", "Audio", "Video", "Multimodal"] as const;
const SHOW_CATEGORY_STORAGE_KEY = "benchmark-matrix:show-category";
const SHOW_DUPLICATE_STORAGE_KEY = "benchmark-matrix:show-duplicate";
const MODEL_SELECTION_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:model-selection-by-source";
const MODEL_ORDER_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:model-order-by-source";
const COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY = "benchmark-matrix:column-width-by-source";
const HEATMAP_PALETTE_STORAGE_KEY = "benchmark-matrix:heatmap-palette";
const EXPORT_PRESET_STORAGE_KEY = "benchmark-matrix:export-preset";
const CATEGORY_COLUMN_WIDTH_KEY = "__CATEGORY__";
const BENCHMARK_COLUMN_WIDTH_KEY = "__BENCHMARK__";
const DEFAULT_CATEGORY_COLUMN_WIDTH = 150;
const DEFAULT_BENCHMARK_COLUMN_WIDTH = 180;
const MIN_CATEGORY_COLUMN_WIDTH = 120;
const MAX_CATEGORY_COLUMN_WIDTH = 420;
const MIN_BENCHMARK_COLUMN_WIDTH = 140;
const MAX_BENCHMARK_COLUMN_WIDTH = 560;
const DEFAULT_MODEL_COLUMN_BASELINE_WIDTH = 88;
const MIN_MODEL_COLUMN_RESIZE_WIDTH = 24;
const MAX_MODEL_COLUMN_WIDTH = 320;
const COLUMN_WIDTH_STORAGE_DEBOUNCE_MS = 250;
const SOURCE_MATCH_FRAME_COLOR = "rgba(93, 167, 255, 0.42)";
const WEBP_EXPORT_QUALITY = 0.94;
const AVIF_EXPORT_QUALITY = 0.9;
const HEATMAP_PRESETS = {
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
const DEFAULT_HEATMAP_PRESET_KEY: HeatmapPresetKey = "classic";
const DEFAULT_HEATMAP_ALPHA = 0.55;
const MIN_HEATMAP_ALPHA = 0.24;
const MAX_HEATMAP_ALPHA = 0.92;
const EXPORT_PRESET_MAP = {
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
const DEFAULT_EXPORT_PRESET: ExportPresetKey = "2x-webp";

type HeatmapPresetKey = keyof typeof HEATMAP_PRESETS;
type HeatmapPresetSelection = HeatmapPresetKey | "custom";
type HeatmapPaletteHex = {
  low: string;
  mid: string;
  high: string;
};
type HeatmapPaletteRgb = {
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
};

const DEFAULT_HEATMAP_PALETTE_HEX: HeatmapPaletteHex = {
  low: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].low,
  mid: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].mid,
  high: HEATMAP_PRESETS[DEFAULT_HEATMAP_PRESET_KEY].high
};

function getModelColumnWidthKey(modelName: string): string {
  return `model:${modelName}`;
}

function clampColumnWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

function normalizeColumnWidthBySource(input: unknown): Record<string, Record<string, number>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalizedBySource: Record<string, Record<string, number>> = {};

  Object.entries(input as Record<string, unknown>).forEach(([sourceKey, widthMapRaw]) => {
    if (!widthMapRaw || typeof widthMapRaw !== "object" || Array.isArray(widthMapRaw)) return;

    const normalizedMap: Record<string, number> = {};

    Object.entries(widthMapRaw as Record<string, unknown>).forEach(([columnKey, value]) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      normalizedMap[columnKey] = Math.max(1, Math.round(value));
    });

    normalizedBySource[sourceKey] = normalizedMap;
  });

  return normalizedBySource;
}

function areColumnWidthMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) return false;

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) return false;
  }

  return true;
}

type SourceFrameShadowBuildInput = {
  isMatched: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  includeTop?: boolean;
  includeBottom?: boolean;
  exportMode?: boolean;
};

function buildSourceFrameShadows(input: SourceFrameShadowBuildInput): string[] {
  if (!input.isMatched) {
    return [];
  }

  const edgeSize = 2;
  const frameColor = input.exportMode ? "rgba(93, 167, 255, 0.72)" : SOURCE_MATCH_FRAME_COLOR;

  const shadows: string[] = [];

  if (input.includeTop) {
    shadows.push(`inset 0 ${edgeSize}px 0 ${frameColor}`);
  }
  if (input.includeBottom) {
    shadows.push(`inset 0 -${edgeSize}px 0 ${frameColor}`);
  }
  if (input.isFirst) {
    shadows.push(`inset ${edgeSize}px 0 0 ${frameColor}`);
  }
  if (input.isLast) {
    shadows.push(`inset -${edgeSize}px 0 0 ${frameColor}`);
  }

  return shadows;
}

export function __buildSourceFrameShadowsForTest(input: SourceFrameShadowBuildInput): string[] {
  return buildSourceFrameShadows(input);
}

function applyExportSourceFrameFallback(root: HTMLElement, color: string, width: number): void {
  const sourceMatchedCells = root.querySelectorAll<HTMLElement>("[data-source-match='1']");

  sourceMatchedCells.forEach((cell) => {
    cell.style.boxShadow = "none";

    if (cell.dataset.sourceMatchFirst === "1") {
      cell.style.borderLeft = `${width}px solid ${color}`;
    }
    if (cell.dataset.sourceMatchLast === "1") {
      cell.style.borderRight = `${width}px solid ${color}`;
    }
    if (cell.tagName === "TH") {
      cell.style.borderTop = `${width}px solid ${color}`;
    }
    if (cell.dataset.sourceMatchBottom === "1") {
      cell.style.borderBottom = `${width}px solid ${color}`;
    }
  });
}

function applyExportOverallRowNudgeFallback(root: HTMLElement): void {
  const overallRow = root.querySelector<HTMLTableRowElement>("tr[data-overall-row='1']");
  if (!overallRow) return;

  const overallBenchmarkLabel = overallRow.querySelector<HTMLElement>("[data-overall-benchmark-label='1']");
  if (overallBenchmarkLabel) {
    overallBenchmarkLabel.style.paddingTop = "8px";
    overallBenchmarkLabel.style.paddingBottom = "4px";
  }

  const overallBenchmarkCnText = overallRow.querySelector<HTMLElement>("[data-overall-benchmark-cn-text='1']");
  if (overallBenchmarkCnText) {
    overallBenchmarkCnText.style.display = "inline-block";
    overallBenchmarkCnText.style.transform = "translateY(2px)";
  }

  overallRow.querySelectorAll<HTMLElement>("[data-overall-tooltip-trigger]").forEach((trigger) => {
    trigger.style.top = "56%";
  });
}

export function __applyExportSourceFrameFallbackForTest(root: HTMLElement, color = "rgba(93, 167, 255, 0.65)", width = 2): void {
  applyExportSourceFrameFallback(root, color, width);
}

type ExportPresetKey = keyof typeof EXPORT_PRESET_MAP;
type ExportMimeType = (typeof EXPORT_PRESET_MAP)[ExportPresetKey]["mimeType"];
type ExportFormat = (typeof EXPORT_PRESET_MAP)[ExportPresetKey]["format"];

function isExportPresetKey(value: string): value is ExportPresetKey {
  return value in EXPORT_PRESET_MAP;
}

function canEncodeCanvasMimeType(mimeType: ExportMimeType): boolean {
  if (typeof document === "undefined") return false;

  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = 2;
  probeCanvas.height = 2;
  const context = probeCanvas.getContext("2d");
  if (!context) return false;

  context.fillStyle = "#111827";
  context.fillRect(0, 0, 2, 2);

  try {
    return probeCanvas.toDataURL(mimeType, 0.9).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64 = ""] = dataUrl.split(",");
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function getMimeTypeFallbackChain(mimeType: ExportMimeType): ExportMimeType[] {
  if (mimeType === "image/avif") {
    return ["image/avif", "image/webp", "image/png"];
  }
  if (mimeType === "image/webp") {
    return ["image/webp", "image/png"];
  }
  return ["image/png"];
}

function getEncoderQuality(mimeType: ExportMimeType): number | undefined {
  if (mimeType === "image/webp") return WEBP_EXPORT_QUALITY;
  if (mimeType === "image/avif") return AVIF_EXPORT_QUALITY;
  return undefined;
}

function mimeTypeToFormat(mimeType: string): ExportFormat {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

type Html2CanvasFn = (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

let html2canvasLoaderPromise: Promise<Html2CanvasFn> | null = null;

function getSourceKey(source: string | null): string {
  const cleaned = source?.trim();
  return cleaned ? cleaned : SOURCE_EMPTY;
}

function getSourceLabel(sourceKey: string): string {
  if (sourceKey === SOURCE_EMPTY) {
    return "未标注";
  }
  return sourceKey;
}

function sourceTabDisplayLabel(sourceKey: string): string {
  const rawLabel = getSourceLabel(sourceKey);
  const colonIndex = rawLabel.indexOf(":");
  if (colonIndex < 0) return rawLabel;

  const stripped = rawLabel.slice(colonIndex + 1).trim();
  return stripped.length > 0 ? stripped : rawLabel;
}

function normalizeBenchmarkKeyFallback(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBenchmarkDuplicateToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9().]+/g, "");
}

function pickPreferredBenchmarkDisplayName(current: string, candidate: string): string {
  const currentTrimmed = current.trim();
  const candidateTrimmed = candidate.trim();
  if (!currentTrimmed) return candidateTrimmed;
  if (!candidateTrimmed) return currentTrimmed;

  const currentHasParentheses = /[（(][^()（）]+[)）]/.test(currentTrimmed);
  const candidateHasParentheses = /[（(][^()（）]+[)）]/.test(candidateTrimmed);

  if (currentHasParentheses !== candidateHasParentheses) {
    return currentHasParentheses ? candidateTrimmed : currentTrimmed;
  }

  return currentTrimmed.length <= candidateTrimmed.length ? currentTrimmed : candidateTrimmed;
}

function getBenchmarkDuplicateKey(canonicalKey: string | null | undefined, benchmarkName: string): string {
  const normalizedCanonical = canonicalKey?.trim().toLowerCase() ?? "";
  if (normalizedCanonical.length > 0) {
    const splitIndex = normalizedCanonical.indexOf(":");
    if (splitIndex > 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical.slice(0, splitIndex));
      if (token.length > 0) return token;
    }
    if (splitIndex < 0) {
      const token = normalizeBenchmarkDuplicateToken(normalizedCanonical);
      if (token.length > 0) return token;
    }
  }

  const fallbackToken = normalizeBenchmarkDuplicateToken(benchmarkName);
  if (fallbackToken.length > 0) {
    return fallbackToken;
  }

  const fallback = normalizeBenchmarkKeyFallback(benchmarkName);
  return fallback.length > 0 ? fallback : benchmarkName.trim().toLowerCase();
}

function getMatrixGroupingKey(
  row: Pick<MatrixInputRow, "benchmarkType" | "benchmarkName" | "benchmarkCanonicalKey">,
  showDuplicateRows: boolean
): string {
  if (showDuplicateRows) {
    const category = row.benchmarkType || "General";
    return `raw::${category}::${row.benchmarkName}`;
  }

  const duplicateKey = getBenchmarkDuplicateKey(row.benchmarkCanonicalKey, row.benchmarkName);
  return `merged::${duplicateKey}`;
}

function normalizeModalityName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "Text";
  if (normalized.includes("vision") || normalized.includes("vlm")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (normalized.includes("multimodal") || normalized.includes("multi-modal") || normalized.includes("多模态")) {
    return "Multimodal";
  }
  return "Text";
}

function normalizeModalityList(input: string[] | undefined, benchmarkType: string): string[] {
  const source = input && input.length > 0 ? input : [benchmarkType];

  const normalized = source
    .map((item) => normalizeModalityName(item))
    .filter(Boolean);

  const unique = normalized.length > 0 ? Array.from(new Set(normalized)) : ["Text"];
  const withoutText = unique.some((item) => item !== "Text")
    ? unique.filter((item) => item !== "Text")
    : unique;

  const withoutVision = withoutText.includes("Video")
    ? withoutText.filter((item) => item !== "Vision")
    : withoutText;

  return withoutVision.length > 0 ? withoutVision : ["Text"];
}

function renderModalityBadge(modalityInput: string, key: string) {
  const modality = normalizeModalityName(modalityInput);

  if (modality === "Text") {
    return (
      <span key={key} className="inline-flex items-center rounded-md px-1 text-[10px] opacity-70" title="Text">
        T
      </span>
    );
  }

  if (modality === "Vision") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title="Vision">
        <Eye size={11} />
      </span>
    );
  }

  if (modality === "Audio") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-purple-500/15 px-1.5 py-0.5 text-purple-300" title="Audio">
        <Headphones size={11} />
      </span>
    );
  }

  if (modality === "Video") {
    return (
      <span key={key} className="inline-flex items-center rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300" title="Video">
        <Video size={11} />
      </span>
    );
  }

  return (
    <span
      key={key}
      className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
      title="Multimodal"
    >
      <Layers size={11} />
    </span>
  );
}

function normalizeMatchToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const MATCH_HYPHEN_VARIANT_REGEX = /[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function normalizeHeaderPrefixMatchToken(input: string): string {
  return input
    .toLowerCase()
    .replace(MATCH_HYPHEN_VARIANT_REGEX, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isSourceHeaderPrefixMatch(modelName: string, sourceLabel: string): boolean {
  const normalizedSourceLabel = normalizeHeaderPrefixMatchToken(sourceLabel);
  if (!normalizedSourceLabel) return false;

  const normalizedModelName = normalizeHeaderPrefixMatchToken(modelName);
  if (!normalizedModelName) return false;

  return normalizedModelName.startsWith(normalizedSourceLabel);
}

type ModelScaleToken = {
  prefixKey: string;
  sizeInBillions: number;
  isEstimated: boolean;
};

type ModelVersionToken = {
  familyKey: string;
  version: number;
};

type ModelVariantToken = {
  familyKey: string;
  variant: "pro" | "base" | "flash" | "flash-lite" | "mini" | "nano";
};

const MODEL_SIZE_TOKEN_PATTERN = /\b(E?)(\d+(?:\.\d+)?)B\b/i;
const MODEL_VERSION_TOKEN_PATTERN = /^([A-Za-z]+)[\s-_]*([0-9]+(?:\.\d+)?)/i;
const MODEL_FLASH_LITE_PATTERN = /\bflash[\s-_]*lite\b/i;

function extractModelVersionToken(modelName: string): ModelVersionToken | null {
  const match = MODEL_VERSION_TOKEN_PATTERN.exec(modelName.trim());
  if (!match) {
    return null;
  }

  const [, family, versionText] = match;
  const version = Number.parseFloat(versionText);
  if (!Number.isFinite(version)) {
    return null;
  }

  return {
    familyKey: family.toLowerCase(),
    version
  };
}

function compareSourceTabKeysByVersion(leftKey: string, rightKey: string): number {
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

function extractModelScaleToken(modelName: string): ModelScaleToken | null {
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

function extractModelVariantToken(modelName: string): ModelVariantToken | null {
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

  const familyKey = normalized
    .replace(MODEL_FLASH_LITE_PATTERN, " ")
    .replace(/\b(?:pro|flash|lite|mini|nano)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!familyKey) return null;

  return {
    familyKey,
    variant
  };
}

function compareModelVariantPriority(
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

function compareModelNameByColumnOrder(left: string, right: string, collator: Intl.Collator): number {
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

function getProviderBrandColor(providerName: string | null | undefined): string {
  const normalized = (providerName ?? "").trim().toLowerCase();

  if (normalized.includes("openai") || normalized.includes("gpt")) return "#34d399";
  if (normalized.includes("anthropic") || normalized.includes("claude")) return "#e09a0e";
  if (normalized.includes("google") || normalized.includes("gemini") || normalized.includes("gemma")) return "#4285f4";
  if (normalized.includes("meta") || normalized.includes("llama")) return "#3b82f6";
  if (normalized.includes("qwen") || normalized.includes("alibaba")) return "#a16dfa";
  if (normalized.includes("deepseek")) return "#14b8a6";
  if (normalized.includes("xai") || normalized.includes("grok")) return "#cecece";
  if (normalized.includes("minimax")) return "#ff604a";

  const fallbackPalette = [
    "#f180b9",
    "#ffa98f",
    "#6cc9de",
  ];
  const hash = normalized.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return fallbackPalette[hash % fallbackPalette.length];
}

function lerp(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

function blendColor(from: [number, number, number], to: [number, number, number], t: number) {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)] as const;
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function normalizeHexColor(value: string, fallback: string): string {
  return isValidHexColor(value) ? value.trim().toLowerCase() : fallback;
}

function clampHeatmapAlpha(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HEATMAP_ALPHA;
  return Math.min(MAX_HEATMAP_ALPHA, Math.max(MIN_HEATMAP_ALPHA, Number(value.toFixed(2))));
}

function hexToRgbTuple(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

function rgbaFromHex(value: string, alpha: number): string {
  const [red, green, blue] = hexToRgbTuple(value);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getHeatCellStyle(
  valueNum: number | null,
  minNum: number | null,
  maxNum: number | null,
  palette: HeatmapPaletteRgb,
  alpha: number
) {
  if (valueNum === null || minNum === null || maxNum === null) {
    return {} as const;
  }

  if (minNum === maxNum) {
    const mid = palette.mid;
    return {
      backgroundColor: `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, ${alpha})`,
      color: "#0f172a",
      textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
      WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
    } as const;
  }

  const ratio = Math.min(1, Math.max(0, (valueNum - minNum) / (maxNum - minNum)));

  const color = ratio <= 0.5
    ? blendColor(palette.low, palette.mid, ratio / 0.5)
    : blendColor(palette.mid, palette.high, (ratio - 0.5) / 0.5);

  return {
    backgroundColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`,
    color: "#0f172a",
    textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
    WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
  } as const;
}

function formatTooltipTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatValueNumForDisplay(valueNum: number | null): string | null {
  if (valueNum === null || !Number.isFinite(valueNum)) return null;
  return Number(valueNum.toFixed(6)).toString();
}

function getSortedQuantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;

  const clampedQ = Math.min(1, Math.max(0, q));
  const position = (sortedValues.length - 1) * clampedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  if (lowerIndex === upperIndex) return lower;

  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

function buildDenseRankMap(
  items: Array<{ modelName: string; score: number | null }>,
  precision = 2
): Map<string, number> {
  const factor = 10 ** precision;

  const validItems = items
    .filter((item): item is { modelName: string; score: number } => item.score !== null && Number.isFinite(item.score))
    .map((item) => ({
      modelName: item.modelName,
      normalizedScore: Math.round(item.score * factor) / factor
    }))
    .sort((a, b) => b.normalizedScore - a.normalizedScore);

  const rankMap = new Map<string, number>();
  let rank = 0;
  let previousScore: number | null = null;

  validItems.forEach((item) => {
    if (previousScore === null || item.normalizedScore !== previousScore) {
      rank += 1;
      previousScore = item.normalizedScore;
    }

    rankMap.set(item.modelName, rank);
  });

  return rankMap;
}

type OverallScoreDisplayItem = {
  modelName: string;
  rawScore: number | null;
  rawRank: number | null;
};

function buildOverallScoreDisplayDecimalsMap(items: OverallScoreDisplayItem[]): Map<string, 1 | 2> {
  const decimalsMap = new Map<string, 1 | 2>();
  const groupedByOneDecimal = new Map<string, OverallScoreDisplayItem[]>();

  items.forEach((item) => {
    decimalsMap.set(item.modelName, 1);

    if (item.rawScore === null || item.rawRank === null || !Number.isFinite(item.rawScore)) return;

    const oneDecimalKey = item.rawScore.toFixed(1);
    if (!groupedByOneDecimal.has(oneDecimalKey)) {
      groupedByOneDecimal.set(oneDecimalKey, []);
    }
    groupedByOneDecimal.get(oneDecimalKey)!.push(item);
  });

  groupedByOneDecimal.forEach((groupItems) => {
    if (groupItems.length < 2) return;

    const distinctRanks = new Set(groupItems.map((item) => item.rawRank));
    if (distinctRanks.size > 1) {
      groupItems.forEach((item) => {
        decimalsMap.set(item.modelName, 2);
      });
    }
  });

  return decimalsMap;
}

export function __buildOverallScoreDisplayDecimalsMapForTest(items: OverallScoreDisplayItem[]): Map<string, 1 | 2> {
  return buildOverallScoreDisplayDecimalsMap(items);
}

function getMatrixCellDisplayValue(
  valueNum: number | null,
  valueNum2: number | null,
  rawValue: string,
  valueNote: string | null
): string {
  const raw = rawValue.trim();
  if (!raw) return "--";

  const hasStarMarker = /[*∗﹡✱✳✻]/.test(raw);
  const pairMatch = raw.match(
    /^((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*((?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );

  if (pairMatch) {
    const [, first, second] = pairMatch;
    const hasCurrencySymbol = /[$¥€£]/.test(first) || /[$¥€£]/.test(second);

    if (hasCurrencySymbol) {
      return `${first.trim()} / ${second.trim()}`;
    }

    const firstNumeric = formatValueNumForDisplay(valueNum);
    const secondNumeric = formatValueNumForDisplay(valueNum2);

    if (firstNumeric !== null && secondNumeric !== null) {
      return `${firstNumeric} / ${secondNumeric}`;
    }

    return `${first.trim()} / ${second.trim()}`;
  }

  const currencySingleMatch = raw.match(/^((?:[$¥€£]\s*)[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (currencySingleMatch) {
    const [, value, tail] = currencySingleMatch;
    const tailText = tail.trim();

    if (!tailText) return value.trim();
    if (tailText === "*" || tailText.startsWith("*")) return `${value.trim()}*`;
    if (valueNote && valueNote.trim().length > 0) return value.trim();

    return `${value.trim()}${tailText}`;
  }

  const numericDisplay = formatValueNumForDisplay(valueNum);
  if (numericDisplay !== null) {
    return hasStarMarker ? `${numericDisplay}*` : numericDisplay;
  }

  const singleMatch = raw.match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/);
  if (singleMatch) {
    const [, value, tail] = singleMatch;
    const tailText = tail.trim();

    if (!tailText) return value;
    if (tailText === "*" || tailText.startsWith("*")) return `${value}*`;
    if (valueNote && valueNote.trim().length > 0) return value;

    return `${value}${tailText}`;
  }

  return raw;
}

function getMatrixCellValueIdentity(entry: MatrixCellEntry): string {
  if (entry.valueNum !== null || entry.valueNum2 !== null) {
    return `num:${entry.valueNum ?? ""}|${entry.valueNum2 ?? ""}`;
  }

  return `raw:${entry.valueRaw}`;
}

function getMatrixCellSourceValueDedupKey(entry: MatrixCellEntry): string {
  return `${entry.source ?? ""}__${getMatrixCellValueIdentity(entry)}`;
}

async function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持图片导出");
  }

  if (html2canvasLoaderPromise) {
    return html2canvasLoaderPromise;
  }

  html2canvasLoaderPromise = import("html2canvas-pro")
    .then((module) => {
      const html2canvas = module.default as Html2CanvasFn | undefined;
      if (typeof html2canvas !== "function") {
        throw new Error("截图引擎加载失败");
      }
      return html2canvas;
    })
    .catch((error) => {
      html2canvasLoaderPromise = null;
      throw error instanceof Error ? error : new Error("无法加载截图引擎");
    });

  return html2canvasLoaderPromise;
}

function resolveCaptureDimensions(element: HTMLElement): { width: number; height: number } {
  const table = element.querySelector("table") as HTMLElement | null;

  const widthSource = table
    ? Math.max(table.scrollWidth || 0, table.clientWidth || 0)
    : Math.max(element.scrollWidth || 0, element.clientWidth || 0);

  const heightSource = table
    ? Math.max(table.scrollHeight || 0, table.clientHeight || 0)
    : Math.max(element.scrollHeight || 0, element.clientHeight || 0);

  return {
    width: Math.max(1, Math.round(widthSource)),
    height: Math.max(1, Math.round(heightSource))
  };
}

export function __resolveCaptureDimensionsForTest(element: HTMLElement): { width: number; height: number } {
  return resolveCaptureDimensions(element);
}

async function renderElementToImageBlob(
  element: HTMLElement,
  scale: number,
  mimeType: ExportMimeType
): Promise<Blob> {
  const html2canvas = await loadHtml2Canvas();

  const { width, height } = resolveCaptureDimensions(element);
  const captureBottomPadding = 4;
  const captureHeight = height + captureBottomPadding;
  const captureAttr = "data-h2c-export-root";

  element.setAttribute(captureAttr, "1");

  const canvas = await (async () => {
    try {
      return await html2canvas(element, {
        backgroundColor: "#0b1020",
        scale,
        foreignObjectRendering: false,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        width,
        height: captureHeight,
        windowWidth: width,
        windowHeight: captureHeight,
        onclone: (clonedDoc: Document) => {
          const clonedRoot = clonedDoc.querySelector(`[${captureAttr}="1"]`) as HTMLElement | null;
          if (!clonedRoot) return;

          clonedRoot.style.overflow = "visible";
          clonedRoot.style.maxHeight = "none";
          clonedRoot.style.height = `${captureHeight}px`;
          clonedRoot.style.width = `${width}px`;

          const clonedTable = clonedRoot.querySelector("table") as HTMLTableElement | null;
          if (clonedTable) {
            clonedTable.style.minWidth = `${width}px`;
            clonedTable.style.borderCollapse = "separate";
            clonedTable.style.borderSpacing = "0";
          }

          const clonedModalityFilters = clonedRoot.querySelectorAll<HTMLElement>("[data-modality-filter='true']");
          clonedModalityFilters.forEach((filter) => {
            filter.removeAttribute("open");
            filter.querySelectorAll<HTMLElement>(".dropdown-content").forEach((panel) => {
              panel.style.display = "none";
            });
          });

          const exportSourceFrameColor = "rgba(93, 167, 255, 0.65)";
          const exportSourceFrameWidth = 2;
          applyExportOverallRowNudgeFallback(clonedRoot);
          applyExportSourceFrameFallback(clonedRoot, exportSourceFrameColor, exportSourceFrameWidth);
        }
      });
    } finally {
      element.removeAttribute(captureAttr);
    }
  })();

  const mimeCandidates = getMimeTypeFallbackChain(mimeType);

  let blob: Blob | null = null;
  for (const candidateMimeType of mimeCandidates) {
    const quality = getEncoderQuality(candidateMimeType);

    const blobFromCanvas = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        candidateMimeType,
        quality
      );
    });

    if (blobFromCanvas) {
      const actualType = blobFromCanvas.type.toLowerCase();
      if (actualType.includes(candidateMimeType.replace("image/", "")) || candidateMimeType === "image/png") {
        blob = blobFromCanvas;
        break;
      }
    }

    try {
      const dataUrl = canvas.toDataURL(candidateMimeType, quality);
      if (dataUrl.startsWith(`data:${candidateMimeType}`)) {
        blob = dataUrlToBlob(dataUrl);
        break;
      }
    } catch {
      // try next fallback type
    }
  }

  if (!blob) {
    throw new Error("图片导出失败");
  }

  return blob;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: number | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }) as Promise<T>;
}

export function BenchmarkMatrix({ rows, allRows = rows, sourceOptions: allSourceOptions = [] }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const showCategoryLoadedRef = useRef(false);
  const showDuplicateLoadedRef = useRef(false);
  const modelSelectionBySourceRef = useRef<Record<string, string[]>>({});
  const columnWidthBySourceRef = useRef<Record<string, Record<string, number>>>({});
  const columnWidthPersistTimeoutRef = useRef<number | null>(null);
  const heatmapPaletteLoadedRef = useRef(false);
  const columnResizeStateRef = useRef<{
    columnKey: string;
    startX: number;
    startWidth: number;
    minWidth: number;
    maxWidth: number;
  } | null>(null);
  const headerInteractionSuppressUntilRef = useRef(0);
  const exportPresetLoadedRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
  const [showDuplicateRows, setShowDuplicateRows] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const [isModelSelectionLoaded, setIsModelSelectionLoaded] = useState(false);
  const [isModelOrderLoaded, setIsModelOrderLoaded] = useState(false);
  const [isColumnWidthLoaded, setIsColumnWidthLoaded] = useState(false);
  const [activeColumnWidthMap, setActiveColumnWidthMap] = useState<Record<string, number>>({});
  const [resizingColumnKey, setResizingColumnKey] = useState<string | null>(null);
  const [modelOrderBySource, setModelOrderBySource] = useState<Record<string, string[]>>({});
  const [draggingModelName, setDraggingModelName] = useState<string | null>(null);
  const [dragOverModelName, setDragOverModelName] = useState<string | null>(null);
  const [dragInsertPosition, setDragInsertPosition] = useState<"before" | "after" | null>(null);
  const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPaletteHex>(DEFAULT_HEATMAP_PALETTE_HEX);
  const [heatmapAlpha, setHeatmapAlpha] = useState(DEFAULT_HEATMAP_ALPHA);
  const [heatmapPresetSelection, setHeatmapPresetSelection] = useState<HeatmapPresetSelection>(DEFAULT_HEATMAP_PRESET_KEY);
  const [exportPreset, setExportPreset] = useState<ExportPresetKey>(DEFAULT_EXPORT_PRESET);
  const [supportsWebpExport, setSupportsWebpExport] = useState(true);
  const [supportsAvifExport, setSupportsAvifExport] = useState(false);
  const [isModelFilterExpanded, setIsModelFilterExpanded] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExportMenuHovered, setIsExportMenuHovered] = useState(false);
  const [suppressHoverMenu, setSuppressHoverMenu] = useState(false);
  const [columnSortBenchmarkKey, setColumnSortBenchmarkKey] = useState<string | null>(null);
  const [rowSortState, setRowSortState] = useState<{ column: RowSortColumn; mode: RowSortMode }>({
    column: "benchmark",
    mode: "data"
  });
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [rowPresenceFilterModel, setRowPresenceFilterModel] = useState<string | null>(null);
  const [isDownloadingTableImage, setIsDownloadingTableImage] = useState(false);
  const [isCopyingTableImage, setIsCopyingTableImage] = useState(false);
  const [isExportCaptureMode, setIsExportCaptureMode] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copyNoticeVisible, setCopyNoticeVisible] = useState(false);
  const [activeCellTooltip, setActiveCellTooltip] = useState<{
    x: number;
    y: number;
    entries: MatrixCellEntry[];
    note: string | null;
  } | null>(null);
  const [activeOverallTooltip, setActiveOverallTooltip] = useState<{
    x: number;
    y: number;
    modelName: string;
    summary: OverallModelSummary;
  } | null>(null);

  const sourceOptions = useMemo(() => {
    const rowSourceKeys = rows.map((row) => getSourceKey(row.source));
    const externalSourceKeys = allSourceOptions.map((source) => getSourceKey(source));
    const keys = Array.from(new Set([...rowSourceKeys, ...externalSourceKeys])).sort(compareSourceTabKeysByVersion);

    return [
      { key: SOURCE_ALL, label: "全部" },
      ...keys.map((key) => ({ key, label: getSourceLabel(key) }))
    ];
  }, [rows, allSourceOptions]);

  const [activeSource, setActiveSource] = useState(SOURCE_ALL);
  const activeSourceRef = useRef(SOURCE_ALL);

  useEffect(() => {
    const sourceFromUrl = searchParams.get("source");
    const isKnown = sourceFromUrl
      ? sourceOptions.some((item) => item.key === sourceFromUrl)
      : false;
    const nextSource = sourceFromUrl && isKnown ? sourceFromUrl : SOURCE_ALL;

    setActiveSource((prev) => (prev === nextSource ? prev : nextSource));

    if (activeSourceRef.current !== nextSource) {
      const nextMode: RowSortMode = nextSource === SOURCE_ALL ? "data" : "source";
      setRowSortState((prev) => (prev.mode === nextMode ? prev : { ...prev, mode: nextMode }));
    }
  }, [searchParams, sourceOptions]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    activeSourceRef.current = activeSource;
  }, [activeSource]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const normalizedBySource: Record<string, string[]> = {};

          Object.entries(parsed).forEach(([sourceKey, value]) => {
            if (!Array.isArray(value)) return;

            const normalized = Array.from(
              new Set(value.filter((item): item is string => typeof item === "string"))
            ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

            normalizedBySource[sourceKey] = normalized;
          });

          modelSelectionBySourceRef.current = normalizedBySource;
        }
      }
    } catch {
      // ignore storage access errors gracefully
    }

    setIsModelSelectionLoaded(true);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODEL_ORDER_BY_SOURCE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const normalizedBySource: Record<string, string[]> = {};

          Object.entries(parsed).forEach(([sourceKey, value]) => {
            if (!Array.isArray(value)) return;

            normalizedBySource[sourceKey] = Array.from(
              new Set(value.filter((item): item is string => typeof item === "string"))
            );
          });

          setModelOrderBySource(normalizedBySource);
        }
      }
    } catch {
      // ignore storage access errors gracefully
    }

    setIsModelOrderLoaded(true);
  }, []);

  useEffect(() => {
    if (!isModelOrderLoaded) return;

    try {
      window.localStorage.setItem(MODEL_ORDER_BY_SOURCE_STORAGE_KEY, JSON.stringify(modelOrderBySource));
    } catch {
      // ignore storage access errors gracefully
    }
  }, [modelOrderBySource, isModelOrderLoaded]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as unknown;
        columnWidthBySourceRef.current = normalizeColumnWidthBySource(parsed);
      }
    } catch {
      // ignore storage access errors gracefully
    }

    setIsColumnWidthLoaded(true);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SHOW_CATEGORY_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        setShowCategory(saved === "1");
      }
    } catch {
      // ignore storage access errors gracefully
    }

    showCategoryLoadedRef.current = true;
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SHOW_DUPLICATE_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        setShowDuplicateRows(saved === "1");
      }
    } catch {
      // ignore storage access errors gracefully
    }

    showDuplicateLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!showCategoryLoadedRef.current) return;

    try {
      window.localStorage.setItem(SHOW_CATEGORY_STORAGE_KEY, showCategory ? "1" : "0");
    } catch {
      // ignore storage access errors gracefully
    }
  }, [showCategory]);

  useEffect(() => {
    if (!showDuplicateLoadedRef.current) return;

    try {
      window.localStorage.setItem(SHOW_DUPLICATE_STORAGE_KEY, showDuplicateRows ? "1" : "0");
    } catch {
      // ignore storage access errors gracefully
    }
  }, [showDuplicateRows]);

  useEffect(() => {
    setSelectedRowKey(null);
    setColumnSortBenchmarkKey(null);
  }, [showDuplicateRows]);

  useEffect(() => {
    setSupportsWebpExport(canEncodeCanvasMimeType("image/webp"));
    setSupportsAvifExport(canEncodeCanvasMimeType("image/avif"));
  }, []);

  const availableExportPresetKeys = useMemo(() => {
    return (Object.keys(EXPORT_PRESET_MAP) as ExportPresetKey[]).filter((key) => {
      const mimeType = EXPORT_PRESET_MAP[key].mimeType;
      if (mimeType === "image/webp" && !supportsWebpExport) return false;
      if (mimeType === "image/avif" && !supportsAvifExport) return false;
      return true;
    });
  }, [supportsWebpExport, supportsAvifExport]);

  useEffect(() => {
    if (availableExportPresetKeys.includes(exportPreset)) return;

    if (availableExportPresetKeys.includes(DEFAULT_EXPORT_PRESET)) {
      setExportPreset(DEFAULT_EXPORT_PRESET);
      return;
    }

    const fallback = availableExportPresetKeys[0];
    if (fallback) {
      setExportPreset(fallback);
    }
  }, [availableExportPresetKeys, exportPreset]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(EXPORT_PRESET_STORAGE_KEY);
      if (saved && isExportPresetKey(saved)) {
        setExportPreset(saved);
      }
    } catch {
      // ignore storage access errors gracefully
    }

    exportPresetLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!exportPresetLoadedRef.current) return;

    try {
      window.localStorage.setItem(EXPORT_PRESET_STORAGE_KEY, exportPreset);
    } catch {
      // ignore storage access errors gracefully
    }
  }, [exportPreset]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HEATMAP_PALETTE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          low?: unknown;
          mid?: unknown;
          high?: unknown;
          alpha?: unknown;
          preset?: unknown;
        };

        const nextPalette: HeatmapPaletteHex = {
          low: normalizeHexColor(typeof parsed.low === "string" ? parsed.low : "", DEFAULT_HEATMAP_PALETTE_HEX.low),
          mid: normalizeHexColor(typeof parsed.mid === "string" ? parsed.mid : "", DEFAULT_HEATMAP_PALETTE_HEX.mid),
          high: normalizeHexColor(typeof parsed.high === "string" ? parsed.high : "", DEFAULT_HEATMAP_PALETTE_HEX.high)
        };

        const presetRaw = typeof parsed.preset === "string" ? parsed.preset : "";
        const isKnownPreset = presetRaw in HEATMAP_PRESETS;
        const nextPresetSelection: HeatmapPresetSelection = isKnownPreset
          ? (presetRaw as HeatmapPresetKey)
          : "custom";
        const parsedAlpha = typeof parsed.alpha === "number" ? parsed.alpha : DEFAULT_HEATMAP_ALPHA;

        setHeatmapPalette(nextPalette);
        setHeatmapAlpha(clampHeatmapAlpha(parsedAlpha));
        setHeatmapPresetSelection(nextPresetSelection);
      }
    } catch {
      // ignore storage access errors gracefully
    }

    heatmapPaletteLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!heatmapPaletteLoadedRef.current) return;

    try {
      window.localStorage.setItem(
        HEATMAP_PALETTE_STORAGE_KEY,
        JSON.stringify({
          ...heatmapPalette,
          alpha: heatmapAlpha,
          preset: heatmapPresetSelection
        })
      );
    } catch {
      // ignore storage access errors gracefully
    }
  }, [heatmapPalette, heatmapAlpha, heatmapPresetSelection]);

  useEffect(() => {
    if (!copyNotice) return;

    setCopyNoticeVisible(true);

    const hideTimer = window.setTimeout(() => {
      setCopyNoticeVisible(false);
    }, 15000);

    const clearTimer = window.setTimeout(() => {
      setCopyNotice(null);
    }, 15500);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [copyNotice]);

  useEffect(() => {
    if (!isExportMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!exportMenuRef.current?.contains(target)) {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isExportMenuOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = columnResizeStateRef.current;
      if (!resizeState) return;

      const nextWidth = clampColumnWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX),
        resizeState.minWidth,
        resizeState.maxWidth
      );

      setActiveColumnWidthMap((prev) => {
        if (prev[resizeState.columnKey] === nextWidth) {
          return prev;
        }
        return {
          ...prev,
          [resizeState.columnKey]: nextWidth
        };
      });
    };

    const stopResize = () => {
      if (!columnResizeStateRef.current) return;
      suppressHeaderInteractionsFor();
      columnResizeStateRef.current = null;
      setResizingColumnKey(null);
      document.body.classList.remove("column-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("column-resizing");
    };
  }, []);

  const isImageActionBusy = isDownloadingTableImage || isCopyingTableImage;
  const showExportMenu = isExportMenuOpen || (!suppressHoverMenu && isExportMenuHovered);
  const heatmapPaletteRgb = useMemo<HeatmapPaletteRgb>(() => {
    return {
      low: hexToRgbTuple(heatmapPalette.low),
      mid: hexToRgbTuple(heatmapPalette.mid),
      high: hexToRgbTuple(heatmapPalette.high)
    };
  }, [heatmapPalette]);
  const heatmapGradientPreview = useMemo(
    () => `linear-gradient(90deg, ${rgbaFromHex(heatmapPalette.low, heatmapAlpha)} 0%, ${rgbaFromHex(heatmapPalette.mid, heatmapAlpha)} 50%, ${rgbaFromHex(heatmapPalette.high, heatmapAlpha)} 100%)`,
    [heatmapPalette, heatmapAlpha]
  );

  function updateHeatmapPaletteColor(key: keyof HeatmapPaletteHex, nextColor: string) {
    setHeatmapPalette((prev) => {
      const fallback = prev[key];
      const normalized = normalizeHexColor(nextColor, fallback);
      if (normalized === prev[key]) return prev;
      return {
        ...prev,
        [key]: normalized
      };
    });
    setHeatmapPresetSelection("custom");
  }

  function applyHeatmapPreset(nextPreset: HeatmapPresetKey) {
    const preset = HEATMAP_PRESETS[nextPreset];
    setHeatmapPalette({
      low: preset.low,
      mid: preset.mid,
      high: preset.high
    });
    setHeatmapPresetSelection(nextPreset);
  }

  function resetHeatmapPaletteToDefault() {
    applyHeatmapPreset(DEFAULT_HEATMAP_PRESET_KEY);
    setHeatmapAlpha(DEFAULT_HEATMAP_ALPHA);
  }

  function beginColumnResize(
    event: ReactPointerEvent<HTMLElement>,
    columnKey: string,
    currentWidth: number,
    minWidth: number,
    maxWidth: number
  ) {
    event.preventDefault();
    event.stopPropagation();

    columnResizeStateRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: currentWidth,
      minWidth,
      maxWidth
    };

    setResizingColumnKey(columnKey);
    document.body.classList.add("column-resizing");
    suppressHeaderInteractionsFor();
  }

  function suppressHeaderInteractionsFor(durationMs = 180) {
    headerInteractionSuppressUntilRef.current = Math.max(
      headerInteractionSuppressUntilRef.current,
      Date.now() + durationMs
    );
  }

  function shouldSuppressHeaderInteractions(): boolean {
    if (resizingColumnKey !== null) return true;
    return Date.now() < headerInteractionSuppressUntilRef.current;
  }

  function resetModelColumnDragState() {
    setDraggingModelName(null);
    setDragOverModelName(null);
    setDragInsertPosition(null);
  }

  function commitModelColumnReorder(draggingModel: string, targetModel: string, position: "before" | "after") {
    if (!draggingModel || draggingModel === targetModel) return;

    const visibleModelOrder = [...modelColumns];
    if (!visibleModelOrder.includes(draggingModel) || !visibleModelOrder.includes(targetModel)) return;

    const withoutDragging = visibleModelOrder.filter((modelName) => modelName !== draggingModel);
    const targetIndex = withoutDragging.indexOf(targetModel);
    if (targetIndex < 0) return;

    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    withoutDragging.splice(insertIndex, 0, draggingModel);

    setModelOrderBySource((prev) => {
      const previousForSource = prev[activeSource] ?? [];
      if (
        previousForSource.length === withoutDragging.length &&
        previousForSource.every((item, index) => item === withoutDragging[index])
      ) {
        return prev;
      }

      return {
        ...prev,
        [activeSource]: withoutDragging
      };
    });
  }

  function setSourceAndUrl(nextSource: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSource === SOURCE_ALL) {
      params.delete("source");
    } else {
      params.set("source", nextSource);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const rowsBySource = useMemo(() => {
    const map = new Map<string, MatrixInputRow[]>();

    allRows.forEach((row) => {
      const sourceKey = getSourceKey(row.source);
      if (!map.has(sourceKey)) {
        map.set(sourceKey, []);
      }
      map.get(sourceKey)!.push(row);
    });

    return map;
  }, [allRows]);

  const allRowsIndex = useMemo(() => {
    const modelProviderMap = new Map<string, string>();
    const rowsByModel = new Map<string, IndexedMatrixInputRow[]>();
    const rowsByGroupingKey = new Map<string, IndexedMatrixInputRow[]>();

    allRows.forEach((row) => {
      if (!modelProviderMap.has(row.modelName)) {
        modelProviderMap.set(row.modelName, row.providerName);
      }

      const indexed: IndexedMatrixInputRow = {
        row,
        matrixKey: getMatrixGroupingKey(row, showDuplicateRows)
      };

      if (!rowsByModel.has(row.modelName)) {
        rowsByModel.set(row.modelName, []);
      }
      rowsByModel.get(row.modelName)!.push(indexed);

      if (!rowsByGroupingKey.has(indexed.matrixKey)) {
        rowsByGroupingKey.set(indexed.matrixKey, []);
      }
      rowsByGroupingKey.get(indexed.matrixKey)!.push(indexed);
    });

    return {
      modelProviderMap,
      rowsByModel,
      rowsByGroupingKey
    };
  }, [allRows, showDuplicateRows]);

  const baseSourceRows = useMemo(() => {
    if (activeSource === SOURCE_ALL) {
      return allRows;
    }

    if (rows.length > 0) {
      return rows;
    }

    return rowsBySource.get(activeSource) ?? [];
  }, [allRows, rows, rowsBySource, activeSource]);

  const baseBenchmarkKeySet = useMemo(() => {
    const keys = new Set<string>();
    baseSourceRows.forEach((row) => {
      keys.add(getMatrixGroupingKey(row, showDuplicateRows));
    });
    return keys;
  }, [baseSourceRows, showDuplicateRows]);

  const baseModelNameSet = useMemo(() => {
    return new Set(baseSourceRows.map((row) => row.modelName));
  }, [baseSourceRows]);

  const sourceTabMatchLabel = useMemo(() => {
    if (activeSource === SOURCE_ALL) return "";
    return sourceTabDisplayLabel(activeSource).trim();
  }, [activeSource]);

  const sourceModelHint = useMemo(() => {
    if (!sourceTabMatchLabel) return "";
    return normalizeMatchToken(sourceTabMatchLabel);
  }, [sourceTabMatchLabel]);

  const coverageMetaByModel = useMemo(() => {
    const modelCoveredBenchmarkKeys = new Map<string, Set<string>>();

    baseBenchmarkKeySet.forEach((matrixKey) => {
      const groupedRows = allRowsIndex.rowsByGroupingKey.get(matrixKey);
      if (!groupedRows || groupedRows.length === 0) return;

      groupedRows.forEach(({ row }) => {
        if (!modelCoveredBenchmarkKeys.has(row.modelName)) {
          modelCoveredBenchmarkKeys.set(row.modelName, new Set<string>());
        }
        modelCoveredBenchmarkKeys.get(row.modelName)!.add(matrixKey);
      });
    });

    const totalBenchmarkCount = baseBenchmarkKeySet.size;
    const metaMap = new Map<
      string,
      { providerName: string; coveredCount: number; coverageRate: number; isBaseModel: boolean }
    >();

    for (const [modelName, providerNameRaw] of allRowsIndex.modelProviderMap.entries()) {
      const coveredCount = modelCoveredBenchmarkKeys.get(modelName)?.size ?? 0;
      if (coveredCount <= 0) continue;

      const providerName = providerNameRaw || "Unknown";

      metaMap.set(modelName, {
        providerName,
        coveredCount,
        coverageRate: totalBenchmarkCount > 0 ? coveredCount / totalBenchmarkCount : 0,
        isBaseModel: baseModelNameSet.has(modelName)
      });
    }

    return metaMap;
  }, [allRowsIndex, baseBenchmarkKeySet, baseModelNameSet]);

  const providerGroups = useMemo(() => {
    const map = new Map<string, string[]>();

    coverageMetaByModel.forEach((meta, modelName) => {
      if (!map.has(meta.providerName)) {
        map.set(meta.providerName, []);
      }
      map.get(meta.providerName)!.push(modelName);
    });

    return Array.from(map.entries())
      .map(([providerName, modelList]) => {
        const models = [...modelList].sort((left, right) => {
          const leftMeta = coverageMetaByModel.get(left);
          const rightMeta = coverageMetaByModel.get(right);

          const leftIsBase = leftMeta?.isBaseModel ? 1 : 0;
          const rightIsBase = rightMeta?.isBaseModel ? 1 : 0;
          if (rightIsBase !== leftIsBase) {
            return rightIsBase - leftIsBase;
          }

          const leftCoverage = leftMeta?.coverageRate ?? 0;
          const rightCoverage = rightMeta?.coverageRate ?? 0;
          if (rightCoverage !== leftCoverage) {
            return rightCoverage - leftCoverage;
          }

          return left.localeCompare(right, "zh-Hans-CN", { sensitivity: "base" });
        });

        const providerCoverageAverage = models.length > 0
          ? models.reduce((acc, modelName) => acc + (coverageMetaByModel.get(modelName)?.coverageRate ?? 0), 0) / models.length
          : 0;

        const normalizedProvider = normalizeMatchToken(providerName);
        const isSourceRelated = sourceModelHint.length > 0 && (
          normalizedProvider.includes(sourceModelHint) ||
          models.some((modelName) => normalizeMatchToken(modelName).includes(sourceModelHint))
        );

        return {
          providerName,
          models,
          providerCoverageAverage,
          isSourceRelated
        };
      })
      .sort((left, right) => {
        const leftSourceRelated = left.isSourceRelated ? 1 : 0;
        const rightSourceRelated = right.isSourceRelated ? 1 : 0;
        if (rightSourceRelated !== leftSourceRelated) {
          return rightSourceRelated - leftSourceRelated;
        }

        if (right.providerCoverageAverage !== left.providerCoverageAverage) {
          return right.providerCoverageAverage - left.providerCoverageAverage;
        }

        if (right.models.length !== left.models.length) {
          return right.models.length - left.models.length;
        }

        return left.providerName.localeCompare(right.providerName, "zh-Hans-CN", { sensitivity: "base" });
      })
      .map((item) => ({
        providerName: item.providerName,
        models: item.models
      }));
  }, [coverageMetaByModel, sourceModelHint]);

  const modelCoveragePercentMap = useMemo(() => {
    const map = new Map<string, number>();
    coverageMetaByModel.forEach((meta, modelName) => {
      map.set(modelName, Math.round(meta.coverageRate * 100));
    });
    return map;
  }, [coverageMetaByModel]);

  const providerAverageCoveragePercentMap = useMemo(() => {
    const map = new Map<string, number>();

    providerGroups.forEach((group) => {
      if (group.models.length === 0) {
        map.set(group.providerName, 0);
        return;
      }

      const totalCoverage = group.models.reduce((acc, modelName) => {
        return acc + (coverageMetaByModel.get(modelName)?.coverageRate ?? 0);
      }, 0);

      map.set(group.providerName, Math.round((totalCoverage / group.models.length) * 100));
    });

    return map;
  }, [providerGroups, coverageMetaByModel]);

  const allModelNames = useMemo(
    () => providerGroups.flatMap((group) => group.models).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    [providerGroups]
  );

  const defaultSelectedModels = useMemo(() => {
    const selectableSet = new Set(allModelNames);
    return Array.from(baseModelNameSet)
      .filter((modelName) => selectableSet.has(modelName))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [allModelNames, baseModelNameSet]);

  const [selectedModalities, setSelectedModalities] = useState<string[]>([...MODALITY_OPTIONS]);
  const [selectedModels, setSelectedModels] = useState<string[]>(allModelNames);

  useLayoutEffect(() => {
    if (!isModelSelectionLoaded) return;

    if (activeSource !== SOURCE_ALL && rows.length > 0 && baseSourceRows.length === 0) {
      return;
    }

    const allModelSet = new Set(allModelNames);
    const savedForSource = modelSelectionBySourceRef.current[activeSource];
    const fallbackDefaultModels = activeSource === SOURCE_ALL
      ? [...allModelNames]
      : [...defaultSelectedModels];
    let nextSelected: string[];

    if (!savedForSource) {
      nextSelected = fallbackDefaultModels;
    } else if (savedForSource.length === 0) {
      nextSelected = [];
    } else {
      const kept = savedForSource.filter((modelName) => allModelSet.has(modelName));
      nextSelected = kept.length > 0 ? kept : fallbackDefaultModels;
    }

    const normalized = Array.from(new Set(nextSelected)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

    setSelectedModels((prev) => {
      if (prev.length === normalized.length && prev.every((item, index) => item === normalized[index])) {
        return prev;
      }
      return normalized;
    });
  }, [activeSource, allModelNames, defaultSelectedModels, isModelSelectionLoaded, rows.length, baseSourceRows.length]);

  useEffect(() => {
    if (!isModelSelectionLoaded) return;

    const sourceKey = activeSourceRef.current;
    const normalized = Array.from(new Set(selectedModels)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const fallbackDefaultModels = sourceKey === SOURCE_ALL
      ? [...allModelNames]
      : [...defaultSelectedModels];
    const normalizedDefault = Array.from(new Set(fallbackDefaultModels)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const isDefaultSelection =
      normalized.length === normalizedDefault.length
      && normalized.every((item, index) => item === normalizedDefault[index]);

    const previous = modelSelectionBySourceRef.current[sourceKey] ?? [];

    if (!isDefaultSelection) {
      if (previous.length === normalized.length && previous.every((item, index) => item === normalized[index])) {
        return;
      }

      modelSelectionBySourceRef.current = {
        ...modelSelectionBySourceRef.current,
        [sourceKey]: normalized
      };
    } else {
      if (!(sourceKey in modelSelectionBySourceRef.current)) {
        return;
      }

      const nextSelectionBySource = { ...modelSelectionBySourceRef.current };
      delete nextSelectionBySource[sourceKey];
      modelSelectionBySourceRef.current = nextSelectionBySource;
    }

    try {
      window.localStorage.setItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY, JSON.stringify(modelSelectionBySourceRef.current));
    } catch {
      // ignore storage access errors gracefully
    }
  }, [selectedModels, isModelSelectionLoaded, allModelNames, defaultSelectedModels]);

  useEffect(() => {
    const listener = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);
  const selectedModalitySet = useMemo(() => new Set(selectedModalities), [selectedModalities]);

  const modelProviderMap = allRowsIndex.modelProviderMap;

  const filteredRows = useMemo(() => {
    if (selectedModelSet.size === 0 || baseBenchmarkKeySet.size === 0) {
      return [];
    }

    const result: MatrixInputRow[] = [];

    selectedModels.forEach((modelName) => {
      const indexedRows = allRowsIndex.rowsByModel.get(modelName);
      if (!indexedRows || indexedRows.length === 0) {
        return;
      }

      indexedRows.forEach((indexed) => {
        if (baseBenchmarkKeySet.has(indexed.matrixKey)) {
          result.push(indexed.row);
        }
      });
    });

    return result;
  }, [allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet]);

  const modelColumns = useMemo(() => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    const modelStats = new Map<string, { providerName: string; numericCount: number; totalCount: number }>();

    filteredRows.forEach((row) => {
      const current = modelStats.get(row.modelName) ?? {
        providerName: row.providerName || "Unknown",
        numericCount: 0,
        totalCount: 0
      };

      current.totalCount += 1;
      if (row.valueNum !== null) {
        current.numericCount += 1;
      }

      if (!current.providerName) {
        current.providerName = row.providerName || "Unknown";
      }

      modelStats.set(row.modelName, current);
    });

    const providerStats = new Map<string, { numericCount: number; totalCount: number; models: string[] }>();
    for (const [modelName, stats] of modelStats.entries()) {
      const providerName = stats.providerName || "Unknown";
      const provider = providerStats.get(providerName) ?? { numericCount: 0, totalCount: 0, models: [] };
      provider.numericCount += stats.numericCount;
      provider.totalCount += stats.totalCount;
      provider.models.push(modelName);
      providerStats.set(providerName, provider);
    }

    const orderedProviders = Array.from(providerStats.entries()).sort((a, b) => {
      const left = a[1];
      const right = b[1];
      if (right.numericCount !== left.numericCount) {
        return right.numericCount - left.numericCount;
      }
      if (right.totalCount !== left.totalCount) {
        return right.totalCount - left.totalCount;
      }
      return a[0].localeCompare(b[0], "zh-Hans-CN", { sensitivity: "base" });
    });

    const groupedModels = orderedProviders.flatMap(([, provider]) => {
      return [...provider.models].sort((leftModel, rightModel) => {
        const leftStats = modelStats.get(leftModel);
        const rightStats = modelStats.get(rightModel);
        if (!leftStats || !rightStats) return compareModelNameByColumnOrder(leftModel, rightModel, collator);

        const modelNameCompare = compareModelNameByColumnOrder(leftModel, rightModel, collator);
        if (modelNameCompare !== 0) {
          return modelNameCompare;
        }

        if (rightStats.numericCount !== leftStats.numericCount) {
          return rightStats.numericCount - leftStats.numericCount;
        }
        if (rightStats.totalCount !== leftStats.totalCount) {
          return rightStats.totalCount - leftStats.totalCount;
        }
        return 0;
      });
    });

    const baseOrderedModels = (() => {
      if (!sourceModelHint) return groupedModels;

      const matched: string[] = [];
      const others: string[] = [];

      groupedModels.forEach((modelName) => {
        const normalizedModel = normalizeMatchToken(modelName);
        if (normalizedModel.includes(sourceModelHint)) {
          matched.push(modelName);
        } else {
          others.push(modelName);
        }
      });

      matched.sort((left, right) => compareModelNameByColumnOrder(left, right, collator));
      return [...matched, ...others];
    })();

    const orderedByManual = (() => {
      const savedOrder = modelOrderBySource[activeSource] ?? [];
      if (savedOrder.length === 0) return baseOrderedModels;

      const savedIndex = new Map(savedOrder.map((modelName, index) => [modelName, index]));
      const baseIndex = new Map(baseOrderedModels.map((modelName, index) => [modelName, index]));

      return [...baseOrderedModels].sort((left, right) => {
        const leftSaved = savedIndex.get(left);
        const rightSaved = savedIndex.get(right);

        if (leftSaved !== undefined && rightSaved !== undefined) {
          return leftSaved - rightSaved;
        }
        if (leftSaved !== undefined) return -1;
        if (rightSaved !== undefined) return 1;

        return (baseIndex.get(left) ?? 0) - (baseIndex.get(right) ?? 0);
      });
    })();

    if (!columnSortBenchmarkKey) {
      return orderedByManual;
    }

    const benchmarkScoreMap = new Map<string, number>();
    filteredRows.forEach((row) => {
      if (getMatrixGroupingKey(row, showDuplicateRows) !== columnSortBenchmarkKey || row.valueNum === null) {
        return;
      }

      const comparableScore = getBenchmarkComparableScore(row.benchmarkName, row.valueNum, row.benchmarkType);
      const previous = benchmarkScoreMap.get(row.modelName);
      if (previous === undefined || comparableScore > previous) {
        benchmarkScoreMap.set(row.modelName, comparableScore);
      }
    });

    const baseOrderIndex = new Map(orderedByManual.map((modelName, index) => [modelName, index]));

    return [...orderedByManual].sort((leftModel, rightModel) => {
      const leftScore = benchmarkScoreMap.get(leftModel);
      const rightScore = benchmarkScoreMap.get(rightModel);

      if (leftScore === undefined && rightScore === undefined) {
        return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
      }
      if (leftScore === undefined) return 1;
      if (rightScore === undefined) return -1;
      if (rightScore !== leftScore) return rightScore - leftScore;

      return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
    });
  }, [filteredRows, sourceModelHint, columnSortBenchmarkKey, showDuplicateRows, modelOrderBySource, activeSource]);

  useEffect(() => {
    if (!rowPresenceFilterModel) return;
    if (modelColumns.includes(rowPresenceFilterModel)) return;
    setRowPresenceFilterModel(null);
  }, [modelColumns, rowPresenceFilterModel]);

  const autoModelWidthMap = useMemo(() => {
    const map = new Map<string, number>();
    const valueWidthByModel = new Map<string, number>();

    const measureTextWidth = (() => {
      if (typeof document === "undefined") {
        return (text: string) => text.length * 7;
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        return (text: string) => text.length * 7;
      }

      return (text: string, font: string) => {
        context.font = font;
        return context.measureText(text).width;
      };
    })();

    const entriesByGroup = new Map<string, MatrixCellEntry[]>();
    const preferredEntryByGroup = new Map<string, MatrixCellEntry>();
    const modelNameByGroup = new Map<string, string>();

    filteredRows.forEach((row) => {
      const groupKey = `${getMatrixGroupingKey(row, showDuplicateRows)}::${row.modelName}`;

      const entry: MatrixCellEntry = {
        valueRaw: row.valueRaw,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2 ?? null,
        valueNote: row.valueNote,
        source: row.source,
        benchTime: row.benchTime
      };

      if (!entriesByGroup.has(groupKey)) {
        entriesByGroup.set(groupKey, []);
      }
      entriesByGroup.get(groupKey)!.push(entry);

      const preferred = preferredEntryByGroup.get(groupKey);
      if (!preferred || (entry.valueNum !== null && (preferred.valueNum === null || entry.valueNum > preferred.valueNum))) {
        preferredEntryByGroup.set(groupKey, entry);
      }

      modelNameByGroup.set(groupKey, row.modelName);
    });

    entriesByGroup.forEach((entries, groupKey) => {
      const modelName = modelNameByGroup.get(groupKey);
      if (!modelName || entries.length === 0) return;

      const preferredEntry = preferredEntryByGroup.get(groupKey) ?? entries[0]!;
      const displayValue = getMatrixCellDisplayValue(
        preferredEntry.valueNum,
        preferredEntry.valueNum2,
        preferredEntry.valueRaw,
        preferredEntry.valueNote
      );

      const uniqueEntriesMap = new Map<string, MatrixCellEntry>();
      entries.forEach((entry) => {
        const dedupKey = getMatrixCellSourceValueDedupKey(entry);
        if (!uniqueEntriesMap.has(dedupKey)) {
          uniqueEntriesMap.set(dedupKey, entry);
        }
      });

      const uniqueEntries = Array.from(uniqueEntriesMap.values());
      const valueIdentitySet = new Set(uniqueEntries.map((entry) => getMatrixCellValueIdentity(entry)));
      const noteText = (preferredEntry.valueNote ?? "").trim();
      const hasMeaningfulMultipleValues = uniqueEntries.length > 1 && valueIdentitySet.size > 1;
      const questionMarkPadding = hasMeaningfulMultipleValues || noteText.length > 0 ? 16 : 0;

      const compactDisplayValue = displayValue.replace(/\s*\/\s*/g, "/");
      const measured = measureTextWidth(compactDisplayValue, "600 14px Inter, ui-sans-serif, system-ui") + 18 + questionMarkPadding;
      const previous = valueWidthByModel.get(modelName) ?? 0;

      if (measured > previous) {
        valueWidthByModel.set(modelName, measured);
      }
    });

    modelColumns.forEach((modelName) => {
      const valueWidth = valueWidthByModel.get(modelName) ?? 0;
      const autoWidth = clampColumnWidth(
        Math.max(DEFAULT_MODEL_COLUMN_BASELINE_WIDTH, valueWidth),
        MIN_MODEL_COLUMN_RESIZE_WIDTH,
        MAX_MODEL_COLUMN_WIDTH
      );

      map.set(getModelColumnWidthKey(modelName), autoWidth);
    });

    return map;
  }, [modelColumns, filteredRows, showDuplicateRows]);

  useEffect(() => {
    if (!isColumnWidthLoaded) return;

    const savedForSource = columnWidthBySourceRef.current[activeSource] ?? {};
    const nextMap: Record<string, number> = {
      ...savedForSource,
      [CATEGORY_COLUMN_WIDTH_KEY]: clampColumnWidth(
        savedForSource[CATEGORY_COLUMN_WIDTH_KEY] ?? DEFAULT_CATEGORY_COLUMN_WIDTH,
        MIN_CATEGORY_COLUMN_WIDTH,
        MAX_CATEGORY_COLUMN_WIDTH
      ),
      [BENCHMARK_COLUMN_WIDTH_KEY]: clampColumnWidth(
        savedForSource[BENCHMARK_COLUMN_WIDTH_KEY] ?? DEFAULT_BENCHMARK_COLUMN_WIDTH,
        MIN_BENCHMARK_COLUMN_WIDTH,
        MAX_BENCHMARK_COLUMN_WIDTH
      )
    };

    autoModelWidthMap.forEach((autoWidth, modelWidthKey) => {
      const stored = savedForSource[modelWidthKey];
      nextMap[modelWidthKey] = clampColumnWidth(
        stored ?? autoWidth,
        MIN_MODEL_COLUMN_RESIZE_WIDTH,
        MAX_MODEL_COLUMN_WIDTH
      );
    });

    setActiveColumnWidthMap((prev) => (areColumnWidthMapsEqual(prev, nextMap) ? prev : nextMap));
  }, [activeSource, autoModelWidthMap, isColumnWidthLoaded]);

  useEffect(() => {
    if (!isColumnWidthLoaded) return;

    const sourceKey = activeSourceRef.current;
    const previousForSource = columnWidthBySourceRef.current[sourceKey] ?? {};

    if (areColumnWidthMapsEqual(previousForSource, activeColumnWidthMap)) {
      return;
    }

    columnWidthBySourceRef.current = {
      ...columnWidthBySourceRef.current,
      [sourceKey]: activeColumnWidthMap
    };

    if (columnWidthPersistTimeoutRef.current !== null) {
      window.clearTimeout(columnWidthPersistTimeoutRef.current);
    }

    columnWidthPersistTimeoutRef.current = window.setTimeout(() => {
      columnWidthPersistTimeoutRef.current = null;

      try {
        window.localStorage.setItem(COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY, JSON.stringify(columnWidthBySourceRef.current));
      } catch {
        // ignore storage access errors gracefully
      }
    }, COLUMN_WIDTH_STORAGE_DEBOUNCE_MS);
  }, [activeColumnWidthMap, isColumnWidthLoaded]);

  useEffect(() => {
    return () => {
      if (columnWidthPersistTimeoutRef.current !== null) {
        window.clearTimeout(columnWidthPersistTimeoutRef.current);
        columnWidthPersistTimeoutRef.current = null;
      }
    };
  }, []);

  const categoryColumnWidth = useMemo(
    () => clampColumnWidth(
      activeColumnWidthMap[CATEGORY_COLUMN_WIDTH_KEY] ?? DEFAULT_CATEGORY_COLUMN_WIDTH,
      MIN_CATEGORY_COLUMN_WIDTH,
      MAX_CATEGORY_COLUMN_WIDTH
    ),
    [activeColumnWidthMap]
  );

  const benchmarkColumnWidth = useMemo(
    () => clampColumnWidth(
      activeColumnWidthMap[BENCHMARK_COLUMN_WIDTH_KEY] ?? DEFAULT_BENCHMARK_COLUMN_WIDTH,
      MIN_BENCHMARK_COLUMN_WIDTH,
      MAX_BENCHMARK_COLUMN_WIDTH
    ),
    [activeColumnWidthMap]
  );

  const sourceMatchedModelSet = useMemo(() => {
    if (!sourceTabMatchLabel) return new Set<string>();

    return new Set(
      modelColumns.filter((modelName) => isSourceHeaderPrefixMatch(modelName, sourceTabMatchLabel))
    );
  }, [modelColumns, sourceTabMatchLabel]);

  const sourceMatchedGroupBoundaryByModel = useMemo(() => {
    const firstSet = new Set<string>();
    const lastSet = new Set<string>();

    modelColumns.forEach((modelName, index) => {
      if (!sourceMatchedModelSet.has(modelName)) return;

      const previousModel = modelColumns[index - 1];
      const nextModel = modelColumns[index + 1];
      const hasPreviousMatched = previousModel ? sourceMatchedModelSet.has(previousModel) : false;
      const hasNextMatched = nextModel ? sourceMatchedModelSet.has(nextModel) : false;

      if (!hasPreviousMatched) {
        firstSet.add(modelName);
      }

      if (!hasNextMatched) {
        lastSet.add(modelName);
      }
    });

    return {
      firstSet,
      lastSet
    };
  }, [modelColumns, sourceMatchedModelSet]);

  const modelColumnMeta = useMemo(() => {
    return modelColumns.map((modelName) => {
      const providerName = modelProviderMap.get(modelName) ?? "Unknown";
      const columnWidthKey = getModelColumnWidthKey(modelName);
      const autoWidth = autoModelWidthMap.get(columnWidthKey) ?? DEFAULT_MODEL_COLUMN_BASELINE_WIDTH;
      const columnWidth = clampColumnWidth(
        activeColumnWidthMap[columnWidthKey] ?? autoWidth,
        MIN_MODEL_COLUMN_RESIZE_WIDTH,
        MAX_MODEL_COLUMN_WIDTH
      );

      return {
        modelName,
        columnWidthKey,
        providerName,
        color: getProviderBrandColor(providerName),
        columnWidth,
        isSourceMatched: sourceMatchedModelSet.has(modelName),
        isSourceMatchedFirst: sourceMatchedGroupBoundaryByModel.firstSet.has(modelName),
        isSourceMatchedLast: sourceMatchedGroupBoundaryByModel.lastSet.has(modelName)
      };
    });
  }, [
    modelColumns,
    modelProviderMap,
    sourceMatchedModelSet,
    sourceMatchedGroupBoundaryByModel,
    autoModelWidthMap,
    activeColumnWidthMap
  ]);

  const hiddenResizeHandleKeys = useMemo(() => {
    const hidden = new Set<string>();

    modelColumnMeta.forEach((model, index) => {
      if (model.isSourceMatchedFirst) {
        if (index === 0) {
          hidden.add(BENCHMARK_COLUMN_WIDTH_KEY);
        } else {
          const previousModel = modelColumnMeta[index - 1];
          if (previousModel) {
            hidden.add(previousModel.columnWidthKey);
          }
        }
      }

      if (model.isSourceMatchedLast) {
        hidden.add(model.columnWidthKey);
      }
    });

    return hidden;
  }, [modelColumnMeta]);

  const matrixRows = useMemo(() => {
    const matrixMap = new Map<
      string,
      MatrixRow & {
        categoryValues: string[];
        benchmarkValues: string[];
      }
    >();

    baseSourceRows.forEach((row, rowIndex) => {
      const category = row.benchmarkType || "General";
      const benchmark = row.benchmarkName;
      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      const normalizedModalities = normalizeModalityList(row.modalities, row.benchmarkType);

      if (!matrixMap.has(matrixKey)) {
        matrixMap.set(matrixKey, {
          rowKey: matrixKey,
          category,
          benchmark,
          categoryValues: [category],
          benchmarkValues: [benchmark],
          modalities: normalizedModalities,
          cells: new Map<string, MatrixCell>(),
          firstSeenIndex: rowIndex,
          sourceOrderKey: typeof row.recordId === "number" ? row.recordId : null,
          rowDataCount: 0,
          rowNumericCount: 0,
          minComparable: null,
          maxComparable: null,
          minComparable2: null,
          maxComparable2: null,
          minNum: null,
          maxNum: null,
          minNum2: null,
          maxNum2: null
        });
      }

      const matrixRow = matrixMap.get(matrixKey)!;

      if (typeof row.recordId === "number") {
        if (matrixRow.sourceOrderKey === null || row.recordId < matrixRow.sourceOrderKey) {
          matrixRow.sourceOrderKey = row.recordId;
        }
      }

      if (!matrixRow.categoryValues.includes(category)) {
        matrixRow.categoryValues.push(category);
        matrixRow.category = matrixRow.categoryValues.join(" / ");
      }

      if (!matrixRow.benchmarkValues.includes(benchmark)) {
        matrixRow.benchmarkValues.push(benchmark);
        matrixRow.benchmark = showDuplicateRows
          ? matrixRow.benchmarkValues.join(" / ")
          : pickPreferredBenchmarkDisplayName(matrixRow.benchmark, benchmark);
      }

      matrixRow.modalities = normalizeModalityList(
        [...matrixRow.modalities, ...normalizedModalities],
        matrixRow.categoryValues[0] ?? "General"
      );
    });

    filteredRows.forEach((row) => {
      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      const matrixRow = matrixMap.get(matrixKey);
      if (!matrixRow) {
        return;
      }

      if (!matrixRow.cells.has(row.modelName)) {
        const initialEntry: MatrixCellEntry = {
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNum2: row.valueNum2 ?? null,
          valueNote: row.valueNote,
          source: row.source,
          benchTime: row.benchTime
        };
        const noteText = (row.valueNote ?? "").trim();

        matrixRow.cells.set(row.modelName, {
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNum2: row.valueNum2 ?? null,
          valueNote: row.valueNote,
          source: row.source,
          benchTime: row.benchTime,
          allEntries: [initialEntry],
          hasMultipleValues: false,
          uniqueEntries: [initialEntry],
          noteText,
          displayValue: getMatrixCellDisplayValue(row.valueNum, row.valueNum2 ?? null, row.valueRaw, row.valueNote),
          hasMeaningfulMultipleValues: false,
          shouldShowQuestionMark: noteText.length > 0
        });
      } else {
        const existingCell = matrixRow.cells.get(row.modelName)!;
        existingCell.allEntries.push({
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNum2: row.valueNum2 ?? null,
          valueNote: row.valueNote,
          source: row.source,
          benchTime: row.benchTime
        });
        existingCell.hasMultipleValues = existingCell.allEntries.length > 1;

        if (row.valueNum !== null && (existingCell.valueNum === null || row.valueNum > existingCell.valueNum)) {
          existingCell.valueNum = row.valueNum;
          existingCell.valueNum2 = row.valueNum2 ?? null;
          existingCell.valueRaw = row.valueRaw;
          existingCell.valueNote = row.valueNote;
          existingCell.source = row.source;
          existingCell.benchTime = row.benchTime;
        }
      }
    });

    return Array.from(matrixMap.values())
      .map((matrixRow) => {
        const finalizedCells = new Map<string, MatrixCell>();

        matrixRow.cells.forEach((cell, modelName) => {
          const uniqueEntriesMap = new Map<string, MatrixCellEntry>();
          cell.allEntries.forEach((entry) => {
            const dedupKey = getMatrixCellSourceValueDedupKey(entry);
            if (!uniqueEntriesMap.has(dedupKey)) {
              uniqueEntriesMap.set(dedupKey, entry);
            }
          });

          const uniqueEntries = Array.from(uniqueEntriesMap.values());
          const valueIdentitySet = new Set(uniqueEntries.map((entry) => getMatrixCellValueIdentity(entry)));
          const noteText = (cell.valueNote ?? "").trim();
          const hasMeaningfulMultipleValues = uniqueEntries.length > 1 && valueIdentitySet.size > 1;

          finalizedCells.set(modelName, {
            ...cell,
            uniqueEntries,
            noteText,
            displayValue: getMatrixCellDisplayValue(cell.valueNum, cell.valueNum2, cell.valueRaw, cell.valueNote),
            hasMeaningfulMultipleValues,
            shouldShowQuestionMark: hasMeaningfulMultipleValues || noteText.length > 0
          });
        });

        const numericValues = Array.from(finalizedCells.values())
          .map((cell) => cell.valueNum)
          .filter((value): value is number => value !== null && Number.isFinite(value));

        const numericValues2 = Array.from(finalizedCells.values())
          .map((cell) => cell.valueNum2)
          .filter((value): value is number => value !== null && Number.isFinite(value));

        const comparableValues = numericValues.map((valueNum) =>
          getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category)
        );

        const comparableValues2 = numericValues2.map((valueNum) =>
          getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category)
        );

        const rowDataCount = matrixRow.cells.size;
        const rowNumericCount = numericValues.length;

        return {
          ...matrixRow,
          cells: finalizedCells,
          rowDataCount,
          rowNumericCount,
          minComparable: comparableValues.length > 0 ? Math.min(...comparableValues) : null,
          maxComparable: comparableValues.length > 0 ? Math.max(...comparableValues) : null,
          minComparable2: comparableValues2.length > 0 ? Math.min(...comparableValues2) : null,
          maxComparable2: comparableValues2.length > 0 ? Math.max(...comparableValues2) : null,
          minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
          maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null,
          minNum2: numericValues2.length > 0 ? Math.min(...numericValues2) : null,
          maxNum2: numericValues2.length > 0 ? Math.max(...numericValues2) : null
        };
      })
      .sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
  }, [baseSourceRows, filteredRows, showDuplicateRows]);

  function getRowSortCycle(): RowSortMode[] {
    return activeSource === SOURCE_ALL
      ? ["data", "alpha"]
      : ["source", "alpha", "data"];
  }

  function nextRowSortMode(mode: RowSortMode): RowSortMode {
    const cycle = getRowSortCycle();
    const index = cycle.indexOf(mode);
    if (index < 0) return cycle[0] ?? "source";
    return cycle[(index + 1) % cycle.length] ?? "source";
  }

  function getInactiveColumnBaseMode(): RowSortMode {
    return activeSource === SOURCE_ALL ? "data" : "source";
  }

  function getEffectiveSortMode(mode: RowSortMode): RowSortMode {
    if (activeSource === SOURCE_ALL && mode === "source") {
      return "data";
    }
    return mode;
  }

  function toggleRowSort(column: RowSortColumn) {
    const baseMode = getInactiveColumnBaseMode();
    setRowSortState((prev) => {
      if (prev.column === column) {
        return { column, mode: nextRowSortMode(getEffectiveSortMode(prev.mode)) };
      }
      return { column, mode: nextRowSortMode(baseMode) };
    });
  }

  const modalityFilteredMatrixRows = useMemo(() => {
    if (selectedModalitySet.size === 0) return [];

    return matrixRows.filter((row) => row.modalities.some((modality) => selectedModalitySet.has(modality)));
  }, [matrixRows, selectedModalitySet]);

  const presenceFilteredMatrixRows = useMemo(() => {
    if (!rowPresenceFilterModel) return modalityFilteredMatrixRows;

    return modalityFilteredMatrixRows.filter((row) => {
      const cell = row.cells.get(rowPresenceFilterModel);
      if (!cell) return false;
      return cell.displayValue.trim() !== "--";
    });
  }, [modalityFilteredMatrixRows, rowPresenceFilterModel]);

  const sortedMatrixRows = useMemo(() => {
    const rowsCopy = [...presenceFilteredMatrixRows];
    const effectiveMode = getEffectiveSortMode(rowSortState.mode);

    if (effectiveMode === "source") {
      rowsCopy.sort((a, b) => {
        const leftSourceOrder = a.sourceOrderKey;
        const rightSourceOrder = b.sourceOrderKey;

        if (leftSourceOrder !== null && rightSourceOrder !== null && leftSourceOrder !== rightSourceOrder) {
          return leftSourceOrder - rightSourceOrder;
        }

        if (leftSourceOrder !== null && rightSourceOrder === null) {
          return -1;
        }

        if (leftSourceOrder === null && rightSourceOrder !== null) {
          return 1;
        }

        return a.firstSeenIndex - b.firstSeenIndex;
      });
      return rowsCopy;
    }

    if (effectiveMode === "data") {
      if (rowSortState.column === "category") {
        const categoryDataTotals = new Map<string, number>();
        rowsCopy.forEach((row) => {
          categoryDataTotals.set(row.category, (categoryDataTotals.get(row.category) ?? 0) + row.rowDataCount);
        });

        rowsCopy.sort((a, b) => {
          const totalDiff = (categoryDataTotals.get(b.category) ?? 0) - (categoryDataTotals.get(a.category) ?? 0);
          if (totalDiff !== 0) return totalDiff;

          const categoryCompare = a.category.localeCompare(b.category, "zh-Hans-CN", { sensitivity: "base" });
          if (categoryCompare !== 0) return categoryCompare;

          if (a.rowDataCount !== b.rowDataCount) {
            return b.rowDataCount - a.rowDataCount;
          }

          return a.firstSeenIndex - b.firstSeenIndex;
        });
        return rowsCopy;
      }

      rowsCopy.sort((a, b) => {
        if (a.rowDataCount !== b.rowDataCount) {
          return b.rowDataCount - a.rowDataCount;
        }
        if (a.rowNumericCount !== b.rowNumericCount) {
          return b.rowNumericCount - a.rowNumericCount;
        }
        return a.firstSeenIndex - b.firstSeenIndex;
      });
      return rowsCopy;
    }

    const sortField: RowSortColumn = rowSortState.column;
    rowsCopy.sort((a, b) => {
      const left = sortField === "category" ? a.category : a.benchmark;
      const right = sortField === "category" ? b.category : b.benchmark;
      const compare = left.localeCompare(right, "zh-Hans-CN", { sensitivity: "base" });
      if (compare !== 0) return compare;
      return a.firstSeenIndex - b.firstSeenIndex;
    });
    return rowsCopy;
  }, [presenceFilteredMatrixRows, rowSortState]);

  const headerUniqueCounts = useMemo(() => {
    const uniqueCategories = new Set<string>();
    const uniqueBenchmarks = new Set<string>();

    presenceFilteredMatrixRows.forEach((row) => {
      uniqueCategories.add(row.category);
      uniqueBenchmarks.add(row.rowKey);
    });

    return {
      category: uniqueCategories.size,
      benchmark: uniqueBenchmarks.size
    };
  }, [presenceFilteredMatrixRows]);

  const overallSummaryByModel = useMemo(() => {
    const aggregateByModel = new Map<string, { sum: number; count: number }>();
    modelColumns.forEach((modelName) => {
      aggregateByModel.set(modelName, { sum: 0, count: 0 });
    });

    let totalComparableRows = 0;

    presenceFilteredMatrixRows.forEach((row) => {
      const rowEntries: Array<{ modelName: string; original: number; comparable: number }> = [];

      modelColumns.forEach((modelName) => {
        const cell = row.cells.get(modelName);
        const valueNum = cell?.valueNum;

        if (valueNum === null || valueNum === undefined || !Number.isFinite(valueNum)) {
          return;
        }

        rowEntries.push({
          modelName,
          original: valueNum,
          comparable: getBenchmarkComparableScore(row.benchmark, valueNum, row.category)
        });
      });

      if (rowEntries.length === 0) {
        return;
      }

      totalComparableRows += 1;

      const originalValues = rowEntries.map((entry) => entry.original);
      const minOriginal = Math.min(...originalValues);
      const maxOriginal = Math.max(...originalValues);

      const isRatioRow = minOriginal >= 0 && maxOriginal <= 1.2;
      const isPercentRow = !isRatioRow && minOriginal >= 0 && maxOriginal <= 100.000001;

      const transformedByEntry = (() => {
        if (isRatioRow) {
          return rowEntries.map((entry) => ({
            modelName: entry.modelName,
            transformed: entry.comparable * 100
          }));
        }

        if (isPercentRow) {
          return rowEntries.map((entry) => ({
            modelName: entry.modelName,
            transformed: entry.comparable
          }));
        }

        const comparableValues = rowEntries.map((entry) => entry.comparable);
        const sortedComparable = [...comparableValues].sort((a, b) => a - b);
        const percentile05 = getSortedQuantile(sortedComparable, 0.05);
        const percentile95 = getSortedQuantile(sortedComparable, 0.95);
        const clippedComparable = comparableValues.map((value) => Math.min(percentile95, Math.max(percentile05, value)));
        const clippedMin = Math.min(...clippedComparable);
        const loggedComparable = clippedComparable.map((value) => Math.log1p(Math.max(0, value - clippedMin)));

        return rowEntries.map((entry, index) => ({
          modelName: entry.modelName,
          transformed: loggedComparable[index] ?? 0
        }));
      })();

      const transformedValues = transformedByEntry.map((entry) => entry.transformed);
      const minTransformed = Math.min(...transformedValues);
      const maxTransformed = Math.max(...transformedValues);

      transformedByEntry.forEach((entry) => {
        const aggregate = aggregateByModel.get(entry.modelName);
        if (!aggregate) return;

        const rowScore = maxTransformed === minTransformed
          ? 50
          : Math.min(100, Math.max(0, ((entry.transformed - minTransformed) / (maxTransformed - minTransformed)) * 100));

        aggregate.sum += rowScore;
        aggregate.count += 1;
      });
    });

    const rawScoreItems = modelColumns.map((modelName) => {
      const aggregate = aggregateByModel.get(modelName) ?? { sum: 0, count: 0 };
      const rawScore = aggregate.count > 0 ? aggregate.sum / aggregate.count : null;
      const coverage = totalComparableRows > 0 ? aggregate.count / totalComparableRows : 0;
      const correctionFactor = 0.9 + 0.1 * coverage;
      const correctedScore = rawScore !== null ? rawScore * correctionFactor : null;

      return {
        modelName,
        rawScore,
        correctedScore,
        coveredRows: aggregate.count,
        totalRows: totalComparableRows,
        coverage,
        correctionFactor
      };
    });

    const rawRankMap = buildDenseRankMap(
      rawScoreItems.map((item) => ({ modelName: item.modelName, score: item.rawScore }))
    );
    const correctedRankMap = buildDenseRankMap(
      rawScoreItems.map((item) => ({ modelName: item.modelName, score: item.correctedScore }))
    );

    const summaryMap = new Map<string, OverallModelSummary>();
    rawScoreItems.forEach((item) => {
      summaryMap.set(item.modelName, {
        rawScore: item.rawScore,
        rawRank: item.rawScore !== null ? (rawRankMap.get(item.modelName) ?? null) : null,
        correctedScore: item.correctedScore,
        correctedRank: item.correctedScore !== null ? (correctedRankMap.get(item.modelName) ?? null) : null,
        coverage: item.coverage,
        coveredRows: item.coveredRows,
        totalRows: item.totalRows,
        correctionFactor: item.correctionFactor
      });
    });

    return summaryMap;
  }, [presenceFilteredMatrixRows, modelColumns]);

  const hasOverallSummary = useMemo(() => {
    return modelColumns.some((modelName) => overallSummaryByModel.get(modelName)?.rawScore !== null);
  }, [modelColumns, overallSummaryByModel]);

  const overallHeatRange = useMemo(() => {
    const rawScores = modelColumns
      .map((modelName) => overallSummaryByModel.get(modelName)?.rawScore)
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));

    if (rawScores.length === 0) {
      return {
        minRawScore: null,
        maxRawScore: null
      };
    }

    return {
      minRawScore: Math.min(...rawScores),
      maxRawScore: Math.max(...rawScores)
    };
  }, [modelColumns, overallSummaryByModel]);

  const overallScoreDisplayDecimalsByModel = useMemo(() => {
    const items: OverallScoreDisplayItem[] = modelColumns.map((modelName) => {
      const summary = overallSummaryByModel.get(modelName);
      return {
        modelName,
        rawScore: summary?.rawScore ?? null,
        rawRank: summary?.rawRank ?? null
      };
    });

    return buildOverallScoreDisplayDecimalsMap(items);
  }, [modelColumns, overallSummaryByModel]);

  function getSortModeLabel(column: RowSortColumn): string {
    if (rowSortState.column !== column) return "";
    const effectiveMode = getEffectiveSortMode(rowSortState.mode);
    if (effectiveMode === "alpha") return "A↑";
    if (effectiveMode === "data") return "↓";
    return "";
  }

  function getSortActionText(mode: RowSortMode): string {
    if (mode === "alpha") return "点击按首字母排序";
    if (mode === "data") return "点击按数据量排序";
    return "点击按 source 导入顺序排序";
  }

  function getSortModeTitle(column: RowSortColumn): string {
    const current = rowSortState.column === column
      ? getEffectiveSortMode(rowSortState.mode)
      : getInactiveColumnBaseMode();
    const next = nextRowSortMode(current);
    return getSortActionText(next);
  }

  function toggleModel(modelName: string, checked: boolean) {
    setSelectedModels((prev) => {
      const set = new Set(prev);
      if (checked) {
        set.add(modelName);
      } else {
        set.delete(modelName);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    });
  }

  function toggleProvider(providerName: string, checked: boolean) {
    const group = providerGroups.find((item) => item.providerName === providerName);
    if (!group) return;

    setSelectedModels((prev) => {
      const set = new Set(prev);
      group.models.forEach((model) => {
        if (checked) {
          set.add(model);
        } else {
          set.delete(model);
        }
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    });
  }

  function selectAllModels() {
    setSelectedModels(allModelNames);
  }

  function clearAllModels() {
    setSelectedModels([]);
  }

  function restoreDefaultModelsForActiveSource() {
    const sourceKey = activeSourceRef.current;
    const fallbackDefaultModels = sourceKey === SOURCE_ALL
      ? [...allModelNames]
      : [...defaultSelectedModels];

    const nextSelectionBySource = { ...modelSelectionBySourceRef.current };
    delete nextSelectionBySource[sourceKey];
    modelSelectionBySourceRef.current = nextSelectionBySource;

    try {
      window.localStorage.setItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY, JSON.stringify(nextSelectionBySource));
    } catch {
      // ignore storage access errors gracefully
    }

    setModelOrderBySource((prev) => {
      if (!(sourceKey in prev)) return prev;

      const next = { ...prev };
      delete next[sourceKey];

      try {
        window.localStorage.setItem(MODEL_ORDER_BY_SOURCE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage access errors gracefully
      }

      return next;
    });

    setSelectedModels(fallbackDefaultModels);
    setRowPresenceFilterModel(null);
    setColumnSortBenchmarkKey(null);
  }

  function toggleModality(modality: string, checked: boolean) {
    setSelectedModalities((prev) => {
      const set = new Set(prev);
      if (checked) {
        set.add(modality);
      } else {
        set.delete(modality);
      }
      return MODALITY_OPTIONS.filter((item) => set.has(item));
    });
  }

  function selectAllModalities() {
    setSelectedModalities([...MODALITY_OPTIONS]);
  }

  function clearAllModalities() {
    setSelectedModalities([]);
  }

  async function toggleFullscreen() {
    if (!sectionRef.current) return;

    try {
      if (document.fullscreenElement === sectionRef.current) {
        await document.exitFullscreen();
      } else {
        await sectionRef.current.requestFullscreen();
      }
    } catch {
      // ignore fullscreen API errors gracefully
    }
  }

  async function copyTableImageToClipboard() {
    if (!tableViewportRef.current || isImageActionBusy) return;

    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setIsCopyingTableImage(true);
    setIsExportCaptureMode(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const { scale } = EXPORT_PRESET_MAP[exportPreset];
      const pngBlob = await withTimeout(
        renderElementToImageBlob(tableViewportRef.current, scale, "image/png"),
        12000,
        "导出超时，请稍后重试"
      );

      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持图片剪贴板");
      }

      await withTimeout(
        navigator.clipboard.write([
          new ClipboardItem({
            "image/png": pngBlob
          })
        ]),
        5000,
        "复制超时，请检查剪贴板权限"
      );

      setCopyNotice({ type: "success", message: "已复制表格 PNG 到剪贴板" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.includes("Tainted canvases")
        ? "复制失败：检测到跨域资源，请重试或切换到无扩展干扰窗口"
        : rawMessage || "复制失败，请检查浏览器剪贴板权限";
      setCopyNotice({ type: "error", message });
    } finally {
      setIsExportCaptureMode(false);
      setIsCopyingTableImage(false);
    }
  }

  async function downloadTableImage() {
    if (!tableViewportRef.current || isImageActionBusy) return;

    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setIsDownloadingTableImage(true);
    setIsExportCaptureMode(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const preset = EXPORT_PRESET_MAP[exportPreset];
      const imageBlob = await withTimeout(
        renderElementToImageBlob(tableViewportRef.current, preset.scale, preset.mimeType),
        12000,
        "导出超时，请稍后重试"
      );

      const outputFormat = mimeTypeToFormat(imageBlob.type);
      const requestedFormat = preset.format;

      const fileTime = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const fileName = `benchmark-matrix-${fileTime}.${outputFormat}`;
      const objectUrl = URL.createObjectURL(imageBlob);

      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      setCopyNotice({
        type: "success",
        message: outputFormat === requestedFormat
          ? `已导出表格 ${outputFormat.toUpperCase()}`
          : `已自动回退导出 ${outputFormat.toUpperCase()}（原选择 ${requestedFormat.toUpperCase()}）`
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.includes("Tainted canvases")
        ? "下载失败：检测到跨域资源，请重试或切换到无扩展干扰窗口"
        : rawMessage || "下载失败，请稍后重试";
      setCopyNotice({ type: "error", message });
    } finally {
      setIsExportCaptureMode(false);
      setIsDownloadingTableImage(false);
    }
  }

  if (!isClientReady) {
    return null;
  }

  return (
    <section className="card" ref={sectionRef} style={isFullscreen ? { paddingTop: 8 } : undefined}>
      {copyNotice ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[140]">
          <div
            className={`pointer-events-auto flex min-w-[260px] max-w-[520px] items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-300 ease-out ${
              copyNoticeVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
            } ${
              copyNotice.type === "success"
                ? "border-emerald-500/45 bg-emerald-900/80 text-emerald-100"
                : "border-rose-500/45 bg-rose-900/80 text-rose-100"
            }`}
          >
            <span
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                copyNotice.type === "success" ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200"
              }`}
            >
              {copyNotice.type === "success" ? <Check size={18} /> : <TriangleAlert size={18} />}
            </span>
            <span className="text-sm font-semibold tracking-wide">{copyNotice.message}</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          className="tabs tabs-boxed max-w-full overflow-x-auto whitespace-nowrap bg-base-200/70 p-1"
        >
          {sourceOptions.map((source) => (
            <button
              key={source.key}
              type="button"
              role="tab"
              className={`tab transition-all ${
                activeSource === source.key
                  ? "tab-active !rounded-xl !bg-primary/50 !text-primary-content font-semibold shadow-[0_0_0_0px_rgba(93,167,255,0.55),0_4px_20px_rgba(93,167,255,0.22)] scale-[1.01]"
                  : "hover:!rounded-xl hover:bg-base-100/60"
              }`}
              onClick={() => setSourceAndUrl(source.key)}
              title={source.key === SOURCE_ALL ? source.label : sourceTabDisplayLabel(source.key)}
            >
              {source.key === SOURCE_ALL ? source.label : sourceTabDisplayLabel(source.key)}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-sm btn-outline ml-auto" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
          {isFullscreen ? "退出全屏" : "全屏显示表格"}
        </button>

        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <div
            className="relative"
            ref={exportMenuRef}
            onMouseEnter={() => setIsExportMenuHovered(true)}
            onMouseLeave={() => {
              setIsExportMenuHovered(false);
              setSuppressHoverMenu(false);
            }}
          >
            <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-base-300/80 bg-base-100/55 shadow-sm">
              <button
                type="button"
                className="btn btn-sm btn-ghost h-8 gap-1 rounded-none border-0 px-1.5"
                aria-label="导出图片"
                onClick={downloadTableImage}
                disabled={isImageActionBusy}
              >
                <ImageDown size={15} />
                {isDownloadingTableImage ? "下载中..." : "导出图片"}
              </button>

              <span className="h-4 w-px bg-base-300/70" />

              <label className="inline-flex h-full items-center px-0">
                <select
                  className="select select-ghost select-xs h-6 min-h-6 w-[82px] border-0 bg-base-200/45 px-0.5 pr-4 text-[11px] font-medium text-base-content shadow-none focus:bg-base-200/60 focus:outline-none"
                  aria-label="导出规格"
                  value={exportPreset}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isExportPresetKey(next)) {
                      setExportPreset(next);
                    }
                  }}
                  disabled={isImageActionBusy}
                >
                  {availableExportPresetKeys.map((key) => (
                    <option
                      key={key}
                      value={key}
                      style={{ backgroundColor: "#0f172a", color: "#e2e8f0" }}
                    >
                      {EXPORT_PRESET_MAP[key].label}
                    </option>
                  ))}
                </select>
              </label>

              <span className="h-4 w-px bg-base-300/70" />

              <button
                type="button"
                className="btn btn-sm btn-ghost h-8 rounded-none border-0 px-1.5"
                aria-label="导出图片菜单"
                aria-haspopup="menu"
                aria-expanded={isExportMenuOpen}
                onClick={() => {
                  setSuppressHoverMenu(false);
                  setIsExportMenuOpen((prev) => !prev);
                }}
                disabled={isImageActionBusy}
              >
                <ChevronDown size={14} />
              </button>
            </div>

            <div
              role="menu"
              onMouseEnter={() => setIsExportMenuHovered(true)}
              className={`absolute right-0 top-full z-40 min-w-[170px] rounded-lg border border-base-300/80 bg-base-100/95 p-1 shadow-xl backdrop-blur transition-all duration-150 ${
                showExportMenu ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <button
                type="button"
                role="menuitem"
                className="btn btn-sm btn-ghost w-full justify-start"
                onClick={copyTableImageToClipboard}
                disabled={isImageActionBusy}
              >
                <Copy size={14} />
                {isCopyingTableImage ? "复制中..." : "复制到剪贴板"}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => setShowCategory((prev) => !prev)}
          >
            {showCategory ? <Eye size={14} /> : <EyeOff size={14} />}
            显示类别列
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => setShowDuplicateRows((prev) => !prev)}
          >
            {showDuplicateRows ? <Eye size={14} /> : <EyeOff size={14} />}
            显示重名行
          </button>
        </div>
      </div>

      <div className={`${isFullscreen ? "mt-2" : ""} rounded-box border border-base-300/70 bg-base-200/35 p-3`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs opacity-80">
          <Layers size={14} />
          <span>模型层叠筛选：点击可展开具体模型列表</span>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            style={{ marginLeft: 4 }}
            onClick={() => setIsModelFilterExpanded((prev) => !prev)}
          >
            {isModelFilterExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {isModelFilterExpanded ? "收起模型筛选" : "展开模型筛选"}
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2 opacity-100">
            <div className="flex items-center gap-1 text-xs opacity-75">
              <Filter size={14} />
              已选模型 {selectedModels.length}/{allModelNames.length}
            </div>

            <button type="button" className="btn btn-xs btn-ghost" onClick={selectAllModels}>
              全选模型
            </button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={clearAllModels}>
              清空模型
            </button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={restoreDefaultModelsForActiveSource}>
              恢复默认
            </button>
          </div>
        </div>

        {isModelFilterExpanded ? (
          <div className={`grid grid-cols-1 gap-2 md:grid-cols-2 ${isFullscreen ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
            {providerGroups.map((group) => {
              const selectedCount = group.models.filter((model) => selectedModelSet.has(model)).length;
              const providerChecked = selectedCount > 0 && selectedCount === group.models.length;
              const providerAverageCoverage = providerAverageCoveragePercentMap.get(group.providerName) ?? 0;
              const providerHasBaseModel = group.models.some((model) => baseModelNameSet.has(model));

              return (
                <details
                  key={group.providerName}
                  className={`rounded-lg border bg-base-100/70 px-2 py-1 ${
                    providerHasBaseModel ? "border-base-300/70" : "border-dashed border-base-300/70"
                  }`}
                >
                  <summary className="flex list-none items-center justify-between gap-2 cursor-pointer py-1">
                    <label
                      className="inline-flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={providerChecked}
                        aria-checked={providerChecked ? "true" : selectedCount > 0 ? "mixed" : "false"}
                        ref={(element) => {
                          if (!element) return;
                          element.indeterminate = selectedCount > 0 && selectedCount < group.models.length;
                        }}
                        onChange={(e) => toggleProvider(group.providerName, e.target.checked)}
                      />
                      <span className="text-sm font-medium" style={{ color: getProviderBrandColor(group.providerName) }}>
                        {group.providerName}
                        {providerHasBaseModel ? null : <span className="ml-1 text-[10px] opacity-70">(跨页签)</span>}
                      </span>
                    </label>
                    <span className="text-xs opacity-70">{selectedCount}/{group.models.length} · 覆盖率 {providerAverageCoverage}%</span>
                  </summary>

                  <div className="grid grid-cols-1 gap-1 pb-2 pt-1">
                    {group.models.map((model) => {
                      const isBaseModel = baseModelNameSet.has(model);
                      const coveragePercent = modelCoveragePercentMap.get(model) ?? 0;

                      return (
                        <label
                          key={`${group.providerName}-${model}`}
                          className={`inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-xs ${
                            isBaseModel ? "" : "border border-dashed border-base-300/70 bg-base-200/25"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={selectedModelSet.has(model)}
                            onChange={(e) => toggleModel(model, e.target.checked)}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate" title={model}>{model}</span>
                            {isBaseModel ? null : (
                              <span className="rounded border border-dashed border-base-content/40 px-1 text-[10px] opacity-70">跨页签</span>
                            )}
                          </span>
                          <span className="shrink-0 text-[10px] opacity-70">{coveragePercent}%</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        ref={tableViewportRef}
        style={{
          overflow: "auto",
          maxHeight: isFullscreen
            ? `calc(100vh - ${isModelFilterExpanded ? 170 : 120}px)`
            : "98vh",
          borderRadius: 10,
          border: "1px solid rgba(53, 73, 116, 0.35)"
        }}
      >
        <table style={{ width: "max-content" }}>
          <thead>
            <tr>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 22,
                    width: 72,
                    minWidth: 72,
                    maxWidth: 72,
                    padding: "6px 6px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap"
                  }}
                >
                <details className="dropdown dropdown-bottom" data-modality-filter="true">
                  <summary
                    className="btn btn-ghost btn-xs h-auto min-h-0 px-1 normal-case text-inherit"
                    onClick={(event) => {
                      if (!shouldSuppressHeaderInteractions()) return;
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    Modality
                  </summary>
                  <div className="dropdown-content z-[90] mt-1 w-60 overflow-hidden rounded-xl border border-base-300/80 bg-base-100/95 p-1.5 shadow-xl backdrop-blur">
                    <div className="mb-1 px-1 text-[11px] font-medium opacity-75">勾选筛选模态</div>

                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      {MODALITY_OPTIONS.map((modality) => (
                        <label
                          key={`matrix-modality-filter-${modality}`}
                          className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium leading-none transition hover:bg-base-200/55"
                        >
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs shrink-0"
                            checked={selectedModalitySet.has(modality)}
                            onChange={(e) => toggleModality(modality, e.target.checked)}
                          />
                          <span className="min-w-0 truncate">{modality}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
              </th>

              {showCategory ? (
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    width: categoryColumnWidth,
                    minWidth: categoryColumnWidth,
                    maxWidth: categoryColumnWidth,
                    padding: "6px 8px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap"
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs h-auto min-h-0 rounded-none p-0 normal-case text-inherit hover:bg-transparent"
                    onClick={() => {
                      if (shouldSuppressHeaderInteractions()) return;
                      toggleRowSort("category");
                    }}
                    title={getSortModeTitle("category")}
                  >
                    <span className="inline-flex items-baseline gap-0.5">
                      <span>Category</span>
                      <span className="text-[10px] opacity-70">({headerUniqueCounts.category})</span>
                    </span>
                    {getSortModeLabel("category") ? (
                      <span className="text-[10px] opacity-70">{getSortModeLabel("category")}</span>
                    ) : null}
                  </button>
                  <span
                    className="column-resize-handle"
                    data-active={resizingColumnKey === CATEGORY_COLUMN_WIDTH_KEY ? "1" : undefined}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整 Category 列宽"
                    onPointerDown={(event) =>
                      beginColumnResize(
                        event,
                        CATEGORY_COLUMN_WIDTH_KEY,
                        categoryColumnWidth,
                        MIN_CATEGORY_COLUMN_WIDTH,
                        MAX_CATEGORY_COLUMN_WIDTH
                      )
                    }
                    onClick={(event) => event.stopPropagation()}
                  />
                </th>
              ) : null}

              <th
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 35,
                  width: benchmarkColumnWidth,
                  minWidth: benchmarkColumnWidth,
                  maxWidth: benchmarkColumnWidth,
                  padding: "6px 8px",
                  background: "rgba(20, 27, 45, 0.98)",
                  backdropFilter: "blur(6px)",
                  boxShadow: "8px 0 12px rgba(2, 6, 23, 0.35)",
                  whiteSpace: "nowrap"
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-xs h-auto min-h-0 rounded-none p-0 normal-case text-inherit hover:bg-transparent"
                  onClick={() => {
                    if (shouldSuppressHeaderInteractions()) return;
                    toggleRowSort("benchmark");
                  }}
                  title={getSortModeTitle("benchmark")}
                >
                  <span className="inline-flex items-baseline gap-0.5">
                    <span>Benchmark</span>
                    <span className="text-[10px] opacity-70">({headerUniqueCounts.benchmark})</span>
                  </span>
                  {getSortModeLabel("benchmark") ? (
                    <span className="text-[10px] opacity-70">{getSortModeLabel("benchmark")}</span>
                  ) : null}
                </button>
                <span
                  className={`column-resize-handle${hiddenResizeHandleKeys.has(BENCHMARK_COLUMN_WIDTH_KEY) ? " column-resize-handle-transparent" : ""}`}
                  data-active={resizingColumnKey === BENCHMARK_COLUMN_WIDTH_KEY ? "1" : undefined}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整 Benchmark 列宽"
                  onPointerDown={(event) =>
                    beginColumnResize(
                      event,
                      BENCHMARK_COLUMN_WIDTH_KEY,
                      benchmarkColumnWidth,
                      MIN_BENCHMARK_COLUMN_WIDTH,
                      MAX_BENCHMARK_COLUMN_WIDTH
                    )
                  }
                  onClick={(event) => event.stopPropagation()}
                />
              </th>

              {modelColumnMeta.map((model) => {
                const headerFrameShadows = buildSourceFrameShadows({
                  isMatched: model.isSourceMatched,
                  isFirst: model.isSourceMatchedFirst,
                  isLast: model.isSourceMatchedLast,
                  includeTop: true,
                  exportMode: isExportCaptureMode
                });
                const isActiveDropTarget =
                  !!draggingModelName &&
                  draggingModelName !== model.modelName &&
                  dragOverModelName === model.modelName;
                const dragIndicatorShadow = isActiveDropTarget
                  ? (dragInsertPosition === "before"
                      ? "inset 3px 0 0 rgba(153, 196, 255, 0.9)"
                      : "inset -3px 0 0 rgba(153, 196, 255, 0.9)")
                  : "";
                const isDraggingCurrentModel = draggingModelName === model.modelName;
                const isPresenceFilterActive = rowPresenceFilterModel === model.modelName;
                const activeUnderlineShadow = isPresenceFilterActive
                  ? "inset 0 -2px 0 rgba(166, 203, 255, 0.96), inset 0 -6px 12px rgba(124, 177, 255, 0.28)"
                  : "";
                const combinedHeaderShadow = [...headerFrameShadows, dragIndicatorShadow, activeUnderlineShadow]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <th
                    key={model.modelName}
                    draggable={!resizingColumnKey}
                    data-source-match={model.isSourceMatched ? "1" : undefined}
                    data-source-match-first={model.isSourceMatchedFirst ? "1" : undefined}
                    data-source-match-last={model.isSourceMatchedLast ? "1" : undefined}
                    aria-grabbed={isDraggingCurrentModel ? "true" : "false"}
                    title={isPresenceFilterActive ? "再次点击显示全部行" : "点击仅保留该模型有值的行"}
                    onDragStart={(event) => {
                      const target = event.target as HTMLElement;
                      if (resizingColumnKey || target.closest(".column-resize-handle")) {
                        event.preventDefault();
                        return;
                      }

                      setDraggingModelName(model.modelName);
                      setDragOverModelName(model.modelName);
                      setDragInsertPosition("after");
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", model.modelName);
                    }}
                    onDragOver={(event) => {
                      if (!draggingModelName || draggingModelName === model.modelName) return;

                      event.preventDefault();

                      const rect = event.currentTarget.getBoundingClientRect();
                      const nextPosition = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
                      if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = "move";
                      }

                      setDragOverModelName(model.modelName);
                      setDragInsertPosition(nextPosition);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();

                      const draggingModel = draggingModelName || event.dataTransfer.getData("text/plain");
                      if (!draggingModel) {
                        resetModelColumnDragState();
                        return;
                      }

                      const nextPosition = dragOverModelName === model.modelName
                        ? (dragInsertPosition ?? "after")
                        : "after";

                      commitModelColumnReorder(draggingModel, model.modelName, nextPosition);
                      resetModelColumnDragState();
                    }}
                    onDragEnd={resetModelColumnDragState}
                    onClick={() => {
                      if (draggingModelName || shouldSuppressHeaderInteractions()) return;
                      setRowPresenceFilterModel((prev) => (prev === model.modelName ? null : model.modelName));
                    }}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                      width: model.columnWidth,
                      minWidth: model.columnWidth,
                      maxWidth: model.columnWidth,
                      padding: "6px 6px",
                      background: "rgba(20, 27, 45, 0.96)",
                      backdropFilter: "blur(6px)",
                      cursor: resizingColumnKey ? "col-resize" : "grab",
                      opacity: isDraggingCurrentModel ? 0.58 : 1,
                      boxShadow: combinedHeaderShadow || undefined
                    }}
                  >
                    <div
                      style={{
                        color: model.color,
                        fontWeight: 700,
                        lineHeight: 1.15,
                        wordBreak: "break-word"
                      }}
                    >
                      {model.modelName}
                    </div>
                    <span
                      className={`column-resize-handle${hiddenResizeHandleKeys.has(model.columnWidthKey) ? " column-resize-handle-transparent" : ""}`}
                      data-active={resizingColumnKey === model.columnWidthKey ? "1" : undefined}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整 ${model.modelName} 列宽`}
                      onPointerDown={(event) =>
                        beginColumnResize(
                          event,
                          model.columnWidthKey,
                          model.columnWidth,
                          MIN_MODEL_COLUMN_RESIZE_WIDTH,
                          MAX_MODEL_COLUMN_WIDTH
                        )
                      }
                      onClick={(event) => event.stopPropagation()}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedMatrixRows.map((matrixRow, rowIndex) => {
              const rowKey = matrixRow.rowKey;
              const isLastMatrixRow = rowIndex === sortedMatrixRows.length - 1;
              const isRowLowerBetter = isLowerBetterBenchmark(matrixRow.benchmark, matrixRow.category);
              const isSelectedRow = selectedRowKey === rowKey;
              const selectedRowColor = "rgba(94, 234, 212, 0)";
              const rowFrameStyle = isSelectedRow
                ? {
                    boxShadow: "0 0 0 1px rgba(94, 234, 212, 0.22), 0 0 12px rgba(45, 212, 191, 0.12)"
                  }
                : undefined;
              const rowCellLineStyle = isSelectedRow
                ? {
                    borderTopWidth: 1,
                    borderTopStyle: "solid" as const,
                    borderTopColor: selectedRowColor,
                    borderBottomColor: selectedRowColor,
                    backgroundImage: "linear-gradient(rgba(45, 212, 191, 0.00), rgba(45, 212, 191, 0.05))",
                    boxShadow: "inset 0 1px 0 rgba(94, 234, 212, 0.5), inset 0 -1px 0 rgba(94, 234, 212, 0.5)"
                  }
                : undefined;
              const rowLeftEdgeStyle = isSelectedRow
                ? { borderLeft: `1px solid ${selectedRowColor}` }
                : undefined;
              const rowRightEdgeStyle = isSelectedRow
                ? { borderRight: `1px solid ${selectedRowColor}` }
                : undefined;

              return (
                <tr
                  key={rowKey}
                  className={isSelectedRow ? "matrix-row-selected" : "matrix-row-hover"}
                  onClick={() => {
                    setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey));
                    setColumnSortBenchmarkKey((prev) => (prev === rowKey ? null : rowKey));
                  }}
                  style={{ cursor: "pointer", ...rowFrameStyle }}
                >
                  <td
                    style={{
                      width: 72,
                      minWidth: 72,
                      maxWidth: 72,
                      padding: "4px 6px",
                      textAlign: "center",
                      ...rowCellLineStyle,
                      ...rowLeftEdgeStyle
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {matrixRow.modalities.map((modality, idx) =>
                        renderModalityBadge(modality, `${rowKey}-modality-${modality}-${idx}`)
                      )}
                    </div>
                  </td>

                  {showCategory ? (
                    <td
                      style={{
                        width: categoryColumnWidth,
                        minWidth: categoryColumnWidth,
                        maxWidth: categoryColumnWidth,
                        padding: "6px 8px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        ...rowCellLineStyle
                      }}
                      title={matrixRow.category}
                    >
                      {matrixRow.category}
                    </td>
                  ) : null}

                  <td
                    title={matrixRow.benchmark}
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 12,
                      width: benchmarkColumnWidth,
                      minWidth: benchmarkColumnWidth,
                      maxWidth: benchmarkColumnWidth,
                      padding: "6px 8px",
                      backgroundColor: "rgba(20, 27, 45, 0.96)",
                      boxShadow: "8px 0 12px rgba(2, 6, 23, 0.28)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      ...rowCellLineStyle
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        width: "100%",
                        minWidth: 0
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          flex: "1 1 auto",
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {matrixRow.benchmark}
                      </span>
                      {isRowLowerBetter ? (
                        <span
                          className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                          title="该项目为低值更优"
                          onClick={(event) => event.stopPropagation()}
                        >
                          ↓
                        </span>
                      ) : null}
                    </span>
                  </td>

                  {modelColumnMeta.map((model, modelIndex) => {
                    const cell = matrixRow.cells.get(model.modelName);
                    const cellNum = cell?.valueNum ?? null;
                    const cellNum2 = cell?.valueNum2 ?? null;
                    const comparableCellNum = cellNum !== null
                      ? getBenchmarkComparableScore(matrixRow.benchmark, cellNum, matrixRow.category)
                      : null;
                    const comparableCellNum2 = cellNum2 !== null
                      ? getBenchmarkComparableScore(matrixRow.benchmark, cellNum2, matrixRow.category)
                      : null;
                    const rawText = cell?.displayValue ?? "--";
                    const noteText = cell?.noteText ?? "";
                    const shouldShowQuestionMark = cell?.shouldShowQuestionMark ?? false;
                    const uniqueEntries = cell?.uniqueEntries ?? [];
                    const isMaxCellFirst =
                      comparableCellNum !== null &&
                      matrixRow.maxComparable !== null &&
                      comparableCellNum === matrixRow.maxComparable;
                    const isMaxCellSecond =
                      comparableCellNum2 !== null &&
                      matrixRow.maxComparable2 !== null &&
                      comparableCellNum2 === matrixRow.maxComparable2;
                    const pairFirstDisplay = cell ? formatValueNumForDisplay(cell.valueNum) : null;
                    const pairSecondDisplay = cell ? formatValueNumForDisplay(cell.valueNum2) : null;
                    const isPairNumericDisplay =
                      Boolean(cell?.valueRaw.includes("/")) &&
                      pairFirstDisplay !== null &&
                      pairSecondDisplay !== null &&
                      !/[$¥€£]/.test(cell?.valueRaw ?? "");
                    const cellPaddingRight = shouldShowQuestionMark
                      ? (isPairNumericDisplay ? "18px" : "22px")
                      : "6px";
                    const isSingleMaxCell = !isPairNumericDisplay && isMaxCellFirst;
                    const heatStyle = getHeatCellStyle(
                      comparableCellNum,
                      matrixRow.minComparable,
                      matrixRow.maxComparable,
                      heatmapPaletteRgb,
                      heatmapAlpha
                    );
                    const heatBackground =
                      (heatStyle as { backgroundColor?: string }).backgroundColor ?? "rgba(20, 27, 45, 0.96)";
                    const hasHeatColor =
                      comparableCellNum !== null &&
                      matrixRow.minComparable !== null &&
                      matrixRow.maxComparable !== null;
                    const rowCellBoxShadow =
                      rowCellLineStyle && "boxShadow" in rowCellLineStyle
                        ? (rowCellLineStyle.boxShadow as string | undefined)
                        : undefined;
                    const sourceFrameShadows = buildSourceFrameShadows({
                      isMatched: model.isSourceMatched,
                      isFirst: model.isSourceMatchedFirst,
                      isLast: model.isSourceMatchedLast,
                      includeBottom: isLastMatrixRow,
                      exportMode: isExportCaptureMode
                    });
                    const mergedCellBoxShadow = [rowCellBoxShadow, ...sourceFrameShadows].filter(Boolean).join(", ");
                    const maxSegmentStyle = isExportCaptureMode
                      ? {
                          fontWeight: 800,
                          display: "inline-block",
                          borderBottom: "1.5px solid rgba(15, 23, 42, 0.45)",
                          paddingBottom: "0.5px",
                          lineHeight: 1
                        }
                      : {
                          fontWeight: 800,
                          textDecoration: "underline",
                          textDecorationColor: "rgba(15, 23, 42, 0.35)",
                          textDecorationThickness: "1px",
                          textUnderlineOffset: "2px"
                        };

                    return (
                      <td
                        key={`${rowKey}::${model.modelName}`}
                        data-source-match={model.isSourceMatched ? "1" : undefined}
                        data-source-match-first={model.isSourceMatchedFirst ? "1" : undefined}
                        data-source-match-last={model.isSourceMatchedLast ? "1" : undefined}
                        data-source-match-bottom={
                          model.isSourceMatched && isLastMatrixRow ? "1" : undefined
                        }
                        style={{
                          ...rowCellLineStyle,
                          ...heatStyle,
                          backgroundColor: heatBackground,
                          borderBottomColor: hasHeatColor ? "rgba(255, 255, 255, 0.08)" : undefined,
                          padding: "4px 6px",
                          paddingRight: cellPaddingRight,
                          fontSize: "14px",
                          lineHeight: 1.2,
                          whiteSpace: "nowrap",
                          position: "relative",
                          width: model.columnWidth,
                          minWidth: model.columnWidth,
                          maxWidth: model.columnWidth,
                          boxShadow: mergedCellBoxShadow || undefined,
                          ...(modelIndex === modelColumnMeta.length - 1 ? rowRightEdgeStyle ?? {} : {})
                        }}
                      >
                        {isPairNumericDisplay && pairFirstDisplay && pairSecondDisplay ? (
                          <span className="inline-flex items-center gap-0 leading-none">
                            <span style={isMaxCellFirst ? maxSegmentStyle : undefined}>{pairFirstDisplay}</span>
                            <span className="mx-[1px] opacity-85">/</span>
                            <span style={isMaxCellSecond ? maxSegmentStyle : undefined}>{pairSecondDisplay}</span>
                          </span>
                        ) : (
                          <span style={isSingleMaxCell ? maxSegmentStyle : undefined}>{rawText}</span>
                        )}
                        {shouldShowQuestionMark ? (
                          <span
                            className="absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                            onMouseEnter={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setActiveCellTooltip({
                                x: rect.left + rect.width / 2,
                                y: rect.top - 6,
                                entries: uniqueEntries,
                                note: noteText.length > 0 ? noteText : null
                              });
                            }}
                            onMouseLeave={() => setActiveCellTooltip(null)}
                          >
                            ?
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {hasOverallSummary ? (
              <tr data-overall-row="1" className="matrix-row-overall">
                <td
                  style={{
                    width: 72,
                    minWidth: 72,
                    maxWidth: 72,
                    padding: "4px 6px",
                    textAlign: "center",
                    borderTop: "1px solid rgba(147, 197, 253, 0.35)",
                    backgroundColor: "rgba(18, 31, 52, 0.92)",
                    fontWeight: 700,
                    fontSize: "13px",
                    lineHeight: 1
                  }}
                >
                  ∑
                </td>

                {showCategory ? (
                  <td
                    style={{
                      width: categoryColumnWidth,
                      minWidth: categoryColumnWidth,
                      maxWidth: categoryColumnWidth,
                      padding: "6px 8px",
                      borderTop: "1px solid rgba(147, 197, 253, 0.35)",
                      backgroundColor: "rgba(18, 31, 52, 0.92)",
                      fontWeight: 700
                    }}
                  >
                    Overall
                  </td>
                ) : null}

                <td
                  data-overall-benchmark-label="1"
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 13,
                    width: benchmarkColumnWidth,
                    minWidth: benchmarkColumnWidth,
                    maxWidth: benchmarkColumnWidth,
                    padding: "6px 8px",
                    borderTop: "1px solid rgba(147, 197, 253, 0.4)",
                    backgroundColor: "rgba(18, 31, 52, 0.98)",
                    boxShadow: "8px 0 12px rgba(2, 6, 23, 0.28)",
                    fontWeight: 800,
                    letterSpacing: "0.02em"
                  }}
                >
                  <span data-overall-benchmark-cn-text="1">总评</span>
                  <span> / Ranking</span>
                </td>

                {modelColumnMeta.map((model) => {
                  const summary = overallSummaryByModel.get(model.modelName);
                  const hasRawScore = summary?.rawScore !== null && summary?.rawRank !== null;
                  const showSummaryTip = hasRawScore && summary?.correctedScore !== null && summary?.correctedRank !== null;
                  const heatStyle = getHeatCellStyle(
                    summary?.rawScore ?? null,
                    overallHeatRange.minRawScore,
                    overallHeatRange.maxRawScore,
                    heatmapPaletteRgb,
                    heatmapAlpha
                  );
                  const heatBackground =
                    (heatStyle as { backgroundColor?: string }).backgroundColor ?? "rgba(18, 31, 52, 0.92)";

                  const scoreDecimals = overallScoreDisplayDecimalsByModel.get(model.modelName) ?? 1;
                  const scoreText = hasRawScore ? summary!.rawScore!.toFixed(scoreDecimals) : "--";
                  const rankText = hasRawScore ? `(${summary!.rawRank})` : "";

                  return (
                    <td
                      key={`overall::${model.modelName}`}
                      data-overall-model={model.modelName}
                      style={{
                        ...heatStyle,
                        padding: "4px 6px",
                        paddingRight: showSummaryTip ? "22px" : "6px",
                        fontSize: "14px",
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        position: "relative",
                        backgroundColor: heatBackground,
                        borderTop: "1px solid rgba(147, 197, 253, 0.35)",
                        fontWeight: 750,
                        width: model.columnWidth,
                        minWidth: model.columnWidth,
                        maxWidth: model.columnWidth
                      }}
                    >
                      {hasRawScore ? (
                        <span className="inline-flex items-end gap-1">
                          <span>{scoreText}</span>
                          <span className="text-[11px] opacity-75">{rankText}</span>
                        </span>
                      ) : (
                        <span>{scoreText}</span>
                      )}
                      {showSummaryTip ? (
                        <span
                          data-overall-tooltip-trigger={model.modelName}
                          className="absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                          onMouseEnter={(event) => {
                            if (!summary) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            setActiveOverallTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top - 6,
                              modelName: model.modelName,
                              summary
                            });
                          }}
                          onMouseLeave={() => setActiveOverallTooltip(null)}
                        >
                          ?
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="heatmap-panel">
        <div className="heatmap-panel-top">
          <div className="heatmap-panel-title-wrap">
            <span className="heatmap-panel-title">热力图渐变设置</span>
          </div>

          <div className="heatmap-panel-actions">
            <label className="heatmap-preset-group">
              <span>预设</span>
              <select
                className="select select-sm heatmap-preset-select"
                value={heatmapPresetSelection}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === "custom") {
                    setHeatmapPresetSelection("custom");
                    return;
                  }

                  if (next in HEATMAP_PRESETS) {
                    applyHeatmapPreset(next as HeatmapPresetKey);
                  }
                }}
              >
                {(Object.entries(HEATMAP_PRESETS) as [HeatmapPresetKey, (typeof HEATMAP_PRESETS)[HeatmapPresetKey]][]).map(
                  ([presetKey, preset]) => (
                    <option key={presetKey} value={presetKey}>{preset.label}</option>
                  )
                )}
                <option value="custom">自定义</option>
              </select>
            </label>

            <button type="button" className="btn btn-sm heatmap-reset-btn" onClick={resetHeatmapPaletteToDefault}>
              恢复默认
            </button>
          </div>
        </div>

        <div className="heatmap-gradient-track" style={{ background: heatmapGradientPreview }} />

        <div className="heatmap-panel-bottom">
          <span className="heatmap-hex-readout">
            {heatmapPalette.low.toUpperCase()} · {heatmapPalette.mid.toUpperCase()} · {heatmapPalette.high.toUpperCase()}
          </span>

          <div className="heatmap-stop-controls">
            <label className="heatmap-alpha-inline">
              <span>透明度</span>
              <input
                type="range"
                className="heatmap-alpha-range"
                min={Math.round(MIN_HEATMAP_ALPHA * 100)}
                max={Math.round(MAX_HEATMAP_ALPHA * 100)}
                step={1}
                value={Math.round(heatmapAlpha * 100)}
                onChange={(event) => {
                  const next = Number(event.target.value) / 100;
                  setHeatmapAlpha(clampHeatmapAlpha(next));
                }}
              />
              <span>{Math.round(heatmapAlpha * 100)}%</span>
            </label>

            <label className="heatmap-stop-pill">
              <span>较差</span>
              <input
                type="color"
                className="input heatmap-color-input"
                value={heatmapPalette.low}
                onChange={(event) => updateHeatmapPaletteColor("low", event.target.value)}
              />
            </label>

            <label className="heatmap-stop-pill">
              <span>中等</span>
              <input
                type="color"
                className="input heatmap-color-input"
                value={heatmapPalette.mid}
                onChange={(event) => updateHeatmapPaletteColor("mid", event.target.value)}
              />
            </label>

            <label className="heatmap-stop-pill">
              <span>优秀</span>
              <input
                type="color"
                className="input heatmap-color-input"
                value={heatmapPalette.high}
                onChange={(event) => updateHeatmapPaletteColor("high", event.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      {activeCellTooltip ? (
        <div
          className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/96 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
          style={{
            left: activeCellTooltip.x,
            top: activeCellTooltip.y,
            transform: "translate(-50%, -100%)"
          }}
        >
          {activeCellTooltip.entries.length > 1 ? (
            <span className="mb-1 block text-[10px] text-slate-300">该单元格存在多条记录</span>
          ) : null}

          {activeCellTooltip.note ? (
            <span className="mb-1 block rounded-md bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
              注释：{activeCellTooltip.note}
            </span>
          ) : null}

          <span className="block max-h-44 space-y-1 overflow-auto">
            {activeCellTooltip.entries.map((entry) => (
              <span
                key={`${entry.valueRaw}-${entry.valueNote ?? ""}-${entry.source ?? "-"}-${entry.benchTime}`}
                className="block rounded-md bg-white/5 px-2 py-1 leading-4"
              >
                {getMatrixCellDisplayValue(entry.valueNum, entry.valueNum2, entry.valueRaw, entry.valueNote)}
                {entry.valueNote ? <span className="opacity-80"> · note: {entry.valueNote}</span> : null}
                <span className="opacity-80"> · {entry.source ?? "unknown-source"} · {formatTooltipTime(entry.benchTime)}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {activeOverallTooltip ? (
        <div
          className="pointer-events-none fixed z-[2600] w-[320px] max-w-[320px] rounded-xl border border-white/20 bg-slate-900/96 p-2 text-left text-[11px] font-medium text-slate-100 shadow-2xl backdrop-blur-lg"
          style={{
            left: activeOverallTooltip.x,
            top: activeOverallTooltip.y,
            transform: "translate(-50%, -100%)"
          }}
        >
          <span className="mb-1 block text-[10px] text-slate-300">{activeOverallTooltip.modelName} · 总评细节</span>

          <span className="block rounded-md bg-white/5 px-2 py-1 leading-4">
            原始总评分：{activeOverallTooltip.summary.rawScore !== null ? `${activeOverallTooltip.summary.rawScore.toFixed(1)}%` : "--"}
          </span>
          <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
            原始名次：{activeOverallTooltip.summary.rawRank !== null ? `No.${activeOverallTooltip.summary.rawRank}` : "--"}
          </span>
          <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
            覆盖率：{(activeOverallTooltip.summary.coverage * 100).toFixed(1)}%
            （{activeOverallTooltip.summary.coveredRows}/{activeOverallTooltip.summary.totalRows}）
          </span>
          <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
            修正后总评：{activeOverallTooltip.summary.correctedScore !== null ? `${activeOverallTooltip.summary.correctedScore.toFixed(1)}%` : "--"}
            （系数 {activeOverallTooltip.summary.correctionFactor.toFixed(3)}）
          </span>
          <span className="mt-1 block rounded-md bg-white/5 px-2 py-1 leading-4">
            修正后名次：{activeOverallTooltip.summary.correctedRank !== null ? `No.${activeOverallTooltip.summary.correctedRank}` : "--"}
          </span>

          <span className="mt-1 block text-[10px] text-slate-300">注：表格主展示名次按原始总评分计算</span>
        </div>
      ) : null}

      {sortedMatrixRows.length === 0 ? (
        <div className="mt-3 text-sm opacity-75">当前筛选条件下暂无数据。</div>
      ) : null}
    </section>
  );
}
