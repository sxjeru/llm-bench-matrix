"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Copy, Expand, Eye, EyeOff, Filter, ImageDown, Layers, Minimize2, TriangleAlert } from "lucide-react";

type MatrixInputRow = {
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
};

type MatrixCellEntry = {
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
  benchTime: string;
};

type MatrixCell = {
  valueRaw: string;
  valueNum: number | null;
  source: string | null;
  benchTime: string;
  allEntries: MatrixCellEntry[];
  hasMultipleValues: boolean;
};

type MatrixRow = {
  category: string;
  benchmark: string;
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
  { matcher: /fleurs/i, baseline: 100 }
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
};

const SOURCE_ALL = "__ALL__";
const SOURCE_EMPTY = "__EMPTY__";
const SHOW_CATEGORY_STORAGE_KEY = "benchmark-matrix:show-category";
const EXPORT_PRESET_STORAGE_KEY = "benchmark-matrix:export-preset";
const HTML2CANVAS_PRO_CDN = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.2/dist/html2canvas-pro.min.js";
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

declare global {
  interface Window {
    html2canvas?: Html2CanvasFn;
    __html2canvasProLoaded__?: boolean;
  }
}

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

function normalizeMatchToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
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

async function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持图片导出");
  }

  if (window.html2canvas && window.__html2canvasProLoaded__) {
    return window.html2canvas;
  }

  if (html2canvasLoaderPromise) {
    return html2canvasLoaderPromise;
  }

  html2canvasLoaderPromise = new Promise<Html2CanvasFn>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HTML2CANVAS_PRO_CDN;
    script.async = true;
    script.onload = () => {
      if (window.html2canvas) {
        window.__html2canvasProLoaded__ = true;
        resolve(window.html2canvas);
      } else {
        html2canvasLoaderPromise = null;
        reject(new Error("截图引擎加载失败"));
      }
    };
    script.onerror = () => {
      html2canvasLoaderPromise = null;
      reject(new Error("无法加载截图引擎，请检查网络"));
    };
    document.head.appendChild(script);
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

export function BenchmarkMatrix({ rows }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const showCategoryLoadedRef = useRef(false);
  const exportPresetLoadedRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
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
  } | null>(null);

  const sourceOptions = useMemo(() => {
    const keys = Array.from(new Set(rows.map((row) => getSourceKey(row.source)))).sort((a, b) =>
      getSourceLabel(a).localeCompare(getSourceLabel(b), "zh-Hans-CN")
    );

    return [
      { key: SOURCE_ALL, label: "全部" },
      ...keys.map((key) => ({ key, label: getSourceLabel(key) }))
    ];
  }, [rows]);

  const [activeSource, setActiveSource] = useState(SOURCE_ALL);

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
    if (!showCategoryLoadedRef.current) return;

    try {
      window.localStorage.setItem(SHOW_CATEGORY_STORAGE_KEY, showCategory ? "1" : "0");
    } catch {
      // ignore storage access errors gracefully
    }
  }, [showCategory]);

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
    }, 2200);

    const clearTimer = window.setTimeout(() => {
      setCopyNotice(null);
    }, 2520);

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

  const providerGroups = useMemo(() => {
    const map = new Map<string, Set<string>>();

    rows.forEach((row) => {
      const provider = row.providerName || "Unknown";
      if (!map.has(provider)) {
        map.set(provider, new Set<string>());
      }
      map.get(provider)!.add(row.modelName);
    });

    return Array.from(map.entries())
      .map(([providerName, modelSet]) => ({
        providerName,
        models: Array.from(modelSet).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName, "zh-Hans-CN"));
  }, [rows]);

  const allModelNames = useMemo(
    () => providerGroups.flatMap((group) => group.models).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    [providerGroups]
  );

  const [selectedModels, setSelectedModels] = useState<string[]>(allModelNames);

  useEffect(() => {
    setSelectedModels((prev) => {
      if (prev.length === 0) {
        return allModelNames;
      }

      const allSet = new Set(allModelNames);
      const kept = prev.filter((model) => allSet.has(model));
      return kept.length > 0 ? kept : allModelNames;
    });
  }, [allModelNames]);

  useEffect(() => {
    const listener = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);

  const modelProviderMap = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (!map.has(row.modelName)) {
        map.set(row.modelName, row.providerName);
      }
    });
    return map;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const sourceMatched = activeSource === SOURCE_ALL || getSourceKey(row.source) === activeSource;
      const modelMatched = selectedModelSet.has(row.modelName);
      return sourceMatched && modelMatched;
    });
  }, [rows, activeSource, selectedModelSet]);

  const sourceModelHint = useMemo(() => {
    if (activeSource === SOURCE_ALL) return "";
    return normalizeMatchToken(sourceTabDisplayLabel(activeSource));
  }, [activeSource]);

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
        if (!leftStats || !rightStats) return collator.compare(rightModel, leftModel);

        if (rightStats.numericCount !== leftStats.numericCount) {
          return rightStats.numericCount - leftStats.numericCount;
        }
        if (rightStats.totalCount !== leftStats.totalCount) {
          return rightStats.totalCount - leftStats.totalCount;
        }
        return collator.compare(rightModel, leftModel);
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

      matched.sort((left, right) => collator.compare(right, left));
      return [...matched, ...others];
    })();

    if (!columnSortBenchmarkKey) {
      return baseOrderedModels;
    }

    const splitIndex = columnSortBenchmarkKey.indexOf("::");
    if (splitIndex < 0) {
      return baseOrderedModels;
    }

    const targetCategory = columnSortBenchmarkKey.slice(0, splitIndex);
    const targetBenchmark = columnSortBenchmarkKey.slice(splitIndex + 2);

    const benchmarkScoreMap = new Map<string, number>();
    filteredRows.forEach((row) => {
      const rowCategory = row.benchmarkType || "General";
      if (rowCategory !== targetCategory || row.benchmarkName !== targetBenchmark || row.valueNum === null) {
        return;
      }

      const comparableScore = getBenchmarkComparableScore(targetBenchmark, row.valueNum);
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
  }, [filteredRows, sourceModelHint, columnSortBenchmarkKey]);

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
    const matrixMap = new Map<string, MatrixRow>();

    filteredRows.forEach((row, rowIndex) => {
      const category = row.benchmarkType || "General";
      const benchmark = row.benchmarkName;
      const matrixKey = `${category}::${benchmark}`;

      if (!matrixMap.has(matrixKey)) {
        matrixMap.set(matrixKey, {
          category,
          benchmark,
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
      if (!matrixRow.cells.has(row.modelName)) {
        matrixRow.cells.set(row.modelName, {
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          source: row.source,
          benchTime: row.benchTime,
          allEntries: [
            {
              valueRaw: row.valueRaw,
              valueNum: row.valueNum,
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
          source: row.source,
          benchTime: row.benchTime
        });
        existingCell.hasMultipleValues = existingCell.allEntries.length > 1;

        if (row.valueNum !== null && (existingCell.valueNum === null || row.valueNum > existingCell.valueNum)) {
          existingCell.valueNum = row.valueNum;
          existingCell.valueRaw = row.valueRaw;
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
  }, [filteredRows]);

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

  const sortedMatrixRows = useMemo(() => {
    const rowsCopy = [...matrixRows];
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
  }, [matrixRows, rowSortState]);

  function getSortModeLabel(column: RowSortColumn): string {
    if (rowSortState.column !== column) return "";
    const effectiveMode = getEffectiveSortMode(rowSortState.mode);
    if (effectiveMode === "alpha") return "A↑";
    if (effectiveMode === "data") return "↓";
    return "";
  }

  function getSortModeTitle(column: RowSortColumn): string {
    const current = rowSortState.column === column
      ? getEffectiveSortMode(rowSortState.mode)
      : getInactiveColumnBaseMode();
    const next = nextRowSortMode(current);
    if (next === "alpha") return "点击按首字母升序";
    if (next === "data") return "点击按数据量降序";
    if (next === "source") return "点击按 source 导入顺序（倒序）";
    return "点击按首字母升序";
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
        <div role="tablist" className="tabs tabs-boxed bg-base-200/70 p-1">
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

              return (
                <details key={group.providerName} className="rounded-lg border border-base-300/70 bg-base-100/70 px-2 py-1">
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
                      </span>
                    </label>
                    <span className="text-xs opacity-70">{selectedCount}/{group.models.length}</span>
                  </summary>

                  <div className="grid grid-cols-1 gap-1 pb-2 pt-1">
                    {group.models.map((model) => (
                      <label key={`${group.providerName}-${model}`} className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={selectedModelSet.has(model)}
                          onChange={(e) => toggleModel(model, e.target.checked)}
                        />
                        <span className="truncate" title={model}>{model}</span>
                      </label>
                    ))}
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
                    <span>Category</span>
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
                  <span>Benchmark</span>
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
              const rowKey = `${matrixRow.category}::${matrixRow.benchmark}`;
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
                      ...rowCellLineStyle,
                      ...rowLeftEdgeStyle
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
                    ...rowCellLineStyle,
                    ...(showCategory ? {} : rowLeftEdgeStyle)
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
                  const rawText = cell?.valueRaw ?? "--";
                  const allEntries = cell?.allEntries ?? [];
                  const valueIdentitySet = new Set(
                    allEntries.map((entry) =>
                      entry.valueNum !== null ? `num:${entry.valueNum}` : `raw:${entry.valueRaw}`
                    )
                  );
                  const hasMultipleValues = (cell?.hasMultipleValues ?? false) && valueIdentitySet.size > 1;
                  const uniqueEntries = Array.from(
                    new Map(
                      allEntries.map((entry) => [
                        `${entry.valueRaw}__${entry.source ?? ""}__${entry.benchTime}`,
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
                      key={`${matrixRow.category}::${matrixRow.benchmark}::${model.modelName}`}
                      style={{
                        ...rowCellLineStyle,
                        ...heatStyle,
                        backgroundColor: heatBackground,
                        borderBottomColor: hasHeatColor ? "rgba(255, 255, 255, 0.08)" : undefined,
                        padding: "4px 6px",
                        paddingRight: hasMultipleValues ? "22px" : "6px",
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
                      {hasMultipleValues ? (
                        <span
                          className="absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 cursor-help items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                          onMouseEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setActiveCellTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top - 6,
                              entries: uniqueEntries
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
          <span className="mb-1 block text-[10px] text-slate-300">该单元格存在多条记录</span>
          <span className="block max-h-44 space-y-1 overflow-auto">
            {activeCellTooltip.entries.map((entry) => (
              <span
                key={`${entry.valueRaw}-${entry.source ?? "-"}-${entry.benchTime}`}
                className="block rounded-md bg-white/5 px-2 py-1 leading-4"
              >
                {entry.valueRaw}
                <span className="opacity-80"> · {entry.source ?? "unknown-source"} · {formatTooltipTime(entry.benchTime)}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {matrixRows.length === 0 ? (
        <div className="mt-3 text-sm opacity-75">当前筛选条件下暂无数据。</div>
      ) : null}
    </section>
  );
}
