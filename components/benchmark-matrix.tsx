"use client";

/* eslint-disable react-hooks/preserve-manual-memoization -- This large matrix keeps hand-tuned memoization to preserve table behavior. */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
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
  useMatrixColumnResize,
  useMatrixColumnWidths,
  type ColumnResizeState
} from "./benchmark-matrix/column-width";
import {
  saveModelOrderBySource,
  saveModelSelectionBySource,
  useExportPresetStorage,
  useHeatmapPaletteStorage,
  useMatrixPreferenceStorage
} from "./benchmark-matrix/persistence";
import {
  buildAllModelNames,
  buildAllRowsIndex,
  buildBaseBenchmarkKeySet,
  buildBaseModelNameSet,
  buildCoverageMetaByModel,
  buildCoveragePrunedRows,
  buildCoveredModelsByGroupingKey,
  buildDefaultAllSourceModels,
  buildDefaultSelectedModels,
  buildDisplayedCoverageMetaByModel,
  buildFilteredRows,
  buildHeaderUniqueCounts,
  buildMatrixRows,
  buildModelColumns,
  buildModelCoveragePercentMap,
  buildOverallHeatRange,
  buildOverallScoreDisplayDecimalsByModel,
  buildOverallSummaryByModel,
  buildProviderAverageCoveragePercentMap,
  buildProviderGroups,
  buildRowsBySource,
  buildRowsWithSourceMeta,
  filterMatrixRowsByModalities,
  filterMatrixRowsByPresence,
  resolveBaseSourceRows,
  sortMatrixRows
} from "./benchmark-matrix/selectors";
import { useMatrixSourceTabs } from "./benchmark-matrix/source-tabs";
import {
  type MatrixCellEntry,
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
  SOURCE_ALL,
  MODALITY_OPTIONS,
  CATEGORY_COLUMN_WIDTH_KEY,
  BENCHMARK_COLUMN_WIDTH_KEY,
  MIN_CATEGORY_COLUMN_WIDTH,
  MAX_CATEGORY_COLUMN_WIDTH,
  MIN_BENCHMARK_COLUMN_WIDTH,
  MAX_BENCHMARK_COLUMN_WIDTH,
  MIN_MODEL_COLUMN_RESIZE_WIDTH,
  MAX_MODEL_COLUMN_WIDTH,
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
  getMatrixCellDisplayValue,
  formatTooltipTime,
  formatValueNumForDisplay,
  formatComparisonDeltaValue,
  normalizeHexColor,
  clampHeatmapAlpha,
  hexToRgbTuple,
  rgbaFromHex,
  getHeatCellStyle,
  areStringArraysEqual,
  sourceTabDisplayLabel,
  renderModalityBadge,
  normalizeMatchToken,
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
  withTimeout,
  enqueueStateUpdate,
  getSourceValueDeltaRaw,
  getSourceValueDisplayItem
} from "./benchmark-matrix/index";

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
  const columnResizeStateRef = useRef<ColumnResizeState | null>(null);
  const headerInteractionSuppressUntilRef = useRef(0);
  const exportPresetLoadedRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
  const [showDuplicateRows, setShowDuplicateRows] = useState(false);
  const [showSourceValues, setShowSourceValues] = useState(false);
  const [showSourceValueDeltas, setShowSourceValueDeltas] = useState(false);
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
  const [sourceNewReferenceTime, setSourceNewReferenceTime] = useState<number | null>(null);
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

  const {
    sourceOptions,
    activeSource,
    activeSourceRef,
    hasSourceData,
    visibleSourceOptions,
    overflowSourceOptions,
    sourceNewStateByKey,
    getSourceTabDisplayText,
    getSourceTabTitle,
    setSourceAndUrl
  } = useMatrixSourceTabs({
    rows,
    allRows,
    allSourceOptions,
    isClientReady,
    pathname,
    router,
    searchParams,
    sourceNewReferenceTime,
    overflowSourceKeys,
    setOverflowSourceKeys,
    isSourceOverflowMenuOpen,
    setIsSourceOverflowMenuOpen,
    sourceTabsViewportRef,
    sourceTabsMeasureRef,
    skipSelectionPersistenceOnceRef,
    setRowSortState
  });

  const displaySourceValuesInCells = showSourceValues && hasSourceData && activeSource !== SOURCE_ALL;
  const displaySourceValueDeltasInCells = displaySourceValuesInCells && showSourceValueDeltas;

  useEffect(() => {
    enqueueStateUpdate(() => setIsClientReady(true));
  }, []);

  useEffect(() => {
    enqueueStateUpdate(() => setSourceNewReferenceTime(Date.now()));
  }, []);

  useEffect(() => {
    activeSourceRef.current = activeSource;
  }, [activeSource, activeSourceRef]);

  useMatrixPreferenceStorage({
    modelSelectionBySourceRef,
    setIsModelSelectionLoaded,
    modelOrderBySource,
    setModelOrderBySource,
    isModelOrderLoaded,
    setIsModelOrderLoaded,
    columnWidthBySourceRef,
    setIsColumnWidthLoaded,
    showCategoryLoadedRef,
    showCategory,
    setShowCategory,
    showDuplicateLoadedRef,
    showDuplicateRows,
    setShowDuplicateRows,
    showSourceValuesLoadedRef,
    showSourceValues,
    setShowSourceValues
  });

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

  useExportPresetStorage({
    exportPresetLoadedRef,
    exportPreset,
    setExportPreset
  });

  useHeatmapPaletteStorage({
    heatmapPaletteLoadedRef,
    heatmapPalette,
    setHeatmapPalette,
    heatmapAlpha,
    setHeatmapAlpha,
    heatmapPresetSelection,
    setHeatmapPresetSelection
  });

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

  const { beginColumnResize, shouldSuppressHeaderInteractions } = useMatrixColumnResize({
    activeSourceRef,
    columnResizeStateRef,
    headerInteractionSuppressUntilRef,
    resizingColumnKey,
    setActiveColumnWidthMap,
    setColumnWidthOverrideKeys,
    setResizingColumnKey
  });

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

  const scopedRowsBySource = useMemo(
    () => buildRowsBySource(rows),
    [rows]
  );

  const allRowsBySource = useMemo(
    () => buildRowsBySource(allRows),
    [allRows]
  );

  const allRowsWithSourceMeta = useMemo(
    () => buildRowsWithSourceMeta(allRows),
    [allRows]
  );

  const indexedSourceRows = useMemo(
    () => (activeSource === SOURCE_ALL ? allRows : allRowsWithSourceMeta),
    [allRows, allRowsWithSourceMeta, activeSource]
  );

  const allRowsIndex = useMemo(
    () => buildAllRowsIndex(indexedSourceRows, showDuplicateRows),
    [indexedSourceRows, showDuplicateRows]
  );

  const coveredModelsByGroupingKey = useMemo(
    () => buildCoveredModelsByGroupingKey(allRowsIndex),
    [allRowsIndex]
  );

  const baseSourceRows = useMemo(
    () => resolveBaseSourceRows(allRows, rows, scopedRowsBySource, allRowsBySource, activeSource, showDuplicateRows),
    [allRows, rows, scopedRowsBySource, allRowsBySource, activeSource, showDuplicateRows]
  );

  const baseBenchmarkKeySet = useMemo(
    () => buildBaseBenchmarkKeySet(baseSourceRows, showDuplicateRows),
    [baseSourceRows, showDuplicateRows]
  );

  const baseModelNameSet = useMemo(
    () => buildBaseModelNameSet(baseSourceRows),
    [baseSourceRows]
  );

  const sourceTabMatchLabel = useMemo(() => {
    if (activeSource === SOURCE_ALL) return "";
    return sourceTabDisplayLabel(activeSource).trim();
  }, [activeSource]);

  const sourceModelHint = useMemo(() => {
    if (!sourceTabMatchLabel) return "";
    return normalizeMatchToken(sourceTabMatchLabel);
  }, [sourceTabMatchLabel]);

  const coverageMetaByModel = useMemo(
    () => buildCoverageMetaByModel(allRowsIndex, baseBenchmarkKeySet, baseModelNameSet),
    [allRowsIndex, baseBenchmarkKeySet, baseModelNameSet]
  );

  const providerGroups = useMemo(
    () => buildProviderGroups(coverageMetaByModel, sourceModelHint),
    [coverageMetaByModel, sourceModelHint]
  );

  const allModelNames = useMemo(
    () => buildAllModelNames(providerGroups),
    [providerGroups]
  );

  const defaultSelectedModels = useMemo(
    () => buildDefaultSelectedModels(allModelNames, baseModelNameSet),
    [allModelNames, baseModelNameSet]
  );

  const defaultAllSourceModels = useMemo(
    () => buildDefaultAllSourceModels(allModelNames, defaultSelectedModels, baseModelNameSet),
    [allModelNames, defaultSelectedModels, baseModelNameSet]
  );

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

    saveModelSelectionBySource(modelSelectionBySourceRef.current);
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

  const filteredRows = useMemo(
    () => buildFilteredRows(allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet),
    [allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet]
  );

  const coveragePrunedRows = useMemo(
    () => buildCoveragePrunedRows(activeSource, filteredRows, showDuplicateRows, showLowCoverageRows),
    [activeSource, filteredRows, showDuplicateRows, showLowCoverageRows]
  );

  const modelColumns = useMemo<readonly string[]>(
    () => buildModelColumns(coveragePrunedRows, sourceModelHint, columnSortBenchmarkKey, showDuplicateRows, modelOrderBySource, activeSource),
    [coveragePrunedRows, sourceModelHint, columnSortBenchmarkKey, showDuplicateRows, modelOrderBySource, activeSource]
  );

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

  const {
    categoryColumnWidth,
    benchmarkColumnWidth,
    modelColumnMeta,
    hiddenResizeHandleKeys
  } = useMatrixColumnWidths({
    modelColumns,
    coveragePrunedRows,
    showDuplicateRows,
    displaySourceValuesInCells,
    displaySourceValueDeltasInCells,
    activeSource,
    activeSourceRef,
    activeColumnWidthMap,
    setActiveColumnWidthMap,
    columnWidthBySourceRef,
    columnWidthPersistTimeoutRef,
    columnWidthOverrideKeys,
    isColumnWidthLoaded,
    sourceTabMatchLabel,
    modelProviderMap,
    modelProviderBrandColorMap,
    compareModelSet,
    compareBaselineModelName
  });

  const matrixRows = useMemo(
    () => buildMatrixRows(baseSourceRows, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells, activeSource),
    [baseSourceRows, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells, activeSource]
  );

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

  const modalityFilteredMatrixRows = useMemo(
    () => filterMatrixRowsByModalities(matrixRows, selectedModalitySet),
    [matrixRows, selectedModalitySet]
  );

  const presenceFilteredMatrixRows = useMemo(
    () => filterMatrixRowsByPresence(modalityFilteredMatrixRows, rowPresenceFilterModel),
    [modalityFilteredMatrixRows, rowPresenceFilterModel]
  );

  const displayedCoverageMetaByModel = useMemo(
    () => buildDisplayedCoverageMetaByModel(allModelNames, coveredModelsByGroupingKey, presenceFilteredMatrixRows),
    [allModelNames, coveredModelsByGroupingKey, presenceFilteredMatrixRows]
  );

  const modelCoveragePercentMap = useMemo(
    () => buildModelCoveragePercentMap(displayedCoverageMetaByModel),
    [displayedCoverageMetaByModel]
  );

  const providerAverageCoveragePercentMap = useMemo(
    () => buildProviderAverageCoveragePercentMap(providerGroups, displayedCoverageMetaByModel),
    [providerGroups, displayedCoverageMetaByModel]
  );

  const sortedMatrixRows = useMemo(
    () => sortMatrixRows(presenceFilteredMatrixRows, rowSortState, activeSource),
    [presenceFilteredMatrixRows, rowSortState, activeSource]
  );

  const headerUniqueCounts = useMemo(
    () => buildHeaderUniqueCounts(presenceFilteredMatrixRows),
    [presenceFilteredMatrixRows]
  );

  const overallSummaryByModel = useMemo(
    () => buildOverallSummaryByModel(presenceFilteredMatrixRows, modelColumns),
    [presenceFilteredMatrixRows, modelColumns]
  );

  const hasOverallSummary = useMemo(() => {
    return modelColumns.some((modelName) => overallSummaryByModel.get(modelName)?.rawScore !== null);
  }, [modelColumns, overallSummaryByModel]);

  const overallHeatRange = useMemo(
    () => buildOverallHeatRange(modelColumns, overallSummaryByModel),
    [modelColumns, overallSummaryByModel]
  );

  const overallScoreDisplayDecimalsByModel = useMemo(
    () => buildOverallScoreDisplayDecimalsByModel(modelColumns, overallSummaryByModel),
    [modelColumns, overallSummaryByModel]
  );

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

    saveModelSelectionBySource(nextSelectionBySource);

    setModelOrderBySource((prev) => {
      if (!(sourceKey in prev)) return prev;

      const next = { ...prev };
      delete next[sourceKey];

      saveModelOrderBySource(next);

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
                        title={getSourceTabTitle(source)}
                      >
                        {getSourceTabDisplayText(source)}
                        {sourceNewStateByKey.has(source.key) ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-[4px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                          />
                        ) : null}
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
                            title={getSourceTabTitle(source)}
                          >
                            {getSourceTabDisplayText(source)}
                            {sourceNewStateByKey.has(source.key) ? (
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute right-[4px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                              />
                            ) : null}
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
                    {sourceNewStateByKey.has(source.key) ? (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-[4px] top-[6px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_1px_rgba(6,78,59,0.75),0_0_8px_rgba(110,231,183,0.45)]"
                      />
                    ) : null}
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

          {hasSourceData && activeSource !== SOURCE_ALL ? (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              title="普通点击切换当前 source 值；按住 Ctrl 点击切换差值徽标"
              onClick={(event) => {
                if (isCompareModifierClick(event)) {
                  event.preventDefault();
                  setShowSourceValues(true);
                  setShowSourceValueDeltas((prev) => !prev);
                  return;
                }

                setShowSourceValues((prev) => {
                  const next = !prev;
                  if (!next) {
                    setShowSourceValueDeltas(false);
                  }
                  return next;
                });
              }}
            >
              {displaySourceValuesInCells ? <Eye size={14} /> : <EyeOff size={14} />}
              显示原始值
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
              const sourceDeltaAbsValues = displaySourceValueDeltasInCells
                ? modelColumnMeta
                    .map((model) => {
                      const cell = matrixRow.cells.get(model.modelName);
                      if (!cell?.hasMeaningfulMultipleValues) {
                        return null;
                      }

                      const deltaRaw = getSourceValueDeltaRaw(cell.uniqueEntries, activeSource, matrixRow.higherIsBetter);
                      return deltaRaw === null ? null : Math.abs(deltaRaw);
                    })
                    .filter((value): value is number => value !== null && Number.isFinite(value))
                : [];
              const sourceDeltaAbsP90 = sourceDeltaAbsValues.length > 0
                ? Math.max(
                    getSortedQuantile(sourceDeltaAbsValues.sort((a, b) => a - b), 0.9),
                    Number.EPSILON
                  )
                : null;
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
                    getSortedQuantile(compareAbsEffectiveDeltaValues.sort((a, b) => a - b), 0.9),
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
                    const sourceValueItem = displaySourceValuesInCells && cell?.hasMeaningfulMultipleValues
                      ? getSourceValueDisplayItem(uniqueEntries, activeSource, matrixRow.higherIsBetter)
                      : null;
                    const sourceValueDeltaRaw = displaySourceValueDeltasInCells && cell?.hasMeaningfulMultipleValues
                      ? getSourceValueDeltaRaw(uniqueEntries, activeSource, matrixRow.higherIsBetter)
                      : null;
                    const shouldRenderSourceValues = Boolean(sourceValueItem);
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
                    const compareArrow = compareDirection === "up" ? "▲" : compareDirection === "down" ? "▼" : "•";
                    const compareDeltaText = showCompareBadge && compareDeltaRaw !== null
                      ? formatComparisonDeltaValue(compareDeltaRaw)
                      : "";
                    const sourceValueDeltaEffective = sourceValueDeltaRaw === null
                      ? null
                      : (isRowLowerBetter ? -sourceValueDeltaRaw : sourceValueDeltaRaw);
                    const sourceValueDeltaDirection: CompareDirection = sourceValueDeltaEffective === null
                      ? "flat"
                      : Math.abs(sourceValueDeltaEffective) < Number.EPSILON
                        ? "flat"
                        : sourceValueDeltaEffective > 0
                          ? "up"
                          : "down";
                    const sourceValueDeltaIntensity =
                      sourceValueDeltaEffective === null || sourceDeltaAbsP90 === null
                        ? 0
                        : clampCompareIntensity(Math.abs(sourceValueDeltaEffective) / sourceDeltaAbsP90);
                    const showSourceValueDeltaBadge =
                      shouldRenderSourceValues && sourceValueDeltaRaw !== null && !showCompareBadge;
                    const sourceValueDeltaBadgeStyle = showSourceValueDeltaBadge
                      ? getCompareDeltaBadgeStyle(sourceValueDeltaDirection, sourceValueDeltaIntensity, isExportCaptureMode)
                      : null;
                    const sourceValueDeltaArrow = sourceValueDeltaDirection === "up" ? "▲" : sourceValueDeltaDirection === "down" ? "▼" : "•";
                    const sourceValueDeltaText = showSourceValueDeltaBadge && sourceValueDeltaRaw !== null
                      ? formatComparisonDeltaValue(sourceValueDeltaRaw)
                      : "";
                    const activeDeltaBadgeStyle = showCompareBadge ? compareBadgeStyle : sourceValueDeltaBadgeStyle;
                    const activeDeltaDirection = showCompareBadge ? compareDirection : sourceValueDeltaDirection;
                    const activeDeltaArrow = showCompareBadge ? compareArrow : sourceValueDeltaArrow;
                    const activeDeltaText = showCompareBadge ? compareDeltaText : sourceValueDeltaText;
                    const activeDeltaTitle = showCompareBadge
                      ? `相对基准 ${compareBaselineModelName} 的差值`
                      : "相对表格默认取值的差值";
                    const showAnyDeltaBadge = showCompareBadge || showSourceValueDeltaBadge;
                    const showQuestionMarkIcon = (shouldRenderSourceValues ? noteText.length > 0 : shouldShowQuestionMark) && !showAnyDeltaBadge;

                    const basePadding = showQuestionMarkIcon
                      ? (isPairNumericDisplay ? 18 : 22)
                      : 6;
                    const comparePadding = showAnyDeltaBadge
                      ? Math.min(28, 9 + activeDeltaText.length * 3)
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
                          <span style={singleCellScoreStyle}>{sourceValueItem!.displayValue}</span>
                        ) : isPairNumericDisplay && pairFirstDisplay && pairSecondDisplay ? (
                          <span className="inline-flex items-center gap-0 leading-none">
                            <span style={isTopCellFirst ? topRankSegmentStyle : isSecondCellFirst ? secondRankSegmentStyle : undefined}>{pairFirstDisplay}</span>
                            <span className="mx-[1px] opacity-85">/</span>
                            <span style={isTopCellSecond ? topRankSegmentStyle : isSecondCellSecond ? secondRankSegmentStyle : undefined}>{pairSecondDisplay}</span>
                          </span>
                        ) : (
                          <span style={singleCellScoreStyle}>{rawText}</span>
                        )}
                        {showAnyDeltaBadge && activeDeltaBadgeStyle ? (
                          <span
                            data-compare-delta-badge={showCompareBadge ? "1" : undefined}
                            data-source-delta-badge={showSourceValueDeltaBadge ? "1" : undefined}
                            data-compare-direction={activeDeltaDirection}
                            className="absolute top-1/2 inline-flex h-[14px] -translate-y-1/2 items-center overflow-hidden rounded-[5px] border text-[9px] font-semibold leading-none"
                            style={{
                              right: "3px",
                              color: activeDeltaBadgeStyle.textColor,
                              borderColor: activeDeltaBadgeStyle.borderColor,
                              backgroundColor: activeDeltaBadgeStyle.backgroundColor,
                              boxShadow: activeDeltaBadgeStyle.boxShadow,
                              textShadow: activeDeltaBadgeStyle.textShadow,
                              WebkitTextStroke: activeDeltaBadgeStyle.textStroke
                            }}
                            title={activeDeltaTitle}
                          >
                            <span
                              className="inline-flex h-full min-w-[11px] items-center justify-center px-[2px] text-[9px] font-bold leading-none"
                              style={{
                                color: activeDeltaBadgeStyle.textColor
                              }}
                            >
                              {activeDeltaArrow}
                            </span>
                            <span
                              className="h-[8px] w-px"
                              style={{
                                backgroundColor: activeDeltaBadgeStyle.separatorColor
                              }}
                            />
                            <span
                              className="inline-flex h-full items-center px-[3px] text-[9px] font-semibold leading-none"
                              style={{
                                color: activeDeltaBadgeStyle.textColor
                              }}
                            >
                              {activeDeltaText}
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
