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
  TriangleAlert
} from "lucide-react";
import {
  useMatrixColumnResize,
  useMatrixColumnWidths,
  type ColumnResizeState
} from "./benchmark-matrix/column-width";
import { HeatmapPanel } from "./benchmark-matrix/heatmap-panel";
import { useMatrixImageActions } from "./benchmark-matrix/image-actions";
import { ModelFilterPanel } from "./benchmark-matrix/model-filter-panel";
import {
  MatrixCellTooltip,
  OverallScoreTooltip
} from "./benchmark-matrix/tooltips";
import { BenchmarkMatrixTopControls } from "./benchmark-matrix/top-controls";
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
  buildPriceMatrixRows,
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
  OVERALL_ROW_KEY,
  PRICE_CACHE_INPUT_ROW_KEY,
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY,
  MODALITY_OPTIONS,
  CATEGORY_COLUMN_WIDTH_KEY,
  BENCHMARK_COLUMN_WIDTH_KEY,
  MIN_CATEGORY_COLUMN_WIDTH,
  MAX_CATEGORY_COLUMN_WIDTH,
  MIN_BENCHMARK_COLUMN_WIDTH,
  MAX_BENCHMARK_COLUMN_WIDTH,
  MIN_MODEL_COLUMN_RESIZE_WIDTH,
  MAX_MODEL_COLUMN_WIDTH,
  HEATMAP_PRESETS,
  DEFAULT_HEATMAP_PRESET_KEY,
  DEFAULT_HEATMAP_ALPHA,
  EXPORT_PRESET_MAP,
  DEFAULT_EXPORT_PRESET,
  DEFAULT_HEATMAP_PALETTE_HEX,
  isLowerBetterBenchmark,
  getBenchmarkComparableScore,
  getSortedQuantile,
  formatValueNumForDisplay,
  formatComparisonDeltaValue,
  normalizeHexColor,
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
  canEncodeCanvasMimeType,
  buildSourceFrameShadows,
  buildCompareBaselineShadows,
  enqueueStateUpdate,
  getSourceValueDeltaRaw,
  getSourceValueDisplayItem
} from "./benchmark-matrix/index";

const PRICE_ROW_KEY_SET = new Set([
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY,
  PRICE_CACHE_INPUT_ROW_KEY
]);

export function BenchmarkMatrix({
  rows,
  allRows = rows,
  sourceOptions: allSourceOptions = [],
  modelPrices = []
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
  const showPriceRowsLoadedRef = useRef(false);
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
  const [showPriceRows, setShowPriceRows] = useState(false);
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
    setIsSourceOverflowMenuOpen,
    sourceTabsViewportRef,
    sourceTabsMeasureRef,
    skipSelectionPersistenceOnceRef,
    setRowSortState
  });

  const displaySourceValuesInCells = showSourceValues && hasSourceData && activeSource !== SOURCE_ALL;
  const displaySourceValueDeltasInCells = displaySourceValuesInCells && showSourceValueDeltas;
  const effectiveShowPriceRows = showPriceRows && modelPrices.length > 0;

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
    setShowSourceValues,
    showPriceRowsLoadedRef,
    showPriceRows,
    setShowPriceRows
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
  const { copyTableImageToClipboard, downloadTableImage } = useMatrixImageActions({
    tableViewportRef,
    exportPreset,
    isImageActionBusy,
    setIsExportMenuOpen,
    setSuppressHoverMenu,
    setIsCopyingTableImage,
    setIsDownloadingTableImage,
    setIsExportCaptureMode,
    setCopyNotice,
    setCopyNoticeVisible
  });
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

    const visibleModelOrder = [...baseModelColumns];
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

  const isPriceRowSortKey = columnSortBenchmarkKey !== null && PRICE_ROW_KEY_SET.has(columnSortBenchmarkKey);

  const baseModelColumns = useMemo<readonly string[]>(
    () => buildModelColumns(
      coveragePrunedRows,
      sourceModelHint,
      columnSortBenchmarkKey === OVERALL_ROW_KEY || isPriceRowSortKey ? null : columnSortBenchmarkKey,
      showDuplicateRows,
      modelOrderBySource,
      activeSource
    ),
    [coveragePrunedRows, sourceModelHint, columnSortBenchmarkKey, isPriceRowSortKey, showDuplicateRows, modelOrderBySource, activeSource]
  );

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

  const priceMatrixRows = useMemo(
    () => effectiveShowPriceRows ? buildPriceMatrixRows(baseModelColumns, modelPrices) : [],
    [effectiveShowPriceRows, baseModelColumns, modelPrices]
  );

  const summaryMatrixRows = useMemo(
    () => effectiveShowPriceRows ? [...priceMatrixRows, ...presenceFilteredMatrixRows] : presenceFilteredMatrixRows,
    [effectiveShowPriceRows, priceMatrixRows, presenceFilteredMatrixRows]
  );

  const displayedCoverageMetaByModel = useMemo(
    () => buildDisplayedCoverageMetaByModel(allModelNames, coveredModelsByGroupingKey, presenceFilteredMatrixRows, priceMatrixRows),
    [allModelNames, coveredModelsByGroupingKey, presenceFilteredMatrixRows, priceMatrixRows]
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

  const displayMatrixRows = useMemo(
    () => effectiveShowPriceRows ? [...priceMatrixRows, ...sortedMatrixRows] : sortedMatrixRows,
    [effectiveShowPriceRows, priceMatrixRows, sortedMatrixRows]
  );

  const headerUniqueCounts = useMemo(
    () => buildHeaderUniqueCounts(presenceFilteredMatrixRows),
    [presenceFilteredMatrixRows]
  );

  const overallSummaryByModel = useMemo(
    () => buildOverallSummaryByModel(summaryMatrixRows, baseModelColumns),
    [summaryMatrixRows, baseModelColumns]
  );

  const modelColumns = useMemo<readonly string[]>(() => {
    if (isPriceRowSortKey) {
      const priceRow = priceMatrixRows.find((row) => row.rowKey === columnSortBenchmarkKey);
      if (!priceRow) return baseModelColumns;

      const baseOrderIndex = new Map(baseModelColumns.map((modelName, index) => [modelName, index]));

      return [...baseModelColumns].sort((leftModel, rightModel) => {
        const leftValue = priceRow.cells.get(leftModel)?.valueNum;
        const rightValue = priceRow.cells.get(rightModel)?.valueNum;

        if (leftValue === null || leftValue === undefined) {
          if (rightValue === null || rightValue === undefined) {
            return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
          }

          return 1;
        }

        if (rightValue === null || rightValue === undefined) {
          return -1;
        }

        if (rightValue !== leftValue) {
          return leftValue - rightValue;
        }

        return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
      });
    }

    if (columnSortBenchmarkKey !== OVERALL_ROW_KEY) {
      return baseModelColumns;
    }

    const baseOrderIndex = new Map(baseModelColumns.map((modelName, index) => [modelName, index]));

    return [...baseModelColumns].sort((leftModel, rightModel) => {
      const leftScore = overallSummaryByModel.get(leftModel)?.rawScore;
      const rightScore = overallSummaryByModel.get(rightModel)?.rawScore;

      if (leftScore === null || leftScore === undefined) {
        if (rightScore === null || rightScore === undefined) {
          return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
        }

        return 1;
      }

      if (rightScore === null || rightScore === undefined) {
        return -1;
      }

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return (baseOrderIndex.get(leftModel) ?? 0) - (baseOrderIndex.get(rightModel) ?? 0);
    });
  }, [baseModelColumns, columnSortBenchmarkKey, isPriceRowSortKey, overallSummaryByModel, priceMatrixRows]);

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

      <BenchmarkMatrixTopControls
        sourceTabsMenuRef={sourceTabsMenuRef}
        sourceTabsViewportRef={sourceTabsViewportRef}
        sourceTabsMeasureRef={sourceTabsMeasureRef}
        sourceOptions={sourceOptions}
        visibleSourceOptions={visibleSourceOptions}
        overflowSourceOptions={overflowSourceOptions}
        sourceNewStateByKey={sourceNewStateByKey}
        activeSource={activeSource}
        isSourceOverflowMenuOpen={isSourceOverflowMenuOpen}
        setIsSourceOverflowMenuOpen={setIsSourceOverflowMenuOpen}
        setSourceAndUrl={setSourceAndUrl}
        getSourceTabDisplayText={getSourceTabDisplayText}
        getSourceTabTitle={getSourceTabTitle}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        compareModelOrderLength={compareModelOrder.length}
        compareBaselineModelName={compareBaselineModelName}
        clearCompareSelection={clearCompareSelection}
        exportMenuRef={exportMenuRef}
        setIsExportMenuHovered={setIsExportMenuHovered}
        setSuppressHoverMenu={setSuppressHoverMenu}
        showExportMenu={showExportMenu}
        isExportMenuOpen={isExportMenuOpen}
        setIsExportMenuOpen={setIsExportMenuOpen}
        isImageActionBusy={isImageActionBusy}
        downloadTableImage={downloadTableImage}
        copyTableImageToClipboard={copyTableImageToClipboard}
        isDownloadingTableImage={isDownloadingTableImage}
        isCopyingTableImage={isCopyingTableImage}
        exportPreset={exportPreset}
        setExportPreset={setExportPreset}
        availableExportPresetKeys={availableExportPresetKeys}
        showCategory={showCategory}
        setShowCategory={setShowCategory}
        showDuplicateRows={showDuplicateRows}
        setShowDuplicateRows={setShowDuplicateRows}
        showLowCoverageRows={showLowCoverageRows}
        setShowLowCoverageRows={setShowLowCoverageRows}
        showPriceRows={showPriceRows}
        setShowPriceRows={setShowPriceRows}
        hasPriceData={modelPrices.length > 0}
        hasSourceData={hasSourceData}
        displaySourceValuesInCells={displaySourceValuesInCells}
        onSourceValuesButtonClick={(event) => {
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
      />

      <ModelFilterPanel
        isFullscreen={isFullscreen}
        isModelFilterExpanded={isModelFilterExpanded}
        setIsModelFilterExpanded={setIsModelFilterExpanded}
        selectedModelCount={selectedModels.length}
        allModelCount={allModelNames.length}
        selectAllModels={selectAllModels}
        clearAllModels={clearAllModels}
        restoreDefaultModelsForActiveSource={restoreDefaultModelsForActiveSource}
        providerGroups={providerGroups}
        selectedModelSet={selectedModelSet}
        providerAverageCoveragePercentMap={providerAverageCoveragePercentMap}
        baseModelNameSet={baseModelNameSet}
        modelCoveragePercentMap={modelCoveragePercentMap}
        providerDisplayNameBrandColorMap={allRowsIndex.providerDisplayNameBrandColorMap}
        expandedLowCoverageProviders={expandedLowCoverageProviders}
        setExpandedLowCoverageProviders={setExpandedLowCoverageProviders}
        toggleProvider={toggleProvider}
        toggleModel={toggleModel}
      />

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
            {displayMatrixRows.map((matrixRow, rowIndex) => {
              const rowKey = matrixRow.rowKey;
              const isLastMatrixRow = rowIndex === displayMatrixRows.length - 1;
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

                  return matrixRow.isPriceRow
                    ? -valueNum
                    : getBenchmarkComparableScore(
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

                  return matrixRow.isPriceRow
                    ? -valueNum2
                    : getBenchmarkComparableScore(
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
                  data-metric-type={matrixRow.isPriceRow ? "price" : undefined}
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
                      ? matrixRow.isPriceRow
                        ? -cellNum
                        : getBenchmarkComparableScore(matrixRow.benchmark, cellNum, matrixRow.category, matrixRow.higherIsBetter)
                      : null;
                    const comparableCellNum2 = cellNum2 !== null
                      ? matrixRow.isPriceRow
                        ? -cellNum2
                        : getBenchmarkComparableScore(matrixRow.benchmark, cellNum2, matrixRow.category, matrixRow.higherIsBetter)
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
                        data-model-name={model.modelName}
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
              <tr
                data-overall-row="1"
                className={selectedRowKey === OVERALL_ROW_KEY ? "matrix-row-selected" : "matrix-row-hover"}
                onClick={() => {
                  setSelectedRowKey((prev) => (prev === OVERALL_ROW_KEY ? null : OVERALL_ROW_KEY));
                  setColumnSortBenchmarkKey((prev) => (prev === OVERALL_ROW_KEY ? null : OVERALL_ROW_KEY));
                }}
                style={{ cursor: "pointer" }}
              >
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
                          onClick={(event) => event.stopPropagation()}
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

      <HeatmapPanel
        heatmapPalette={heatmapPalette}
        heatmapAlpha={heatmapAlpha}
        heatmapPresetSelection={heatmapPresetSelection}
        heatmapGradientPreview={heatmapGradientPreview}
        setHeatmapAlpha={setHeatmapAlpha}
        setHeatmapPresetSelection={setHeatmapPresetSelection}
        updateHeatmapPaletteColor={updateHeatmapPaletteColor}
        applyHeatmapPreset={applyHeatmapPreset}
        resetHeatmapPaletteToDefault={resetHeatmapPaletteToDefault}
      />

      <MatrixCellTooltip tooltip={activeCellTooltip} />

      <OverallScoreTooltip tooltip={activeOverallTooltip} />

      {displayMatrixRows.length === 0 ? (
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
