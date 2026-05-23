"use client";

/* eslint-disable react-hooks/preserve-manual-memoization -- This large matrix keeps hand-tuned memoization to preserve table behavior. */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
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
  ImageDown,
  Layers,
  Minimize2,
  TriangleAlert
} from "lucide-react";
import { resolveProviderBrandColor } from "@/lib/provider-config";
import {
  type MatrixInputRow,
  type MatrixCellEntry,
  type MatrixCell,
  type IndexedMatrixInputRow,
  type MatrixRow,
  type ProviderIdentity,
  type OverallModelSummary,
  type RowSortColumn,
  type RowSortMode,
  type Props,
  type HeatmapPresetKey,
  type HeatmapPresetSelection,
  type HeatmapPaletteHex,
  type HeatmapPaletteRgb,
  type CompareDirection,
  type ExportPresetKey,
  type OverallScoreDisplayItem,
  SOURCE_ALL,
  MODALITY_OPTIONS,
  SHOW_CATEGORY_STORAGE_KEY,
  SHOW_DUPLICATE_STORAGE_KEY,
  SHOW_SOURCE_VALUES_STORAGE_KEY,
  MODEL_SELECTION_BY_SOURCE_STORAGE_KEY,
  MODEL_ORDER_BY_SOURCE_STORAGE_KEY,
  COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY,
  HEATMAP_PALETTE_STORAGE_KEY,
  EXPORT_PRESET_STORAGE_KEY,
  CATEGORY_COLUMN_WIDTH_KEY,
  BENCHMARK_COLUMN_WIDTH_KEY,
  DEFAULT_CATEGORY_COLUMN_WIDTH,
  DEFAULT_BENCHMARK_COLUMN_WIDTH,
  MIN_CATEGORY_COLUMN_WIDTH,
  MAX_CATEGORY_COLUMN_WIDTH,
  MIN_BENCHMARK_COLUMN_WIDTH,
  MAX_BENCHMARK_COLUMN_WIDTH,
  DEFAULT_MODEL_COLUMN_BASELINE_WIDTH,
  MIN_MODEL_COLUMN_RESIZE_WIDTH,
  COMPARE_BASELINE_DEFAULT_EXPANDED_WIDTH,
  COMPARE_BADGE_DEFAULT_EXPANDED_WIDTH,
  MAX_MODEL_COLUMN_WIDTH,
  COLUMN_WIDTH_STORAGE_DEBOUNCE_MS,
  ALL_SOURCE_ROW_COVERAGE_THRESHOLD,
  ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD,
  PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT,
  HEATMAP_PRESETS,
  DEFAULT_HEATMAP_PRESET_KEY,
  DEFAULT_HEATMAP_ALPHA,
  MIN_HEATMAP_ALPHA,
  MAX_HEATMAP_ALPHA,
  EXPORT_PRESET_MAP,
  DEFAULT_EXPORT_PRESET,
  DEFAULT_HEATMAP_PALETTE_HEX,
  isLowerBetterBenchmark,
  getBenchmarkComparableScore,
  getSortedQuantile,
  buildDenseRankMap,
  buildOverallScoreDisplayDecimalsMap,
  getMatrixCellDisplayValue,
  formatTooltipTime,
  formatValueNumForDisplay,
  formatComparisonDeltaValue,
  normalizeHexColor,
  clampHeatmapAlpha,
  hexToRgbTuple,
  rgbaFromHex,
  getHeatCellStyle,
  compareSourceTabKeysByVersion,
  compareModelNameByColumnOrder,
  isSourceHeaderPrefixMatch,
  getModelColumnWidthKey,
  getColumnWidthOverrideKey,
  clampColumnWidth,
  normalizeColumnWidthBySource,
  areColumnWidthMapsEqual,
  areStringArraysEqual,
  getSourceKey,
  getSourceLabel,
  sourceTabDisplayLabel,
  pickPreferredBenchmarkDisplayName,
  getMatrixGroupingKey,
  normalizeModalityList,
  renderModalityBadge,
  normalizeMatchToken,
  hasMeaningfulMatrixRawValue,
  getMatrixCellValueIdentity,
  getMatrixCellSourceValueDedupKey,
  isCompareModifierClick,
  isSelectionModifierClick,
  clampCompareIntensity,
  getCompareDeltaBadgeStyle,
  isExportPresetKey,
  canEncodeCanvasMimeType,
  mimeTypeToFormat,
  buildSourceFrameShadows,
  buildCompareBaselineShadows,
  renderElementToImageBlob,
  withTimeout
} from "./benchmark-matrix/index";

function enqueueStateUpdate(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

function applySourceMeta(row: MatrixInputRow): MatrixInputRow {
  const sourceBenchmarkType = row.sourceBenchmarkType?.trim();

  return {
    ...row,
    benchmarkType: sourceBenchmarkType || row.benchmarkType,
    modalities: row.sourceModalities ?? row.modalities
  };
}

type SourceValueDisplayItem = {
  key: string;
  sourceLabel: string;
  rawValue: string;
};

function getSourceValueDisplayItems(entries: MatrixCellEntry[]): SourceValueDisplayItem[] {
  const seen = new Set<string>();
  const items: SourceValueDisplayItem[] = [];

  entries.forEach((entry, index) => {
    const sourceLabel = getSourceLabel(getSourceKey(entry.source));
    const rawValue = entry.valueRaw.trim() || "--";
    const dedupKey = `${sourceLabel}\u0000${rawValue}\u0000${entry.valueNote?.trim() ?? ""}`;

    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    items.push({
      key: `${index}-${sourceLabel}-${rawValue}-${entry.valueNote?.trim() ?? ""}`,
      sourceLabel,
      rawValue
    });
  });

  return items;
}

export function BenchmarkMatrix({
  rows,
  allRows = rows,
  sourceOptions: allSourceOptions = []
}: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsViewportRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsMeasureRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const showCategoryLoadedRef = useRef(false);
  const showDuplicateLoadedRef = useRef(false);
  const showSourceValuesLoadedRef = useRef(false);
  const modelSelectionBySourceRef = useRef<Record<string, string[]>>({});
  const isSyncingSelectionFromSourceRef = useRef(false);
  const skipSelectionPersistenceOnceRef = useRef(false);
  const columnWidthBySourceRef = useRef<Record<string, Record<string, number>>>({});
  const [columnWidthOverrideKeys, setColumnWidthOverrideKeys] = useState<readonly string[]>([]);
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
  const [showSourceValues, setShowSourceValues] = useState(false);
  const [showLowCoverageRows, setShowLowCoverageRows] = useState(false);
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
  const [expandedLowCoverageProviders, setExpandedLowCoverageProviders] = useState<Record<string, boolean>>({});
  const [overflowSourceKeys, setOverflowSourceKeys] = useState<string[]>([]);
  const [isSourceOverflowMenuOpen, setIsSourceOverflowMenuOpen] = useState(false);
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
  const [compareModelOrder, setCompareModelOrder] = useState<string[]>([]);
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
  const pendingSourceSyncRef = useRef<string | null>(null);
  const hasSourceData = useMemo(
    () => allSourceOptions.some((source) => source.trim().length > 0)
      || rows.some((row) => row.source?.trim())
      || allRows.some((row) => row.source?.trim()),
    [allSourceOptions, rows, allRows]
  );
  const displaySourceValuesInCells = showSourceValues && hasSourceData;
  const overflowSourceKeySet = useMemo(() => new Set(overflowSourceKeys), [overflowSourceKeys]);
  const visibleSourceOptions = useMemo(
    () => sourceOptions.filter((source) => !overflowSourceKeySet.has(source.key)),
    [sourceOptions, overflowSourceKeySet]
  );
  const overflowSourceOptions = useMemo(
    () => sourceOptions.filter((source) => overflowSourceKeySet.has(source.key)),
    [sourceOptions, overflowSourceKeySet]
  );
  const getSourceTabDisplayText = (source: { key: string; label: string }) => (
    source.key === SOURCE_ALL ? source.label : sourceTabDisplayLabel(source.key)
  );

  useEffect(() => {
    const sourceFromUrl = searchParams.get("source");
    const isKnown = sourceFromUrl
      ? sourceOptions.some((item) => item.key === sourceFromUrl)
      : false;
    const nextSource = sourceFromUrl && isKnown ? sourceFromUrl : SOURCE_ALL;

    const pendingSource = pendingSourceSyncRef.current;
    if (pendingSource) {
      if (nextSource === pendingSource) {
        pendingSourceSyncRef.current = null;
      } else {
        return;
      }
    }

    setActiveSource((prev) => {
      if (prev === nextSource) return prev;
      skipSelectionPersistenceOnceRef.current = true;
      return nextSource;
    });

    if (activeSourceRef.current !== nextSource) {
      const nextMode: RowSortMode = nextSource === SOURCE_ALL ? "data" : "source";
      setRowSortState((prev) => (prev.mode === nextMode ? prev : { ...prev, mode: nextMode }));
    }
  }, [searchParams, sourceOptions]);

  useEffect(() => {
    enqueueStateUpdate(() => setIsClientReady(true));
  }, []);

  useEffect(() => {
    activeSourceRef.current = activeSource;
  }, [activeSource]);

  useLayoutEffect(() => {
    if (!isClientReady) return;

    const allKeys = sourceOptions.map((item) => item.key);

    const computeOverflowKeys = () => {
      const viewportElement = sourceTabsViewportRef.current;
      const measureElement = sourceTabsMeasureRef.current;

      if (!viewportElement || !measureElement || allKeys.length === 0) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      const availableWidth = viewportElement.clientWidth;
      const widthByKey = new Map<string, number>();

      measureElement.querySelectorAll<HTMLElement>("[data-source-tab-measure='item']").forEach((node) => {
        const key = node.dataset.sourceTabMeasureKey;
        if (!key) return;

        const width = Math.ceil(node.getBoundingClientRect().width);
        if (width > 0) {
          widthByKey.set(key, width);
        }
      });

      const overflowMeasureNode = measureElement.querySelector<HTMLElement>("[data-source-tab-measure='more']");
      const overflowButtonWidth = Math.ceil(overflowMeasureNode?.getBoundingClientRect().width ?? 72);

      const hasValidMeasurements =
        availableWidth > 0 &&
        allKeys.every((key) => (widthByKey.get(key) ?? 0) > 0);

      if (!hasValidMeasurements) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      const totalWidth = allKeys.reduce((sum, key) => sum + (widthByKey.get(key) ?? 0), 0);
      if (totalWidth <= availableWidth) {
        setOverflowSourceKeys((prev) => (prev.length > 0 ? [] : prev));
        return;
      }

      const widthLimit = Math.max(availableWidth - overflowButtonWidth - 8, 0);
      if (widthLimit <= 0) {
        const fallbackVisibleKeys = allKeys.includes(activeSource) ? [activeSource] : allKeys.slice(0, 1);
        const fallbackVisibleSet = new Set(fallbackVisibleKeys);
        const nextOverflowKeys = allKeys.filter((key) => !fallbackVisibleSet.has(key));

        setOverflowSourceKeys((prev) => (areStringArraysEqual(prev, nextOverflowKeys) ? prev : nextOverflowKeys));
        return;
      }

      const visibleKeys: string[] = [];
      let usedWidth = 0;

      for (const key of allKeys) {
        const width = widthByKey.get(key) ?? 0;
        if (usedWidth + width <= widthLimit || visibleKeys.length === 0) {
          visibleKeys.push(key);
          usedWidth += width;
        } else {
          break;
        }
      }

      const forceIncludeKey = (key: string, mandatory: boolean) => {
        if (!allKeys.includes(key) || visibleKeys.includes(key)) return;

        const width = widthByKey.get(key) ?? 0;

        while (visibleKeys.length > 0 && usedWidth + width > widthLimit) {
          const removed = visibleKeys.pop();
          if (!removed) break;
          usedWidth -= widthByKey.get(removed) ?? 0;
        }

        if (usedWidth + width <= widthLimit || visibleKeys.length === 0) {
          visibleKeys.push(key);
          usedWidth += width;
          return;
        }

        if (mandatory) {
          visibleKeys.splice(0, visibleKeys.length, key);
          usedWidth = width;
        }
      };

      forceIncludeKey(activeSource, true);
      if (activeSource !== SOURCE_ALL) {
        forceIncludeKey(SOURCE_ALL, false);
      }

      const orderMap = new Map(allKeys.map((key, index) => [key, index]));
      const visibleSet = new Set(
        Array.from(new Set(visibleKeys)).sort(
          (left, right) => (orderMap.get(left) ?? 0) - (orderMap.get(right) ?? 0)
        )
      );

      const nextOverflowKeys = allKeys.filter((key) => !visibleSet.has(key));

      setOverflowSourceKeys((prev) => (areStringArraysEqual(prev, nextOverflowKeys) ? prev : nextOverflowKeys));
      if (nextOverflowKeys.length === 0) {
        setIsSourceOverflowMenuOpen(false);
      }
    };

    computeOverflowKeys();

    let observer: ResizeObserver | null = null;
    const handleWindowResize = () => {
      computeOverflowKeys();
    };

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        computeOverflowKeys();
      });

      if (sourceTabsViewportRef.current) {
        observer.observe(sourceTabsViewportRef.current);
      }
    } else {
      window.addEventListener("resize", handleWindowResize);
    }

    return () => {
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener("resize", handleWindowResize);
      }
    };
  }, [isClientReady, sourceOptions, activeSource]);

  useEffect(() => {
    let nextSelectionBySource: Record<string, string[]> | null = null;

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

          nextSelectionBySource = normalizedBySource;
        }
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextSelectionBySource) {
        modelSelectionBySourceRef.current = nextSelectionBySource;
      }
      setIsModelSelectionLoaded(true);
    });
  }, []);

  useEffect(() => {
    let nextModelOrderBySource: Record<string, string[]> | null = null;

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

          nextModelOrderBySource = normalizedBySource;
        }
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextModelOrderBySource) {
        setModelOrderBySource(nextModelOrderBySource);
      }
      setIsModelOrderLoaded(true);
    });
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
    let nextColumnWidthBySource: Record<string, Record<string, number>> | null = null;

    try {
      const saved = window.localStorage.getItem(COLUMN_WIDTH_BY_SOURCE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as unknown;
        nextColumnWidthBySource = normalizeColumnWidthBySource(parsed);
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextColumnWidthBySource) {
        columnWidthBySourceRef.current = nextColumnWidthBySource;
      }
      setIsColumnWidthLoaded(true);
    });
  }, []);

  useEffect(() => {
    let nextShowCategory: boolean | null = null;

    try {
      const saved = window.localStorage.getItem(SHOW_CATEGORY_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        nextShowCategory = saved === "1";
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextShowCategory !== null) {
        setShowCategory(nextShowCategory);
      }
      showCategoryLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    let nextShowDuplicateRows: boolean | null = null;

    try {
      const saved = window.localStorage.getItem(SHOW_DUPLICATE_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        nextShowDuplicateRows = saved === "1";
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextShowDuplicateRows !== null) {
        setShowDuplicateRows(nextShowDuplicateRows);
      }
      showDuplicateLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    let nextShowSourceValues: boolean | null = null;

    try {
      const saved = window.localStorage.getItem(SHOW_SOURCE_VALUES_STORAGE_KEY);
      if (saved === "0" || saved === "1") {
        nextShowSourceValues = saved === "1";
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextShowSourceValues !== null) {
        setShowSourceValues(nextShowSourceValues);
      }
      showSourceValuesLoadedRef.current = true;
    });
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
    if (!showSourceValuesLoadedRef.current) return;

    try {
      window.localStorage.setItem(SHOW_SOURCE_VALUES_STORAGE_KEY, showSourceValues ? "1" : "0");
    } catch {
      // ignore storage access errors gracefully
    }
  }, [showSourceValues]);

  useEffect(() => {
    enqueueStateUpdate(() => {
      setSelectedRowKey(null);
      setColumnSortBenchmarkKey(null);
    });
  }, [showDuplicateRows]);

  useEffect(() => {
    const nextSupportsWebpExport = canEncodeCanvasMimeType("image/webp");
    const nextSupportsAvifExport = canEncodeCanvasMimeType("image/avif");

    enqueueStateUpdate(() => {
      setSupportsWebpExport(nextSupportsWebpExport);
      setSupportsAvifExport(nextSupportsAvifExport);
    });
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

    const fallback = availableExportPresetKeys.includes(DEFAULT_EXPORT_PRESET)
      ? DEFAULT_EXPORT_PRESET
      : availableExportPresetKeys[0];

    if (fallback) {
      enqueueStateUpdate(() => setExportPreset(fallback));
    }
  }, [availableExportPresetKeys, exportPreset]);

  useEffect(() => {
    let nextExportPreset: ExportPresetKey | null = null;

    try {
      const saved = window.localStorage.getItem(EXPORT_PRESET_STORAGE_KEY);
      if (saved && isExportPresetKey(saved)) {
        nextExportPreset = saved;
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextExportPreset) {
        setExportPreset(nextExportPreset);
      }
      exportPresetLoadedRef.current = true;
    });
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
    let nextHeatmapPalette: HeatmapPaletteHex | null = null;
    let nextHeatmapAlpha = DEFAULT_HEATMAP_ALPHA;
    let nextHeatmapPresetSelection: HeatmapPresetSelection | null = null;

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

        nextHeatmapPalette = nextPalette;
        nextHeatmapAlpha = clampHeatmapAlpha(parsedAlpha);
        nextHeatmapPresetSelection = nextPresetSelection;
      }
    } catch {
      // ignore storage access errors gracefully
    }

    enqueueStateUpdate(() => {
      if (nextHeatmapPalette && nextHeatmapPresetSelection) {
        setHeatmapPalette(nextHeatmapPalette);
        setHeatmapAlpha(nextHeatmapAlpha);
        setHeatmapPresetSelection(nextHeatmapPresetSelection);
      }
      heatmapPaletteLoadedRef.current = true;
    });
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

    enqueueStateUpdate(() => setCopyNoticeVisible(true));

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
    if (!isSourceOverflowMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!sourceTabsMenuRef.current?.contains(target)) {
        setIsSourceOverflowMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isSourceOverflowMenuOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = columnResizeStateRef.current;
      if (!resizeState) return;

      const overrideKey = getColumnWidthOverrideKey(activeSourceRef.current, resizeState.columnKey);
      setColumnWidthOverrideKeys((prev) => (prev.includes(overrideKey) ? prev : [...prev, overrideKey]));

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
      headerInteractionSuppressUntilRef.current = Math.max(
        headerInteractionSuppressUntilRef.current,
        Date.now() + 180
      );
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
    setIsSourceOverflowMenuOpen(false);

    if (activeSourceRef.current !== nextSource) {
      skipSelectionPersistenceOnceRef.current = true;
      pendingSourceSyncRef.current = nextSource;
      setActiveSource(nextSource);
      const nextMode: RowSortMode = nextSource === SOURCE_ALL ? "data" : "source";
      setRowSortState((prev) => (prev.mode === nextMode ? prev : { ...prev, mode: nextMode }));
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

  const scopedRowsBySource = useMemo(() => {
    const map = new Map<string, MatrixInputRow[]>();

    rows.forEach((row) => {
      const sourceKey = getSourceKey(row.source);
      if (!map.has(sourceKey)) {
        map.set(sourceKey, []);
      }
      map.get(sourceKey)!.push(applySourceMeta(row));
    });

    return map;
  }, [rows]);

  const allRowsBySource = useMemo(() => {
    const map = new Map<string, MatrixInputRow[]>();

    allRows.forEach((row) => {
      const sourceKey = getSourceKey(row.source);
      if (!map.has(sourceKey)) {
        map.set(sourceKey, []);
      }
      map.get(sourceKey)!.push(applySourceMeta(row));
    });

    return map;
  }, [allRows]);

  const allRowsWithSourceMeta = useMemo(
    () => allRows.map((row) => applySourceMeta(row)),
    [allRows]
  );

  const indexedSourceRows = useMemo(
    () => (activeSource === SOURCE_ALL ? allRows : allRowsWithSourceMeta),
    [allRows, allRowsWithSourceMeta, activeSource]
  );

  const allRowsIndex = useMemo(() => {
    const modelProviderMap = new Map<string, ProviderIdentity>();
    const modelProviderBrandColorMap = new Map<string, string | null>();
    const providerDisplayNameBrandColorMap = new Map<string, string | null>();
    const rowsByModel = new Map<string, IndexedMatrixInputRow[]>();
    const rowsByGroupingKey = new Map<string, IndexedMatrixInputRow[]>();

    indexedSourceRows.forEach((row) => {
      if (!modelProviderMap.has(row.modelName)) {
        const displayName = row.providerDisplayName?.trim() || row.providerName || "Unknown";
        modelProviderMap.set(row.modelName, {
          canonicalName: row.providerName || "Unknown",
          displayName
        });
        modelProviderBrandColorMap.set(row.modelName, row.providerBrandColor ?? null);

        if (!providerDisplayNameBrandColorMap.has(displayName)) {
          providerDisplayNameBrandColorMap.set(displayName, row.providerBrandColor ?? null);
        }
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
      modelProviderBrandColorMap,
      providerDisplayNameBrandColorMap,
      rowsByModel,
      rowsByGroupingKey
    };
  }, [indexedSourceRows, showDuplicateRows]);

  const coveredModelsByGroupingKey = useMemo(() => {
    const coveredMap = new Map<string, Set<string>>();

    allRowsIndex.rowsByGroupingKey.forEach((groupedRows, matrixKey) => {
      const coveredModels = new Set<string>();

      groupedRows.forEach(({ row }) => {
        if (!hasMeaningfulMatrixRawValue(row.valueRaw)) return;
        coveredModels.add(row.modelName);
      });

      if (coveredModels.size > 0) {
        coveredMap.set(matrixKey, coveredModels);
      }
    });

    return coveredMap;
  }, [allRowsIndex]);

  const baseSourceRows = useMemo(() => {
    if (activeSource === SOURCE_ALL) {
      if (rows.length === 0) {
        return allRows;
      }

      const sourceCount = new Set(rows.map((row) => getSourceKey(row.source))).size;
      const benchmarkCount = new Set(rows.map((row) => getMatrixGroupingKey(row, showDuplicateRows))).size;

      if (sourceCount === 1 && benchmarkCount <= 1) {
        return allRows;
      }

      return rows;
    }

    const sourceScopedRows = scopedRowsBySource.get(activeSource) ?? allRowsBySource.get(activeSource) ?? [];
    if (sourceScopedRows.length > 0) {
      return sourceScopedRows;
    }

    return rows;
  }, [allRows, rows, scopedRowsBySource, allRowsBySource, activeSource, showDuplicateRows]);

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

    for (const [modelName, providerIdentity] of allRowsIndex.modelProviderMap.entries()) {
      const coveredCount = modelCoveredBenchmarkKeys.get(modelName)?.size ?? 0;
      if (coveredCount <= 0) continue;

      const providerName = providerIdentity.displayName || "Unknown";

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
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
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

          return compareModelNameByColumnOrder(left, right, collator);
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

  const defaultAllSourceModels = useMemo(() => {
    return baseModelNameSet.size <= 1
      ? [...allModelNames]
      : [...defaultSelectedModels];
  }, [allModelNames, defaultSelectedModels, baseModelNameSet]);

  const [selectedModalities, setSelectedModalities] = useState<string[]>([...MODALITY_OPTIONS]);
  const [selectedModels, setSelectedModels] = useState<string[]>(defaultAllSourceModels);

  useLayoutEffect(() => {
    if (!isModelSelectionLoaded) return;

    if (activeSource !== SOURCE_ALL && rows.length > 0 && baseSourceRows.length === 0) {
      return;
    }

    const allModelSet = new Set(allModelNames);
    const savedForSource = modelSelectionBySourceRef.current[activeSource];
    const fallbackDefaultModels = activeSource === SOURCE_ALL
      ? [...defaultAllSourceModels]
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

    isSyncingSelectionFromSourceRef.current = true;
    setSelectedModels((prev) => {
      if (prev.length === normalized.length && prev.every((item, index) => item === normalized[index])) {
        isSyncingSelectionFromSourceRef.current = false;
        return prev;
      }
      return normalized;
    });
  }, [activeSource, allModelNames, defaultSelectedModels, defaultAllSourceModels, isModelSelectionLoaded, rows.length, baseSourceRows.length]);

  useEffect(() => {
    if (!isModelSelectionLoaded) return;
    if (skipSelectionPersistenceOnceRef.current) {
      skipSelectionPersistenceOnceRef.current = false;
      return;
    }
    if (isSyncingSelectionFromSourceRef.current) {
      isSyncingSelectionFromSourceRef.current = false;
      return;
    }

    const sourceKey = activeSource;
    const normalized = Array.from(new Set(selectedModels)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const fallbackDefaultModels = sourceKey === SOURCE_ALL
      ? [...defaultAllSourceModels]
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
  }, [selectedModels, activeSource, isModelSelectionLoaded, allModelNames, defaultSelectedModels, defaultAllSourceModels]);

  useEffect(() => {
    const listener = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setCompareModelOrder((prev) => (prev.length > 0 ? [] : prev));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);
  const selectedModalitySet = useMemo(() => new Set(selectedModalities), [selectedModalities]);

  const modelProviderMap = allRowsIndex.modelProviderMap;
  const modelProviderBrandColorMap = allRowsIndex.modelProviderBrandColorMap;

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

  const coveragePrunedRows = useMemo(() => {
    if (activeSource !== SOURCE_ALL || showLowCoverageRows) {
      return filteredRows;
    }

    if (filteredRows.length === 0) {
      return filteredRows;
    }

    const candidateModels = Array.from(new Set(filteredRows.map((row) => row.modelName)));
    if (candidateModels.length === 0) {
      return filteredRows;
    }

    const rowModelsWithValue = new Map<string, Set<string>>();
    filteredRows.forEach((row) => {
      if (!hasMeaningfulMatrixRawValue(row.valueRaw)) return;

      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      if (!rowModelsWithValue.has(matrixKey)) {
        rowModelsWithValue.set(matrixKey, new Set<string>());
      }
      rowModelsWithValue.get(matrixKey)!.add(row.modelName);
    });

    if (rowModelsWithValue.size === 0) {
      return filteredRows;
    }

    const firstPassRowKeys = new Set<string>();
    rowModelsWithValue.forEach((modelsWithValue, matrixKey) => {
      const rowCoverage = modelsWithValue.size / candidateModels.length;
      if (rowCoverage >= ALL_SOURCE_ROW_COVERAGE_THRESHOLD) {
        firstPassRowKeys.add(matrixKey);
      }
    });

    if (firstPassRowKeys.size === 0) {
      return filteredRows;
    }

    const modelCoveredRowCount = new Map<string, number>();
    firstPassRowKeys.forEach((matrixKey) => {
      const modelsWithValue = rowModelsWithValue.get(matrixKey);
      if (!modelsWithValue) return;

      modelsWithValue.forEach((modelName) => {
        modelCoveredRowCount.set(modelName, (modelCoveredRowCount.get(modelName) ?? 0) + 1);
      });
    });

    const keptModels = new Set<string>();
    modelCoveredRowCount.forEach((coveredRowCount, modelName) => {
      const columnCoverage = coveredRowCount / firstPassRowKeys.size;
      if (columnCoverage >= ALL_SOURCE_COLUMN_COVERAGE_THRESHOLD) {
        keptModels.add(modelName);
      }
    });

    if (keptModels.size === 0) {
      return filteredRows;
    }

    const secondPassRowKeys = new Set<string>();
    rowModelsWithValue.forEach((modelsWithValue, matrixKey) => {
      let keptValueCount = 0;
      modelsWithValue.forEach((modelName) => {
        if (keptModels.has(modelName)) {
          keptValueCount += 1;
        }
      });

      const rowCoverage = keptValueCount / keptModels.size;
      if (rowCoverage >= ALL_SOURCE_ROW_COVERAGE_THRESHOLD) {
        secondPassRowKeys.add(matrixKey);
      }
    });

    if (secondPassRowKeys.size === 0) {
      return filteredRows;
    }

    const prunedRows = filteredRows.filter((row) => {
      if (!keptModels.has(row.modelName)) return false;
      const matrixKey = getMatrixGroupingKey(row, showDuplicateRows);
      return secondPassRowKeys.has(matrixKey);
    });

    return prunedRows.length > 0 ? prunedRows : filteredRows;
  }, [activeSource, filteredRows, showDuplicateRows, showLowCoverageRows]);

  const modelColumns = useMemo<readonly string[]>(() => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

    const modelStats = new Map<string, { providerName: string; numericCount: number; totalCount: number }>();

    coveragePrunedRows.forEach((row) => {
      const current = modelStats.get(row.modelName) ?? {
        providerName: row.providerDisplayName?.trim() || row.providerName || "Unknown",
        numericCount: 0,
        totalCount: 0
      };

      current.totalCount += 1;
      if (row.valueNum !== null) {
        current.numericCount += 1;
      }

      if (!current.providerName) {
        current.providerName = row.providerDisplayName?.trim() || row.providerName || "Unknown";
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
    coveragePrunedRows.forEach((row) => {
      if (getMatrixGroupingKey(row, showDuplicateRows) !== columnSortBenchmarkKey || row.valueNum === null) {
        return;
      }

      const comparableScore = getBenchmarkComparableScore(
        row.benchmarkName,
        row.valueNum,
        row.benchmarkType,
        row.higherIsBetter
      );
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
  }, [coveragePrunedRows, sourceModelHint, columnSortBenchmarkKey, showDuplicateRows, modelOrderBySource, activeSource]);

  const compareModelSet = useMemo(() => new Set(compareModelOrder), [compareModelOrder]);
  const compareBaselineModelName = compareModelOrder[0] ?? null;
  const isCompareActive = compareModelOrder.length >= 2;

  useEffect(() => {
    const visibleModelSet = new Set(modelColumns);

    enqueueStateUpdate(() => {
      setCompareModelOrder((prev) => {
        const next = prev.filter((modelName) => visibleModelSet.has(modelName));
        return areStringArraysEqual(prev, next) ? prev : next;
      });
    });
  }, [modelColumns]);

  useEffect(() => {
    if (!rowPresenceFilterModel) return;
    if (modelColumns.includes(rowPresenceFilterModel)) return;
    enqueueStateUpdate(() => setRowPresenceFilterModel(null));
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

    coveragePrunedRows.forEach((row) => {
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
      const sourceValueItems = getSourceValueDisplayItems(uniqueEntries);
      const valueIdentitySet = new Set(uniqueEntries.map((entry) => getMatrixCellValueIdentity(entry)));
      const noteText = (preferredEntry.valueNote ?? "").trim();
      const hasMeaningfulMultipleValues = uniqueEntries.length > 1 && valueIdentitySet.size > 1;
      const questionMarkPadding = hasMeaningfulMultipleValues || noteText.length > 0 ? 16 : 0;

      const compactDisplayValue = displayValue.replace(/\s*\/\s*/g, "/");
      const sourceValueWidth = displaySourceValuesInCells && sourceValueItems.length > 0
        ? Math.max(...sourceValueItems.map((item) => (
            measureTextWidth(`${item.sourceLabel}: ${item.rawValue}`, "600 11px Inter, ui-sans-serif, system-ui") + 20
          )))
        : 0;
      const measured = Math.max(
        measureTextWidth(compactDisplayValue, "600 14px Inter, ui-sans-serif, system-ui") + 18 + questionMarkPadding,
        sourceValueWidth
      );
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
  }, [modelColumns, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells]);

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

  const columnWidthOverrideKeySet = useMemo(() => new Set(columnWidthOverrideKeys), [columnWidthOverrideKeys]);

  const modelColumnMeta = useMemo(() => {
    return modelColumns.map((modelName) => {
      const providerIdentity = modelProviderMap.get(modelName);
      const providerName = providerIdentity?.displayName ?? "Unknown";
      const canonicalProviderName = providerIdentity?.canonicalName ?? providerName;
      const columnWidthKey = getModelColumnWidthKey(modelName);
      const autoWidth = autoModelWidthMap.get(columnWidthKey) ?? DEFAULT_MODEL_COLUMN_BASELINE_WIDTH;
      const storedWidth = activeColumnWidthMap[columnWidthKey];
      const isCompareSelected = compareModelSet.has(modelName);
      const isCompareBaseline = compareBaselineModelName === modelName;
      const hasManualWidthOverride = columnWidthOverrideKeySet.has(
        getColumnWidthOverrideKey(activeSource, columnWidthKey)
      );
      const compareExpandedDefaultWidth = isCompareBaseline
        ? COMPARE_BASELINE_DEFAULT_EXPANDED_WIDTH
        : COMPARE_BADGE_DEFAULT_EXPANDED_WIDTH;
      const shouldApplyCompareExpandedDefault = isCompareSelected && !hasManualWidthOverride;
      const preferredWidth = shouldApplyCompareExpandedDefault
        ? Math.max(storedWidth ?? autoWidth, compareExpandedDefaultWidth)
        : (storedWidth ?? autoWidth);
      const columnWidth = clampColumnWidth(
        preferredWidth,
        MIN_MODEL_COLUMN_RESIZE_WIDTH,
        MAX_MODEL_COLUMN_WIDTH
      );

      return {
        modelName,
        columnWidthKey,
        providerName,
        color: resolveProviderBrandColor(canonicalProviderName, modelProviderBrandColorMap.get(modelName) ?? null),
        columnWidth,
        isSourceMatched: sourceMatchedModelSet.has(modelName),
        isSourceMatchedFirst: sourceMatchedGroupBoundaryByModel.firstSet.has(modelName),
        isSourceMatchedLast: sourceMatchedGroupBoundaryByModel.lastSet.has(modelName)
      };
    });
  }, [
    modelColumns,
    modelProviderMap,
    modelProviderBrandColorMap,
    sourceMatchedModelSet,
    sourceMatchedGroupBoundaryByModel,
    columnWidthOverrideKeySet,
    autoModelWidthMap,
    activeColumnWidthMap,
    compareModelSet,
    compareBaselineModelName,
    activeSource
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
      const initialHigherIsBetter = typeof row.higherIsBetter === "boolean"
        ? row.higherIsBetter
        : !isLowerBetterBenchmark(row.benchmarkName, row.benchmarkType);

      if (!matrixMap.has(matrixKey)) {
        matrixMap.set(matrixKey, {
          rowKey: matrixKey,
          category,
          benchmark,
          higherIsBetter: initialHigherIsBetter,
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

      if (row.higherIsBetter === false) {
        matrixRow.higherIsBetter = false;
      }

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

    coveragePrunedRows.forEach((row) => {
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
          getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category, matrixRow.higherIsBetter)
        );

        const comparableValues2 = numericValues2.map((valueNum) =>
          getBenchmarkComparableScore(matrixRow.benchmark, valueNum, matrixRow.category, matrixRow.higherIsBetter)
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
      .filter((row) => row.rowDataCount > 0)
      .sort((a, b) => a.firstSeenIndex - b.firstSeenIndex);
  }, [baseSourceRows, coveragePrunedRows, showDuplicateRows]);

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

  const displayedCoverageMetaByModel = useMemo(() => {
    const displayedRowKeys = Array.from(new Set(presenceFilteredMatrixRows.map((row) => row.rowKey)));
    const displayedRowCount = displayedRowKeys.length;
    const coveredRowCountByModel = new Map<string, number>();
    const candidateModelSet = new Set(allModelNames);

    displayedRowKeys.forEach((rowKey) => {
      const coveredModels = coveredModelsByGroupingKey.get(rowKey);
      if (!coveredModels || coveredModels.size === 0) return;

      coveredModels.forEach((modelName) => {
        if (!candidateModelSet.has(modelName)) return;
        coveredRowCountByModel.set(modelName, (coveredRowCountByModel.get(modelName) ?? 0) + 1);
      });
    });

    const metaMap = new Map<string, { coveredCount: number; coverageRate: number }>();
    allModelNames.forEach((modelName) => {
      const coveredCount = coveredRowCountByModel.get(modelName) ?? 0;
      metaMap.set(modelName, {
        coveredCount,
        coverageRate: displayedRowCount > 0 ? coveredCount / displayedRowCount : 0
      });
    });

    return {
      displayedRowCount,
      metaMap
    };
  }, [allModelNames, coveredModelsByGroupingKey, presenceFilteredMatrixRows]);

  const modelCoveragePercentMap = useMemo(() => {
    const map = new Map<string, number>();
    displayedCoverageMetaByModel.metaMap.forEach((meta, modelName) => {
      map.set(modelName, Math.round(meta.coverageRate * 100));
    });
    return map;
  }, [displayedCoverageMetaByModel]);

  const providerAverageCoveragePercentMap = useMemo(() => {
    const map = new Map<string, number>();

    providerGroups.forEach((group) => {
      if (group.models.length === 0) {
        map.set(group.providerName, 0);
        return;
      }

      const totalCoverage = group.models.reduce((acc, modelName) => {
        return acc + (displayedCoverageMetaByModel.metaMap.get(modelName)?.coverageRate ?? 0);
      }, 0);

      map.set(group.providerName, Math.round((totalCoverage / group.models.length) * 100));
    });

    return map;
  }, [providerGroups, displayedCoverageMetaByModel]);

  const sortedMatrixRows = useMemo(() => {
    const rowsCopy = [...presenceFilteredMatrixRows];
    const effectiveMode = activeSource === SOURCE_ALL && rowSortState.mode === "source"
      ? "data"
      : rowSortState.mode;

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
  }, [presenceFilteredMatrixRows, rowSortState, activeSource]);

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
          comparable: getBenchmarkComparableScore(row.benchmark, valueNum, row.category, row.higherIsBetter)
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

  function toggleCompareModelSelection(modelName: string) {
    setCompareModelOrder((prev) => {
      if (prev.includes(modelName)) {
        return prev.filter((item) => item !== modelName);
      }

      return [...prev, modelName];
    });
  }

  function clearCompareSelection() {
    setCompareModelOrder((prev) => (prev.length > 0 ? [] : prev));
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
    const sourceKey = activeSource;
    const fallbackDefaultModels = sourceKey === SOURCE_ALL
      ? [...defaultAllSourceModels]
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
    setCompareModelOrder([]);
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

      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="relative z-[70] min-w-0 flex-1"
            ref={sourceTabsMenuRef}
            onMouseLeave={() => setIsSourceOverflowMenuOpen(false)}
          >
            {/* 固定高度占位槽，防止下拉时撑开导致页面抖动：tab(36px) + p-0.5(4px) + border(2px) = 42px */}
            <div className="h-[42px] w-full" />

            <div ref={sourceTabsViewportRef} className="absolute left-0 top-0 w-full min-w-0" data-source-tabs-viewport="1">
              <div
                role="tablist"
                className="tabs tabs-boxed w-full overflow-hidden whitespace-nowrap rounded-2xl border border-white/10 bg-[radial-gradient(140%_180%_at_0%_0%,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0)_35%),radial-gradient(120%_160%_at_100%_100%,rgba(72,140,255,0.18)_0%,rgba(72,140,255,0)_42%),linear-gradient(135deg,rgba(21,36,64,0.58),rgba(14,24,43,0.38))] p-0.5 shadow-[0_10px_30px_rgba(2,8,20,0.24),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
              >
                <div className="flex min-w-0 items-center justify-between gap-1 w-full relative">
                  <div className="flex flex-1 min-w-0 items-center overflow-hidden">
                    {visibleSourceOptions.map((source) => (
                      <button
                        key={source.key}
                        type="button"
                        role="tab"
                        className={`tab relative h-9 min-h-0 shrink-0 overflow-visible rounded-xl text-base-content/80 transition-all duration-150 ${
                          activeSource === source.key
                            ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content font-semibold shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                            : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                        }`}
                        onClick={() => setSourceAndUrl(source.key)}
                        title={getSourceTabDisplayText(source)}
                      >
                        {getSourceTabDisplayText(source)}
                      </button>
                    ))}
                  </div>

                  {overflowSourceOptions.length > 0 ? (
                    <div className="absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[#19243a]/90 via-[#19243a]/80 to-transparent pl-4 pr-1">
                      <button
                        type="button"
                        className="tab h-9 min-h-0 w-7 shrink-0 !rounded-lg bg-transparent px-0 text-xs font-medium text-base-content/65 hover:bg-white/8 hover:text-base-content"
                        aria-label="展开溢出页签"
                        aria-haspopup="menu"
                        aria-expanded={isSourceOverflowMenuOpen}
                        onMouseEnter={() => setIsSourceOverflowMenuOpen(true)}
                        onFocus={() => setIsSourceOverflowMenuOpen(true)}
                        onClick={() => setIsSourceOverflowMenuOpen((prev) => !prev)}
                      >
                        <ChevronDown
                          size={14}
                          className={`transition-transform duration-150 ${isSourceOverflowMenuOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  ) : null}
                </div>

                {overflowSourceOptions.length > 0 ? (
                  <div
                    role="menu"
                    onMouseEnter={() => setIsSourceOverflowMenuOpen(true)}
                    className={`grid transition-all duration-180 ${
                      isSourceOverflowMenuOpen
                        ? "pointer-events-auto opacity-100"
                        : "pointer-events-none opacity-0"
                    }`}
                    style={{
                      gridTemplateRows: isSourceOverflowMenuOpen ? "1fr" : "0fr"
                    }}
                  >
                    <div className="overflow-hidden border-t border-white/8 mt-0.5">
                      <div className="flex flex-wrap items-center gap-1 py-1">
                        {overflowSourceOptions.map((source) => (
                          <button
                            key={`overflow-${source.key}`}
                            type="button"
                            role="tab"
                            className={`tab relative h-9 min-h-0 overflow-visible rounded-xl text-base-content/80 transition-all duration-150 ${
                              activeSource === source.key
                                ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content font-semibold shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                                : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                            }`}
                            onClick={() => setSourceAndUrl(source.key)}
                            title={getSourceTabDisplayText(source)}
                          >
                            {getSourceTabDisplayText(source)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              ref={sourceTabsMeasureRef}
              aria-hidden="true"
              className="pointer-events-none absolute -left-[9999px] top-0 opacity-0"
            >
              <div className="tabs tabs-boxed whitespace-nowrap rounded-2xl border border-white/10 p-1">
                {sourceOptions.map((source) => (
                  <button
                    key={`measure-${source.key}`}
                    type="button"
                    data-source-tab-measure="item"
                    data-source-tab-measure-key={source.key}
                    className={`tab relative h-9 min-h-0 shrink-0 overflow-visible rounded-xl text-base-content/80 transition-all duration-150 ${
                      activeSource === source.key
                        ? "tab-active !rounded-xl !bg-primary/55 !text-primary-content font-semibold shadow-[0_6px_20px_rgba(93,167,255,0.24)]"
                        : "hover:!rounded-xl hover:bg-white/10 hover:text-base-content"
                    }`}
                  >
                    {getSourceTabDisplayText(source)}
                  </button>
                ))}
                <button
                  type="button"
                  data-source-tab-measure="more"
                  className="tab h-9 min-h-0 w-7 shrink-0 !rounded-lg bg-transparent px-0 text-xs font-medium text-base-content/65"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm h-[42px] min-h-[42px] shrink-0 rounded-2xl border border-white/25 bg-[linear-gradient(135deg,rgba(24,38,66,0.32),rgba(14,24,43,0.2))] px-5 text-base-content/90 shadow-[0_8px_22px_rgba(2,8,20,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm hover:border-white/35 hover:bg-white/10"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
            {isFullscreen ? "退出全屏" : "全屏显示表格"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 mt-4">
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2 text-xs">
            {compareModelOrder.length > 0 ? (
              <>
                <span className="font-semibold text-amber-200">比较模式</span>
                <span className="opacity-80">
                  基准：
                  <span className="font-semibold text-amber-100">{compareBaselineModelName ?? "--"}</span>
                </span>
                <span className="opacity-75">已选 {compareModelOrder.length} 个模型</span>
                <button type="button" className="btn btn-xs btn-ghost h-7 min-h-0 px-2" onClick={clearCompareSelection}>
                  清空比较
                </button>
              </>
            ) : (
              <span className="opacity-70">按住 Ctrl 点击模型表头，可选择并比较模型间差异</span>
            )}
          </div>

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

          {hasSourceData ? (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => setShowSourceValues((prev) => !prev)}
            >
              {displaySourceValuesInCells ? <Eye size={14} /> : <EyeOff size={14} />}
              显示 Source 原值
            </button>
          ) : null}

          {activeSource === SOURCE_ALL ? (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => setShowLowCoverageRows((prev) => !prev)}
            >
              {showLowCoverageRows ? <Eye size={14} /> : <EyeOff size={14} />}
              {showLowCoverageRows ? "隐藏低覆盖行" : "显示低覆盖行"}
            </button>
          ) : null}
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
              const baseOrderIndexByModel = new Map(group.models.map((model, index) => [model, index]));
              const modelsSortedByCoverage = [...group.models].sort((leftModel, rightModel) => {
                const leftCoverage = modelCoveragePercentMap.get(leftModel) ?? 0;
                const rightCoverage = modelCoveragePercentMap.get(rightModel) ?? 0;

                if (rightCoverage !== leftCoverage) {
                  return rightCoverage - leftCoverage;
                }

                return (baseOrderIndexByModel.get(leftModel) ?? 0) - (baseOrderIndexByModel.get(rightModel) ?? 0);
              });
              const hasOverflowModels = modelsSortedByCoverage.length > PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT;
              const leadingModels = hasOverflowModels
                ? modelsSortedByCoverage.slice(0, PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT)
                : modelsSortedByCoverage;
              const trailingModels = hasOverflowModels
                ? modelsSortedByCoverage.slice(PROVIDER_MODEL_AUTO_COLLAPSE_LIMIT)
                : [];
              const isLowCoverageExpanded = expandedLowCoverageProviders[group.providerName] === true;
              const providerModelsToRender = hasOverflowModels
                ? [
                    ...leadingModels,
                    ...(isLowCoverageExpanded ? trailingModels : [])
                  ]
                : modelsSortedByCoverage;
              const hiddenTrailingModelCount = hasOverflowModels && !isLowCoverageExpanded
                ? trailingModels.length
                : 0;

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
                        aria-label={group.providerName}
                        checked={providerChecked}
                        aria-checked={providerChecked ? "true" : selectedCount > 0 ? "mixed" : "false"}
                        ref={(element) => {
                          if (!element) return;
                          element.indeterminate = selectedCount > 0 && selectedCount < group.models.length;
                        }}
                        onChange={(e) => toggleProvider(group.providerName, e.target.checked)}
                      />
                      <span className="text-sm font-medium" style={{ color: resolveProviderBrandColor(group.providerName, allRowsIndex.providerDisplayNameBrandColorMap.get(group.providerName) ?? null) }}>
                        {group.providerName}
                        {providerHasBaseModel ? null : <span className="ml-1 text-[10px] opacity-70">(跨页签)</span>}
                      </span>
                    </label>
                    <span className="text-xs opacity-70">{selectedCount}/{group.models.length} · 覆盖率 {providerAverageCoverage}%</span>
                  </summary>

                  <div className="grid grid-cols-1 gap-1 pb-2 pt-1">
                    {providerModelsToRender.map((model) => {
                      const isBaseModel = baseModelNameSet.has(model);
                      const coveragePercent = modelCoveragePercentMap.get(model) ?? 0;
                      const coverageText = isBaseModel ? `${coveragePercent}%\u200b` : `${coveragePercent}%`;

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
                            aria-label={model}
                            checked={selectedModelSet.has(model)}
                            onChange={(e) => toggleModel(model, e.target.checked)}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate" title={model}>{model}</span>
                            {isBaseModel ? null : (
                              <span className="shrink-0 whitespace-nowrap rounded border border-dashed border-base-content/40 px-1 text-[10px] leading-none opacity-70">跨页签</span>
                            )}
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-[10px] opacity-70">{coverageText}</span>
                        </label>
                      );
                    })}

                    {trailingModels.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost h-7 min-h-0 justify-start px-1 text-[11px] opacity-80 hover:opacity-100"
                        onClick={() => {
                          setExpandedLowCoverageProviders((prev) => ({
                            ...prev,
                            [group.providerName]: !prev[group.providerName]
                          }));
                        }}
                      >
                        {isLowCoverageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {isLowCoverageExpanded
                          ? `收起后续模型（${trailingModels.length}）`
                          : `展开后续模型（${hiddenTrailingModelCount}）`}
                      </button>
                    ) : null}
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
                const isCompareBaseline = compareBaselineModelName === model.modelName;
                const isCompareSelected = compareModelSet.has(model.modelName);
                const headerFrameShadows = buildSourceFrameShadows({
                  isMatched: model.isSourceMatched,
                  isFirst: model.isSourceMatchedFirst,
                  isLast: model.isSourceMatchedLast,
                  includeTop: true,
                  exportMode: isExportCaptureMode
                });
                const compareBaselineShadows = buildCompareBaselineShadows({
                  isBaseline: isCompareBaseline,
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
                const compareSelectedRing = isCompareSelected && !isCompareBaseline
                  ? "inset 0 0 0 1px rgba(148, 163, 184, 0.52)"
                  : "";
                const combinedHeaderShadow = [
                  ...headerFrameShadows,
                  ...compareBaselineShadows,
                  compareSelectedRing,
                  dragIndicatorShadow,
                  activeUnderlineShadow
                ]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <th
                    key={model.modelName}
                    draggable={!resizingColumnKey}
                    data-source-match={model.isSourceMatched ? "1" : undefined}
                    data-source-match-first={model.isSourceMatchedFirst ? "1" : undefined}
                    data-source-match-last={model.isSourceMatchedLast ? "1" : undefined}
                    data-compare-baseline={isCompareBaseline ? "1" : undefined}
                    aria-grabbed={isDraggingCurrentModel ? "true" : "false"}
                    title={isCompareBaseline
                      ? "基准模型（Ctrl/Cmd+点击可取消）"
                      : isPresenceFilterActive
                        ? "再次点击显示全部行（Ctrl/Cmd+点击加入比较）"
                        : "点击仅保留该模型有值的行（Ctrl/Cmd+点击加入比较）"}
                    onDragStart={(event) => {
                      const target = event.target as HTMLElement;
                      if (event.ctrlKey || event.metaKey || resizingColumnKey || target.closest(".column-resize-handle")) {
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
                    onClick={(event) => {
                      if (draggingModelName || shouldSuppressHeaderInteractions()) return;

                      if (isSelectionModifierClick(event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleModel(model.modelName, !selectedModelSet.has(model.modelName));
                        return;
                      }

                      if (isCompareModifierClick(event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleCompareModelSelection(model.modelName);
                        return;
                      }

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
                        lineHeight: 1.15
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          wordBreak: "break-word"
                        }}
                      >
                        {model.modelName}
                      </span>
                      {isCompareBaseline ? (
                        <span
                          className="mt-1 inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                          style={{
                            borderColor: "rgba(250, 211, 106, 0.8)",
                            color: "rgba(250, 219, 133, 0.98)",
                            backgroundColor: "rgba(43, 32, 13, 0.58)",
                            wordBreak: "keep-all"
                          }}
                        >
                          Baseline
                        </span>
                      ) : isCompareSelected ? (
                        <span
                          className="mt-1 inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                          style={{
                            borderColor: "rgba(148, 163, 184, 0.68)",
                            color: "rgba(226, 232, 240, 0.96)",
                            backgroundColor: "rgba(15, 23, 42, 0.45)",
                            wordBreak: "keep-all"
                          }}
                        >
                          Compare
                        </span>
                      ) : null}
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
              const isRowLowerBetter = isLowerBetterBenchmark(
                matrixRow.benchmark,
                matrixRow.category,
                matrixRow.higherIsBetter
              );
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
              const primaryComparableValues = modelColumnMeta
                .map((model) => {
                  const valueNum = matrixRow.cells.get(model.modelName)?.valueNum;
                  if (valueNum === null || valueNum === undefined || !Number.isFinite(valueNum)) {
                    return null;
                  }

                  return getBenchmarkComparableScore(
                    matrixRow.benchmark,
                    valueNum,
                    matrixRow.category,
                    matrixRow.higherIsBetter
                  );
                })
                .filter((value): value is number => value !== null && Number.isFinite(value));
              const secondaryComparableValues = modelColumnMeta
                .map((model) => {
                  const valueNum2 = matrixRow.cells.get(model.modelName)?.valueNum2;
                  if (valueNum2 === null || valueNum2 === undefined || !Number.isFinite(valueNum2)) {
                    return null;
                  }

                  return getBenchmarkComparableScore(
                    matrixRow.benchmark,
                    valueNum2,
                    matrixRow.category,
                    matrixRow.higherIsBetter
                  );
                })
                .filter((value): value is number => value !== null && Number.isFinite(value));
              const primaryComparableDistinctDesc = Array.from(new Set(primaryComparableValues)).sort((a, b) => b - a);
              const secondaryComparableDistinctDesc = Array.from(new Set(secondaryComparableValues)).sort((a, b) => b - a);
              const primaryComparableTop = primaryComparableDistinctDesc[0] ?? null;
              const primaryComparableSecond = primaryComparableDistinctDesc[1] ?? null;
              const secondaryComparableTop = secondaryComparableDistinctDesc[0] ?? null;
              const secondaryComparableSecond = secondaryComparableDistinctDesc[1] ?? null;
              const topRankSegmentStyle = {
                fontWeight: 800
              };
              const secondRankSegmentStyle = isExportCaptureMode
                ? {
                    display: "inline-block",
                    borderBottom: "1.5px solid rgba(15, 23, 42, 0.45)",
                    paddingBottom: "0.5px",
                    lineHeight: 1
                  }
                : {
                    textDecoration: "underline",
                    textDecorationColor: "rgba(15, 23, 42, 0.35)",
                    textDecorationThickness: "1px",
                    textUnderlineOffset: "2px"
                  };

              const baselineCellForRow = compareBaselineModelName
                ? matrixRow.cells.get(compareBaselineModelName)
                : undefined;
              const baselineValueNum = baselineCellForRow?.valueNum ?? null;
              const compareAbsEffectiveDeltaValues =
                isCompareActive && compareBaselineModelName && baselineValueNum !== null
                  ? modelColumnMeta
                      .filter((model) => compareModelSet.has(model.modelName) && model.modelName !== compareBaselineModelName)
                      .map((model) => {
                        const compareCellNum = matrixRow.cells.get(model.modelName)?.valueNum;
                        if (compareCellNum === null || compareCellNum === undefined || !Number.isFinite(compareCellNum)) {
                          return null;
                        }

                        const deltaRaw = compareCellNum - baselineValueNum;
                        const deltaEffective = isRowLowerBetter ? -deltaRaw : deltaRaw;
                        return Math.abs(deltaEffective);
                      })
                      .filter((value): value is number => value !== null && Number.isFinite(value))
                  : [];
              const compareAbsEffectiveDeltaP90 = compareAbsEffectiveDeltaValues.length > 0
                ? Math.max(
                    getSortedQuantile([...compareAbsEffectiveDeltaValues].sort((a, b) => a - b), 0.9),
                    Number.EPSILON
                  )
                : null;

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
                    const isCompareBaseline = compareBaselineModelName === model.modelName;
                    const isCompareSelected = compareModelSet.has(model.modelName);
                    const comparableCellNum = cellNum !== null
                      ? getBenchmarkComparableScore(matrixRow.benchmark, cellNum, matrixRow.category, matrixRow.higherIsBetter)
                      : null;
                    const comparableCellNum2 = cellNum2 !== null
                      ? getBenchmarkComparableScore(matrixRow.benchmark, cellNum2, matrixRow.category, matrixRow.higherIsBetter)
                      : null;
                    const rawText = cell?.displayValue ?? "--";
                    const noteText = cell?.noteText ?? "";
                    const shouldShowQuestionMark = cell?.shouldShowQuestionMark ?? false;
                    const uniqueEntries = cell?.uniqueEntries ?? [];
                    const sourceValueItems = displaySourceValuesInCells ? getSourceValueDisplayItems(uniqueEntries) : [];
                    const shouldRenderSourceValues = sourceValueItems.length > 0;
                    const isTopCellFirst =
                      comparableCellNum !== null &&
                      primaryComparableTop !== null &&
                      comparableCellNum === primaryComparableTop;
                    const isSecondCellFirst =
                      comparableCellNum !== null &&
                      primaryComparableSecond !== null &&
                      comparableCellNum === primaryComparableSecond;
                    const isTopCellSecond =
                      comparableCellNum2 !== null &&
                      secondaryComparableTop !== null &&
                      comparableCellNum2 === secondaryComparableTop;
                    const isSecondCellSecond =
                      comparableCellNum2 !== null &&
                      secondaryComparableSecond !== null &&
                      comparableCellNum2 === secondaryComparableSecond;
                    const pairFirstDisplay = cell ? formatValueNumForDisplay(cell.valueNum) : null;
                    const pairSecondDisplay = cell ? formatValueNumForDisplay(cell.valueNum2) : null;
                    const isPairNumericDisplay =
                      Boolean(cell?.valueRaw.includes("/")) &&
                      pairFirstDisplay !== null &&
                      pairSecondDisplay !== null &&
                      !/[$¥€£]/.test(cell?.valueRaw ?? "");

                    const compareDeltaRaw =
                      isCompareActive
                      && compareAbsEffectiveDeltaP90 !== null
                      && baselineValueNum !== null
                      && cellNum !== null
                      && isCompareSelected
                      && !isCompareBaseline
                        ? cellNum - baselineValueNum
                        : null;
                    const compareDeltaEffective = compareDeltaRaw === null
                      ? null
                      : (isRowLowerBetter ? -compareDeltaRaw : compareDeltaRaw);
                    const compareDirection: CompareDirection = compareDeltaEffective === null
                      ? "flat"
                      : Math.abs(compareDeltaEffective) < Number.EPSILON
                        ? "flat"
                        : compareDeltaEffective > 0
                          ? "up"
                          : "down";
                    const compareIntensity =
                      compareDeltaEffective === null || compareAbsEffectiveDeltaP90 === null
                        ? 0
                        : clampCompareIntensity(Math.abs(compareDeltaEffective) / compareAbsEffectiveDeltaP90);
                    const showCompareBadge = compareDeltaRaw !== null;
                    const compareBadgeStyle = showCompareBadge
                      ? getCompareDeltaBadgeStyle(compareDirection, compareIntensity, isExportCaptureMode)
                      : null;
                    const showQuestionMarkIcon = (shouldRenderSourceValues ? noteText.length > 0 : shouldShowQuestionMark) && !showCompareBadge;
                    const compareArrow = compareDirection === "up" ? "▲" : compareDirection === "down" ? "▼" : "•";
                    const compareDeltaText = showCompareBadge && compareDeltaRaw !== null
                      ? formatComparisonDeltaValue(compareDeltaRaw)
                      : "";

                    const basePadding = showQuestionMarkIcon
                      ? (isPairNumericDisplay ? 18 : 22)
                      : 6;
                    const comparePadding = showCompareBadge
                      ? Math.min(28, 9 + compareDeltaText.length * 3)
                      : 0;
                    const cellPaddingRight = `${basePadding + comparePadding}px`;
                    const singleCellScoreStyle = !isPairNumericDisplay
                      ? (isTopCellFirst ? topRankSegmentStyle : isSecondCellFirst ? secondRankSegmentStyle : undefined)
                      : undefined;
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
                    const compareBaselineShadows = buildCompareBaselineShadows({
                      isBaseline: isCompareBaseline,
                      includeBottom: isLastMatrixRow,
                      exportMode: isExportCaptureMode
                    });
                    const mergedCellBoxShadow = [
                      rowCellBoxShadow,
                      ...sourceFrameShadows,
                      ...compareBaselineShadows
                    ].filter(Boolean).join(", ");

                    return (
                      <td
                        key={`${rowKey}::${model.modelName}`}
                        data-source-match={model.isSourceMatched ? "1" : undefined}
                        data-source-match-first={model.isSourceMatchedFirst ? "1" : undefined}
                        data-source-match-last={model.isSourceMatchedLast ? "1" : undefined}
                        data-compare-baseline={isCompareBaseline ? "1" : undefined}
                        data-compare-baseline-bottom={
                          isCompareBaseline && isLastMatrixRow ? "1" : undefined
                        }
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
                          whiteSpace: shouldRenderSourceValues ? "normal" : "nowrap",
                          position: "relative",
                          width: model.columnWidth,
                          minWidth: model.columnWidth,
                          maxWidth: model.columnWidth,
                          boxShadow: mergedCellBoxShadow || undefined,
                          ...(modelIndex === modelColumnMeta.length - 1 ? rowRightEdgeStyle ?? {} : {})
                        }}
                      >
                        {shouldRenderSourceValues ? (
                          <span className="flex min-w-0 flex-col gap-0.5">
                            {sourceValueItems.map((item) => (
                              <span
                                key={item.key}
                                className="inline-flex min-w-0 items-baseline gap-1 rounded-md border border-white/10 bg-slate-950/20 px-1.5 py-0.5 text-[11px] leading-tight"
                                title={`${item.sourceLabel}: ${item.rawValue}`}
                              >
                                <span className="max-w-[112px] shrink truncate text-[10px] font-medium opacity-70">
                                  {item.sourceLabel}
                                </span>
                                <span className="min-w-0 truncate font-semibold">
                                  {item.rawValue}
                                </span>
                              </span>
                            ))}
                          </span>
                        ) : isPairNumericDisplay && pairFirstDisplay && pairSecondDisplay ? (
                          <span className="inline-flex items-center gap-0 leading-none">
                            <span style={isTopCellFirst ? topRankSegmentStyle : isSecondCellFirst ? secondRankSegmentStyle : undefined}>{pairFirstDisplay}</span>
                            <span className="mx-[1px] opacity-85">/</span>
                            <span style={isTopCellSecond ? topRankSegmentStyle : isSecondCellSecond ? secondRankSegmentStyle : undefined}>{pairSecondDisplay}</span>
                          </span>
                        ) : (
                          <span style={singleCellScoreStyle}>{rawText}</span>
                        )}
                        {showCompareBadge && compareBadgeStyle ? (
                          <span
                            data-compare-delta-badge="1"
                            data-compare-direction={compareDirection}
                            className="absolute top-1/2 inline-flex h-[14px] -translate-y-1/2 items-center overflow-hidden rounded-[5px] border text-[9px] font-semibold leading-none"
                            style={{
                              right: "3px",
                              color: compareBadgeStyle.textColor,
                              borderColor: compareBadgeStyle.borderColor,
                              backgroundColor: compareBadgeStyle.backgroundColor,
                              boxShadow: compareBadgeStyle.boxShadow,
                              textShadow: compareBadgeStyle.textShadow,
                              WebkitTextStroke: compareBadgeStyle.textStroke
                            }}
                            title={`相对基准 ${compareBaselineModelName} 的差值`}
                          >
                            <span
                              className="inline-flex h-full min-w-[11px] items-center justify-center px-[2px] text-[9px] font-bold leading-none"
                              style={{
                                color: compareBadgeStyle.textColor
                              }}
                            >
                              {compareArrow}
                            </span>
                            <span
                              className="h-[8px] w-px"
                              style={{
                                backgroundColor: compareBadgeStyle.separatorColor
                              }}
                            />
                            <span
                              className="inline-flex h-full items-center px-[3px] text-[9px] font-semibold leading-none"
                              style={{
                                color: compareBadgeStyle.textColor
                              }}
                            >
                              {compareDeltaText}
                            </span>
                          </span>
                        ) : null}
                        {showQuestionMarkIcon ? (
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

          <span className="block max-h-[65vh] space-y-1 overflow-auto">
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

// Re-export test functions
export {
  __buildSourceFrameShadowsForTest,
  __buildCompareBaselineShadowsForTest,
  __applyExportSourceFrameFallbackForTest,
  __applyExportCompareBaselineFallbackForTest,
  __buildOverallScoreDisplayDecimalsMapForTest,
  __resolveCaptureDimensionsForTest
} from "./benchmark-matrix/index";
