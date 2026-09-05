"use client";

/* eslint-disable react-hooks/preserve-manual-memoization -- This large matrix keeps hand-tuned memoization to preserve table behavior. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Check,
  TriangleAlert
} from "lucide-react";
import { BenchmarkRankingPanel } from "./benchmark-matrix/benchmark-ranking-panel";
import { CellTrendPanel } from "./benchmark-matrix/cell-trend-panel";
import {
  buildCellTrendData,
  getCellTrendPopoverPosition,
  isCellTrendEligible,
  type CellTrendPopoverPosition
} from "./benchmark-matrix/cell-trend";
import {
  useMatrixColumnResize,
  useMatrixColumnWidths,
  type ColumnResizeState
} from "./benchmark-matrix/column-width";
import { HeatmapPanel } from "./benchmark-matrix/heatmap-panel";
import { useMatrixImageActions } from "./benchmark-matrix/image-actions";
import { ModelFilterPanel } from "./benchmark-matrix/model-filter-panel";
import {
  MatrixCellTooltipHost,
  OverallScoreTooltipHost,
  type CellTooltip,
  type CellTooltipHandle,
  type OverallTooltip,
  type OverallTooltipHandle
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
  buildBenchmarkRankingData,
  buildMatrixRows,
  buildModelColumns,
  buildModelCoveragePercentMap,
  buildOverallHeatRange,
  buildOverallScoreDisplayDecimalsByModel,
  buildOverallSummaryByModel,
  buildParamsMatrixRows,
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
import { useSharedMatrixDerived } from "./dashboard-provider";
import { useMatrixSourceTabs } from "./benchmark-matrix/source-tabs";
import {
  type MatrixInputRow,
  type RowSortColumn,
  type RowSortMode,
  type Props,
  hasPublicModelPriceCost,
  type HeatmapPresetKey,
  type HeatmapPresetSelection,
  type HeatmapPaletteHex,
  type HeatmapPaletteRgb,
  type CompareDirection,
  type ExportPresetKey,
  type BenchmarkRankingScaleMode,
  type BenchmarkRankingScope,
  SOURCE_ALL,
  EMPTY_SOURCE_OPTIONS,
  EMPTY_MODEL_PRICES,
  EMPTY_MODEL_PARAMS,
  OVERALL_ROW_KEY,
  PARAMS_ACTIVE_RATIO_ROW_KEY,
  PARAMS_ROW_KEY,
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
  getMatrixRowComparableScore,
  getSortedQuantile,
  formatComparisonDeltaValue,
  getMatrixCellPairDisplayParts,
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
  getSourceValueDisplayItem,
  getSourceKey,
  buildMatrixMarkdownTable,
  type SourceValueMode
} from "./benchmark-matrix/index";

const PRICE_ROW_KEY_SET = new Set([
  PRICE_INPUT_ROW_KEY,
  PRICE_OUTPUT_ROW_KEY,
  PRICE_CACHE_INPUT_ROW_KEY
]);

const PARAMS_ROW_KEY_SET = new Set([
  PARAMS_ROW_KEY,
  PARAMS_ACTIVE_RATIO_ROW_KEY
]);

const RANKING_POPOVER_GAP = 8;
const RANKING_POPOVER_MARGIN = 16;
const RANKING_POPOVER_MAX_WIDTH = 860;
const CELL_TOOLTIP_HIDE_DELAY_MS = 140;
const BOX_PLOT_TOOLTIP_LEFT_OFFSET = 88;
const FRONTEND_TABLE_PAIR_VALUE_REGEX =
  /^\s*((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[^\s/]*)\s*\/\s*((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?.*)\s*$/;
const PAIR_VALUE_SLASH_CLASS_NAME = "mx-[2px] opacity-85";

/** 单行渲染所需的名次阈值与色阶基准，由 rowRenderMetricsByKey 预先算好 */
type RowRenderMetrics = {
  isRowLowerBetter: boolean;
  primaryComparableTop: number | null;
  primaryComparableSecond: number | null;
  secondaryComparableTop: number | null;
  secondaryComparableSecond: number | null;
  sourceDeltaAbsP90: number | null;
  compareAbsEffectiveDeltaP90: number | null;
};

const EMPTY_ROW_RENDER_METRICS: RowRenderMetrics = {
  isRowLowerBetter: false,
  primaryComparableTop: null,
  primaryComparableSecond: null,
  secondaryComparableTop: null,
  secondaryComparableSecond: null,
  sourceDeltaAbsP90: null,
  compareAbsEffectiveDeltaP90: null
};

const EMPTY_MATRIX_ROWS: MatrixInputRow[] = [];

/**
 * 单元格里的「A / B」两段值。
 *
 * 与 valueNum + valueNum2 的 pair 单元格渲染保持一致：去掉原始空格避免占宽，
 * 再由斜杠自己带 2px 外边距，这样 `13B / 284B` 两段仍然分得开。
 * 名次样式只落在两侧的数值上，斜杠保持中性 —— 否则加粗会把分隔符也吃进去，
 * 第二名的下划线还会连成一条横穿整格的线。
 */
function renderFrontendTableCellText(value: string, segmentStyle?: CSSProperties): ReactNode {
  const pairMatch = value.match(FRONTEND_TABLE_PAIR_VALUE_REGEX);
  if (!pairMatch) return <span style={segmentStyle}>{value}</span>;

  const [, first, second] = pairMatch;
  return (
    <span className="inline-flex items-center gap-0 leading-none">
      <span style={segmentStyle}>{first.trim()}</span>
      <span className={PAIR_VALUE_SLASH_CLASS_NAME}>/</span>
      <span style={segmentStyle}>{second.trim()}</span>
    </span>
  );
}

export function BenchmarkMatrix({
  rows: rowsProp,
  allRows: allRowsProp = rowsProp,
  sourceOptions: allSourceOptions = EMPTY_SOURCE_OPTIONS,
  modelPrices = EMPTY_MODEL_PRICES,
  modelParams = EMPTY_MODEL_PARAMS,
  exportFootnoteText,
  exportFootnoteAlign,
  urlSyncEnabled = true
}: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsViewportRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsMeasureRef = useRef<HTMLDivElement | null>(null);
  const sourceTabsMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const rankingPopoverRef = useRef<HTMLDivElement | null>(null);
  const trendPopoverRef = useRef<HTMLDivElement | null>(null);
  const cellTooltipHideTimerRef = useRef<number | null>(null);
  const showCategoryLoadedRef = useRef(false);
  const showDuplicateLoadedRef = useRef(false);
  const showSourceValuesLoadedRef = useRef(false);
  const showPriceRowsLoadedRef = useRef(false);
  const showParamsRowsLoadedRef = useRef(false);
  const priceRowsInOverallLoadedRef = useRef(false);
  const paramsRowsInOverallLoadedRef = useRef(false);
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
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCategory, setShowCategory] = useState(true);
  const [showDuplicateRows, setShowDuplicateRows] = useState(false);
  const [showSourceValues, setShowSourceValues] = useState(false);
  const [showSourceValueMax, setShowSourceValueMax] = useState(false);
  const [showSourceValueDeltas, setShowSourceValueDeltas] = useState(false);
  const [showPriceRows, setShowPriceRows] = useState(false);
  const [showParamsRows, setShowParamsRows] = useState(false);
  // 价格与参数量默认都只作参考：便宜或参数小并不直接等于模型更好，需要 Ctrl 点击开关显式纳入
  const [priceRowsInOverall, setPriceRowsInOverall] = useState(false);
  const [paramsRowsInOverall, setParamsRowsInOverall] = useState(false);
  const [showLowCoverageRows, setShowLowCoverageRows] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  // 首帧只出 loading：空数组让后续 useMemo 走空路径，ready 后再用真实数据算一次。
  const rows = isClientReady ? rowsProp : EMPTY_MATRIX_ROWS;
  const allRows = isClientReady ? allRowsProp : EMPTY_MATRIX_ROWS;
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
  const exportIncludeFootnoteLoadedRef = useRef(false);
  const [exportIncludeFootnote, setExportIncludeFootnote] = useState(true);
  const [supportsWebpExport, setSupportsWebpExport] = useState(true);
  const [supportsAvifExport, setSupportsAvifExport] = useState(false);
  const [isModelFilterExpanded, setIsModelFilterExpanded] = useState(false);
  const [expandedLowCoverageProviders, setExpandedLowCoverageProviders] = useState<Record<string, boolean>>({});
  const [benchmarkSearchInputValue, setBenchmarkSearchInputValue] = useState("");
  const [benchmarkSearchQuery, setBenchmarkSearchQuery] = useState("");
  const showLowCoverageRowsRef = useRef(showLowCoverageRows);
  const preSearchShowLowCoverageRowsRef = useRef<boolean | null>(null);
  const handleSetShowLowCoverageRows = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowLowCoverageRows((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      showLowCoverageRowsRef.current = next;
      if (benchmarkSearchInputValue.trim().length > 0) {
        preSearchShowLowCoverageRowsRef.current = next;
      }
      return next;
    });
  }, [benchmarkSearchInputValue]);
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
  const [expandedRankingRowKey, setExpandedRankingRowKey] = useState<string | null>(null);
  const [rankingScope, setRankingScope] = useState<BenchmarkRankingScope>("source");
  const [rankingScaleMode, setRankingScaleMode] = useState<BenchmarkRankingScaleMode>("relative");
  const [rankingShowBoxPlot, setRankingShowBoxPlot] = useState<boolean>(false);
  const [rankingPopoverPosition, setRankingPopoverPosition] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "above" | "below";
  } | null>(null);
  const [expandedTrendCellKey, setExpandedTrendCellKey] = useState<{
    rowKey: string;
    modelName: string;
  } | null>(null);
  const [trendPopoverPosition, setTrendPopoverPosition] = useState<CellTrendPopoverPosition | null>(null);
  const [temporarilyHiddenRowKeys, setTemporarilyHiddenRowKeys] = useState<string[]>([]);
  const [rowPresenceFilterModel, setRowPresenceFilterModel] = useState<string | null>(null);
  const [compareModelOrder, setCompareModelOrder] = useState<string[]>([]);
  const [isDownloadingTableImage, setIsDownloadingTableImage] = useState(false);
  const [isCopyingTableImage, setIsCopyingTableImage] = useState(false);
  const [isExportCaptureMode, setIsExportCaptureMode] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copyNoticeVisible, setCopyNoticeVisible] = useState(false);
  const [copyNoticeDismissing, setCopyNoticeDismissing] = useState(false);
  const copyNoticeHideTimerRef = useRef<number | null>(null);
  const copyNoticeClearTimerRef = useRef<number | null>(null);

  const clearCopyNoticeTimers = useCallback(() => {
    if (copyNoticeHideTimerRef.current !== null) {
      window.clearTimeout(copyNoticeHideTimerRef.current);
      copyNoticeHideTimerRef.current = null;
    }
    if (copyNoticeClearTimerRef.current !== null) {
      window.clearTimeout(copyNoticeClearTimerRef.current);
      copyNoticeClearTimerRef.current = null;
    }
  }, []);

  const dismissCopyNotice = useCallback(() => {
    clearCopyNoticeTimers();
    setCopyNoticeVisible(false);
    setCopyNoticeDismissing(true);
    copyNoticeClearTimerRef.current = window.setTimeout(() => {
      setCopyNotice(null);
      setCopyNoticeDismissing(false);
      copyNoticeClearTimerRef.current = null;
    }, 300);
  }, [clearCopyNoticeTimers]);

  const scheduleCopyNoticeDismiss = useCallback(() => {
    clearCopyNoticeTimers();
    copyNoticeHideTimerRef.current = window.setTimeout(() => {
      setCopyNoticeVisible(false);
      setCopyNoticeDismissing(true);
      copyNoticeClearTimerRef.current = window.setTimeout(() => {
        setCopyNotice(null);
        setCopyNoticeDismissing(false);
        copyNoticeClearTimerRef.current = null;
      }, 300);
    }, 15000);
  }, [clearCopyNoticeTimers]);

  const pauseCopyNotice = useCallback(() => {
    if (copyNoticeDismissing) return;
    clearCopyNoticeTimers();
    setCopyNoticeVisible(true);
    setCopyNoticeDismissing(false);
  }, [clearCopyNoticeTimers, copyNoticeDismissing]);

  const resumeCopyNotice = useCallback(() => {
    if (!copyNotice || copyNoticeDismissing) return;
    scheduleCopyNoticeDismiss();
  }, [copyNotice, copyNoticeDismissing, scheduleCopyNoticeDismiss]);
  const [sourceNewReferenceTime, setSourceNewReferenceTime] = useState<number | null>(null);
  const cellTooltipHandleRef = useRef<CellTooltipHandle | null>(null);
  const overallTooltipHandleRef = useRef<OverallTooltipHandle | null>(null);
  const cellTooltipScrollableRef = useRef(false);

  const cancelCellTooltipHide = useCallback(() => {
    if (cellTooltipHideTimerRef.current === null) return;
    window.clearTimeout(cellTooltipHideTimerRef.current);
    cellTooltipHideTimerRef.current = null;
  }, []);

  const handleCellTooltipScrollableChange = useCallback((scrollable: boolean) => {
    cellTooltipScrollableRef.current = scrollable;
  }, []);

  const showCellTooltip = useCallback((tooltip: CellTooltip) => {
    cancelCellTooltipHide();
    cellTooltipScrollableRef.current = false;
    cellTooltipHandleRef.current?.show(tooltip);
  }, [cancelCellTooltipHide]);

  const hideCellTooltip = useCallback((immediate = false) => {
    cancelCellTooltipHide();
    if (immediate || !cellTooltipScrollableRef.current) {
      cellTooltipScrollableRef.current = false;
      cellTooltipHandleRef.current?.hide();
      return;
    }

    cellTooltipHideTimerRef.current = window.setTimeout(() => {
      cellTooltipHideTimerRef.current = null;
      cellTooltipScrollableRef.current = false;
      cellTooltipHandleRef.current?.hide();
    }, CELL_TOOLTIP_HIDE_DELAY_MS);
  }, [cancelCellTooltipHide]);

  const showOverallTooltip = useCallback((tooltip: OverallTooltip) => {
    overallTooltipHandleRef.current?.show(tooltip);
  }, []);

  const hideOverallTooltip = useCallback(() => {
    overallTooltipHandleRef.current?.hide();
  }, []);

  const handleCellTooltipHoverChange = useCallback((hovered: boolean) => {
    if (hovered) {
      cancelCellTooltipHide();
      return;
    }
    hideCellTooltip();
  }, [cancelCellTooltipHide, hideCellTooltip]);

  useEffect(() => {
    return () => {
      if (cellTooltipHideTimerRef.current === null) return;
      window.clearTimeout(cellTooltipHideTimerRef.current);
    };
  }, []);

  const {
    sourceOptions,
    activeSource,
    activeSourceRef,
    hasSourceData,
    visibleSourceOptions,
    overflowSourceOptions,
    overflowSourceMenuOptions,
    promotedOverflowSourceKey,
    sourceNewStateByKey,
    getSourceTabDisplayText,
    getSourceTabTextColor,
    getSourceTabTitle,
    setSourceAndUrl
  } = useMatrixSourceTabs({
    rows,
    allRows,
    allSourceOptions,
    isClientReady,
    urlSyncEnabled,
    pathname,
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
  const sourceValueMode: SourceValueMode = showSourceValueMax ? "max" : "latest";
  const displaySourceValueDeltasInCells = displaySourceValuesInCells && showSourceValueDeltas;
  const hasPriceData = modelPrices.some(hasPublicModelPriceCost);
  const effectiveShowPriceRows = showPriceRows && hasPriceData;
  const hasParamsData = modelParams.length > 0;
  const effectiveShowParamsRows = showParamsRows && hasParamsData;

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
    setShowPriceRows,
    showParamsRowsLoadedRef,
    showParamsRows,
    setShowParamsRows,
    priceRowsInOverallLoadedRef,
    priceRowsInOverall,
    setPriceRowsInOverall,
    paramsRowsInOverallLoadedRef,
    paramsRowsInOverall,
    setParamsRowsInOverall
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
    setExportPreset,
    exportIncludeFootnoteLoadedRef,
    exportIncludeFootnote,
    setExportIncludeFootnote
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

    enqueueStateUpdate(() => {
      setCopyNoticeVisible(true);
      setCopyNoticeDismissing(false);
    });

    scheduleCopyNoticeDismiss();

    return () => {
      clearCopyNoticeTimers();
    };
  }, [copyNotice, clearCopyNoticeTimers, scheduleCopyNoticeDismiss]);

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
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const openedFilters = document.querySelectorAll<HTMLDetailsElement>(
        'details[data-modality-filter="true"][open]'
      );

      openedFilters.forEach((filter) => {
        if (!filter.contains(target)) {
          filter.removeAttribute("open");
        }
      });
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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

  const sharedDerived = useSharedMatrixDerived(rows, allRows);

  const scopedRowsBySource = useMemo(
    () => sharedDerived?.rowsBySource ?? buildRowsBySource(rows),
    [rows, sharedDerived]
  );

  // allRows 默认就是 rows（见 Props 默认值），此时没有理由把同一个数组再分桶一遍
  const allRowsBySource = useMemo(
    () => (allRows === rows ? scopedRowsBySource : buildRowsBySource(allRows)),
    [allRows, rows, scopedRowsBySource]
  );

  // source 元信息投影（benchmarkType / modalities 换成 source 自报的值）在两处要用：
  // 非 All 视图的主链路，以及排名面板的「全部模型」范围。All 视图首屏两处都不碰，
  // 所以包成一个惰性 getter：真正被问到时才投影，之后在同一份 allRows 上复用结果。
  // 这样首屏不白算两万行，切 tab、调排名面板参数也不会反复重投影。
  const getAllRowsWithSourceMeta = useMemo(() => {
    if (sharedDerived) return sharedDerived.getAllRowsWithSourceMeta;

    let projected: MatrixInputRow[] | null = null;

    return () => {
      projected ??= buildRowsWithSourceMeta(allRows);
      return projected;
    };
  }, [allRows, sharedDerived]);

  const indexedSourceRows = useMemo(
    () => (activeSource === SOURCE_ALL ? allRows : getAllRowsWithSourceMeta()),
    [allRows, activeSource, getAllRowsWithSourceMeta]
  );

  const allRowsIndex = useMemo(
    () => {
      if (
        sharedDerived
        && activeSource === SOURCE_ALL
        && !showDuplicateRows
        && indexedSourceRows === allRows
      ) {
        return sharedDerived.mergedAllRowsIndex;
      }

      return buildAllRowsIndex(indexedSourceRows, showDuplicateRows);
    },
    [allRows, indexedSourceRows, sharedDerived, showDuplicateRows, activeSource]
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
    showLowCoverageRowsRef.current = showLowCoverageRows;
  }, [showLowCoverageRows]);

  useEffect(() => {
    if (benchmarkSearchInputValue.trim().length === 0) {
      if (preSearchShowLowCoverageRowsRef.current !== null) {
        const restoredShowLowCoverageRows = preSearchShowLowCoverageRowsRef.current;
        showLowCoverageRowsRef.current = restoredShowLowCoverageRows;
        setShowLowCoverageRows(restoredShowLowCoverageRows);
        preSearchShowLowCoverageRowsRef.current = null;
      }
      setBenchmarkSearchQuery("");
      return;
    }

    if (preSearchShowLowCoverageRowsRef.current === null) {
      preSearchShowLowCoverageRowsRef.current = showLowCoverageRowsRef.current;
    }

    const timer = setTimeout(() => {
      if (benchmarkSearchInputValue.includes("'")) {
        return;
      }
      setBenchmarkSearchQuery(benchmarkSearchInputValue);
      showLowCoverageRowsRef.current = true;
      setShowLowCoverageRows(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [benchmarkSearchInputValue]);

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
    () => buildFilteredRows(allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet, benchmarkSearchQuery),
    [allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet, benchmarkSearchQuery]
  );

  const coveragePrunedRows = useMemo(
    () => buildCoveragePrunedRows(activeSource, filteredRows, showDuplicateRows, showLowCoverageRows),
    [activeSource, filteredRows, showDuplicateRows, showLowCoverageRows]
  );

  const isSyntheticRowSortKey = columnSortBenchmarkKey !== null
    && (PRICE_ROW_KEY_SET.has(columnSortBenchmarkKey) || PARAMS_ROW_KEY_SET.has(columnSortBenchmarkKey));

  const baseModelColumns = useMemo<readonly string[]>(
    () => buildModelColumns(
      coveragePrunedRows,
      sourceModelHint,
      columnSortBenchmarkKey === OVERALL_ROW_KEY || isSyntheticRowSortKey ? null : columnSortBenchmarkKey,
      showDuplicateRows,
      modelOrderBySource,
      activeSource
    ),
    [coveragePrunedRows, sourceModelHint, columnSortBenchmarkKey, isSyntheticRowSortKey, showDuplicateRows, modelOrderBySource, activeSource]
  );

  const matrixRows = useMemo(
    () => buildMatrixRows(baseSourceRows, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells, activeSource, sourceValueMode),
    [baseSourceRows, coveragePrunedRows, showDuplicateRows, displaySourceValuesInCells, activeSource, sourceValueMode]
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

  const temporarilyHiddenRowKeySet = useMemo(
    () => new Set(temporarilyHiddenRowKeys),
    [temporarilyHiddenRowKeys]
  );

  const visiblePresenceFilteredMatrixRows = useMemo(
    () => temporarilyHiddenRowKeySet.size === 0
      ? presenceFilteredMatrixRows
      : presenceFilteredMatrixRows.filter((row) => !temporarilyHiddenRowKeySet.has(row.rowKey)),
    [presenceFilteredMatrixRows, temporarilyHiddenRowKeySet]
  );

  const priceMatrixRows = useMemo(
    () => effectiveShowPriceRows ? buildPriceMatrixRows(baseModelColumns, modelPrices) : [],
    [effectiveShowPriceRows, baseModelColumns, modelPrices]
  );

  const visiblePriceMatrixRows = useMemo(
    () => temporarilyHiddenRowKeySet.size === 0
      ? priceMatrixRows
      : priceMatrixRows.filter((row) => !temporarilyHiddenRowKeySet.has(row.rowKey)),
    [priceMatrixRows, temporarilyHiddenRowKeySet]
  );

  const paramsMatrixRows = useMemo(
    () => effectiveShowParamsRows ? buildParamsMatrixRows(baseModelColumns, modelParams) : [],
    [effectiveShowParamsRows, baseModelColumns, modelParams]
  );

  const visibleParamsMatrixRows = useMemo(
    () => temporarilyHiddenRowKeySet.size === 0
      ? paramsMatrixRows
      : paramsMatrixRows.filter((row) => !temporarilyHiddenRowKeySet.has(row.rowKey)),
    [paramsMatrixRows, temporarilyHiddenRowKeySet]
  );

  const benchmarkRankingModelNames = useMemo(
    () => Array.from(baseModelNameSet),
    [baseModelNameSet]
  );

  const allRankingModelNames = useMemo(() => {
    // 排名弹窗未展开、或范围不是「全部模型」时，不必扫两万行 allRows / 全量价格名。
    if (!expandedRankingRowKey || rankingScope !== "all") {
      return benchmarkRankingModelNames;
    }

    // 这里只取 modelName，而 applySourceMeta 只改写 benchmarkType / modalities，
    // 所以读 allRows 与读它的 source 投影结果完全等价，省掉一次两万行的对象展开
    const ordered = Array.from(new Set(allRows.map((row) => row.modelName)));
    const seen = new Set(ordered);

    modelPrices.forEach((price) => {
      if (!hasPublicModelPriceCost(price) || seen.has(price.modelName)) return;
      seen.add(price.modelName);
      ordered.push(price.modelName);
    });

    modelParams.forEach((params) => {
      if (!seen.has(params.modelName)) {
        seen.add(params.modelName);
        ordered.push(params.modelName);
      }
    });

    return ordered;
  }, [allRows, benchmarkRankingModelNames, expandedRankingRowKey, modelParams, modelPrices, rankingScope]);

  // 只有「显示 + 计入总评」同时成立的合成行才进入 Overall 打分
  const includePriceRowsInOverall = effectiveShowPriceRows && priceRowsInOverall;
  const includeParamsRowsInOverall = effectiveShowParamsRows && paramsRowsInOverall;

  const summaryMatrixRows = useMemo(
    () => [
      ...(includeParamsRowsInOverall ? visibleParamsMatrixRows : []),
      ...(includePriceRowsInOverall ? visiblePriceMatrixRows : []),
      ...visiblePresenceFilteredMatrixRows
    ],
    [includeParamsRowsInOverall, visibleParamsMatrixRows, includePriceRowsInOverall, visiblePriceMatrixRows, visiblePresenceFilteredMatrixRows]
  );

  const displayedCoverageMetaByModel = useMemo(
    () => buildDisplayedCoverageMetaByModel(
      allModelNames,
      coveredModelsByGroupingKey,
      visiblePresenceFilteredMatrixRows,
      [...visibleParamsMatrixRows, ...visiblePriceMatrixRows]
    ),
    [allModelNames, coveredModelsByGroupingKey, visiblePresenceFilteredMatrixRows, visibleParamsMatrixRows, visiblePriceMatrixRows]
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
    () => sortMatrixRows(visiblePresenceFilteredMatrixRows, rowSortState, activeSource),
    [visiblePresenceFilteredMatrixRows, rowSortState, activeSource]
  );

  const displayMatrixRows = useMemo(
    () => [
      ...(effectiveShowParamsRows ? visibleParamsMatrixRows : []),
      ...(effectiveShowPriceRows ? visiblePriceMatrixRows : []),
      ...sortedMatrixRows
    ],
    [effectiveShowParamsRows, visibleParamsMatrixRows, effectiveShowPriceRows, visiblePriceMatrixRows, sortedMatrixRows]
  );

  const displayMatrixRowKeySet = useMemo(
    () => new Set(displayMatrixRows.map((row) => row.rowKey)),
    [displayMatrixRows]
  );

  useEffect(() => {
    if (!expandedRankingRowKey) return;
    if (displayMatrixRowKeySet.has(expandedRankingRowKey)) return;
    enqueueStateUpdate(() => {
      setExpandedRankingRowKey(null);
      setRankingPopoverPosition(null);
    });
  }, [displayMatrixRowKeySet, expandedRankingRowKey]);

  const headerUniqueCounts = useMemo(
    () => buildHeaderUniqueCounts(visiblePresenceFilteredMatrixRows),
    [visiblePresenceFilteredMatrixRows]
  );

  const overallSummaryByModel = useMemo(
    () => buildOverallSummaryByModel(summaryMatrixRows, baseModelColumns),
    [summaryMatrixRows, baseModelColumns]
  );

  const modelColumns = useMemo<readonly string[]>(() => {
    if (isSyntheticRowSortKey) {
      // 价格与参数量都以小为好，按升序排；缺值的模型沉到末尾
      const syntheticRow = [...priceMatrixRows, ...paramsMatrixRows]
        .find((row) => row.rowKey === columnSortBenchmarkKey);
      if (!syntheticRow) return baseModelColumns;

      const baseOrderIndex = new Map(baseModelColumns.map((modelName, index) => [modelName, index]));

      return [...baseModelColumns].sort((leftModel, rightModel) => {
        const leftValue = syntheticRow.cells.get(leftModel)?.valueNum;
        const rightValue = syntheticRow.cells.get(rightModel)?.valueNum;

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
  }, [baseModelColumns, columnSortBenchmarkKey, isSyntheticRowSortKey, overallSummaryByModel, priceMatrixRows, paramsMatrixRows]);

  const activeRankingData = useMemo(() => {
    if (!expandedRankingRowKey) return null;

    const matrixRow = displayMatrixRows.find((row) => row.rowKey === expandedRankingRowKey);
    if (!matrixRow) return null;

    const candidateModelNames = rankingScope === "all"
      ? allRankingModelNames
      : benchmarkRankingModelNames;
    const sourceRowsForRanking = rankingScope === "all"
      ? getAllRowsWithSourceMeta()
      : baseSourceRows;
    const rankingMatrixRow = matrixRow.isPriceRow
      ? buildPriceMatrixRows(candidateModelNames, modelPrices).find((row) => row.rowKey === matrixRow.rowKey) ?? matrixRow
      : matrixRow.isInfoRow
        ? buildParamsMatrixRows(candidateModelNames, modelParams).find((row) => row.rowKey === matrixRow.rowKey) ?? matrixRow
        : matrixRow;

    return buildBenchmarkRankingData(
      rankingMatrixRow,
      sourceRowsForRanking,
      candidateModelNames,
      modelColumns,
      showDuplicateRows,
      rankingScaleMode
    );
  }, [
    allRankingModelNames,
    getAllRowsWithSourceMeta,
    baseSourceRows,
    benchmarkRankingModelNames,
    displayMatrixRows,
    expandedRankingRowKey,
    modelColumns,
    modelPrices,
    modelParams,
    rankingScaleMode,
    rankingScope,
    showDuplicateRows
  ]);

  useLayoutEffect(() => {
    if (!activeRankingData || !rankingPopoverPosition || !rankingPopoverRef.current) return;

    const rect = rankingPopoverRef.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    let nextTop = rankingPopoverPosition.top;

    if (rect.top < RANKING_POPOVER_MARGIN) {
      nextTop += RANKING_POPOVER_MARGIN - rect.top;
    } else if (rect.bottom > window.innerHeight - RANKING_POPOVER_MARGIN) {
      nextTop -= rect.bottom - (window.innerHeight - RANKING_POPOVER_MARGIN);
    }

    if (Math.abs(nextTop - rankingPopoverPosition.top) < 1) return;

    setRankingPopoverPosition((prev) => prev ? { ...prev, top: nextTop } : prev);
  }, [activeRankingData, rankingPopoverPosition]);

  const activeTrendData = useMemo(() => {
    if (!expandedTrendCellKey) return null;
    if (!modelColumns.includes(expandedTrendCellKey.modelName)) return null;
    const row = displayMatrixRows.find((r) => r.rowKey === expandedTrendCellKey.rowKey);
    if (!row) return null;
    const cell = row.cells.get(expandedTrendCellKey.modelName);
    if (!cell) return null;
    return buildCellTrendData(row, expandedTrendCellKey.modelName, cell, activeSource);
  }, [activeSource, displayMatrixRows, expandedTrendCellKey, modelColumns]);

  useEffect(() => {
    if (!expandedTrendCellKey) return;
    if (activeTrendData) return;
    enqueueStateUpdate(() => {
      setExpandedTrendCellKey(null);
      setTrendPopoverPosition(null);
    });
  }, [activeTrendData, expandedTrendCellKey]);

  useEffect(() => {
    if (!expandedTrendCellKey) return;
    if (modelColumns.includes(expandedTrendCellKey.modelName)) return;
    enqueueStateUpdate(() => {
      setExpandedTrendCellKey(null);
      setTrendPopoverPosition(null);
    });
  }, [expandedTrendCellKey, modelColumns]);

  const previousTrendActiveSourceRef = useRef(activeSource);
  useEffect(() => {
    if (previousTrendActiveSourceRef.current !== activeSource) {
      previousTrendActiveSourceRef.current = activeSource;
      if (expandedTrendCellKey) {
        enqueueStateUpdate(() => {
          setExpandedTrendCellKey(null);
          setTrendPopoverPosition(null);
        });
      }
    }
  }, [activeSource, expandedTrendCellKey]);

  useLayoutEffect(() => {
    if (!activeTrendData || !trendPopoverPosition || !trendPopoverRef.current) return;

    const rect = trendPopoverRef.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    let nextTop = trendPopoverPosition.top;

    if (rect.top < RANKING_POPOVER_MARGIN) {
      nextTop += RANKING_POPOVER_MARGIN - rect.top;
    } else if (rect.bottom > window.innerHeight - RANKING_POPOVER_MARGIN) {
      nextTop -= rect.bottom - (window.innerHeight - RANKING_POPOVER_MARGIN);
    }

    if (Math.abs(nextTop - trendPopoverPosition.top) < 1) return;

    setTrendPopoverPosition((prev) => (prev ? { ...prev, top: nextTop } : prev));
  }, [activeTrendData, trendPopoverPosition]);

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
    sourceValueMode,
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
  const shouldShowOverallSummary = hasOverallSummary && !temporarilyHiddenRowKeySet.has(OVERALL_ROW_KEY);

  const overallHeatRange = useMemo(
    () => buildOverallHeatRange(modelColumns, overallSummaryByModel),
    [modelColumns, overallSummaryByModel]
  );

  const overallScoreDisplayDecimalsByModel = useMemo(
    () => buildOverallScoreDisplayDecimalsByModel(modelColumns, overallSummaryByModel),
    [modelColumns, overallSummaryByModel]
  );

  const copyTableMarkdownToClipboard = useCallback(async () => {
    setIsExportMenuOpen(false);
    setSuppressHoverMenu(true);
    setCopyNotice(null);
    setCopyNoticeVisible(false);

    try {
      const markdown = buildMatrixMarkdownTable({
        rows: displayMatrixRows,
        modelColumns,
        showCategory,
        displaySourceValuesInCells,
        activeSource,
        sourceValueMode,
        shouldShowOverallSummary,
        overallSummaryByModel,
        overallScoreDisplayDecimalsByModel
      });

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
      } else if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([markdown], { type: "text/plain" })
          })
        ]);
      } else {
        throw new Error("当前浏览器不支持文本剪贴板");
      }

      setCopyNotice({ type: "success", message: "已复制 Markdown 表格到剪贴板" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      setCopyNotice({
        type: "error",
        message: rawMessage || "复制失败，请检查浏览器剪贴板权限"
      });
    }
  }, [
    activeSource,
    displayMatrixRows,
    displaySourceValuesInCells,
    modelColumns,
    overallScoreDisplayDecimalsByModel,
    overallSummaryByModel,
    setCopyNotice,
    setCopyNoticeVisible,
    setIsExportMenuOpen,
    setSuppressHoverMenu,
    shouldShowOverallSummary,
    showCategory,
    sourceValueMode
  ]);

  // 每行的名次阈值与 P90 基准原先在 render 体内逐行现算，
  // 于是选中行、展开排名、拖拽列宽这些与数值无关的交互也要把整表重算一遍。
  // 依赖只取 modelColumns（列名序列）而非 modelColumnMeta，列宽变化便不再触发重算。
  const rowRenderMetricsByKey = useMemo(() => {
    const metricsByKey = new Map<string, RowRenderMetrics>();

    displayMatrixRows.forEach((matrixRow) => {
      const isRowLowerBetter = isLowerBetterBenchmark(
        matrixRow.benchmark,
        matrixRow.category,
        matrixRow.higherIsBetter
      );

      const primaryComparableValues: number[] = [];
      const secondaryComparableValues: number[] = [];
      const sourceDeltaAbsValues: number[] = [];
      const compareAbsEffectiveDeltaValues: number[] = [];

      const baselineValueNum = compareBaselineModelName
        ? matrixRow.cells.get(compareBaselineModelName)?.valueNum ?? null
        : null;
      const shouldCollectCompareDelta = isCompareActive
        && compareBaselineModelName !== null
        && baselineValueNum !== null;

      modelColumns.forEach((modelName) => {
        const cell = matrixRow.cells.get(modelName);
        if (!cell) return;

        const { valueNum, valueNum2 } = cell;

        if (valueNum !== null && Number.isFinite(valueNum)) {
          const score = getMatrixRowComparableScore(matrixRow, valueNum);
          if (Number.isFinite(score)) {
            primaryComparableValues.push(score);
          }
        }

        if (valueNum2 !== null && Number.isFinite(valueNum2)) {
          const score2 = getMatrixRowComparableScore(matrixRow, valueNum2);
          if (Number.isFinite(score2)) {
            secondaryComparableValues.push(score2);
          }
        }

        if (displaySourceValueDeltasInCells && cell.hasMeaningfulMultipleValues) {
          const deltaRaw = getSourceValueDeltaRaw(cell.allEntries, activeSource, matrixRow.higherIsBetter);
          if (deltaRaw !== null) {
            const deltaAbs = Math.abs(deltaRaw);
            if (Number.isFinite(deltaAbs)) {
              sourceDeltaAbsValues.push(deltaAbs);
            }
          }
        }

        if (
          shouldCollectCompareDelta
          && modelName !== compareBaselineModelName
          && compareModelSet.has(modelName)
          && valueNum !== null
          && Number.isFinite(valueNum)
        ) {
          const compareDeltaRaw = valueNum - baselineValueNum!;
          const compareDeltaEffective = isRowLowerBetter ? -compareDeltaRaw : compareDeltaRaw;
          const compareDeltaAbs = Math.abs(compareDeltaEffective);
          if (Number.isFinite(compareDeltaAbs)) {
            compareAbsEffectiveDeltaValues.push(compareDeltaAbs);
          }
        }
      });

      const primaryComparableDistinctDesc = Array.from(new Set(primaryComparableValues)).sort((a, b) => b - a);
      const secondaryComparableDistinctDesc = Array.from(new Set(secondaryComparableValues)).sort((a, b) => b - a);

      metricsByKey.set(matrixRow.rowKey, {
        isRowLowerBetter,
        primaryComparableTop: primaryComparableDistinctDesc[0] ?? null,
        primaryComparableSecond: primaryComparableDistinctDesc[1] ?? null,
        secondaryComparableTop: secondaryComparableDistinctDesc[0] ?? null,
        secondaryComparableSecond: secondaryComparableDistinctDesc[1] ?? null,
        sourceDeltaAbsP90: sourceDeltaAbsValues.length > 0
          ? Math.max(
              getSortedQuantile(sourceDeltaAbsValues.sort((a, b) => a - b), 0.9),
              Number.EPSILON
            )
          : null,
        compareAbsEffectiveDeltaP90: compareAbsEffectiveDeltaValues.length > 0
          ? Math.max(
              getSortedQuantile(compareAbsEffectiveDeltaValues.sort((a, b) => a - b), 0.9),
              Number.EPSILON
            )
          : null
      });
    });

    return metricsByKey;
  }, [
    displayMatrixRows,
    modelColumns,
    displaySourceValueDeltasInCells,
    activeSource,
    isCompareActive,
    compareBaselineModelName,
    compareModelSet
  ]);

  // 名次样式与行无关，只随导出模式切换，没必要在每行重建对象
  const topRankSegmentStyle = useMemo<CSSProperties>(() => ({ fontWeight: 800 }), []);
  const secondRankSegmentStyle = useMemo<CSSProperties>(
    () => isExportCaptureMode
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
        },
    [isExportCaptureMode]
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

  function temporarilyHideRow(rowKey: string) {
    setTemporarilyHiddenRowKeys((prev) => (prev.includes(rowKey) ? prev : [...prev, rowKey]));
    setSelectedRowKey((prev) => (prev === rowKey ? null : prev));
    setColumnSortBenchmarkKey((prev) => (prev === rowKey ? null : prev));
    setExpandedRankingRowKey((prev) => (prev === rowKey ? null : prev));
    setRankingPopoverPosition(null);
    setExpandedTrendCellKey((prev) => (prev?.rowKey === rowKey ? null : prev));
    setTrendPopoverPosition(null);
    hideCellTooltip(true);
    hideOverallTooltip();
    window.getSelection()?.removeAllRanges();
  }

  function getRankingPopoverPosition(event: ReactMouseEvent<HTMLTableRowElement>): {
    top: number;
    left: number;
    width: number;
    placement: "above" | "below";
  } {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(viewportWidth - RANKING_POPOVER_MARGIN * 2, RANKING_POPOVER_MAX_WIDTH);
    const preferredLeft = event.clientX - width / 2;
    const left = Math.max(
      RANKING_POPOVER_MARGIN,
      Math.min(preferredLeft, viewportWidth - width - RANKING_POPOVER_MARGIN)
    );
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement = spaceBelow >= 360 || spaceBelow >= spaceAbove ? "below" : "above";
    const top = placement === "below"
      ? Math.min(rect.bottom + RANKING_POPOVER_GAP, viewportHeight - RANKING_POPOVER_MARGIN)
      : Math.max(rect.top - RANKING_POPOVER_GAP, RANKING_POPOVER_MARGIN);

    return { top, left, width, placement };
  }

  function preventTemporaryRowHideTextSelection(event: ReactMouseEvent<HTMLTableRowElement>) {
    if (event.shiftKey) {
      event.preventDefault();
    }
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
            role="alert"
            onClick={(e) => {
              const selection = typeof window !== "undefined" ? window.getSelection() : null;
              const selectedText = selection?.toString()?.trim();
              if (selectedText && selectedText.length > 0) {
                const isOutside = Boolean(
                  selection?.anchorNode && !e.currentTarget.contains(selection.anchorNode)
                );
                if (!isOutside) {
                  return;
                }
              }
              dismissCopyNotice();
            }}
            onMouseEnter={pauseCopyNotice}
            onMouseLeave={resumeCopyNotice}
            title="点击关闭"
            className={`group pointer-events-auto flex min-w-[260px] max-w-[520px] cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-300 ease-out hover:scale-[1.01] hover:brightness-105 active:scale-[0.98] ${
              copyNoticeDismissing
                ? "translate-x-12 opacity-0 scale-90 pointer-events-none"
                : copyNoticeVisible
                  ? "translate-x-0 translate-y-0 opacity-100 scale-100"
                  : "translate-x-0 -translate-y-2 opacity-0 scale-95"
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
        overflowSourceMenuOptions={overflowSourceMenuOptions}
        promotedOverflowSourceKey={promotedOverflowSourceKey}
        sourceNewStateByKey={sourceNewStateByKey}
        activeSource={activeSource}
        isSourceOverflowMenuOpen={isSourceOverflowMenuOpen}
        setIsSourceOverflowMenuOpen={setIsSourceOverflowMenuOpen}
        setSourceAndUrl={setSourceAndUrl}
        getSourceTabDisplayText={getSourceTabDisplayText}
        getSourceTabTextColor={getSourceTabTextColor}
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
        copyTableMarkdownToClipboard={copyTableMarkdownToClipboard}
        isDownloadingTableImage={isDownloadingTableImage}
        isCopyingTableImage={isCopyingTableImage}
        exportPreset={exportPreset}
        setExportPreset={setExportPreset}
        availableExportPresetKeys={availableExportPresetKeys}
        exportIncludeFootnote={exportIncludeFootnote}
        setExportIncludeFootnote={setExportIncludeFootnote}
        hasFootnoteText={Boolean(exportFootnoteText)}
        showCategory={showCategory}
        setShowCategory={setShowCategory}
        showDuplicateRows={showDuplicateRows}
        setShowDuplicateRows={setShowDuplicateRows}
        showLowCoverageRows={showLowCoverageRows}
        setShowLowCoverageRows={handleSetShowLowCoverageRows}
        showPriceRows={showPriceRows}
        setShowPriceRows={setShowPriceRows}
        hasPriceData={hasPriceData}
        priceRowsInOverall={priceRowsInOverall}
        setPriceRowsInOverall={setPriceRowsInOverall}
        showParamsRows={showParamsRows}
        setShowParamsRows={setShowParamsRows}
        hasParamsData={hasParamsData}
        paramsRowsInOverall={paramsRowsInOverall}
        setParamsRowsInOverall={setParamsRowsInOverall}
        hasSourceData={hasSourceData}
        displaySourceValuesInCells={displaySourceValuesInCells}
        displaySourceValueMax={showSourceValueMax}
        onSourceValuesButtonClick={(event) => {
          if (isCompareModifierClick(event)) {
            event.preventDefault();
            setShowSourceValues(true);
            setShowSourceValueDeltas((prev) => !prev);
            return;
          }

          if (event.shiftKey) {
            event.preventDefault();
            setShowSourceValues(true);
            setShowSourceValueMax((prev) => !prev);
            return;
          }

          setShowSourceValues((prev) => {
            const next = !prev;
            if (!next) {
              setShowSourceValueDeltas(false);
              setShowSourceValueMax(false);
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
        benchmarkSearchInputValue={benchmarkSearchInputValue}
        setBenchmarkSearchInputValue={setBenchmarkSearchInputValue}
      />

      <div
        ref={tableViewportRef}
        data-export-footnote={exportIncludeFootnote ? exportFootnoteText : undefined}
        style={{
          overflow: "auto",
          maxHeight: isFullscreen
            ? `calc(100vh - ${isModelFilterExpanded ? 170 : 120}px)`
            : "95.5vh",
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
                    width: 52,
                    minWidth: 52,
                    maxWidth: 52,
                    padding: "6px 2px",
                    background: "rgba(20, 27, 45, 0.96)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap"
                  }}
                >
                <details className="dropdown dropdown-bottom" data-modality-filter="true">
                  <summary
                    className="btn btn-ghost btn-xs h-auto min-h-0 px-0.5 normal-case text-inherit text-[10px]"
                    style={{ letterSpacing: "-0.03em" }}
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
                    data-presence-active={isPresenceFilterActive ? "1" : undefined}
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
              const {
                isRowLowerBetter,
                primaryComparableTop,
                primaryComparableSecond,
                secondaryComparableTop,
                secondaryComparableSecond,
                sourceDeltaAbsP90,
                compareAbsEffectiveDeltaP90
              } = rowRenderMetricsByKey.get(rowKey) ?? EMPTY_ROW_RENDER_METRICS;
              // 合成行可以只做展示不进总评，此时把行名压暗以示区分
              const isRowExcludedFromOverall = matrixRow.isPriceRow
                ? !priceRowsInOverall
                : matrixRow.isInfoRow
                  ? !paramsRowsInOverall
                  : false;
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

              const baselineCellForRow = compareBaselineModelName
                ? matrixRow.cells.get(compareBaselineModelName)
                : undefined;
              const baselineValueNum = baselineCellForRow?.valueNum ?? null;
              return (
                <tr
                  key={rowKey}
                  data-metric-type={matrixRow.isPriceRow ? "price" : matrixRow.isInfoRow ? "info" : undefined}
                  data-ranking-expanded={expandedRankingRowKey === rowKey ? "1" : undefined}
                  className={isSelectedRow ? "matrix-row-selected" : "matrix-row-hover"}
                  onMouseDown={preventTemporaryRowHideTextSelection}
                  onClick={(event) => {
                    if (event.shiftKey) {
                      event.preventDefault();
                      temporarilyHideRow(rowKey);
                      return;
                    }

                    if (isCompareModifierClick(event)) {
                      event.preventDefault();
                      const nextPosition = getRankingPopoverPosition(event);
                      setExpandedRankingRowKey((prev) => {
                        const shouldClose = prev === rowKey;
                        setRankingPopoverPosition(shouldClose ? null : nextPosition);
                        return shouldClose ? null : rowKey;
                      });
                      setExpandedTrendCellKey(null);
                      setTrendPopoverPosition(null);
                      hideCellTooltip(true);
                      hideOverallTooltip();
                      return;
                    }

                    setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey));
                    setColumnSortBenchmarkKey((prev) => (prev === rowKey ? null : rowKey));
                    setExpandedTrendCellKey(null);
                    setTrendPopoverPosition(null);
                  }}
                  style={{ cursor: "pointer", ...rowFrameStyle }}
                >
                  <td
                    style={{
                      width: 52,
                      minWidth: 52,
                      maxWidth: 52,
                      padding: "4px 2px",
                      textAlign: "center",
                      ...rowCellLineStyle,
                      ...rowLeftEdgeStyle
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-center gap-0.5">
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
                    title={isRowExcludedFromOverall ? `${matrixRow.benchmark}（未计入总评）` : matrixRow.benchmark}
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
                          whiteSpace: "nowrap",
                          opacity: isRowExcludedFromOverall ? 0.5 : undefined
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
                      ? getMatrixRowComparableScore(matrixRow, cellNum)
                      : null;
                    const comparableCellNum2 = cellNum2 !== null
                      ? getMatrixRowComparableScore(matrixRow, cellNum2)
                      : null;
                    const noteText = cell?.noteText ?? "";
                    const shouldShowQuestionMark = cell?.shouldShowQuestionMark ?? false;
                    const hasMultipleActiveSourceValues = cell?.hasMultipleActiveSourceValues ?? false;
                    const uniqueEntries = cell?.uniqueEntries ?? [];
                    const sourceValueItem = displaySourceValuesInCells && cell?.hasMeaningfulMultipleValues
                      ? getSourceValueDisplayItem(uniqueEntries, activeSource, matrixRow.higherIsBetter, sourceValueMode)
                      : null;
                    const sourceValueDeltaRaw = displaySourceValueDeltasInCells && cell?.hasMeaningfulMultipleValues
                      ? getSourceValueDeltaRaw(cell.allEntries, activeSource, matrixRow.higherIsBetter, sourceValueMode)
                      : null;
                    const shouldRenderSourceValues = Boolean(sourceValueItem);
                    // 展示 source 原值时，tooltip 收敛到当前 source 的记录，与单元格里的取值范围一致
                    const tooltipEntries = shouldRenderSourceValues
                      ? uniqueEntries.filter((entry) => getSourceKey(entry.source) === activeSource)
                      : uniqueEntries;
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
                    const pairDisplayParts = cell
                      ? getMatrixCellPairDisplayParts(cell.valueNum, cell.valueNum2, cell.valueRaw, cell.valueNote)
                      : null;
                    const isPairNumericDisplay =
                      pairDisplayParts !== null &&
                      !pairDisplayParts.hasCurrencySymbol;

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
                    const compareValueDirection: CompareDirection = compareDeltaRaw === null
                      ? "flat"
                      : Math.abs(compareDeltaRaw) < Number.EPSILON
                        ? "flat"
                        : compareDeltaRaw > 0
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
                    const compareArrow = compareValueDirection === "up" ? "▲" : compareValueDirection === "down" ? "▼" : "•";
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
                    const sourceValueDeltaValueDirection: CompareDirection = sourceValueDeltaRaw === null
                      ? "flat"
                      : Math.abs(sourceValueDeltaRaw) < Number.EPSILON
                        ? "flat"
                        : sourceValueDeltaRaw > 0
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
                    const sourceValueDeltaArrow = sourceValueDeltaValueDirection === "up" ? "▲" : sourceValueDeltaValueDirection === "down" ? "▼" : "•";
                    const sourceValueDeltaText = showSourceValueDeltaBadge && sourceValueDeltaRaw !== null
                      ? formatComparisonDeltaValue(sourceValueDeltaRaw)
                      : "";
                    const activeDeltaBadgeStyle = showCompareBadge ? compareBadgeStyle : sourceValueDeltaBadgeStyle;
                    const activeDeltaDirection = showCompareBadge ? compareDirection : sourceValueDeltaDirection;
                    const activeDeltaValueDirection = showCompareBadge ? compareValueDirection : sourceValueDeltaValueDirection;
                    const activeDeltaArrow = showCompareBadge ? compareArrow : sourceValueDeltaArrow;
                    const activeDeltaText = showCompareBadge ? compareDeltaText : sourceValueDeltaText;
                    const activeDeltaTitle = showCompareBadge
                      ? `相对基准 ${compareBaselineModelName} 的差值`
                      : "相对表格默认取值的差值";
                    const showAnyDeltaBadge = showCompareBadge || showSourceValueDeltaBadge;
                    // 展示 source 原值时，注释之外，当前 source 内部存在多条不同取值也要保留问号与 tooltip
                    const hasSourceValueNote = noteText.length > 0 && noteText.toLowerCase() !== "x";
                    const showQuestionMarkIcon = (shouldRenderSourceValues
                      ? (hasSourceValueNote || hasMultipleActiveSourceValues)
                      : shouldShowQuestionMark) && !showAnyDeltaBadge;

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
                    const cellText = renderFrontendTableCellText(cell?.displayValue ?? "--", singleCellScoreStyle);
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
                    const isTrendEligible = showQuestionMarkIcon && isCellTrendEligible(cell, activeSource);
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
                        {isPairNumericDisplay && pairDisplayParts ? (
                          <span className="inline-flex items-center gap-0 leading-none">
                            <span style={isTopCellFirst ? topRankSegmentStyle : isSecondCellFirst ? secondRankSegmentStyle : undefined}>{pairDisplayParts.first}</span>
                            <span className={PAIR_VALUE_SLASH_CLASS_NAME}>/</span>
                            <span style={isTopCellSecond ? topRankSegmentStyle : isSecondCellSecond ? secondRankSegmentStyle : undefined}>{pairDisplayParts.second}</span>
                          </span>
                        ) : shouldRenderSourceValues ? (
                          renderFrontendTableCellText(sourceValueItem!.displayValue, singleCellScoreStyle)
                        ) : (
                          cellText
                        )}
                        {showAnyDeltaBadge && activeDeltaBadgeStyle ? (
                          <span
                            data-compare-delta-badge={showCompareBadge ? "1" : undefined}
                            data-source-delta-badge={showSourceValueDeltaBadge ? "1" : undefined}
                            data-compare-direction={activeDeltaValueDirection}
                            data-compare-color-direction={activeDeltaDirection}
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
                            data-cell-trend-trigger={isTrendEligible ? "1" : undefined}
                            role={isTrendEligible ? "button" : undefined}
                            tabIndex={isTrendEligible ? 0 : undefined}
                            className={`absolute right-1 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85 ${
                              isTrendEligible ? "cursor-pointer" : "cursor-help"
                            }`}
                            title={isTrendEligible ? "历史趋势折线图" : undefined}
                            onClick={isTrendEligible ? (event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              const rect = event.currentTarget.getBoundingClientRect();
                              const nextPosition = getCellTrendPopoverPosition(rect);
                              setExpandedTrendCellKey((prev) => {
                                const isSame = prev?.rowKey === rowKey && prev?.modelName === model.modelName;
                                setTrendPopoverPosition(isSame ? null : nextPosition);
                                return isSame ? null : { rowKey, modelName: model.modelName };
                              });
                              setExpandedRankingRowKey(null);
                              setRankingPopoverPosition(null);
                              hideCellTooltip(true);
                              hideOverallTooltip();
                            } : undefined}
                            onKeyDown={isTrendEligible ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.stopPropagation();
                                event.preventDefault();
                                const rect = event.currentTarget.getBoundingClientRect();
                                const nextPosition = getCellTrendPopoverPosition(rect);
                                setExpandedTrendCellKey((prev) => {
                                  const isSame = prev?.rowKey === rowKey && prev?.modelName === model.modelName;
                                  setTrendPopoverPosition(isSame ? null : nextPosition);
                                  return isSame ? null : { rowKey, modelName: model.modelName };
                                });
                                setExpandedRankingRowKey(null);
                                setRankingPopoverPosition(null);
                                hideCellTooltip(true);
                                hideOverallTooltip();
                              }
                            } : undefined}
                            onMouseEnter={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              showCellTooltip({
                                x: rect.left + rect.width / 2,
                                y: rect.top - 6,
                                entries: tooltipEntries,
                                note: noteText.length > 0 ? noteText : null,
                                targetHeight: rect.height
                              });
                            }}
                            onMouseLeave={() => hideCellTooltip()}
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

            {shouldShowOverallSummary ? (
              <tr
                data-overall-row="1"
                className={selectedRowKey === OVERALL_ROW_KEY ? "matrix-row-selected" : "matrix-row-hover"}
                onMouseDown={preventTemporaryRowHideTextSelection}
                onClick={(event) => {
                  if (event.shiftKey) {
                    event.preventDefault();
                    temporarilyHideRow(OVERALL_ROW_KEY);
                    return;
                  }

                  setSelectedRowKey((prev) => (prev === OVERALL_ROW_KEY ? null : OVERALL_ROW_KEY));
                  setColumnSortBenchmarkKey((prev) => (prev === OVERALL_ROW_KEY ? null : OVERALL_ROW_KEY));
                }}
                style={{ cursor: "pointer" }}
              >
                <td
                  style={{
                    width: 52,
                    minWidth: 52,
                    maxWidth: 52,
                    padding: "4px 2px",
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
                            showOverallTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top - 6,
                              modelName: model.modelName,
                              summary,
                              targetHeight: rect.height
                            });
                          }}
                          onMouseLeave={hideOverallTooltip}
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
        {exportIncludeFootnote && exportFootnoteText && isExportCaptureMode ? (() => {
          const now = new Date();
          const formattedTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          
          let sourceTime = "";
          const relevantRows = activeSource === SOURCE_ALL 
            ? allRows 
            : allRows.filter((row) => row.source === activeSource);
          
          if (relevantRows.length > 0) {
            let maxTimeMs = 0;
            relevantRows.forEach((row) => {
              if (row.benchTime) {
                const timeMs = new Date(row.benchTime).getTime();
                if (!isNaN(timeMs) && timeMs > maxTimeMs) {
                  maxTimeMs = timeMs;
                }
              }
            });
            if (maxTimeMs > 0) {
              const maxDate = new Date(maxTimeMs);
              sourceTime = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, "0")}-${String(maxDate.getDate()).padStart(2, "0")}`;
            }
          }

          const processedText = exportFootnoteText
            .replace(/\{time\}/g, formattedTime)
            .replace(/\{source_time\}/g, sourceTime)
            .replace(/\{model_count\}/g, String(modelColumns.length))
            .replace(/\{data_source\}/g, activeSource === SOURCE_ALL ? "全数据源" : sourceTabDisplayLabel(activeSource).trim())
            .replace(/\{origin_source\}/g, activeSource);
          return (
            <div
              data-export-footnote-element="true"
              style={{
                padding: "2.5px 6px 1.5px 6px",
                textAlign: exportFootnoteAlign || "center",
                fontSize: "12px",
                color: "rgba(255, 255, 255, 0.5)",
                whiteSpace: "pre-wrap",
                width: "max-content",
                minWidth: "100%"
              }}
            >
              {processedText}
            </div>
          );
        })() : null}
      </div>

      {activeRankingData && rankingPopoverPosition ? (
        <div
          className="fixed inset-0 z-[130] bg-transparent"
          onMouseDown={() => {
            setExpandedRankingRowKey(null);
            setRankingPopoverPosition(null);
          }}
        >
          <div
            ref={rankingPopoverRef}
            className="fixed"
            style={{
              top: rankingPopoverPosition.top,
              left: rankingPopoverPosition.left,
              width: rankingPopoverPosition.width,
              transform: rankingPopoverPosition.placement === "above" ? "translateY(-100%)" : undefined
            }}
          >
            <BenchmarkRankingPanel
              ranking={activeRankingData}
              scope={rankingScope}
              scaleMode={rankingScaleMode}
              placement={rankingPopoverPosition.placement}
              showBoxPlot={rankingShowBoxPlot}
              onScopeChange={setRankingScope}
              onScaleModeChange={setRankingScaleMode}
              onShowBoxPlotChange={setRankingShowBoxPlot}
              onClose={() => {
                setExpandedRankingRowKey(null);
                setRankingPopoverPosition(null);
              }}
              onHoverItem={(rect, item) => {
                if (!rankingShowBoxPlot || !rect || !item || !item.allEntries || item.allEntries.length === 0) {
                  hideCellTooltip();
                  return;
                }
                showCellTooltip({
                  x: rect.left + Math.min(rect.width / 2, BOX_PLOT_TOOLTIP_LEFT_OFFSET),
                  y: rect.top - 6,
                  entries: item.allEntries,
                  note: item.noteText && item.noteText.length > 0 ? item.noteText : null,
                  targetHeight: rect.height
                });
              }}
            />
          </div>
        </div>
      ) : null}

      {activeTrendData && trendPopoverPosition ? (
        <div
          className="fixed inset-0 z-[130] bg-transparent"
          onMouseDown={() => {
            setExpandedTrendCellKey(null);
            setTrendPopoverPosition(null);
          }}
        >
          <div
            ref={trendPopoverRef}
            className="fixed z-[130]"
            style={{
              top: trendPopoverPosition.top,
              left: trendPopoverPosition.left,
              width: trendPopoverPosition.width,
              transform: trendPopoverPosition.placement === "above" ? "translateY(-100%)" : undefined
            }}
          >
            <CellTrendPanel
              trend={activeTrendData}
              placement={trendPopoverPosition.placement}
              onClose={() => {
                setExpandedTrendCellKey(null);
                setTrendPopoverPosition(null);
              }}
            />
          </div>
        </div>
      ) : null}

      {isFullscreen ? null : (
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
      )}

      <MatrixCellTooltipHost
        handleRef={cellTooltipHandleRef}
        onScrollableChange={handleCellTooltipScrollableChange}
        onHoverChange={handleCellTooltipHoverChange}
      />

      <OverallScoreTooltipHost handleRef={overallTooltipHandleRef} />

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
  __applyExportPresenceFilterFallbackForTest,
  __buildOverallScoreDisplayDecimalsMapForTest,
  __resolveCaptureDimensionsForTest
} from "./benchmark-matrix/index";
