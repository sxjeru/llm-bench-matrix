"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EXPORT_PRESET,
  EXPORT_PRESET_MAP,
  PARAMS_ROWS_IN_OVERALL_STORAGE_KEY,
  PRICE_ROWS_IN_OVERALL_STORAGE_KEY,
  SOURCE_ALL
} from "@/components/benchmark-matrix/constants";
import { canEncodeCanvasMimeType } from "@/components/benchmark-matrix/export-image";
import {
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
  buildProviderGroups,
  buildRowsBySource,
  buildRowsWithSourceMeta,
  buildSourceOptions,
  resolveBaseSourceRows
} from "@/components/benchmark-matrix/selectors";
import type { ExportPresetKey } from "@/components/benchmark-matrix/types";
import { normalizeMatchToken, sourceTabDisplayLabel, enqueueStateUpdate } from "@/components/benchmark-matrix/utils";
import { resolveProviderBrandColorForDarkTheme } from "@/lib/provider-config";
import { ScatterChartHost } from "./model-scatter/chart-host";
import {
  SCATTER_ALWAYS_VISIBLE_BENCHMARK_TYPES,
  SCATTER_CHART_COMPACT_BREAKPOINT,
  SCATTER_CHART_FULLSCREEN_CHROME,
  SCATTER_CHART_HEIGHT,
  SCATTER_CHART_HEIGHT_COMPACT,
  SCATTER_CHART_MIN_HEIGHT
} from "./model-scatter/constants";
import { ScatterControls } from "./model-scatter/controls";
import { buildScatterDataset } from "./model-scatter/dataset";
import { useScatterImageActions } from "./model-scatter/image-actions";
import {
  buildScatterMetrics,
  filterMatrixRowsForScatterOverall,
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
import type { ModelScatterProps, ScatterAxisScale, ScatterOverlayMode } from "./model-scatter/types";

/** 散点图不做重复行拆分：合并同名 benchmark 才能得到干净的轴列表。 */
const SHOW_DUPLICATE_ROWS = false;

function readStoredBoolean(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function ModelScatter({
  rows,
  allRows: allRowsProp,
  sourceOptions: sourceOptionsProp = [],
  modelPrices = [],
  modelParams = []
}: ModelScatterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const allRows = useMemo(() => allRowsProp ?? rows, [allRowsProp, rows]);

  const [viewState, setViewState] = useState<ScatterViewState>(DEFAULT_SCATTER_VIEW_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [showLowCoverageRows, setShowLowCoverageRows] = useState(false);
  const [hiddenProviders, setHiddenProviders] = useState<string[]>([]);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [highlightedModel, setHighlightedModel] = useState<string | null>(null);
  const [exportPreset, setExportPreset] = useState<ExportPresetKey>(DEFAULT_EXPORT_PRESET);
  const [supportsWebpExport, setSupportsWebpExport] = useState(true);
  const [supportsAvifExport, setSupportsAvifExport] = useState(false);
  const [chartHeight, setChartHeight] = useState(SCATTER_CHART_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [resetZoomSignal, setResetZoomSignal] = useState(0);
  // 与矩阵页共用的「合成行是否计入总评」开关，保证两页 Overall Score 对得上
  const [priceRowsInOverall, setPriceRowsInOverall] = useState(false);
  const [paramsRowsInOverall, setParamsRowsInOverall] = useState(false);

  const hydratedRef = useRef(false);
  const searchParamsRef = useRef(searchParams);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  // 首帧统一水合：localStorage 提供基线，URL 参数覆盖其上，分享链接因此永远优先
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    setViewState((prev) => ({
      ...prev,
      ...loadScatterPreferences(),
      ...parseScatterSearchParams(searchParams)
    }));
    setPriceRowsInOverall(readStoredBoolean(PRICE_ROWS_IN_OVERALL_STORAGE_KEY));
    setParamsRowsInOverall(readStoredBoolean(PARAMS_ROWS_IN_OVERALL_STORAGE_KEY));

    // 用 state 而非 ref 放行 URL 同步：ref 会在同一轮 effect 里就被置真，
    // 导致同步逻辑拿着尚未水合的默认状态把链接里的参数冲掉
    setIsHydrated(true);
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

  const scopedRowsBySource = useMemo(() => buildRowsBySource(rows), [rows]);
  const allRowsBySource = useMemo(() => buildRowsBySource(allRows), [allRows]);
  const allRowsWithSourceMeta = useMemo(() => buildRowsWithSourceMeta(allRows), [allRows]);

  const indexedSourceRows = useMemo(
    () => (activeSource === SOURCE_ALL ? allRows : allRowsWithSourceMeta),
    [activeSource, allRows, allRowsWithSourceMeta]
  );

  const allRowsIndex = useMemo(
    () => buildAllRowsIndex(indexedSourceRows, SHOW_DUPLICATE_ROWS),
    [indexedSourceRows]
  );

  const baseSourceRows = useMemo(
    () => resolveBaseSourceRows(allRows, rows, scopedRowsBySource, allRowsBySource, activeSource, SHOW_DUPLICATE_ROWS),
    [allRows, rows, scopedRowsBySource, allRowsBySource, activeSource]
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

  const coveragePrunedRows = useMemo(
    () =>
      buildCoveragePrunedRows(activeSource, filteredRows, SHOW_DUPLICATE_ROWS, showLowCoverageRows, {
        // Cost / Performance 作为散点常用轴，始终保留在下拉里
        alwaysKeepBenchmarkTypes: SCATTER_ALWAYS_VISIBLE_BENCHMARK_TYPES
      }),
    [activeSource, filteredRows, showLowCoverageRows]
  );

  const baseModelColumns = useMemo(
    () => buildModelColumns(coveragePrunedRows, sourceModelHint, null, SHOW_DUPLICATE_ROWS, {}, activeSource),
    [coveragePrunedRows, sourceModelHint, activeSource]
  );

  const matrixRows = useMemo(
    () => buildMatrixRows(baseSourceRows, coveragePrunedRows, SHOW_DUPLICATE_ROWS, false, activeSource),
    [baseSourceRows, coveragePrunedRows, activeSource]
  );

  const priceMatrixRows = useMemo(
    () => (modelPrices.length > 0 ? buildPriceMatrixRows(baseModelColumns, modelPrices) : []),
    [baseModelColumns, modelPrices]
  );

  const paramsMatrixRows = useMemo(
    () => (modelParams.length > 0 ? buildParamsMatrixRows(baseModelColumns, modelParams) : []),
    [baseModelColumns, modelParams]
  );

  // 轴下拉可保留 alwaysKeep 的 Cost；Overall 在未勾选低覆盖时剔除 Cost
  const summaryMatrixRows = useMemo(
    () => [
      ...(paramsRowsInOverall ? paramsMatrixRows : []),
      ...(priceRowsInOverall ? priceMatrixRows : []),
      ...filterMatrixRowsForScatterOverall(matrixRows, showLowCoverageRows, activeSource)
    ],
    [
      paramsRowsInOverall,
      paramsMatrixRows,
      priceRowsInOverall,
      priceMatrixRows,
      matrixRows,
      showLowCoverageRows,
      activeSource
    ]
  );

  const overallSummaryByModel = useMemo(
    () => buildOverallSummaryByModel(summaryMatrixRows, baseModelColumns),
    [summaryMatrixRows, baseModelColumns]
  );

  const overallScoreByModel = useMemo(() => {
    const scoreMap = new Map<string, number | null>();
    overallSummaryByModel.forEach((summary, modelName) => {
      scoreMap.set(modelName, summary.rawScore);
    });
    return scoreMap;
  }, [overallSummaryByModel]);

  const metrics = useMemo(
    () =>
      buildScatterMetrics({
        benchmarkRows: matrixRows,
        priceRows: priceMatrixRows,
        paramsRows: paramsMatrixRows,
        overallScoreByModel
      }),
    [matrixRows, priceMatrixRows, paramsMatrixRows, overallScoreByModel]
  );

  const metricGroups = useMemo(() => groupScatterMetrics(metrics), [metrics]);

  // 存档或链接里的轴失效时回落到默认，并顺带套用该指标建议的刻度
  useEffect(() => {
    if (metrics.length === 0) return;

    enqueueStateUpdate(() => {
      setViewState((prev) => {
        const hasX = Boolean(prev.xKey) && metrics.some((metric) => metric.key === prev.xKey);
        const hasY = Boolean(prev.yKey) && metrics.some((metric) => metric.key === prev.yKey);
        if (hasX && hasY) return prev;

        const defaults = resolveDefaultAxisKeys(metrics);
        const nextXKey = hasX ? prev.xKey : defaults.xKey;
        const nextYKey = hasY ? prev.yKey : defaults.yKey;
        const nextXMetric = findScatterMetric(metrics, nextXKey);
        const nextYMetric = findScatterMetric(metrics, nextYKey);

        return {
          ...prev,
          xKey: nextXKey,
          yKey: nextYKey,
          xScale: hasX ? prev.xScale : nextXMetric?.preferLogScale ? "log" : "linear",
          yScale: hasY ? prev.yScale : nextYMetric?.preferLogScale ? "log" : "linear"
        };
      });
    });
  }, [metrics]);

  useEffect(() => {
    if (!isHydrated) return;

    saveScatterPreferences(viewState);

    const query = buildScatterSearchParams(viewState, searchParamsRef.current);
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;

    router.replace(nextUrl, { scroll: false });
  }, [viewState, isHydrated, pathname, router]);

  const xMetric = useMemo(() => findScatterMetric(metrics, viewState.xKey), [metrics, viewState.xKey]);
  const yMetric = useMemo(() => findScatterMetric(metrics, viewState.yKey), [metrics, viewState.yKey]);

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
      xScale: viewState.xScale,
      yScale: viewState.yScale
    });
  }, [xMetric, yMetric, plottableModelNames, providerNameByModel, colorByModel, viewState.xScale, viewState.yScale]);

  const legendEntries = useMemo(() => {
    const countByProvider = new Map<string, { color: string; count: number }>();

    baseModelColumns.forEach((modelName) => {
      const providerName = providerNameByModel.get(modelName);
      if (!providerName) return;

      const existing = countByProvider.get(providerName);
      if (existing) {
        existing.count += 1;
        return;
      }

      countByProvider.set(providerName, {
        color: colorByModel.get(modelName) ?? "#5da7ff",
        count: 1
      });
    });

    return Array.from(countByProvider.entries())
      .map(([providerName, meta]) => ({ providerName, ...meta }))
      .sort((left, right) => right.count - left.count || left.providerName.localeCompare(right.providerName));
  }, [baseModelColumns, providerNameByModel, colorByModel]);

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
    useScatterImageActions(captureRef, exportPreset);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  const handleChangeAxis = useCallback(
    (axis: "x" | "y", key: string) => {
      const metric = findScatterMetric(metrics, key);
      setViewState((prev) => ({
        ...prev,
        [axis === "x" ? "xKey" : "yKey"]: key,
        // 换轴时按新指标的量纲重设刻度：价格/参数量自动切对数
        [axis === "x" ? "xScale" : "yScale"]: (metric?.preferLogScale ? "log" : "linear") as ScatterAxisScale
      }));
    },
    [metrics]
  );

  const handleSwapAxes = useCallback(() => {
    setViewState((prev) => ({
      ...prev,
      xKey: prev.yKey,
      yKey: prev.xKey,
      xScale: prev.yScale,
      yScale: prev.xScale
    }));
  }, []);

  const handleChangeScale = useCallback((axis: "x" | "y", scale: ScatterAxisScale) => {
    setViewState((prev) => ({ ...prev, [axis === "x" ? "xScale" : "yScale"]: scale }));
  }, []);

  const toggleProviderVisibility = useCallback((providerName: string) => {
    setHiddenProviders((prev) => {
      const willHide = !prev.includes(providerName);
      // 刚被隐藏的厂商不该继续作为悬浮目标，否则图上会一片全暗
      if (willHide) setHoveredProvider((current) => (current === providerName ? null : current));

      return willHide ? [...prev, providerName] : prev.filter((item) => item !== providerName);
    });
  }, []);

  /**
   * 轴选择器里一开始输入，就顺带放开低覆盖指标。
   *
   * 低覆盖指标默认被剪掉，用户搜一个名字却搜不到会以为数据不存在；
   * 这里主动打开开关，说明行里的复选框也会同步勾上，改动是可见、可撤销的。
   */
  const handleAxisQueryChange = useCallback((query: string) => {
    if (query.trim().length === 0) return;
    setShowLowCoverageRows((previous) => (previous ? previous : true));
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

  const paretoCount = dataset.points.filter((point) => point.isPareto).length;
  const hasAxes = Boolean(xMetric && yMetric);
  const hasEnoughPoints = dataset.points.length >= 1;
  const overlayMode: ScatterOverlayMode =
    xMetric &&
    yMetric &&
    viewState.xScale === "linear" &&
    viewState.yScale === "linear" &&
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
          xMetric={xMetric}
          yMetric={yMetric}
          onChangeAxis={handleChangeAxis}
          onSwapAxes={handleSwapAxes}
          onAxisQueryChange={handleAxisQueryChange}
          xScale={viewState.xScale}
          yScale={viewState.yScale}
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
          onChangeSource={(key) => setViewState((prev) => ({ ...prev, activeSource: key }))}
          exportPreset={exportPreset}
          onChangeExportPreset={setExportPreset}
          availableExportPresetKeys={availableExportPresetKeys}
          onDownloadImage={downloadImage}
          onCopyImage={copyImage}
          isDownloading={isDownloading}
          isCopying={isCopying}
          isExportBusy={isBusy}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />

        <div className="scatter-capture" ref={captureRef}>
          {hasAxes && hasEnoughPoints ? (
            <ScatterChartHost height={chartHeight}>
              {({ width, height }) => (
                <ScatterCanvas
                  width={width}
                  height={height}
                  xMetric={xMetric!}
                  yMetric={yMetric!}
                  dataset={dataset}
                  xScale={viewState.xScale}
                  yScale={viewState.yScale}
                  showPareto={viewState.showPareto}
                  overlayMode={overlayMode}
                  dimNonPareto={viewState.dimNonPareto}
                  paretoLineStyle={viewState.paretoLineStyle}
                  labelMode={viewState.labelMode}
                  showGuides={viewState.showGuides}
                  highlightedModel={highlightedModel}
                  hoveredProvider={hoveredProvider}
                  onSelectModel={(modelName) =>
                    setHighlightedModel((prev) =>
                      modelName === null ? null : prev === modelName ? null : modelName
                    )
                  }
                  onZoomChange={setIsZoomed}
                  resetZoomSignal={resetZoomSignal}
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
          {/* {isZoomed ? (
            <button
              type="button"
              className="scatter-btn scatter-note scatter-note-action"
              onClick={() => setResetZoomSignal((prev) => prev + 1)}
            >
              已缩放 · 点击重置（或在图上双击）
            </button>
          ) : (
            <span className="scatter-note scatter-note-hint">拖拽平移 · 滚轮以光标为中心放大</span>
          )} */}
          {activeSource === SOURCE_ALL ? (
            <label className="scatter-note scatter-note-toggle">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={showLowCoverageRows}
                onChange={(event) => setShowLowCoverageRows(event.target.checked)}
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
