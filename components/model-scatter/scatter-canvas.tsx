"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
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
import { ScatterGuideLayer } from "./guide-layer";
import { getPlacedLabelBox, layoutScatterLabels } from "./label-layout";
import { formatScatterAxisTick, getMetricAxisLabel } from "./metrics";
import { ScatterParetoLayer } from "./pareto-layer";
import { buildPointProjections, computePlotArea, pixelToAxisRatio } from "./projection";
import { ScatterTooltip } from "./scatter-tooltip";
import { buildAxisTicks } from "./ticks";
import type {
  ScatterAxisScale,
  ScatterLabelCandidate,
  ScatterLabelMode,
  ScatterMetric,
  ScatterParetoLineStyle,
  ScatterPlacedLabel,
  ScatterPlotDataset,
  ScatterPoint
} from "./types";

export type ScatterCanvasProps = {
  width: number;
  height: number;
  xMetric: ScatterMetric;
  yMetric: ScatterMetric;
  dataset: ScatterPlotDataset;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  showPareto: boolean;
  dimNonPareto: boolean;
  paretoLineStyle: ScatterParetoLineStyle;
  labelMode: ScatterLabelMode;
  showGuides: boolean;
  highlightedModel: string | null;
  /** 图例上正在悬浮的厂商；其余厂商的点与标签会被淡化 */
  hoveredProvider?: string | null;
  onSelectModel?: (modelName: string) => void;
  onZoomChange?: (isZoomed: boolean) => void;
  /** 外部触发的重置计数，每次自增都会把缩放归位 */
  resetZoomSignal?: number;
};

type ScatterDotRenderProps = {
  cx?: number;
  cy?: number;
  payload?: ScatterPoint;
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
  travelled: number;
};

/** 位移超过这个像素数就算拖拽，之后那一次 click 不应再被当成「钉住模型」 */
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
  highlightedModel: string | null
): number {
  const highlightBonus = point.modelName === highlightedModel ? 1_000_000 : 0;
  const paretoBonus = point.isPareto ? 10_000 : 0;
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
  xScale,
  yScale,
  showPareto,
  dimNonPareto,
  paretoLineStyle,
  labelMode,
  showGuides,
  highlightedModel,
  hoveredProvider = null,
  onSelectModel,
  onZoomChange,
  resetZoomSignal = 0
}: ScatterCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const suppressClickRef = useRef(false);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const xValues = useMemo(() => dataset.points.map((point) => point.x), [dataset.points]);
  const yValues = useMemo(() => dataset.points.map((point) => point.y), [dataset.points]);

  const baseXDomain = useMemo(() => computeAxisDomain(xValues, xScale), [xValues, xScale]);
  const baseYDomain = useMemo(() => computeAxisDomain(yValues, yScale), [yValues, yScale]);

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
      points: dataset.points,
      xDomain,
      yDomain,
      xScale,
      yScale,
      plotArea
    });

    const rankedModels = [...dataset.points]
      .sort((left, right) => (yMetric.higherIsBetter ? right.y - left.y : left.y - right.y))
      .map((point) => point.modelName);
    const yRankByModel = new Map(rankedModels.map((modelName, index) => [modelName, index]));

    const candidates: ScatterLabelCandidate[] = [];
    const providerByModel = new Map<string, string>();

    dataset.points.forEach((point) => {
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
          yRankByModel.get(point.modelName) ?? dataset.points.length,
          dataset.points.length,
          highlightedModel
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
    dataset.points,
    plotArea,
    xDomain,
    yDomain,
    xScale,
    yScale,
    labelMode,
    highlightedModel,
    hoveredProvider,
    yMetric.higherIsBetter
  ]);

  const xMedian = useMemo(() => (showGuides ? computeMedian(xValues) : null), [showGuides, xValues]);
  const yMedian = useMemo(() => (showGuides ? computeMedian(yValues) : null), [showGuides, yValues]);

  // 横向空间更宽，刻度可以多给两档；纵向密了会挤成一片
  const xTicks = useMemo(() => buildAxisTicks(xDomain, xScale, 8), [xDomain, xScale]);
  const yTicks = useMemo(() => buildAxisTicks(yDomain, yScale, 6), [yDomain, yScale]);

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

  const shouldDim = showPareto && dimNonPareto;

  /**
   * 绘制顺序。
   *
   * SVG 没有 z-index，谁后画谁在上面。默认顺序下，被钉住的点很容易被后面的
   * 散点或标签盖住，所以这里按「钉住 > 悬浮厂商 > 前沿 > 其余」重排一遍，
   * 让当前最该被看清的点始终画在最上层。排序是稳定的，同组内相对次序不变。
   */
  const orderedPoints = useMemo(() => {
    if (!hoveredProvider && !highlightedModel) return dataset.points;

    const rank = (point: ScatterPoint) => {
      if (point.modelName === highlightedModel) return 3;
      if (hoveredProvider && point.providerName === hoveredProvider) return 2;
      if (point.isPareto) return 1;
      return 0;
    };

    return [...dataset.points].sort((left, right) => rank(left) - rank(right));
  }, [dataset.points, hoveredProvider, highlightedModel]);

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

      panSessionRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        travelled: 0
      };
      suppressClickRef.current = false;
      setIsPanning(true);
      containerRef.current.setPointerCapture?.(event.pointerId);
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

  const endPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    // 拖过一段距离后紧跟着的 click 是拖拽的余波，不该被当成点选模型
    suppressClickRef.current = session.travelled > PAN_CLICK_SUPPRESS_THRESHOLD;
    panSessionRef.current = null;
    setIsPanning(false);
    containerRef.current?.releasePointerCapture?.(event.pointerId);
  }, []);

  const renderDot = useCallback(
    (dotProps: ScatterDotRenderProps) => {
      const { cx, cy, payload } = dotProps;
      if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;

      const isHighlighted = payload.modelName === highlightedModel;
      const isPareto = showPareto && payload.isPareto;
      const radius = isPareto ? SCATTER_DOT_RADIUS_PARETO : SCATTER_DOT_RADIUS;

      // 悬浮图例时只留下该厂商；被钉住的点无论属于谁都保持全亮，免得刚选中就看不见了
      const isProviderMuted = Boolean(hoveredProvider) && payload.providerName !== hoveredProvider;
      const isParetoMuted = shouldDim && !payload.isPareto;
      const opacity = isHighlighted || (!isProviderMuted && !isParetoMuted) ? 1 : SCATTER_DIMMED_OPACITY;

      const label = placedLabels.get(payload.modelName);
      const labelBox = label ? getPlacedLabelBox(label, SCATTER_LABEL_FONT_SIZE) : null;

      return (
        <g opacity={opacity}>
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
    [highlightedModel, showPareto, shouldDim, hoveredProvider, placedLabels]
  );

  const handleSelect = useCallback(
    (point: unknown) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      const modelName = (point as { modelName?: string } | undefined)?.modelName;
      if (modelName) onSelectModel?.(modelName);
    },
    [onSelectModel]
  );

  return (
    <div
      ref={containerRef}
      className={`scatter-chart-surface ${isPanning ? "is-panning" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={() => setZoom(null)}
      title={isZoomed ? "拖拽平移 · 滚轮缩放 · 双击重置" : "拖拽平移 · 滚轮缩放"}
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
          content={<ScatterTooltip xMetric={xMetric} yMetric={yMetric} showPareto={showPareto} />}
        />

        {showGuides ? (
          <ScatterGuideLayer
            xMedian={xMedian}
            yMedian={yMedian}
            xHigherIsBetter={xMetric.higherIsBetter}
            yHigherIsBetter={yMetric.higherIsBetter}
          />
        ) : null}

        <Scatter data={orderedPoints} shape={renderDot} isAnimationActive={false} onClick={handleSelect} />

        {showPareto ? (
          <ScatterParetoLayer path={dataset.paretoPath} lineStyle={paretoLineStyle} />
        ) : null}
      </ScatterChart>
    </div>
  );
}
