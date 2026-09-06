"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ScatterArrowLayer } from "./arrow-layer";
import { ScatterHistoryLayer, ScatterHistoryTooltip } from "./history-layer";
import {
  SCATTER_AXIS_STROKE,
  SCATTER_AXIS_TICK_COLOR,
  SCATTER_CHART_MARGIN,
  SCATTER_CURSOR_DASH,
  SCATTER_CURSOR_STROKE,
  SCATTER_CURSOR_WIDTH,
  SCATTER_DIMMED_OPACITY,
  SCATTER_DOT_RADIUS,
  SCATTER_DOT_RADIUS_PARETO,
  SCATTER_GRID_STROKE,
  SCATTER_LABEL_FONT_SIZE,
  SCATTER_LABEL_GAP,
  SCATTER_LABEL_STROKE,
  SCATTER_LABEL_STROKE_WIDTH,
  SCATTER_LABEL_STROKE_WIDTH_HIGHLIGHTED,
  SCATTER_WHEEL_ZOOM_STEP,
  SCATTER_X_AXIS_HEIGHT,
  SCATTER_Y_AXIS_WIDTH
} from "./constants";
import {
  clampPannedDomain,
  computeAxisDomain,
  computeMedian,
  isDomainZoomed,
  panAxisDomain,
  zoomAxisDomain
} from "./dataset";
import { isInWorstQuadrant, ScatterGuideLayer } from "./guide-layer";
import { getPlacedLabelBox, layoutScatterLabels } from "./label-layout";
import { formatScatterAxisTick, formatScatterValue, getMetricAxisLabel } from "./metrics";
import { computeParetoFrontier, orderParetoPath } from "./pareto";
import { ScatterParetoLayer } from "./pareto-layer";
import { ScatterTrendLineLayer } from "./trend-line-layer";
import {
  buildPointProjections,
  computePlotArea,
  pixelToAxisRatio,
  projectToPixel
} from "./projection";
import { ScatterTooltip } from "./scatter-tooltip";
import { buildAxisTicks } from "./ticks";
import { ScatterSnapshotOverlayLayer } from "./snapshot-overlay-layer";
import type {
  ScatterAxisScale,
  ScatterLabelCandidate,
  ScatterLabelMode,
  ScatterMetric,
  ScatterOverlayMode,
  ScatterOverlaySnapshotPoint,
  ScatterParetoLineStyle,
  ScatterPlacedLabel,
  ScatterPlotDataset,
  ScatterPoint,
  ScatterHistoricalPoint,
  ScatterSnapshotOverlayDataset
} from "./types";

export type ScatterCanvasProps = {
  width: number;
  height: number;
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  dataset: ScatterPlotDataset;
  snapshotOverlay?: ScatterSnapshotOverlayDataset | null;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  showPareto: boolean;
  overlayMode: ScatterOverlayMode;
  dimNonPareto: boolean;
  paretoLineStyle: ScatterParetoLineStyle;
  labelMode: ScatterLabelMode;
  showGuides: boolean;
  highlightedModel: string | null;
  historicalPoints?: readonly ScatterHistoricalPoint[];
  /** 图例上正在悬浮的厂商；其余厂商的点与标签会被淡化 */
  hoveredProvider?: string | null;
  /**
   * 点选散点时传入模型名；点选空白区域时传入 null 以取消钉住。
   * 拖拽平移不会触发。
   */
  onSelectModel?: (modelName: string | null) => void;
  onToggleHistory?: (modelName: string) => void;
  onZoomChange?: (isZoomed: boolean) => void;
  onVisiblePointsChange?: (points: readonly ScatterPoint[]) => void;
  /** 外部触发的重置计数，每次自增都会把缩放归位 */
  resetZoomSignal?: number;
};

type ScatterDotRenderProps = {
  cx?: number;
  cy?: number;
  payload?: ScatterPoint;
};

type ScatterClickEvent = {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

type ScatterClickPoint = {
  modelName?: string;
  payload?: {
    modelName?: string;
  };
};

type ScatterArrowAnnotation = {
  id: number;
  fromModelName: string;
  toModelName: string;
};

type ZoomState = {
  key: string;
  x: [number, number];
  y: [number, number];
};

type PanSession = {
  pointerId: number;
  lastX: number;
  lastY: number;
  /** 自按下起累计位移；未过阈值前只是待定，不 capture、不改光标 */
  travelled: number;
  /** 是否已进入真正的平移（过阈值后才 true） */
  active: boolean;
};

/** 位移超过这个像素数才算拖拽；更小的移动仍视为点击钉住 */
const PAN_CLICK_SUPPRESS_THRESHOLD = 4;

/**
 * 标签放置优先级。
 *
 * 钉住的模型必须有名字；其次是前沿点 —— 它们是这张图的结论；
 * 剩下的按 Y 轴表现从好到差争抢剩余空间。
 */
function computeLabelPriority(
  point: ScatterPoint,
  yRank: number,
  totalPoints: number,
  highlightedModel: string | null,
  showPareto: boolean
): number {
  const highlightBonus = point.modelName === highlightedModel ? 1_000_000 : 0;
  const paretoBonus = showPareto && point.isPareto ? 10_000 : 0;
  return highlightBonus + paretoBonus + (totalPoints - yRank);
}

/**
 * 二维散点图。
 *
 * 坐标轴、网格与命中检测交给 Recharts，帕累托线走自定义层
 * （与 `components/custom-boxplot-layer.tsx` 同一模式）。
 *
 * 模型名标签刻意画进 `<Scatter>` 的自定义 shape 里而不是单独一层：Recharts 把
 * `onMouseEnter/Leave` 挂在包裹 shape 的 `<Layer>` 上，标签待在里面就能和散点
 * 共享同一套命中区域，鼠标移到文字上照样出浮窗与十字光标。
 *
 * 标签布局是同步算出来的纯计算 —— 绘图区由固定的坐标轴尺寸推导，不依赖任何
 * 图表内部回传。这一点很关键：早先用「图表内探针回传布局」的写法会让
 * 回传→重渲染→再回传形成死循环，表现为卡顿、浮窗甩不掉、切换标签直接冻结。
 *
 * 宽高由外部显式传入，本组件不做任何测量。
 */
export function ScatterCanvas({
  width,
  height,
  xMetric,
  yMetric,
  dataset,
  snapshotOverlay = null,
  xScale,
  yScale,
  showPareto,
  overlayMode,
  dimNonPareto,
  paretoLineStyle,
  labelMode,
  showGuides,
  highlightedModel,
  historicalPoints = [],
  hoveredProvider = null,
  onSelectModel,
  onToggleHistory,
  onZoomChange,
  onVisiblePointsChange,
  resetZoomSignal = 0
}: ScatterCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const isPanningRef = useRef(false);
  const suppressClickRef = useRef(false);
  const nextArrowIdRef = useRef(1);
  // Recharts 会缓存旧的 onClick；用 ref 读起点，避免第二次 Ctrl 点击拿到过期闭包
  const arrowStartModelNameRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isTooltipDismissed, setIsTooltipDismissed] = useState(false);
  const [hiddenModelNames, setHiddenModelNames] = useState<Set<string>>(() => new Set());
  const [arrowStartModelName, setArrowStartModelName] = useState<string | null>(null);
  const [arrowAnnotations, setArrowAnnotations] = useState<ScatterArrowAnnotation[]>([]);
  const [hoveredHistoryModel, setHoveredHistoryModel] = useState<string | null>(null);
  const [hoveredOverlayPoint, setHoveredOverlayPoint] = useState<{
    point: ScatterOverlaySnapshotPoint;
    coords: { x: number; y: number };
  } | null>(null);

  const activeHiddenModelNames = useMemo(() => {
    const datasetModelNames = new Set(dataset.points.map((point) => point.modelName));
    return new Set([...hiddenModelNames].filter((modelName) => datasetModelNames.has(modelName)));
  }, [dataset.points, hiddenModelNames]);

  const activeDataset = useMemo<ScatterPlotDataset>(() => {
    if (activeHiddenModelNames.size === 0) return dataset;

    const activePoints = dataset.points.filter(
      (point) => !activeHiddenModelNames.has(point.modelName)
    );
    const paretoKeys = computeParetoFrontier(
      activePoints.map((point) => ({ key: point.modelName, x: point.x, y: point.y })),
      xMetric.higherIsBetter,
      yMetric.higherIsBetter
    );
    const points = dataset.points.map((point) => ({
      ...point,
      isPareto: paretoKeys.has(point.modelName)
    }));

    return {
      ...dataset,
      points,
      paretoKeys,
      paretoPath: orderParetoPath(
        points.filter((point) => point.isPareto),
        xMetric.higherIsBetter,
        yMetric.higherIsBetter
      )
    };
  }, [activeHiddenModelNames, dataset, xMetric.higherIsBetter, yMetric.higherIsBetter]);

  const xValues = useMemo(
    () => activeDataset.points.map((point) => point.x),
    [activeDataset.points]
  );
  const yValues = useMemo(
    () => activeDataset.points.map((point) => point.y),
    [activeDataset.points]
  );
  // 历史点只扩轴域，避免被裁切；中位线/参考线仍只看当前散点
  const domainXValues = useMemo(() => {
    let vals = xValues;
    if (historicalPoints.length > 0) {
      vals = [...vals, ...historicalPoints.map((point) => point.x)];
    }
    if (snapshotOverlay && snapshotOverlay.points.length > 0) {
      vals = [...vals, ...snapshotOverlay.points.map((point) => point.x)];
    }
    return vals;
  }, [xValues, historicalPoints, snapshotOverlay]);

  const domainYValues = useMemo(() => {
    let vals = yValues;
    if (historicalPoints.length > 0) {
      vals = [...vals, ...historicalPoints.map((point) => point.y)];
    }
    if (snapshotOverlay && snapshotOverlay.points.length > 0) {
      vals = [...vals, ...snapshotOverlay.points.map((point) => point.y)];
    }
    return vals;
  }, [yValues, historicalPoints, snapshotOverlay]);

  const baseXDomain = useMemo(() => computeAxisDomain(domainXValues, xScale), [domainXValues, xScale]);
  const baseYDomain = useMemo(() => computeAxisDomain(domainYValues, yScale), [domainYValues, yScale]);

  // 换轴、换刻度或数据变了就自动作废旧的缩放，不必再走一次 effect 清状态
  const domainKey = useMemo(
    () => `${xMetric.key}|${yMetric.key}|${xScale}|${yScale}|${baseXDomain.join()}|${baseYDomain.join()}|${resetZoomSignal}`,
    [xMetric.key, yMetric.key, xScale, yScale, baseXDomain, baseYDomain, resetZoomSignal]
  );

  const activeZoom = zoom && zoom.key === domainKey ? zoom : null;
  const xDomain = activeZoom?.x ?? baseXDomain;
  const yDomain = activeZoom?.y ?? baseYDomain;

  const isZoomed =
    activeZoom !== null &&
    (isDomainZoomed(xDomain, baseXDomain) || isDomainZoomed(yDomain, baseYDomain));

  useEffect(() => {
    onZoomChange?.(isZoomed);
  }, [isZoomed, onZoomChange]);

  const visiblePoints = useMemo(
    () =>
      activeDataset.points.filter(
        (point) =>
          !activeHiddenModelNames.has(point.modelName) &&
          point.x >= xDomain[0] &&
          point.x <= xDomain[1] &&
          point.y >= yDomain[0] &&
          point.y <= yDomain[1]
      ),
    [activeDataset.points, activeHiddenModelNames, xDomain, yDomain]
  );

  useEffect(() => {
    onVisiblePointsChange?.(visiblePoints);
  }, [onVisiblePointsChange, visiblePoints]);

  const plotArea = useMemo(
    () =>
      computePlotArea({
        width,
        height,
        margin: SCATTER_CHART_MARGIN,
        yAxisWidth: SCATTER_Y_AXIS_WIDTH,
        xAxisHeight: SCATTER_X_AXIS_HEIGHT
      }),
    [width, height]
  );

  const placedLabels = useMemo<ReadonlyMap<string, ScatterPlacedLabel>>(() => {
    if (labelMode === "none" || !plotArea) return new Map();

    const projections = buildPointProjections({
      points: activeDataset.points,
      xDomain,
      yDomain,
      xScale,
      yScale,
      plotArea
    });

    const rankedModels = [...activeDataset.points]
      .sort((left, right) => (yMetric.higherIsBetter ? right.y - left.y : left.y - right.y))
      .map((point) => point.modelName);
    const yRankByModel = new Map(rankedModels.map((modelName, index) => [modelName, index]));

    const candidates: ScatterLabelCandidate[] = [];
    const providerByModel = new Map<string, string>();

    activeDataset.points.forEach((point) => {
      const projection = projections.get(point.modelName);
      if (!projection) return;
      // 缩放后落在绘图区外的点不参与排版，免得标签飘到坐标轴上
      if (
        projection.cx < plotArea.left ||
        projection.cx > plotArea.right ||
        projection.cy < plotArea.top ||
        projection.cy > plotArea.bottom
      ) {
        return;
      }

      providerByModel.set(point.modelName, point.providerName);
      candidates.push({
        key: point.modelName,
        text: point.modelName,
        cx: projection.cx,
        cy: projection.cy,
        priority: computeLabelPriority(
          point,
          yRankByModel.get(point.modelName) ?? activeDataset.points.length,
          activeDataset.points.length,
          highlightedModel,
          overlayMode === "pareto" && showPareto
        )
      });
    });

    const layoutOptions = {
      fontSize: SCATTER_LABEL_FONT_SIZE,
      dotRadius: SCATTER_DOT_RADIUS,
      gap: SCATTER_LABEL_GAP,
      mode: labelMode
    };

    const labelByKey = new Map(
      layoutScatterLabels(candidates, plotArea, layoutOptions).map((label) => [label.key, label])
    );

    // 悬浮某个厂商时，它的标签一个都不能少。这批点已经被排到最上层、其余点也压暗了，
    // 所以这里允许它们压过别人的标签 —— 看清当前关注的那一组比避让更重要。
    if (hoveredProvider) {
      const missing = candidates.filter(
        (candidate) =>
          providerByModel.get(candidate.key) === hoveredProvider && !labelByKey.has(candidate.key)
      );

      if (missing.length > 0) {
        layoutScatterLabels(missing, plotArea, { ...layoutOptions, mode: "all" }).forEach((label) => {
          labelByKey.set(label.key, label);
        });
      }
    }

    return labelByKey;
  }, [
    activeDataset.points,
    plotArea,
    xDomain,
    yDomain,
    xScale,
    yScale,
    labelMode,
    highlightedModel,
    hoveredProvider,
    yMetric.higherIsBetter,
    overlayMode,
    showPareto
  ]);

  const xMedian = useMemo(() => (showGuides ? computeMedian(xValues) : null), [showGuides, xValues]);
  const yMedian = useMemo(() => (showGuides ? computeMedian(yValues) : null), [showGuides, yValues]);

  const highlightedPoint = useMemo(
    () =>
      highlightedModel
        ? (activeDataset.points.find((point) => point.modelName === highlightedModel) ?? null)
        : null,
      [activeDataset.points, highlightedModel]
  );

  // 钉住时十字与最优象限以该点为中心；取消钉住后回到全体中位
  const guideXCenter = highlightedPoint?.x ?? xMedian;
  const guideYCenter = highlightedPoint?.y ?? yMedian;
  const guideEmphasis = highlightedPoint ? "pinned" : "median";
  // 有钉住点就始终画十字；否则仍受「中位参考线」开关控制
  const shouldRenderGuides = Boolean(highlightedPoint) || (showGuides && (xMedian !== null || yMedian !== null));

  // 横向空间更宽，刻度可以多给两档；纵向密了会挤成一片
  const xTicks = useMemo(() => buildAxisTicks(xDomain, xScale, 8, xMetric.unit), [xDomain, xScale, xMetric.unit]);
  const yTicks = useMemo(() => buildAxisTicks(yDomain, yScale, 6, yMetric.unit), [yDomain, yScale, yMetric.unit]);
  // 滚轮缩放必须拿到非 passive 的监听才能 preventDefault，React 的 onWheel 做不到
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !plotArea) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;

      const rect = node.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const isInsidePlot =
        pointerX >= plotArea.left &&
        pointerX <= plotArea.right &&
        pointerY >= plotArea.top &&
        pointerY <= plotArea.bottom;
      if (!isInsidePlot) return;

      event.preventDefault();

      const factor = event.deltaY > 0 ? SCATTER_WHEEL_ZOOM_STEP : 1 / SCATTER_WHEEL_ZOOM_STEP;
      const xRatio = pixelToAxisRatio(pointerX, plotArea.left, plotArea.right);
      // 屏幕 y 向下增长、数据 y 向上增长，锚点比例要按底边→顶边来算
      const yRatio = pixelToAxisRatio(pointerY, plotArea.bottom, plotArea.top);

      setZoom((previous) => {
        const current = previous && previous.key === domainKey ? previous : null;

        return {
          key: domainKey,
          x: zoomAxisDomain(current?.x ?? baseXDomain, baseXDomain, xScale, xRatio, factor),
          y: zoomAxisDomain(current?.y ?? baseYDomain, baseYDomain, yScale, yRatio, factor)
        };
      });
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [domainKey, baseXDomain, baseYDomain, xScale, yScale, plotArea]);

  const shouldDim = overlayMode === "pareto" && showPareto && dimNonPareto;

  /**
   * 绘制顺序。
   *
   * SVG 没有 z-index，谁后画谁在上面。默认顺序下，被钉住的点很容易被后面的
   * 散点或标签盖住，所以这里按「钉住 > 悬浮厂商 > 前沿 > 其余」重排一遍，
   * 让当前最该被看清的点始终画在最上层。排序是稳定的，同组内相对次序不变。
   */
  const orderedPoints = useMemo(() => {
    if (!hoveredProvider && !highlightedModel) return activeDataset.points;

    const rank = (point: ScatterPoint) => {
      if (point.modelName === highlightedModel) return 3;
      if (hoveredProvider && point.providerName === hoveredProvider) return 2;
      if (overlayMode === "pareto" && showPareto && point.isPareto) return 1;
      return 0;
    };

    return [...activeDataset.points].sort((left, right) => rank(left) - rank(right));
  }, [activeDataset.points, hoveredProvider, highlightedModel, overlayMode, showPareto]);

  const orderedHistoricalPoints = useMemo(() => {
    if (!hoveredHistoryModel) return historicalPoints;
    return [...historicalPoints].sort((left, right) => {
      if (left.modelName === hoveredHistoryModel) return 1;
      if (right.modelName === hoveredHistoryModel) return -1;
      return 0;
    });
  }, [historicalPoints, hoveredHistoryModel]);

  const hoveredHistoryTooltip = useMemo(() => {
    if (!hoveredHistoryModel || !plotArea) return null;
    const point = historicalPoints.find((item) => item.modelName === hoveredHistoryModel);
    if (!point) return null;

    const cx = projectToPixel(point.x, xDomain, xScale, plotArea.left, plotArea.right);
    const cy = projectToPixel(point.y, yDomain, yScale, plotArea.bottom, plotArea.top);
    const currentCx = projectToPixel(point.currentX, xDomain, xScale, plotArea.left, plotArea.right);
    if (cx === null || cy === null || currentCx === null) return null;

    const tooltipWidth = 218;
    const tooltipHeight = 142;
    const placement = currentCx >= cx ? "left" : "right";
    const preferredLeft =
      placement === "left"
        ? cx - SCATTER_DOT_RADIUS - 12 - tooltipWidth
        : cx + SCATTER_DOT_RADIUS + 12;

    return {
      point,
      placement,
      left: Math.min(width - tooltipWidth, Math.max(0, preferredLeft)),
      top: Math.min(height - tooltipHeight, Math.max(0, cy - tooltipHeight - 12))
    } as const;
  }, [hoveredHistoryModel, historicalPoints, plotArea, xDomain, yDomain, xScale, yScale, width, height]);

  const isInsidePlot = useCallback(
    (pointerX: number, pointerY: number) =>
      Boolean(
        plotArea &&
          pointerX >= plotArea.left &&
          pointerX <= plotArea.right &&
          pointerY >= plotArea.top &&
          pointerY <= plotArea.bottom
      ),
    [plotArea]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !plotArea || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      if (!isInsidePlot(event.clientX - rect.left, event.clientY - rect.top)) return;

      // 只记录待定手势：立刻 capture / is-panning 会抢走散点的 click，点选钉住就失效
      panSessionRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        travelled: 0,
        active: false
      };
      suppressClickRef.current = false;
    },
    [plotArea, isInsidePlot]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId || !plotArea) return;

      const deltaX = event.clientX - session.lastX;
      const deltaY = event.clientY - session.lastY;
      if (deltaX === 0 && deltaY === 0) return;

      session.lastX = event.clientX;
      session.lastY = event.clientY;
      session.travelled += Math.abs(deltaX) + Math.abs(deltaY);

      // 未过阈值：仍是点击候选，不平移、不改光标
      if (!session.active) {
        if (session.travelled <= PAN_CLICK_SUPPRESS_THRESHOLD) return;

        session.active = true;
        isPanningRef.current = true;
        setIsPanning(true);
        setIsTooltipDismissed(true);
        containerRef.current?.setPointerCapture?.(event.pointerId);
      }

      const plotWidth = plotArea.right - plotArea.left;
      const plotHeight = plotArea.bottom - plotArea.top;
      if (plotWidth <= 0 || plotHeight <= 0) return;

      // 往右拖，画面跟着往右走，看到的是更小的值 → 值域左移；
      // 纵向屏幕坐标向下增长而数值向上增长，所以 Y 的符号不用再取反
      const xShiftRatio = -deltaX / plotWidth;
      const yShiftRatio = deltaY / plotHeight;

      setZoom((previous) => {
        const current = previous && previous.key === domainKey ? previous : null;
        const currentX = current?.x ?? baseXDomain;
        const currentY = current?.y ?? baseYDomain;

        return {
          key: domainKey,
          x: clampPannedDomain(panAxisDomain(currentX, xScale, xShiftRatio), baseXDomain, xScale),
          y: clampPannedDomain(panAxisDomain(currentY, yScale, yShiftRatio), baseYDomain, yScale)
        };
      });
    },
    [plotArea, domainKey, baseXDomain, baseYDomain, xScale, yScale]
  );

  const endPan = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      // 只有真正拖过阈值才吞掉随后的 click；轻点必须留给散点 onClick
      const wasActive = session.active;
      suppressClickRef.current = wasActive;
      panSessionRef.current = null;
      if (wasActive) {
        isPanningRef.current = false;
        setIsPanning(false);
        containerRef.current?.releasePointerCapture?.(event.pointerId);
        return;
      }

      // 空白轻点取消钉住；点在散点/标签上则交给 Scatter onClick
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".recharts-scatter-symbol")) return;
      arrowStartModelNameRef.current = null;
      setArrowStartModelName(null);
      if (highlightedModel) onSelectModel?.(null);
    },
    [highlightedModel, onSelectModel]
  );

  const renderDot = useCallback(
    (dotProps: ScatterDotRenderProps) => {
      const { cx, cy, payload } = dotProps;
      if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;

      const isTemporarilyHidden = activeHiddenModelNames.has(payload.modelName);
      const isHighlighted = payload.modelName === highlightedModel;
      const isArrowStart = payload.modelName === arrowStartModelName;
      const isPareto = overlayMode === "pareto" && showPareto && payload.isPareto;
      const radius = isPareto ? SCATTER_DOT_RADIUS_PARETO : SCATTER_DOT_RADIUS;

      // 悬浮图例时只留下该厂商；被钉住的点无论属于谁都保持全亮，免得刚选中就看不见了
      const isProviderMuted = Boolean(hoveredProvider) && payload.providerName !== hoveredProvider;
      const isParetoMuted = shouldDim && !payload.isPareto;
      // 钉住后以该点为中心，两轴都更差的象限淡化，方便对比「全面落后」的点
      const isWorstQuadrantMuted =
        Boolean(highlightedPoint) &&
        !isHighlighted &&
        isInWorstQuadrant(
          payload,
          highlightedPoint!,
          xMetric.higherIsBetter,
          yMetric.higherIsBetter
        );
      const opacity =
        isTemporarilyHidden ||
        (!isHighlighted && (isProviderMuted || isParetoMuted || isWorstQuadrantMuted))
          ? SCATTER_DIMMED_OPACITY
          : 1;

      const label = placedLabels.get(payload.modelName);
      const labelBox = label ? getPlacedLabelBox(label, SCATTER_LABEL_FONT_SIZE) : null;

      return (
        <g opacity={opacity} data-model-name={payload.modelName}>
          {isArrowStart ? (
            <circle
              className="scatter-arrow-start-ring"
              cx={cx}
              cy={cy}
              r={radius + 7}
              fill="none"
              stroke={payload.color}
              strokeWidth={2}
              strokeDasharray="3 3"
            />
          ) : null}
          {isHighlighted ? (
            // 钉住标记用该模型自己的品牌色描一圈淡环。早先用的是纯白硬边，
            // 看起来跟浏览器的焦点框一模一样，会被误读成点击留下的脏东西。
            <circle
              cx={cx}
              cy={cy}
              r={radius + 4}
              fill="none"
              stroke={payload.color}
              strokeWidth={2}
              opacity={0.5}
            />
          ) : null}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={payload.color}
            stroke="rgba(11, 16, 32, 0.8)"
            strokeWidth={1.25}
          />

          {label && labelBox ? (
            <>
              {/* 透明底板：让整块标签区域都可悬浮，而不是只有笔画命中 */}
              <rect
                x={labelBox.left}
                y={labelBox.top}
                width={labelBox.right - labelBox.left}
                height={labelBox.bottom - labelBox.top}
                fill="transparent"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.textAnchor}
                dominantBaseline="central"
                fontSize={SCATTER_LABEL_FONT_SIZE}
                // 标签跟散点同色，一眼能把名字和点对上；品牌色本身已按深色主题抬过对比度
                fill={payload.color}
                fontWeight={isHighlighted ? 700 : 600}
                stroke={SCATTER_LABEL_STROKE}
                strokeWidth={
                  isHighlighted ? SCATTER_LABEL_STROKE_WIDTH_HIGHLIGHTED : SCATTER_LABEL_STROKE_WIDTH
                }
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {label.text}
              </text>
            </>
          ) : null}
        </g>
      );
    },
    [
      highlightedModel,
      highlightedPoint,
      arrowStartModelName,
      activeHiddenModelNames,
      overlayMode,
      showPareto,
      shouldDim,
      hoveredProvider,
      placedLabels,
      xMetric.higherIsBetter,
      yMetric.higherIsBetter
    ]
  );

  const handleSelect = useCallback(
    (point: unknown, _index: unknown, event?: ScatterClickEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const clickPoint = point as ScatterClickPoint | undefined;
      const modelName = clickPoint?.payload?.modelName ?? clickPoint?.modelName;
      if (!modelName) return;

      if (event?.altKey) {
        onToggleHistory?.(modelName);
        return;
      }

      // Ctrl/Cmd：首点为起点，次点为终点；普通点击会取消待选起点
      if (event?.ctrlKey || event?.metaKey) {
        const startModelName = arrowStartModelNameRef.current;
        if (!startModelName || startModelName === modelName) {
          arrowStartModelNameRef.current = modelName;
          setArrowStartModelName(modelName);
          return;
        }

        setArrowAnnotations((previous) => [
          ...previous,
          {
            id: nextArrowIdRef.current++,
            fromModelName: startModelName,
            toModelName: modelName
          }
        ]);
        arrowStartModelNameRef.current = null;
        setArrowStartModelName(null);
        return;
      }

      arrowStartModelNameRef.current = null;
      setArrowStartModelName(null);

      if (event?.shiftKey) {
        setHiddenModelNames((previous) => {
          const next = new Set(previous);
          if (next.has(modelName)) next.delete(modelName);
          else next.add(modelName);
          return next;
        });
        return;
      }

      onSelectModel?.(modelName);
    },
    [onSelectModel, onToggleHistory]
  );

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".recharts-scatter-symbol")) return;

    event.preventDefault();
    setIsTooltipDismissed(true);
  }, []);

  const handleMouseMove = useCallback(() => {
    if (panSessionRef.current?.active) return;
    setIsTooltipDismissed(false);
  }, []);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current && !isPanningRef.current) return;

    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`scatter-chart-surface${isPanning ? " is-panning" : ""}${arrowStartModelName ? " is-annotating" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onContextMenu={handleContextMenu}
      onMouseMove={handleMouseMove}
      onClickCapture={handleClickCapture}
      onDoubleClick={() => setZoom(null)}
      title={
        arrowStartModelName
          ? `已选择 ${arrowStartModelName}，按住 Ctrl 点击另一个点作为终点`
          : isZoomed
            ? "拖拽平移 · 滚轮缩放 · 双击重置 · Ctrl 点击两点添加箭头 · Alt 点击查看历史点"
            : "拖拽平移 · 滚轮缩放 · Ctrl 点击两点添加箭头 · Alt 点击查看历史点"
      }
    >
      <ScatterChart width={width} height={height} margin={{ ...SCATTER_CHART_MARGIN }}>
        <CartesianGrid strokeDasharray="3 3" stroke={SCATTER_GRID_STROKE} />

        <XAxis
          type="number"
          dataKey="x"
          name={xMetric.label}
          scale={xScale}
          domain={xDomain}
          ticks={xTicks.length > 0 ? xTicks : undefined}
          allowDataOverflow
          height={SCATTER_X_AXIS_HEIGHT}
          stroke={SCATTER_AXIS_STROKE}
          tick={{ fill: SCATTER_AXIS_TICK_COLOR, fontSize: 11 }}
          tickFormatter={(value: number) => formatScatterAxisTick(xMetric, value)}
          label={{
            value: getMetricAxisLabel(xMetric),
            position: "insideBottom",
            offset: -16,
            fill: SCATTER_AXIS_TICK_COLOR,
            fontSize: 12
          }}
        />

        <YAxis
          type="number"
          dataKey="y"
          name={yMetric.label}
          scale={yScale}
          domain={yDomain}
          ticks={yTicks.length > 0 ? yTicks : undefined}
          allowDataOverflow
          width={SCATTER_Y_AXIS_WIDTH}
          stroke={SCATTER_AXIS_STROKE}
          tick={{ fill: SCATTER_AXIS_TICK_COLOR, fontSize: 11 }}
          tickFormatter={(value: number) => formatScatterAxisTick(yMetric, value)}
          label={{
            value: getMetricAxisLabel(yMetric),
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            fill: SCATTER_AXIS_TICK_COLOR,
            fontSize: 12
          }}
        />

        <Tooltip
          cursor={{
            strokeDasharray: SCATTER_CURSOR_DASH,
            stroke: SCATTER_CURSOR_STROKE,
            strokeWidth: SCATTER_CURSOR_WIDTH
          }}
          // 关掉 Recharts 默认的位移过渡：否则浮窗每次都从上一个位置（首次是左上角）滑过来
          isAnimationActive={false}
          content={(tooltipProps) =>
            isTooltipDismissed ? null : (
              <ScatterTooltip
                {...tooltipProps}
                xMetric={xMetric}
                yMetric={yMetric}
                xScale={xScale}
                yScale={yScale}
                showPareto={overlayMode === "pareto" && showPareto}
                points={activeDataset.points}
              />
            )
          }
        />

        {shouldRenderGuides ? (
          <ScatterGuideLayer
            xCenter={guideXCenter}
            yCenter={guideYCenter}
            xHigherIsBetter={xMetric.higherIsBetter}
            yHigherIsBetter={yMetric.higherIsBetter}
            emphasis={guideEmphasis}
          />
        ) : null}

        {snapshotOverlay ? (
          <ScatterSnapshotOverlayLayer
            overlay={snapshotOverlay}
            hoveredModelName={hoveredOverlayPoint?.point.modelName}
            onHoverPoint={(point, coords) => {
              if (point && coords) {
                setHoveredOverlayPoint({ point, coords });
              } else {
                setHoveredOverlayPoint(null);
              }
            }}
          />
        ) : null}

        <Scatter data={orderedPoints} shape={renderDot} isAnimationActive={false} onClick={handleSelect} />

        {overlayMode === "pareto" && showPareto ? (
          <ScatterParetoLayer path={activeDataset.paretoPath} lineStyle={paretoLineStyle} />
        ) : null}
        {overlayMode === "trend" && showPareto ? (
          <ScatterTrendLineLayer line={dataset.trendLine} xDomain={xDomain} />
        ) : null}
        <ScatterArrowLayer
          annotations={arrowAnnotations}
          points={activeDataset.points}
          xDomain={xDomain}
          yDomain={yDomain}
          xScale={xScale}
          yScale={yScale}
          plotArea={plotArea}
          placedLabels={placedLabels}
        />
        {orderedHistoricalPoints.map((historicalPoint) => {
          const arrowIndex = historicalPoints.findIndex(
            (point) => point.modelName === historicalPoint.modelName
          );
          return (
            <ScatterHistoryLayer
              key={historicalPoint.modelName}
              point={historicalPoint}
              xDomain={xDomain}
              yDomain={yDomain}
              xScale={xScale}
              yScale={yScale}
              plotArea={plotArea}
              placedLabels={placedLabels}
              isHovered={hoveredHistoryModel === historicalPoint.modelName}
              onHoverChange={(isHovered) =>
                setHoveredHistoryModel((current) =>
                  isHovered
                    ? historicalPoint.modelName
                    : current === historicalPoint.modelName
                      ? null
                      : current
                )
              }
              preferredArrowSign={arrowIndex % 2 === 0 ? 1 : -1}
              arrowCurvatureScale={1 + Math.floor(arrowIndex / 2) * 0.35}
              opacity={
                activeHiddenModelNames.has(historicalPoint.modelName)
                  ? SCATTER_DIMMED_OPACITY
                  : 1
              }
            />
          );
        })}
      </ScatterChart>
      {hoveredHistoryTooltip ? (
        <ScatterHistoryTooltip
          point={hoveredHistoryTooltip.point}
          xMetric={xMetric}
          yMetric={yMetric}
          left={hoveredHistoryTooltip.left}
          top={hoveredHistoryTooltip.top}
          placement={hoveredHistoryTooltip.placement}
        />
      ) : null}
      {hoveredOverlayPoint ? (() => {
        const tooltipWidth = 260;
        const tooltipHeight = hoveredOverlayPoint.point.isPareto ? 122 : 98;
        const preferredLeft = hoveredOverlayPoint.coords.x - tooltipWidth / 2;
        const left = Math.min(width - tooltipWidth - 8, Math.max(8, preferredLeft));
        const fitsAbove = hoveredOverlayPoint.coords.y - tooltipHeight - 12 >= 8;
        const top = fitsAbove
          ? hoveredOverlayPoint.coords.y - tooltipHeight - 12
          : hoveredOverlayPoint.coords.y + 16;
        const placement = fitsAbove ? "top" : "bottom";

        const overlayDate =
          snapshotOverlay?.snapshotLabel ??
          (hoveredOverlayPoint.point.xBenchTime?.slice(0, 10) || "历史快照");

        return (
          <div
            className="scatter-history-tooltip-anchor"
            style={{ left, top }}
            data-placement={placement}
          >
            <div className="scatter-tooltip scatter-history-tooltip scatter-overlay-tooltip" role="status">
              <div className="scatter-tooltip-head">
                <span
                  className="scatter-tooltip-swatch"
                  style={{ backgroundColor: hoveredOverlayPoint.point.color }}
                  aria-hidden="true"
                />
                <span className="scatter-tooltip-model">{hoveredOverlayPoint.point.modelName}</span>
              </div>
              <div className="scatter-tooltip-provider flex items-center justify-between gap-2">
                <span>{hoveredOverlayPoint.point.providerName}</span>
                <span className="text-amber-400 font-medium text-[11px]">
                  {overlayDate}
                </span>
              </div>
              <dl className="scatter-tooltip-rows">
                <div className="scatter-tooltip-row">
                  <dt>{yMetric.label}</dt>
                  <dd>{formatScatterValue(yMetric, hoveredOverlayPoint.point.y)}</dd>
                </div>
                <div className="scatter-tooltip-row">
                  <dt>{xMetric.label}</dt>
                  <dd>{formatScatterValue(xMetric, hoveredOverlayPoint.point.x)}</dd>
                </div>
              </dl>
              {hoveredOverlayPoint.point.isPareto ? (
                <div className="scatter-history-tooltip-date">
                  ★ 当期处于帕累托前沿
                </div>
              ) : null}
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
