"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkCanonicalKey?: string | null;
  modalities?: string[];
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNote: string | null;
  source: string | null;
};

type MatrixCellEntry = {
  valueRaw: string;
  valueNum: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
};

type MatrixCell = {
  valueRaw: string;
  valueNum: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
  allEntries: MatrixCellEntry[];
  hasMultipleValues: boolean;
};

type MatrixRow = {
  rowKey: string;
  category: string;
  benchmark: string;
  modalities: string[];
  cells: Map<string, MatrixCell>;
  firstSeenIndex: number;
  rowDataCount: number;
  rowNumericCount: number;
  minComparable: number | null;
  maxComparable: number | null;
  minNum: number | null;
  maxNum: number | null;
};

type RowSortColumn = "category" | "benchmark";
type RowSortMode = "source" | "alpha" | "data";

const LOWER_IS_BETTER_RULES: Array<{ matcher: RegExp; baseline: number }> = [
  { matcher: /fleurs/i, baseline: 100 },
  { matcher: /omnidocbench\s*1\.5/i, baseline: 100 }
];

function getBenchmarkComparableScore(benchmarkName: string, valueNum: number): number {
  for (const rule of LOWER_IS_BETTER_RULES) {
    if (rule.matcher.test(benchmarkName)) {
      return rule.baseline - valueNum;
    }
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
const EXPORT_PRESET_STORAGE_KEY = "benchmark-matrix:export-preset";
const SOURCE_MATCH_FRAME_COLOR = "rgba(93, 167, 255, 0.42)";
const WEBP_EXPORT_QUALITY = 0.94;
const AVIF_EXPORT_QUALITY = 0.9;
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

function getBenchmarkDuplicateKey(canonicalKey: string | null | undefined, benchmarkName: string): string {
  const normalizedCanonical = canonicalKey?.trim().toLowerCase() ?? "";
  if (normalizedCanonical.length > 0) {
    const splitIndex = normalizedCanonical.indexOf(":");
    if (splitIndex > 0) {
      return normalizedCanonical.slice(0, splitIndex);
    }
    if (splitIndex < 0) {
      return normalizedCanonical;
    }
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

type ModelScaleToken = {
  prefixKey: string;
  sizeInBillions: number;
  isEstimated: boolean;
};

const MODEL_SIZE_TOKEN_PATTERN = /\b(E?)(\d+(?:\.\d+)?)B\b/i;

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

function compareModelNameByColumnOrder(left: string, right: string, collator: Intl.Collator): number {
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

function getHeatCellStyle(valueNum: number | null, minNum: number | null, maxNum: number | null) {
  if (valueNum === null || minNum === null || maxNum === null) {
    return {} as const;
  }

  if (minNum === maxNum) {
    return {
      backgroundColor: "rgba(255, 238, 111, 0.52)",
      color: "#0f172a",
      textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
      WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
    } as const;
  }

  const ratio = Math.min(1, Math.max(0, (valueNum - minNum) / (maxNum - minNum)));

  const red: [number, number, number] = [255, 155, 128];
  const yellow: [number, number, number] = [255, 238, 111];
  const green: [number, number, number] = [161, 212, 140];

  const color = ratio <= 0.5
    ? blendColor(red, yellow, ratio / 0.5)
    : blendColor(yellow, green, (ratio - 0.5) / 0.5);

  return {
    backgroundColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.52)`,
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

function getMatrixCellDisplayValue(rawValue: string, valueNote: string | null): string {
  const raw = rawValue.trim();
  if (!raw) return "--";

  const pairMatch = raw.match(
    /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/
  );
  if (pairMatch) {
    const [, first, second] = pairMatch;
    return `${first} / ${second}`;
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

async function renderElementToImageBlob(
  element: HTMLElement,
  scale: number,
  mimeType: ExportMimeType
): Promise<Blob> {
  const html2canvas = await loadHtml2Canvas();

  const width = Math.max(1, Math.round(element.scrollWidth));
  const height = Math.max(1, Math.round(element.scrollHeight));
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
        height,
        windowWidth: width,
        windowHeight: height,
        onclone: (clonedDoc: Document) => {
          const clonedRoot = clonedDoc.querySelector(`[${captureAttr}="1"]`) as HTMLElement | null;
          if (!clonedRoot) return;

          clonedRoot.style.overflow = "visible";
          clonedRoot.style.maxHeight = "none";
          clonedRoot.style.height = `${height}px`;
          clonedRoot.style.width = `${width}px`;

          const clonedTable = clonedRoot.querySelector("table") as HTMLTableElement | null;
          if (clonedTable) {
            clonedTable.style.width = `${width}px`;
          }
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
  const exportPresetLoadedRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
  const [showDuplicateRows, setShowDuplicateRows] = useState(false);
  const [isModelSelectionLoaded, setIsModelSelectionLoaded] = useState(false);
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
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [isDownloadingTableImage, setIsDownloadingTableImage] = useState(false);
  const [isCopyingTableImage, setIsCopyingTableImage] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copyNoticeVisible, setCopyNoticeVisible] = useState(false);
  const [activeCellTooltip, setActiveCellTooltip] = useState<{
    x: number;
    y: number;
    entries: MatrixCellEntry[];
    note: string | null;
  } | null>(null);

  const sourceOptions = useMemo(() => {
    const rowSourceKeys = rows.map((row) => getSourceKey(row.source));
    const externalSourceKeys = allSourceOptions.map((source) => getSourceKey(source));
    const keys = Array.from(new Set([...rowSourceKeys, ...externalSourceKeys])).sort((a, b) =>
      getSourceLabel(a).localeCompare(getSourceLabel(b), "zh-Hans-CN")
    );

    return [
      { key: SOURCE_ALL, label: "全部" },
      ...keys.map((key) => ({ key, label: getSourceLabel(key) }))
    ];
  }, [rows, allSourceOptions]);

  const [activeSource, setActiveSource] = useState(SOURCE_ALL);
  const activeSourceRef = useRef(SOURCE_ALL);

  useEffect(() => {
    const sourceFromUrl = searchParams.get("source");
    if (!sourceFromUrl) {
      setActiveSource(SOURCE_ALL);
      return;
    }

    const isKnown = sourceOptions.some((item) => item.key === sourceFromUrl);
    setActiveSource(isKnown ? sourceFromUrl : SOURCE_ALL);
  }, [searchParams, sourceOptions]);

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

  const isImageActionBusy = isDownloadingTableImage || isCopyingTableImage;
  const showExportMenu = isExportMenuOpen || (!suppressHoverMenu && isExportMenuHovered);

  function setSourceAndUrl(nextSource: string) {
    setActiveSource(nextSource);
    if (nextSource === SOURCE_ALL) {
      setRowSortState({ column: "benchmark", mode: "data" });
    } else {
      setRowSortState((prev) => ({ ...prev, mode: "source" }));
    }

    const params = new URLSearchParams(searchParams.toString());
    if (nextSource === SOURCE_ALL) {
      params.delete("source");
    } else {
      params.set("source", nextSource);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const baseSourceRows = useMemo(() => {
    return rows.filter((row) => activeSource === SOURCE_ALL || getSourceKey(row.source) === activeSource);
  }, [rows, activeSource]);

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

  const sourceModelHint = useMemo(() => {
    if (activeSource === SOURCE_ALL) return "";
    return normalizeMatchToken(sourceTabDisplayLabel(activeSource));
  }, [activeSource]);

  const coverageMetaByModel = useMemo(() => {
    const modelProviderMap = new Map<string, string>();
    const modelCoveredBenchmarkKeys = new Map<string, Set<string>>();

    allRows.forEach((row) => {
      const providerName = row.providerName || "Unknown";
      if (!modelProviderMap.has(row.modelName)) {
        modelProviderMap.set(row.modelName, providerName);
      }

      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      if (!baseBenchmarkKeySet.has(matrixKey)) {
        return;
      }

      if (!modelCoveredBenchmarkKeys.has(row.modelName)) {
        modelCoveredBenchmarkKeys.set(row.modelName, new Set<string>());
      }
      modelCoveredBenchmarkKeys.get(row.modelName)!.add(matrixKey);
    });

    const totalBenchmarkCount = baseBenchmarkKeySet.size;
    const metaMap = new Map<
      string,
      { providerName: string; coveredCount: number; coverageRate: number; isBaseModel: boolean }
    >();

    for (const [modelName, providerName] of modelProviderMap.entries()) {
      const coveredCount = modelCoveredBenchmarkKeys.get(modelName)?.size ?? 0;
      if (coveredCount <= 0) continue;

      metaMap.set(modelName, {
        providerName,
        coveredCount,
        coverageRate: totalBenchmarkCount > 0 ? coveredCount / totalBenchmarkCount : 0,
        isBaseModel: baseModelNameSet.has(modelName)
      });
    }

    return metaMap;
  }, [allRows, baseBenchmarkKeySet, baseModelNameSet, showDuplicateRows]);

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

  useEffect(() => {
    if (!isModelSelectionLoaded) return;

    if (activeSource !== SOURCE_ALL && rows.length > 0 && baseSourceRows.length === 0) {
      return;
    }

    const allModelSet = new Set(allModelNames);
    const savedForSource = modelSelectionBySourceRef.current[activeSource];
    let nextSelected: string[];

    if (!savedForSource) {
      nextSelected = [...defaultSelectedModels];
    } else if (savedForSource.length === 0) {
      nextSelected = [];
    } else {
      const kept = savedForSource.filter((modelName) => allModelSet.has(modelName));
      nextSelected = kept.length > 0 ? kept : [...defaultSelectedModels];
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
    const previous = modelSelectionBySourceRef.current[sourceKey] ?? [];

    if (previous.length === normalized.length && previous.every((item, index) => item === normalized[index])) {
      return;
    }

    modelSelectionBySourceRef.current = {
      ...modelSelectionBySourceRef.current,
      [sourceKey]: normalized
    };

    try {
      window.localStorage.setItem(MODEL_SELECTION_BY_SOURCE_STORAGE_KEY, JSON.stringify(modelSelectionBySourceRef.current));
    } catch {
      // ignore storage access errors gracefully
    }
  }, [selectedModels, isModelSelectionLoaded]);

  useEffect(() => {
    const listener = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);
  const selectedModalitySet = useMemo(() => new Set(selectedModalities), [selectedModalities]);

  const modelProviderMap = useMemo(() => {
    const map = new Map<string, string>();
    allRows.forEach((row) => {
      if (!map.has(row.modelName)) {
        map.set(row.modelName, row.providerName);
      }
    });
    return map;
  }, [allRows]);

  const filteredRows = useMemo(() => {
    if (selectedModelSet.size === 0 || baseBenchmarkKeySet.size === 0) {
      return [];
    }

    return allRows.filter((row) => {
      if (!selectedModelSet.has(row.modelName)) {
        return false;
      }
      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      return baseBenchmarkKeySet.has(matrixKey);
    });
  }, [allRows, selectedModelSet, baseBenchmarkKeySet, showDuplicateRows]);

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

        if (rightStats.numericCount !== leftStats.numericCount) {
          return rightStats.numericCount - leftStats.numericCount;
        }
        if (rightStats.totalCount !== leftStats.totalCount) {
          return rightStats.totalCount - leftStats.totalCount;
        }
        return compareModelNameByColumnOrder(leftModel, rightModel, collator);
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

    if (!columnSortBenchmarkKey) {
      return baseOrderedModels;
    }

    const benchmarkScoreMap = new Map<string, number>();
    filteredRows.forEach((row) => {
      if (getMatrixGroupingKey(row, showDuplicateRows) !== columnSortBenchmarkKey || row.valueNum === null) {
        return;
      }

      const comparableScore = getBenchmarkComparableScore(row.benchmarkName, row.valueNum);
      const previous = benchmarkScoreMap.get(row.modelName);
      if (previous === undefined || comparableScore > previous) {
        benchmarkScoreMap.set(row.modelName, comparableScore);
      }
    });

    const baseOrderIndex = new Map(baseOrderedModels.map((modelName, index) => [modelName, index]));

    return [...baseOrderedModels].sort((leftModel, rightModel) => {
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
  }, [filteredRows, sourceModelHint, columnSortBenchmarkKey, showDuplicateRows]);

  const sourceMatchedModelSet = useMemo(() => {
    if (!sourceModelHint) return new Set<string>();

    return new Set(
      modelColumns.filter((modelName) => normalizeMatchToken(modelName).includes(sourceModelHint))
    );
  }, [modelColumns, sourceModelHint]);

  const modelColumnMeta = useMemo(() => {
    const sourceMatchedOrderedModels = modelColumns.filter((modelName) => sourceMatchedModelSet.has(modelName));
    const firstMatchedModel = sourceMatchedOrderedModels[0] ?? null;
    const lastMatchedModel = sourceMatchedOrderedModels[sourceMatchedOrderedModels.length - 1] ?? null;

    return modelColumns.map((modelName) => {
      const providerName = modelProviderMap.get(modelName) ?? "Unknown";
      const columnWidth = Math.min(112, Math.max(72, Math.round(modelName.length * 6.8)));

      return {
        modelName,
        providerName,
        color: getProviderBrandColor(providerName),
        columnWidth,
        isSourceMatched: sourceMatchedModelSet.has(modelName),
        isSourceMatchedFirst: modelName === firstMatchedModel,
        isSourceMatchedLast: modelName === lastMatchedModel
      };
    });
  }, [modelColumns, modelProviderMap, sourceMatchedModelSet]);

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
          rowDataCount: 0,
          rowNumericCount: 0,
          minComparable: null,
          maxComparable: null,
          minNum: null,
          maxNum: null
        });
      }

      const matrixRow = matrixMap.get(matrixKey)!;

      if (!matrixRow.categoryValues.includes(category)) {
        matrixRow.categoryValues.push(category);
        matrixRow.category = matrixRow.categoryValues.join(" / ");
      }

      if (!matrixRow.benchmarkValues.includes(benchmark)) {
        matrixRow.benchmarkValues.push(benchmark);
        matrixRow.benchmark = matrixRow.benchmarkValues.join(" / ");
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
        matrixRow.cells.set(row.modelName, {
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNote: row.valueNote,
          source: row.source,
          benchTime: row.benchTime,
          allEntries: [
            {
              valueRaw: row.valueRaw,
              valueNum: row.valueNum,
              valueNote: row.valueNote,
              source: row.source,
              benchTime: row.benchTime
            }
          ],
          hasMultipleValues: false
        });
      } else {
        const existingCell = matrixRow.cells.get(row.modelName)!;
        existingCell.allEntries.push({
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNote: row.valueNote,
          source: row.source,
          benchTime: row.benchTime
        });
        existingCell.hasMultipleValues = existingCell.allEntries.length > 1;

        if (row.valueNum !== null && (existingCell.valueNum === null || row.valueNum > existingCell.valueNum)) {
          existingCell.valueNum = row.valueNum;
          existingCell.valueRaw = row.valueRaw;
          existingCell.valueNote = row.valueNote;
          existingCell.source = row.source;
          existingCell.benchTime = row.benchTime;
        }
      }
    });

    return Array.from(matrixMap.values())
      .map((matrixRow) => {
        const numericValues = Array.from(matrixRow.cells.values())
          .map((cell) => cell.valueNum)
          .filter((value): value is number => value !== null && Number.isFinite(value));

        const comparableValues = numericValues.map((valueNum) =>
          getBenchmarkComparableScore(matrixRow.benchmark, valueNum)
        );

        const rowDataCount = matrixRow.cells.size;
        const rowNumericCount = numericValues.length;

        return {
          ...matrixRow,
          rowDataCount,
          rowNumericCount,
          minComparable: comparableValues.length > 0 ? Math.min(...comparableValues) : null,
          maxComparable: comparableValues.length > 0 ? Math.max(...comparableValues) : null,
          minNum: numericValues.length > 0 ? Math.min(...numericValues) : null,
          maxNum: numericValues.length > 0 ? Math.max(...numericValues) : null
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

  const sortedMatrixRows = useMemo(() => {
    const rowsCopy = [...modalityFilteredMatrixRows];
    const effectiveMode = getEffectiveSortMode(rowSortState.mode);

    if (effectiveMode === "source") {
      rowsCopy.sort((a, b) => b.firstSeenIndex - a.firstSeenIndex);
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
  }, [modalityFilteredMatrixRows, rowSortState]);

  const headerUniqueCounts = useMemo(() => {
    const uniqueCategories = new Set<string>();
    const uniqueBenchmarks = new Set<string>();

    modalityFilteredMatrixRows.forEach((row) => {
      uniqueCategories.add(row.category);
      uniqueBenchmarks.add(row.rowKey);
    });

    return {
      category: uniqueCategories.size,
      benchmark: uniqueBenchmarks.size
    };
  }, [modalityFilteredMatrixRows]);

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
    return "点击按 source 导入顺序（倒序）";
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
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
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
      setIsCopyingTableImage(false);
    }
  }

  async function downloadTableImage() {
    if (!tableViewportRef.current || isImageActionBusy) return;

    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setIsDownloadingTableImage(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
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
      setIsDownloadingTableImage(false);
    }
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
          显示重名列
        </button>
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
        <table>
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
                  <summary className="btn btn-ghost btn-xs h-auto min-h-0 px-1 normal-case text-inherit">Modality</summary>
                  <div className="dropdown-content z-[90] mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                    <div className="mb-1 text-[11px] opacity-75">勾选筛选模态</div>
                    <div className="space-y-1">
                      {MODALITY_OPTIONS.map((modality) => (
                        <label
                          key={`matrix-modality-filter-${modality}`}
                          className="label cursor-pointer justify-start gap-2 py-0.5"
                        >
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={selectedModalitySet.has(modality)}
                            onChange={(e) => toggleModality(modality, e.target.checked)}
                          />
                          <span className="label-text text-xs">{modality}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectAllModalities();
                        }}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          clearAllModalities();
                        }}
                      >
                        清空
                      </button>
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
                    width: 150,
                    minWidth: 150,
                    maxWidth: 150,
                    padding: "6px 8px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap"
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs h-auto min-h-0 rounded-none p-0 normal-case text-inherit hover:bg-transparent"
                    onClick={() => toggleRowSort("category")}
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
                </th>
              ) : null}

              <th
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 35,
                  minWidth: 180,
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
                  onClick={() => toggleRowSort("benchmark")}
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
              </th>

              {modelColumnMeta.map((model) => {
                const headerFrameShadows: string[] = [];
                if (model.isSourceMatched) {
                  headerFrameShadows.push(`inset 0 2px 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                }
                if (model.isSourceMatchedFirst) {
                  headerFrameShadows.push(`inset 2px 0 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                }
                if (model.isSourceMatchedLast) {
                  headerFrameShadows.push(`inset -2px 0 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                }

                return (
                  <th
                    key={model.modelName}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                      width: model.columnWidth,
                      minWidth: model.columnWidth,
                      maxWidth: 120,
                      padding: "6px 6px",
                      background: "rgba(20, 27, 45, 0.96)",
                      backdropFilter: "blur(6px)",
                      boxShadow: headerFrameShadows.length > 0 ? headerFrameShadows.join(", ") : undefined
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
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedMatrixRows.map((matrixRow, rowIndex) => {
              const rowKey = matrixRow.rowKey;
              const isLastMatrixRow = rowIndex === sortedMatrixRows.length - 1;
              const isLowerBetterBenchmark = LOWER_IS_BETTER_RULES.some((rule) => rule.matcher.test(matrixRow.benchmark));
              const isHoveredRow = hoveredRowKey === rowKey;
              const isSelectedRow = selectedRowKey === rowKey;
              const rowBorderColor = isSelectedRow
                ? "rgba(94, 234, 212, 0.78)"
                : isHoveredRow
                  ? "rgba(148, 163, 184, 0.45)"
                  : null;
              const rowFrameStyle = isSelectedRow
                ? {
                    outline: "1px solid rgba(94, 234, 212, 0.78)",
                    outlineOffset: "-2px",
                    boxShadow: "0 0 0 1px rgba(94, 234, 212, 0.36), 0 0 12px rgba(45, 212, 191, 0.25)"
                  }
                : isHoveredRow
                  ? {
                      outline: "1px solid rgba(148, 163, 184, 0.38)",
                      outlineOffset: "-2px",
                      boxShadow: "0 0 8px rgba(148, 163, 184, 0.2)"
                    }
                  : undefined;
              const rowCellLineStyle = rowBorderColor
                ? {
                    borderTopWidth: 1,
                    borderTopStyle: "solid" as const,
                    borderTopColor: rowBorderColor,
                    borderBottomColor: rowBorderColor,
                    backgroundImage: isSelectedRow
                      ? "linear-gradient(rgba(45, 212, 191, 0.10), rgba(45, 212, 191, 0.10))"
                      : "linear-gradient(rgba(148, 163, 184, 0.05), rgba(148, 163, 184, 0.05))",
                    boxShadow: isSelectedRow
                      ? "inset 0 1px 0 rgba(94, 234, 212, 0.5), inset 0 -1px 0 rgba(94, 234, 212, 0.5)"
                      : "inset 0 1px 0 rgba(148, 163, 184, 0.3), inset 0 -1px 0 rgba(148, 163, 184, 0.3)"
                  }
                : undefined;
              const rowLeftEdgeStyle = {
                borderLeft: `1px solid ${rowBorderColor ?? "transparent"}`
              };
              const rowRightEdgeStyle = {
                borderRight: `1px solid ${rowBorderColor ?? "transparent"}`
              };

              return (
              <tr
                key={rowKey}
                onMouseEnter={() => setHoveredRowKey(rowKey)}
                onMouseLeave={() => setHoveredRowKey((prev) => (prev === rowKey ? null : prev))}
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
                      width: 150,
                      minWidth: 150,
                      maxWidth: 150,
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
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 12,
                    minWidth: 180,
                    padding: "6px 8px",
                    backgroundColor: "rgba(20, 27, 45, 0.96)",
                    boxShadow: "8px 0 12px rgba(2, 6, 23, 0.28)",
                    whiteSpace: "nowrap",
                    ...rowCellLineStyle
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    <span>{matrixRow.benchmark}</span>
                    {isLowerBetterBenchmark ? (
                      <span
                        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
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
                  const comparableCellNum = cellNum !== null
                    ? getBenchmarkComparableScore(matrixRow.benchmark, cellNum)
                    : null;
                  const rawText = cell ? getMatrixCellDisplayValue(cell.valueRaw, cell.valueNote) : "--";
                  const noteText = (cell?.valueNote ?? "").trim();
                  const allEntries = cell?.allEntries ?? [];
                  const valueIdentitySet = new Set(
                    allEntries.map((entry) =>
                      entry.valueNum !== null ? `num:${entry.valueNum}` : `raw:${entry.valueRaw}`
                    )
                  );
                  const hasMultipleValues = (cell?.hasMultipleValues ?? false) && valueIdentitySet.size > 1;
                  const shouldShowQuestionMark = hasMultipleValues || noteText.length > 0;
                  const uniqueEntries = Array.from(
                    new Map(
                      allEntries.map((entry) => [
                        `${entry.valueRaw}__${entry.valueNote ?? ""}__${entry.source ?? ""}__${entry.benchTime}`,
                        entry
                      ])
                    ).values()
                  );
                  const isMaxCell =
                    comparableCellNum !== null &&
                    matrixRow.maxComparable !== null &&
                    comparableCellNum === matrixRow.maxComparable;
                  const heatStyle = getHeatCellStyle(comparableCellNum, matrixRow.minComparable, matrixRow.maxComparable);
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
                  const sourceFrameShadows: string[] = [];
                  if (model.isSourceMatchedFirst) {
                    sourceFrameShadows.push(`inset 2px 0 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                  }
                  if (model.isSourceMatchedLast) {
                    sourceFrameShadows.push(`inset -2px 0 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                  }
                  if (model.isSourceMatched && isLastMatrixRow) {
                    sourceFrameShadows.push(`inset 0 -2px 0 ${SOURCE_MATCH_FRAME_COLOR}`);
                  }
                  const mergedCellBoxShadow = [rowCellBoxShadow, ...sourceFrameShadows].filter(Boolean).join(", ");

                  return (
                    <td
                      key={`${rowKey}::${model.modelName}`}
                      style={{
                        ...rowCellLineStyle,
                        ...heatStyle,
                        backgroundColor: heatBackground,
                        borderBottomColor: hasHeatColor ? "rgba(255, 255, 255, 0.08)" : undefined,
                        padding: "4px 6px",
                        paddingRight: shouldShowQuestionMark ? "22px" : "6px",
                        fontSize: "14px",
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        position: "relative",
                        fontWeight: isMaxCell ? 800 : undefined,
                        textDecoration: isMaxCell ? "underline" : undefined,
                        textDecorationColor: isMaxCell ? "rgba(15, 23, 42, 0.35)" : undefined,
                        textDecorationThickness: isMaxCell ? "1px" : undefined,
                        textUnderlineOffset: isMaxCell ? "2px" : undefined,
                        boxShadow: mergedCellBoxShadow || undefined,
                        ...(modelIndex === modelColumnMeta.length - 1 ? rowRightEdgeStyle ?? {} : {})
                      }}
                    >
                      <span>{rawText}</span>
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
            );})}
          </tbody>
        </table>
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
                {getMatrixCellDisplayValue(entry.valueRaw, entry.valueNote)}
                {entry.valueNote ? <span className="opacity-80"> · note: {entry.valueNote}</span> : null}
                <span className="opacity-80"> · {entry.source ?? "unknown-source"} · {formatTooltipTime(entry.benchTime)}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {sortedMatrixRows.length === 0 ? (
        <div className="mt-3 text-sm opacity-75">当前筛选条件下暂无数据。</div>
      ) : null}
    </section>
  );
}
