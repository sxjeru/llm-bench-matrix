"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EXPORT_PRESET,
  EMPTY_MODEL_PARAMS,
  EMPTY_MODEL_PRICES,
  EMPTY_SOURCE_OPTIONS,
  EXPORT_PRESET_MAP,
  SOURCE_ALL
} from "@/components/benchmark-matrix/constants";
import { canEncodeCanvasMimeType } from "@/components/benchmark-matrix/export-image";
import {
  buildAaIndexRevisionsByRow,
  buildAllModelNames,
  buildAllRowsIndex,
  buildBaseBenchmarkKeySet,
  buildBaseModelNameSet,
  buildCoverageMetaByModel,
  buildCoveragePrunedRows,
  buildDefaultAllSourceModels,
  buildDefaultSelectedModels,
  buildFilteredRows,
  buildMatrixRows,
  buildModelColumns,
  buildOverallSummaryByModel,
  buildParamsMatrixRows,
  buildPriceMatrixRows,
  buildReleaseDateMatrixRow,
  buildProviderGroups,
  buildRowsBySource,
  buildRowsWithSourceMeta,
  buildSourceOptions,
  resolveBaseSourceRows
} from "@/components/benchmark-matrix/selectors";
import { hasPublicModelPriceCost, type ExportPresetKey } from "@/components/benchmark-matrix/types";
import { normalizeMatchToken, sourceTabDisplayLabel, enqueueStateUpdate } from "@/components/benchmark-matrix/utils";
import { useSharedMatrixDerived } from "@/components/dashboard-provider";
import { resolveProviderBrandColorForDarkTheme } from "@/lib/provider-config";
import { ScatterChartHost } from "./model-scatter/chart-host";
import {
  OVERALL_METRIC_SLUG,
  SCATTER_ALWAYS_VISIBLE_BENCHMARK_TYPES,
  SCATTER_CHART_COMPACT_BREAKPOINT,
  SCATTER_CHART_FULLSCREEN_CHROME,
  SCATTER_CHART_HEIGHT,
  SCATTER_CHART_HEIGHT_COMPACT,
  SCATTER_CHART_MIN_HEIGHT
} from "./model-scatter/constants";
import { ScatterControls } from "./model-scatter/controls";
import { buildScatterDataset, buildScatterSnapshotOverlayDataset } from "./model-scatter/dataset";
import { useScatterImageActions } from "./model-scatter/image-actions";
import {
  buildScatterMetrics,
  findScatterMetric,
  groupScatterMetrics,
  resolveDefaultAxisKeys
} from "./model-scatter/metrics";
import {
  DEFAULT_SCATTER_VIEW_STATE,
  buildScatterSearchParams,
  loadScatterPreferences,
  parseScatterSearchParams,
  saveScatterPreferences,
  type ScatterViewState
} from "./model-scatter/persistence";
import { ScatterCanvas } from "./model-scatter/scatter-canvas";
import {
  describeScatterHistoryUnavailable,
  formatScatterHistoryDate,
  formatScatterHistoryModeLabel,
  nextScatterHistoryMode,
  resolveScatterHistoricalPoint
} from "./model-scatter/history";
import type {
  ModelScatterProps,
  ScatterAxisScale,
  ScatterHistoricalPoint,
  ScatterHistoryMode,
  ScatterOverlayMode
} from "./model-scatter/types";

/** 散点图不做重复行拆分：合并同名 benchmark 才能得到干净的轴列表。 */
const SHOW_DUPLICATE_ROWS = false;

export function ModelScatter({
  rows,
  allRows: allRowsProp,
  sourceOptions: sourceOptionsProp = EMPTY_SOURCE_OPTIONS,
  modelPrices = EMPTY_MODEL_PRICES,
  modelParams = EMPTY_MODEL_PARAMS,
  aaVersionCutoffs,
  urlSyncEnabled = true
}: ModelScatterProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const allRows = useMemo(() => allRowsProp ?? rows, [allRowsProp, rows]);

  const [viewState, setViewState] = useState<ScatterViewState>(DEFAULT_SCATTER_VIEW_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  /**
   * 「含低覆盖指标」开关按轴模式分别记忆：
   * - overall：任一轴为 Overall 时使用，默认关闭（Overall 代表矩阵默认视图）；
   * - other：其余指标共用，默认开启。
   * 该开关只控制是否纳入绘制，不控制轴下拉的搜索范围（搜索始终可查全部指标）。
   */
  const [lowCoveragePrefs, setLowCoveragePrefs] = useState({ overall: false, other: true });
  const isOverallAxisActive =
    viewState.xKey === OVERALL_METRIC_SLUG || viewState.yKey === OVERALL_METRIC_SLUG;
  const showLowCoverageRows = isOverallAxisActive
    ? lowCoveragePrefs.overall
    : lowCoveragePrefs.other;

  /** 手动改动只写入当前轴模式的记忆，另一模式的偏好保持不变。 */
  const applyLowCoveragePref = useCallback((mode: "overall" | "other", next: boolean) => {
    setLowCoveragePrefs((prev) => (prev[mode] === next ? prev : { ...prev, [mode]: next }));
  }, []);

  const setShowLowCoverageRows = useCallback(
    (next: boolean) => applyLowCoveragePref(isOverallAxisActive ? "overall" : "other", next),
    [applyLowCoveragePref, isOverallAxisActive]
  );
  const [hiddenProviders, setHiddenProviders] = useState<string[]>([]);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [highlightedModel, setHighlightedModel] = useState<string | null>(null);
  const [historySelections, setHistorySelections] = useState<Array<{
    modelName: string;
    mode: ScatterHistoryMode;
  }>>([]);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [exportPreset, setExportPreset] = useState<ExportPresetKey>(DEFAULT_EXPORT_PRESET);
  const [includeLegendInExport, setIncludeLegendInExport] = useState(false);
  const [supportsWebpExport, setSupportsWebpExport] = useState(true);
  const [supportsAvifExport, setSupportsAvifExport] = useState(false);
  const [chartHeight, setChartHeight] = useState(SCATTER_CHART_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 视口内可见点（缩放/平移后由画布回传）；dataset 变化时在渲染期重置
  const [visibleScatterPoints, setVisibleScatterPoints] = useState<
    readonly { modelName: string; providerName: string }[]
  >([]);
  const [syncedDatasetPoints, setSyncedDatasetPoints] = useState<
    readonly { modelName: string; providerName: string }[]
  >([]);

  const hydratedRef = useRef(false);
  const searchParamsRef = useRef(searchParams);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const chartCaptureRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    const listener = () => setIsFullscreen(document.fullscreenElement === sectionRef.current);

    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  useEffect(() => {
    const nextSupportsWebpExport = canEncodeCanvasMimeType("image/webp");
    const nextSupportsAvifExport = canEncodeCanvasMimeType("image/avif");

    enqueueStateUpdate(() => {
      setSupportsWebpExport(nextSupportsWebpExport);
      setSupportsAvifExport(nextSupportsAvifExport);
    });
  }, []);

  useEffect(() => {
    const measure = () => {
      // 全屏时把图表撑到视口高度减去控件与说明行占用的部分
      if (document.fullscreenElement === sectionRef.current) {
        setChartHeight(Math.max(SCATTER_CHART_MIN_HEIGHT, window.innerHeight - SCATTER_CHART_FULLSCREEN_CHROME));
        return;
      }

      setChartHeight(
        window.innerWidth < SCATTER_CHART_COMPACT_BREAKPOINT
          ? SCATTER_CHART_HEIGHT_COMPACT
          : SCATTER_CHART_HEIGHT
      );
    };

    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, []);

  const activeSource = viewState.activeSource;

  const sourceOptions = useMemo(
    () => buildSourceOptions(allRows, sourceOptionsProp),
    [allRows, sourceOptionsProp]
  );

  const sharedDerived = useSharedMatrixDerived(rows, allRows);

  const scopedRowsBySource = useMemo(
    () => sharedDerived?.rowsBySource ?? buildRowsBySource(rows),
    [rows, sharedDerived]
  );
  const allRowsBySource = useMemo(
    () => (allRows === rows ? scopedRowsBySource : buildRowsBySource(allRows)),
    [allRows, rows, scopedRowsBySource]
  );
  const getAllRowsWithSourceMeta = useMemo(() => {
    if (sharedDerived) return sharedDerived.getAllRowsWithSourceMeta;

    let projected: typeof allRows | null = null;

    return () => {
      projected ??= buildRowsWithSourceMeta(allRows);
      return projected;
    };
  }, [allRows, sharedDerived]);

  const indexedSourceRows = useMemo(
    () => (activeSource === SOURCE_ALL ? allRows : getAllRowsWithSourceMeta()),
    [activeSource, allRows, getAllRowsWithSourceMeta]
  );

  const allRowsIndex = useMemo(
    () => {
      if (
        sharedDerived
        && activeSource === SOURCE_ALL
        && indexedSourceRows === allRows
      ) {
        return sharedDerived.mergedAllRowsIndex;
      }

      return buildAllRowsIndex(indexedSourceRows, SHOW_DUPLICATE_ROWS);
    },
    [activeSource, allRows, indexedSourceRows, sharedDerived]
  );

  const baseSourceRows = useMemo(
    () => resolveBaseSourceRows(allRows, rows, scopedRowsBySource, allRowsBySource, activeSource, SHOW_DUPLICATE_ROWS),
    [allRows, rows, scopedRowsBySource, allRowsBySource, activeSource]
  );

  const aaRevisionsByRow = useMemo(
    () => buildAaIndexRevisionsByRow(indexedSourceRows, SHOW_DUPLICATE_ROWS, {
      versionCutoffs: aaVersionCutoffs
    }),
    [indexedSourceRows, aaVersionCutoffs]
  );

  const baseBenchmarkKeySet = useMemo(
    () => buildBaseBenchmarkKeySet(baseSourceRows, SHOW_DUPLICATE_ROWS),
    [baseSourceRows]
  );

  const baseModelNameSet = useMemo(() => buildBaseModelNameSet(baseSourceRows), [baseSourceRows]);

  const sourceModelHint = useMemo(() => {
    if (activeSource === SOURCE_ALL) return "";
    return normalizeMatchToken(sourceTabDisplayLabel(activeSource).trim());
  }, [activeSource]);

  const coverageMetaByModel = useMemo(
    () => buildCoverageMetaByModel(allRowsIndex, baseBenchmarkKeySet, baseModelNameSet),
    [allRowsIndex, baseBenchmarkKeySet, baseModelNameSet]
  );

  const providerGroups = useMemo(
    () => buildProviderGroups(coverageMetaByModel, sourceModelHint),
    [coverageMetaByModel, sourceModelHint]
  );

  const allModelNames = useMemo(() => buildAllModelNames(providerGroups), [providerGroups]);

  const defaultSelectedModels = useMemo(
    () => buildDefaultSelectedModels(allModelNames, baseModelNameSet),
    [allModelNames, baseModelNameSet]
  );

  const defaultAllSourceModels = useMemo(
    () => buildDefaultAllSourceModels(allModelNames, defaultSelectedModels, baseModelNameSet),
    [allModelNames, defaultSelectedModels, baseModelNameSet]
  );

  const fallbackDefaultModels = useMemo(
    () => (activeSource === SOURCE_ALL ? defaultAllSourceModels : defaultSelectedModels),
    [activeSource, defaultAllSourceModels, defaultSelectedModels]
  );

  /**
   * 候选模型集合。
   *
   * 散点图的可见性由图例（按厂商）控制，不再有模型层叠筛选面板，
   * 因此这里固定取该来源的默认集合 —— 与矩阵页的默认状态一致，
   * 也不会去继承矩阵那边用户存下的筛选（在本页没有 UI 可以撤销它）。
   */
  const selectedModels = fallbackDefaultModels;
  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);

  const filteredRows = useMemo(
    () => buildFilteredRows(allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet, ""),
    [allRowsIndex, selectedModelSet, selectedModels, baseBenchmarkKeySet]
  );

  /**
   * 主要指标行集：与首页矩阵默认视图一致（剔除低覆盖），并补回 Cost / Performance
   * 这两个散点常用轴。它只用于决定轴下拉默认展示哪些指标。
   */
  const primaryCoverageRows = useMemo(
    () =>
      buildCoveragePrunedRows(activeSource, filteredRows, SHOW_DUPLICATE_ROWS, false, {
        // Cost / Performance 是散点最常用的轴：按分类裁剪后也要补回，
        // 否则低覆盖时下拉里会选不到这两个常用轴。
        alwaysKeepBenchmarkTypes: SCATTER_ALWAYS_VISIBLE_BENCHMARK_TYPES
      }),
    [activeSource, filteredRows]
  );

  /**
   * 严格矩阵默认视图行集：不补回 Cost / Performance。
   * 关闭「含低覆盖指标」时模型列必须与首页矩阵一致，否则只在 Cost/Performance
   * 行有值的模型会留在图里，开关看起来毫无变化。
   */
  const defaultViewRows = useMemo(
    () => buildCoveragePrunedRows(activeSource, filteredRows, SHOW_DUPLICATE_ROWS, false),
    [activeSource, filteredRows]
  );

  /** 坐标轴与模型列实际使用的行集：默认含低覆盖指标，取消勾选后回到矩阵默认视图。 */
  const coverageRows = showLowCoverageRows ? filteredRows : defaultViewRows;

  const baseModelColumns = useMemo(
    () => buildModelColumns(
      coverageRows,
      sourceModelHint,
      null,
      SHOW_DUPLICATE_ROWS,
      {},
      activeSource,
      aaRevisionsByRow,
      { versionCutoffs: aaVersionCutoffs }
    ),
    [coverageRows, sourceModelHint, activeSource, aaRevisionsByRow, aaVersionCutoffs]
  );

  /**
   * 固定的矩阵默认视图指标行：只用于判定「哪些指标属于低覆盖」，
   * 不能跟着 Overall 的行集一起随开关变化，否则判定集合会永远包含全部指标。
   */
  const defaultViewMatrixRows = useMemo(
    () => buildMatrixRows(
      baseSourceRows,
      defaultViewRows,
      SHOW_DUPLICATE_ROWS,
      false,
      activeSource,
      "latest",
      aaRevisionsByRow,
      { versionCutoffs: aaVersionCutoffs }
    ),
    [baseSourceRows, defaultViewRows, activeSource, aaRevisionsByRow, aaVersionCutoffs]
  );

  /**
   * Overall 与首页矩阵的总评同源：勾选低覆盖时吃全量行，取消勾选时回到矩阵默认视图。
   * 之前固定只吃矩阵默认视图，导致 Overall 轴对开关完全无响应，与矩阵页行为不一致。
   */
  const overallMatrixRows = useMemo(
    () => buildMatrixRows(
      baseSourceRows,
      showLowCoverageRows ? filteredRows : defaultViewRows,
      SHOW_DUPLICATE_ROWS,
      false,
      activeSource,
      "latest",
      aaRevisionsByRow,
      { versionCutoffs: aaVersionCutoffs }
    ),
    [
      baseSourceRows,
      defaultViewRows,
      filteredRows,
      showLowCoverageRows,
      activeSource,
      aaRevisionsByRow,
      aaVersionCutoffs
    ]
  );

  /** 主要指标对应的 MatrixRow，用于给轴下拉标出默认展示的指标集合。 */
  const primaryMatrixRows = useMemo(
    () => buildMatrixRows(
      baseSourceRows,
      primaryCoverageRows,
      SHOW_DUPLICATE_ROWS,
      false,
      activeSource,
      "latest",
      aaRevisionsByRow,
      { versionCutoffs: aaVersionCutoffs }
    ),
    [baseSourceRows, primaryCoverageRows, activeSource, aaRevisionsByRow, aaVersionCutoffs]
  );

  /**
   * 全量坐标轴行集：始终包含低覆盖行，专供指标搜索使用。
   * 是否把低覆盖点实际画进图里由下方 metrics 决定，搜索可见性不再依赖开关。
   */
  const allAxisMatrixRows = useMemo(
    () =>
      activeSource !== SOURCE_ALL
        ? // 非 All 来源本来就不做覆盖率裁剪，primaryMatrixRows 已是全量
          primaryMatrixRows
        : buildMatrixRows(
            baseSourceRows,
            filteredRows,
            SHOW_DUPLICATE_ROWS,
            false,
            activeSource,
            "latest",
            aaRevisionsByRow,
            { versionCutoffs: aaVersionCutoffs }
          ),
    [
      activeSource,
      primaryMatrixRows,
      baseSourceRows,
      filteredRows,
      aaRevisionsByRow,
      aaVersionCutoffs
    ]
  );

  const priceMatrixRows = useMemo(
    () => (modelPrices.some(hasPublicModelPriceCost) ? buildPriceMatrixRows(baseModelColumns, modelPrices) : []),
    [baseModelColumns, modelPrices]
  );

  const paramsMatrixRows = useMemo(
    () => (modelParams.length > 0 ? buildParamsMatrixRows(baseModelColumns, modelParams) : []),
    [baseModelColumns, modelParams]
  );

  const releaseDateMatrixRow = useMemo(
    () => (modelPrices.some((p) => Boolean(p.releaseDate?.trim())) ? buildReleaseDateMatrixRow(baseModelColumns, modelPrices) : null),
    [baseModelColumns, modelPrices]
  );

  const modelInfoMatrixRows = useMemo(
    () => [
      ...(releaseDateMatrixRow ? [releaseDateMatrixRow] : []),
      ...paramsMatrixRows
    ],
    [releaseDateMatrixRow, paramsMatrixRows]
  );

  /**
   * Overall 只吃矩阵默认视图的 benchmark 行：价格与参数量不计入。
   * 成本维度已由 AA 的 Cost 类指标覆盖，无需再叠一层合成行，
   * 这样也不再受矩阵页「合成行是否计入总评」开关影响。
   */
  const overallSummaryByModel = useMemo(
    () => buildOverallSummaryByModel(overallMatrixRows, baseModelColumns),
    [overallMatrixRows, baseModelColumns]
  );

  const overallScoreByModel = useMemo(() => {
    const scoreMap = new Map<string, number | null>();
    overallSummaryByModel.forEach((summary, modelName) => {
      scoreMap.set(modelName, summary.rawScore);
    });
    return scoreMap;
  }, [overallSummaryByModel]);

  /**
   * 全量指标：始终包含低覆盖 benchmark，专供轴下拉搜索。
   * 不用它直接绘制，避免取消勾选后仍能画出低覆盖点。
   */
  const allMetrics = useMemo(
    () =>
      buildScatterMetrics({
        benchmarkRows: allAxisMatrixRows,
        priceRows: priceMatrixRows,
        paramsRows: modelInfoMatrixRows,
        overallScoreByModel,
        versionCutoffs: aaVersionCutoffs
      }),
    [allAxisMatrixRows, priceMatrixRows, modelInfoMatrixRows, overallScoreByModel, aaVersionCutoffs]
  );

  /**
   * 轴下拉默认只展示主要指标；输入搜索词后放开全部指标。
   * 价格、参数量与 Overall 始终属于主要指标，benchmark 则以矩阵默认视图的行集为准。
   * 该集合只用于默认列表，与「含低覆盖指标」开关无关。
   */
  const primaryMetricKeys = useMemo(() => {
    const primaryBenchmarkRowKeys = new Set(primaryMatrixRows.map((row) => row.rowKey));
    return new Set(
      allMetrics
        .filter((metric) => metric.kind !== "benchmark" || primaryBenchmarkRowKeys.has(metric.rowKey))
        .map((metric) => metric.key)
    );
  }, [allMetrics, primaryMatrixRows]);

  /**
   * 矩阵默认视图的指标集合：关闭「含低覆盖指标」时只有这些 benchmark 参与绘制。
   * 不能用 primaryMetricKeys —— 它为了散点常用轴补回了 Cost/Performance（alwaysKeep），
   * 这些行即使覆盖率不足也会被当成主要指标，导致开关对它们（含默认的 AA Cost 轴）失效。
   */
  const defaultViewMetricKeys = useMemo(() => {
    const rowKeys = new Set(defaultViewMatrixRows.map((row) => row.rowKey));
    return new Set(
      allMetrics
        .filter((metric) => metric.kind !== "benchmark" || rowKeys.has(metric.rowKey))
        .map((metric) => metric.key)
    );
  }, [allMetrics, defaultViewMatrixRows]);

  // 首帧统一水合：localStorage 提供基线，URL 参数覆盖其上，分享链接因此永远优先
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const restored = {
      ...loadScatterPreferences(),
      ...parseScatterSearchParams(searchParams)
    };

    // 恢复的轴在矩阵默认视图之外时（分享链接或上次停留的轴），把对应模式的记忆打开，
    // 否则开关按默认值关闭会让该轴没有数据，链接无法原样复现
    const restoredKeys = [restored.xKey, restored.yKey].filter(
      (key): key is string => Boolean(key)
    );
    if (restoredKeys.some((key) => !defaultViewMetricKeys.has(key))) {
      const mode = restoredKeys.includes(OVERALL_METRIC_SLUG) ? "overall" : "other";
      // 首帧水合的一次性初始化，与下方 setViewState 同属挂载期同步
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLowCoveragePrefs((prev) => (prev[mode] ? prev : { ...prev, [mode]: true }));
    }

    setViewState((prev) => ({
      ...prev,
      ...restored
    }));

    // 用 state 而非 ref 放行 URL 同步：ref 会在同一轮 effect 里就被置真，
    // 导致同步逻辑拿着尚未水合的默认状态把链接里的参数冲掉
    setIsHydrated(true);
  }, [searchParams, defaultViewMetricKeys]);

  /**
   * 实际参与绘制的指标：关闭「含低覆盖指标」时，低覆盖 benchmark 仍保留在轴里，
   * 但清空取值与历史快照，让散点直接消失；重新勾选后数据恢复。
   * 轴 key 不再因开关而失效，避免用户看到「点了开关但图没变」。
   * 搜索框仍使用 allMetrics，因此「能否搜到」与「是否绘制」相互独立。
   */
  const metrics = useMemo(() => {
    if (showLowCoverageRows) return allMetrics;

    return allMetrics.map((metric) =>
      metric.kind === "benchmark" && !defaultViewMetricKeys.has(metric.key)
        ? { ...metric, valueByModel: new Map(), historyByModel: new Map(), snapshots: [] }
        : metric
    );
  }, [allMetrics, defaultViewMetricKeys, showLowCoverageRows]);

  /** 轴下拉使用全量指标分组：搜索始终覆盖低覆盖指标，不受开关影响。 */
  const metricGroups = useMemo(() => groupScatterMetrics(allMetrics), [allMetrics]);

  // 存档或链接里的轴失效时回落到默认，并顺带套用该指标建议的刻度；同时校验快照有效性
  useEffect(() => {
    if (metrics.length === 0) return;

    enqueueStateUpdate(() => {
      setViewState((prev) => {
        const hasX = Boolean(prev.xKey) && metrics.some((metric) => metric.key === prev.xKey);
        const hasY = Boolean(prev.yKey) && metrics.some((metric) => metric.key === prev.yKey);

        const defaults = !hasX || !hasY ? resolveDefaultAxisKeys(metrics) : null;
        const nextXKey = hasX ? prev.xKey : defaults!.xKey;
        const nextYKey = hasY ? prev.yKey : defaults!.yKey;
        const nextXMetric = findScatterMetric(metrics, nextXKey);
        const nextYMetric = findScatterMetric(metrics, nextYKey);

        const validXSnapshot =
          prev.xSnapshot && nextXMetric?.snapshots.some((s) => s.id === prev.xSnapshot)
            ? prev.xSnapshot
            : null;
        const validYSnapshot =
          prev.ySnapshot && nextYMetric?.snapshots.some((s) => s.id === prev.ySnapshot)
            ? prev.ySnapshot
            : null;
        const validOverlay =
          prev.overlaySnapshot &&
          (nextXMetric?.snapshots.some((s) => s.id === prev.overlaySnapshot) ||
            nextYMetric?.snapshots.some((s) => s.id === prev.overlaySnapshot))
            ? prev.overlaySnapshot
            : null;

        const axisChanged = !hasX || !hasY;
        const snapshotChanged =
          validXSnapshot !== prev.xSnapshot ||
          validYSnapshot !== prev.ySnapshot ||
          validOverlay !== prev.overlaySnapshot;

        if (!axisChanged && !snapshotChanged) return prev;

        return {
          ...prev,
          xKey: nextXKey,
          yKey: nextYKey,
          xSnapshot: validXSnapshot,
          ySnapshot: validYSnapshot,
          overlaySnapshot: validOverlay,
          xScale: hasX ? prev.xScale : nextXMetric?.preferLogScale ? "log" : "linear",
          yScale: hasY ? prev.yScale : nextYMetric?.preferLogScale ? "log" : "linear"
        };
      });
    });
  }, [metrics]);

  useEffect(() => {
    if (!isHydrated) return;

    // 本地偏好与地址栏分开：urlSyncEnabled 只管 URL，
    // keep-alive 隐藏态或内嵌复用时仍要记住用户选的轴与开关。
    saveScatterPreferences(viewState);

    if (!urlSyncEnabled) return;

    const query = buildScatterSearchParams(viewState, searchParamsRef.current);
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;

    window.history.replaceState(window.history.state, "", nextUrl);
  }, [viewState, isHydrated, pathname, urlSyncEnabled]);

  const xMetric = useMemo(() => findScatterMetric(metrics, viewState.xKey), [metrics, viewState.xKey]);
  const yMetric = useMemo(() => findScatterMetric(metrics, viewState.yKey), [metrics, viewState.yKey]);

  const effectiveXScale: ScatterAxisScale = xMetric?.unit === "date" ? "linear" : viewState.xScale;
  const effectiveYScale: ScatterAxisScale = yMetric?.unit === "date" ? "linear" : viewState.yScale;

  const providerNameByModel = useMemo(() => {
    const nameMap = new Map<string, string>();
    allRowsIndex.modelProviderMap.forEach((identity, modelName) => {
      nameMap.set(modelName, identity.displayName);
    });
    return nameMap;
  }, [allRowsIndex]);

  const colorByModel = useMemo(() => {
    const colorMap = new Map<string, string>();
    allRowsIndex.modelProviderMap.forEach((identity, modelName) => {
      colorMap.set(
        modelName,
        resolveProviderBrandColorForDarkTheme(
          identity.canonicalName,
          allRowsIndex.modelProviderBrandColorMap.get(modelName) ?? null
        )
      );
    });
    return colorMap;
  }, [allRowsIndex]);

  const hiddenProviderSet = useMemo(() => new Set(hiddenProviders), [hiddenProviders]);

  const plottableModelNames = useMemo(
    () =>
      baseModelColumns.filter((modelName) => {
        const providerName = providerNameByModel.get(modelName) ?? "Unknown";
        return !hiddenProviderSet.has(providerName);
      }),
    [baseModelColumns, providerNameByModel, hiddenProviderSet]
  );

  const dataset = useMemo(() => {
    if (!xMetric || !yMetric) {
      return {
        points: [],
        paretoKeys: new Set<string>(),
        paretoPath: [],
        trendLine: null,
        missingCount: 0,
        nonPositiveCount: 0
      };
    }

    return buildScatterDataset({
      xMetric,
      yMetric,
      modelNames: plottableModelNames,
      providerNameByModel,
      colorByModel,
      xScale: effectiveXScale,
      yScale: effectiveYScale,
      xSnapshot: viewState.xSnapshot,
      ySnapshot: viewState.ySnapshot
    });
  }, [
    xMetric,
    yMetric,
    plottableModelNames,
    providerNameByModel,
    colorByModel,
    effectiveXScale,
    effectiveYScale,
    viewState.xSnapshot,
    viewState.ySnapshot
  ]);

  const snapshotOverlay = useMemo(() => {
    if (!viewState.overlaySnapshot || !xMetric || !yMetric) return null;
    return buildScatterSnapshotOverlayDataset({
      snapshotId: viewState.overlaySnapshot,
      xMetric,
      yMetric,
      modelNames: plottableModelNames,
      providerNameByModel,
      colorByModel,
      xScale: effectiveXScale,
      yScale: effectiveYScale
    });
  }, [
    viewState.overlaySnapshot,
    xMetric,
    yMetric,
    plottableModelNames,
    providerNameByModel,
    colorByModel,
    effectiveXScale,
    effectiveYScale
  ]);

  const historicalPoints = useMemo<ScatterHistoricalPoint[]>(() => {
    if (!xMetric || !yMetric) return [];

    return historySelections.flatMap((selection) => {
      const current = dataset.points.find((point) => point.modelName === selection.modelName);
      if (!current) return [];

      const result = resolveScatterHistoricalPoint({
        current,
        mode: selection.mode,
        xMetric,
        yMetric,
        xScale: effectiveXScale,
        yScale: effectiveYScale
      });
      return result.status === "ok" ? [result.point] : [];
    });
  }, [dataset.points, historySelections, xMetric, yMetric, effectiveXScale, effectiveYScale]);

  useEffect(() => {
    if (historySelections.length === 0) return;
    if (!xMetric || !yMetric) {
      enqueueStateUpdate(() => setHistorySelections([]));
      return;
    }

    const validSelections = historySelections.filter((selection) => {
      const current = dataset.points.find((point) => point.modelName === selection.modelName);
      if (!current) return false;

      return resolveScatterHistoricalPoint({
        current,
        mode: selection.mode,
        xMetric,
        yMetric,
        xScale: effectiveXScale,
        yScale: effectiveYScale
      }).status === "ok";
    });

    if (validSelections.length !== historySelections.length) {
      enqueueStateUpdate(() => setHistorySelections(validSelections));
    }
  }, [dataset.points, historySelections, xMetric, yMetric, effectiveXScale, effectiveYScale]);

  useEffect(() => {
    if (!historyNotice) return;
    const timer = window.setTimeout(() => setHistoryNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [historyNotice]);

  // 数据集一变就清空视口覆盖，避免沿用上一组轴/筛选下的可见点
  if (dataset.points !== syncedDatasetPoints) {
    setSyncedDatasetPoints(dataset.points);
    setVisibleScatterPoints(dataset.points);
  }

  const legendEntries = useMemo(() => {
    if (!xMetric || !yMetric) return [];

    const countByProvider = new Map<
      string,
      { color: string; candidateCount: number; defaultCount: number }
    >();

    baseModelColumns.forEach((modelName) => {
      const providerName = providerNameByModel.get(modelName);
      if (!providerName) return;

      const x = xMetric.valueByModel.get(modelName);
      const y = yMetric.valueByModel.get(modelName);
      const isPlottable =
        x !== undefined &&
        y !== undefined &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        (effectiveXScale !== "log" || x > 0) &&
        (effectiveYScale !== "log" || y > 0);

      const existing = countByProvider.get(providerName);
      if (existing) {
        existing.candidateCount += 1;
        if (isPlottable) existing.defaultCount += 1;
        return;
      }

      countByProvider.set(providerName, {
        color: colorByModel.get(modelName) ?? "#5da7ff",
        candidateCount: 1,
        defaultCount: isPlottable ? 1 : 0
      });
    });

    const visibleCountByProvider = new Map<string, number>();
    visibleScatterPoints.forEach((point) => {
      visibleCountByProvider.set(
        point.providerName,
        (visibleCountByProvider.get(point.providerName) ?? 0) + 1
      );
    });

    return Array.from(countByProvider.entries())
      .filter(([, meta]) => meta.defaultCount > 0)
      .map(([providerName, meta]) => ({
        providerName,
        color: meta.color,
        count: visibleCountByProvider.get(providerName) ?? 0,
        candidateCount: meta.candidateCount
      }))
      .sort(
        (left, right) =>
          right.candidateCount - left.candidateCount || left.providerName.localeCompare(right.providerName)
      );
  }, [
    baseModelColumns,
    providerNameByModel,
    colorByModel,
    xMetric,
    yMetric,
    effectiveXScale,
    effectiveYScale,
    visibleScatterPoints
  ]);

  const availableExportPresetKeys = useMemo<ExportPresetKey[]>(
    () =>
      (Object.keys(EXPORT_PRESET_MAP) as ExportPresetKey[]).filter((key) => {
        const { mimeType } = EXPORT_PRESET_MAP[key];
        if (mimeType === "image/webp" && !supportsWebpExport) return false;
        if (mimeType === "image/avif" && !supportsAvifExport) return false;
        return true;
      }),
    [supportsWebpExport, supportsAvifExport]
  );

  // 浏览器不支持所选格式时回落到可用项，避免下拉里留着一个必然失败的选择
  useEffect(() => {
    if (availableExportPresetKeys.includes(exportPreset)) return;

    const fallback = availableExportPresetKeys.includes(DEFAULT_EXPORT_PRESET)
      ? DEFAULT_EXPORT_PRESET
      : availableExportPresetKeys[0];

    if (fallback) {
      enqueueStateUpdate(() => setExportPreset(fallback));
    }
  }, [availableExportPresetKeys, exportPreset]);

  const { downloadImage, copyImage, isDownloading, isCopying, isBusy, notice, setNotice } =
    useScatterImageActions(includeLegendInExport ? captureRef : chartCaptureRef, exportPreset);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  /**
   * 关闭「含低覆盖指标」时，若当前轴本身就是低覆盖指标，散点会被清空但轴保留。
   * 这里给出提示，避免用户以为图坏了。
   */
  const handleToggleLowCoverageRows = useCallback(
    (next: boolean) => {
      setShowLowCoverageRows(next);
      if (next) return;

      const hiddenAxes = (["x", "y"] as const).filter((axis) => {
        const key = axis === "x" ? viewState.xKey : viewState.yKey;
        if (!key) return false;
        return !defaultViewMetricKeys.has(key);
      });
      if (hiddenAxes.length === 0) return;

      const axisNames = hiddenAxes.map((axis) => (axis === "x" ? "X 轴" : "Y 轴")).join("、");
      setNotice({
        type: "success",
        message: `已关闭低覆盖指标：${axisNames}的低覆盖数据已隐藏，重新勾选即可恢复`
      });
    },
    [defaultViewMetricKeys, setNotice, setShowLowCoverageRows, viewState.xKey, viewState.yKey]
  );

  const handleChangeAxis = useCallback(
    (axis: "x" | "y", key: string, snapshotId?: string | null) => {
      // 下拉里是全量指标，可能包含当前开关未纳入绘制的低覆盖指标
      const metric = findScatterMetric(allMetrics, key);

      // 切换后的轴模式决定读取哪一份开关记忆：任一轴为 Overall 走 overall，否则走 other
      const nextXKey = axis === "x" ? key : viewState.xKey;
      const nextYKey = axis === "y" ? key : viewState.yKey;
      const nextMode: "overall" | "other" =
        nextXKey === OVERALL_METRIC_SLUG || nextYKey === OVERALL_METRIC_SLUG
          ? "overall"
          : "other";

      // 选中低覆盖指标时，不纳入低覆盖行就无法绘制：把目标模式的记忆改为开启。
      // 其余情况交给模式记忆：离开 Overall 自动恢复 other 偏好，切到 Overall 恢复 overall 偏好。
      const selectsLowCoverageMetric = Boolean(
        metric && metric.kind !== "overall" && !defaultViewMetricKeys.has(metric.key)
      );
      if (selectsLowCoverageMetric) applyLowCoveragePref(nextMode, true);

      const nextIncludesLowCoverage = selectsLowCoverageMetric
        ? true
        : nextMode === "overall"
          ? lowCoveragePrefs.overall
          : lowCoveragePrefs.other;

      // 切到 Overall 会按 overall 记忆关掉低覆盖，另一轴的低覆盖数据会随之隐藏，这里提前提示
      if (nextMode === "overall" && !nextIncludesLowCoverage) {
        const otherAxis = axis === "x" ? "y" : "x";
        const otherKey = otherAxis === "x" ? viewState.xKey : viewState.yKey;
        if (otherKey && !defaultViewMetricKeys.has(otherKey)) {
          const axisName = otherAxis === "x" ? "X 轴" : "Y 轴";
          setNotice({
            type: "success",
            message: `已切换到 Overall 视图：${axisName}的低覆盖数据已隐藏，重新勾选即可恢复`
          });
        }
      }

      setHistorySelections([]);
      setViewState((prev) => {
        const otherKey = axis === "x" ? prev.yKey : prev.xKey;
        const otherMetric = otherKey ? findScatterMetric(allMetrics, otherKey) : null;
        const retainsOverlay = Boolean(
          prev.overlaySnapshot &&
            (metric?.snapshots.some((s) => s.id === prev.overlaySnapshot) ||
              otherMetric?.snapshots.some((s) => s.id === prev.overlaySnapshot))
        );

        return {
          ...prev,
          [axis === "x" ? "xKey" : "yKey"]: key,
          [axis === "x" ? "xSnapshot" : "ySnapshot"]: snapshotId ?? null,
          overlaySnapshot: retainsOverlay ? prev.overlaySnapshot : null,
          // 换轴时按新指标的量纲重设刻度：价格/参数量自动切对数
          [axis === "x" ? "xScale" : "yScale"]: (metric?.preferLogScale ? "log" : "linear") as ScatterAxisScale
        };
      });
    },
    [
      allMetrics,
      applyLowCoveragePref,
      defaultViewMetricKeys,
      lowCoveragePrefs.overall,
      lowCoveragePrefs.other,
      setNotice,
      viewState.xKey,
      viewState.yKey
    ]
  );

  const handleSwapAxes = useCallback(() => {
    setHistorySelections([]);
    setViewState((prev) => ({
      ...prev,
      xKey: prev.yKey,
      yKey: prev.xKey,
      xSnapshot: prev.ySnapshot,
      ySnapshot: prev.xSnapshot,
      xScale: prev.yScale,
      yScale: prev.xScale
    }));
  }, []);

  const handleToggleOverlaySnapshot = useCallback((snapshotId: string) => {
    setViewState((prev) => ({
      ...prev,
      overlaySnapshot: prev.overlaySnapshot === snapshotId ? null : snapshotId
    }));
  }, []);

  const handleClearSnapshot = useCallback((axis: "x" | "y") => {
    setViewState((prev) => ({
      ...prev,
      [axis === "x" ? "xSnapshot" : "ySnapshot"]: null
    }));
  }, []);

  const handleClearOverlaySnapshot = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      overlaySnapshot: null
    }));
  }, []);

  const handleChangeScale = useCallback((axis: "x" | "y", scale: ScatterAxisScale) => {
    const targetMetric = axis === "x" ? xMetric : yMetric;
    if (targetMetric?.unit === "date" && scale === "log") return;
    setViewState((prev) => ({ ...prev, [axis === "x" ? "xScale" : "yScale"]: scale }));
  }, [xMetric, yMetric]);

  const toggleProviderVisibility = useCallback((providerName: string) => {
    setHiddenProviders((prev) => {
      const willHide = !prev.includes(providerName);
      // 刚被隐藏的厂商不该继续作为悬浮目标，否则图上会一片全暗
      if (willHide) setHoveredProvider((current) => (current === providerName ? null : current));

      return willHide ? [...prev, providerName] : prev.filter((item) => item !== providerName);
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
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
  }, []);

  const handleToggleHistory = useCallback(
    (modelName: string) => {
      if (!xMetric || !yMetric) return;

      const current = dataset.points.find((point) => point.modelName === modelName);
      if (!current) return;

      const currentSelection = historySelections.find((selection) => selection.modelName === modelName) ?? null;
      const nextMode = nextScatterHistoryMode(currentSelection, modelName);
      if (!nextMode) {
        setHistorySelections((previous) =>
          previous.filter((selection) => selection.modelName !== modelName)
        );
        setHistoryNotice(null);
        return;
      }

      const result = resolveScatterHistoricalPoint({
        current,
        mode: nextMode,
        xMetric,
        yMetric,
        xScale: effectiveXScale,
        yScale: effectiveYScale
      });

      if (result.status !== "ok") {
        setHistoryNotice(describeScatterHistoryUnavailable(result.reason));
        setHistorySelections((previous) =>
          previous.filter((selection) => selection.modelName !== modelName)
        );
        return;
      }

      setHistorySelections((previous) => [
        ...previous.filter((selection) => selection.modelName !== modelName),
        { modelName, mode: nextMode }
      ]);
      setHistoryNotice(null);
    },
    [dataset.points, historySelections, xMetric, yMetric, effectiveXScale, effectiveYScale]
  );

  const paretoCount = dataset.points.filter((point) => point.isPareto).length;
  const hasAxes = Boolean(xMetric && yMetric);
  const hasEnoughPoints = dataset.points.length >= 1;
  const overlayMode: ScatterOverlayMode =
    xMetric &&
    yMetric &&
    effectiveXScale === "linear" &&
    effectiveYScale === "linear" &&
    xMetric.higherIsBetter === yMetric.higherIsBetter
      ? "trend"
      : "pareto";

  return (
    <section
      className={`scatter-page ${isFullscreen ? "is-fullscreen" : ""}`}
      aria-label="模型二维分析"
      ref={sectionRef}
    >
      <div className="card scatter-card">
        <ScatterControls
          metricGroups={metricGroups}
          primaryMetricKeys={primaryMetricKeys}
          xMetric={xMetric}
          yMetric={yMetric}
          xSnapshot={viewState.xSnapshot}
          ySnapshot={viewState.ySnapshot}
          overlaySnapshot={viewState.overlaySnapshot}
          onChangeAxis={handleChangeAxis}
          onToggleOverlaySnapshot={handleToggleOverlaySnapshot}
          onSwapAxes={handleSwapAxes}
          xScale={effectiveXScale}
          yScale={effectiveYScale}
          onChangeScale={handleChangeScale}
          showPareto={viewState.showPareto}
          onChangeShowPareto={(value) => setViewState((prev) => ({ ...prev, showPareto: value }))}
          overlayMode={overlayMode}
          dimNonPareto={viewState.dimNonPareto}
          onChangeDimNonPareto={(value) => setViewState((prev) => ({ ...prev, dimNonPareto: value }))}
          paretoLineStyle={viewState.paretoLineStyle}
          onChangeParetoLineStyle={(value) => setViewState((prev) => ({ ...prev, paretoLineStyle: value }))}
          labelMode={viewState.labelMode}
          onChangeLabelMode={(value) => setViewState((prev) => ({ ...prev, labelMode: value }))}
          showGuides={viewState.showGuides}
          onChangeShowGuides={(value) => setViewState((prev) => ({ ...prev, showGuides: value }))}
          sourceOptions={sourceOptions}
          activeSource={activeSource}
          onChangeSource={(key) => {
            setHistorySelections([]);
            setViewState((prev) => ({ ...prev, activeSource: key }));
          }}
          exportPreset={exportPreset}
          onChangeExportPreset={setExportPreset}
          availableExportPresetKeys={availableExportPresetKeys}
          includeLegendInExport={includeLegendInExport}
          onChangeIncludeLegendInExport={setIncludeLegendInExport}
          onDownloadImage={downloadImage}
          onCopyImage={copyImage}
          isDownloading={isDownloading}
          isCopying={isCopying}
          isExportBusy={isBusy}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />

        <div className="scatter-capture" ref={captureRef}>
          <div className="scatter-chart-capture" ref={chartCaptureRef}>
            {hasAxes && hasEnoughPoints ? (
              <ScatterChartHost height={chartHeight}>
                {({ width, height }) => (
                  <ScatterCanvas
                    width={width}
                    height={height}
                    xMetric={xMetric!}
                    yMetric={yMetric!}
                    dataset={dataset}
                    snapshotOverlay={snapshotOverlay}
                    xScale={effectiveXScale}
                    yScale={effectiveYScale}
                    showPareto={viewState.showPareto}
                    overlayMode={overlayMode}
                    dimNonPareto={viewState.dimNonPareto}
                    paretoLineStyle={viewState.paretoLineStyle}
                    labelMode={viewState.labelMode}
                    showGuides={viewState.showGuides}
                    highlightedModel={highlightedModel}
                    historicalPoints={historicalPoints}
                    hoveredProvider={hoveredProvider}
                    onSelectModel={(modelName) =>
                      setHighlightedModel((prev) =>
                        modelName === null ? null : prev === modelName ? null : modelName
                      )
                    }
                    onToggleHistory={handleToggleHistory}
                    onVisiblePointsChange={setVisibleScatterPoints}
                  />
                )}
              </ScatterChartHost>
            ) : (
              <div className="scatter-empty" style={{ height: chartHeight }}>
                <p className="scatter-empty-title">当前条件下没有可绘制的点</p>
                <p className="scatter-empty-hint">
                  换一组坐标轴、在图例中放开被隐藏的厂商，或切换数据来源后再试。
                </p>
              </div>
            )}
          </div>

          {legendEntries.length > 0 ? (
            <div className="scatter-legend" role="group" aria-label="按厂商筛选">
              {legendEntries.map((entry) => {
                const isHidden = hiddenProviderSet.has(entry.providerName);
                return (
                  <button
                    key={entry.providerName}
                    type="button"
                    className={`scatter-btn scatter-legend-item ${isHidden ? "is-hidden" : ""} ${
                      hoveredProvider === entry.providerName ? "is-hovered" : ""
                    }`}
                    onClick={() => toggleProviderVisibility(entry.providerName)}
                    // 已隐藏的厂商图上没有点，悬浮它不该把其余厂商全压暗
                    onMouseEnter={() => setHoveredProvider(isHidden ? null : entry.providerName)}
                    onMouseLeave={() => setHoveredProvider(null)}
                    onFocus={() => setHoveredProvider(isHidden ? null : entry.providerName)}
                    onBlur={() => setHoveredProvider(null)}
                    title={isHidden ? "点击显示该厂商" : "点击隐藏该厂商"}
                  >
                    <span className="scatter-legend-swatch" style={{ backgroundColor: entry.color }} />
                    <span className="scatter-legend-name">{entry.providerName}</span>
                    <span className="scatter-legend-count">{entry.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="scatter-notes">
          <span className="scatter-note scatter-note-stat">
            可比模型 <b>{dataset.points.length}</b>
            <span className="scatter-note-dim">/ {baseModelColumns.length}</span>
          </span>
          {overlayMode === "pareto" && viewState.showPareto ? (
            <span className="scatter-note scatter-note-pareto">
              帕累托前沿 <b>{paretoCount}</b>
            </span>
          ) : null}
          {dataset.missingCount > 0 ? (
            <span className="scatter-note">{dataset.missingCount} 个模型缺少当前双轴数据，未绘制</span>
          ) : null}
          {dataset.nonPositiveCount > 0 ? (
            <span className="scatter-note scatter-note-warn">
              {dataset.nonPositiveCount} 个模型数值为 0 或负数，对数刻度下无法绘制
            </span>
          ) : null}
          {highlightedModel ? (
            <button
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              onClick={() => setHighlightedModel(null)}
            >
              已钉住 {highlightedModel} · 点击取消
            </button>
          ) : null}
          {historicalPoints.map((historicalPoint) => (
            <button
              key={historicalPoint.modelName}
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              onClick={() =>
                setHistorySelections((previous) =>
                  previous.filter((selection) => selection.modelName !== historicalPoint.modelName)
                )
              }
            >
              {historicalPoint.modelName} · {formatScatterHistoryModeLabel(historicalPoint.mode)} ·{" "}
              {formatScatterHistoryDate(historicalPoint.xBenchTime)} · 点击取消
            </button>
          ))}
          {viewState.ySnapshot ? (
            <button
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              style={{ borderLeft: "2px solid #5da7ff" }}
              onClick={() => handleClearSnapshot("y")}
              title="点击恢复最新成绩"
            >
              Y 轴快照: {yMetric?.snapshots.find((s) => s.id === viewState.ySnapshot)?.label ?? viewState.ySnapshot.slice(0, 10)} · 点击恢复最新
            </button>
          ) : null}
          {viewState.xSnapshot ? (
            <button
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              style={{ borderLeft: "2px solid #5da7ff" }}
              onClick={() => handleClearSnapshot("x")}
              title="点击恢复最新成绩"
            >
              X 轴快照: {xMetric?.snapshots.find((s) => s.id === viewState.xSnapshot)?.label ?? viewState.xSnapshot.slice(0, 10)} · 点击恢复最新
            </button>
          ) : null}
          {viewState.overlaySnapshot ? (
            <button
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              style={{ borderLeft: "2px solid #f59e0b", color: "#fbbf24" }}
              onClick={handleClearOverlaySnapshot}
              title="点击清除半透明背景叠加"
            >
              对比背景: {snapshotOverlay?.snapshotLabel ?? viewState.overlaySnapshot.slice(0, 10)} · 点击取消叠加
            </button>
          ) : null}
          {historyNotice ? (
            <span className="scatter-note scatter-note-warn">{historyNotice}</span>
          ) : null}
          {/* <span className="scatter-note scatter-note-hint">拖拽平移 · 滚轮以光标为中心放大 · 双击重置</span> */}
          {activeSource === SOURCE_ALL ? (
            <label
              className="scatter-note scatter-note-toggle"
              title="控制低覆盖 benchmark 是否纳入坐标轴、模型列与总评；Overall 与其他指标分别记忆开关状态"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={showLowCoverageRows}
                onChange={(event) => handleToggleLowCoverageRows(event.target.checked)}
              />
              含低覆盖指标
            </label>
          ) : null}
          {notice ? (
            <span className={`scatter-note ${notice.type === "error" ? "scatter-note-warn" : "scatter-note-ok"}`}>
              {notice.message}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
