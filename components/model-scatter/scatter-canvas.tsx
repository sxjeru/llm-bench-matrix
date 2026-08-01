"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  SCATTER_AXIS_STROKE,
  SCATTER_AXIS_TICK_COLOR,
  SCATTER_CHART_MARGIN,
  SCATTER_DIMMED_OPACITY,
  SCATTER_DOT_RADIUS,
  SCATTER_DOT_RADIUS_PARETO,
  SCATTER_GRID_STROKE,
  SCATTER_LABEL_COLOR,
  SCATTER_LABEL_FONT_SIZE,
  SCATTER_LABEL_GAP,
  SCATTER_WHEEL_ZOOM_STEP,
  SCATTER_X_AXIS_HEIGHT,
  SCATTER_Y_AXIS_WIDTH
} from "./constants";
import { computeAxisDomain, computeMedian, isDomainZoomed, zoomAxisDomain } from "./dataset";
import { ScatterGuideLayer } from "./guide-layer";
import { getPlacedLabelBox, layoutScatterLabels } from "./label-layout";
import { formatScatterAxisTick, getMetricAxisLabel } from "./metrics";
import { ScatterParetoLayer } from "./pareto-layer";
import { buildPointProjections, computePlotArea, pixelToAxisRatio } from "./projection";
import { ScatterTooltip } from "./scatter-tooltip";
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
  onSelectModel,
  onZoomChange,
  resetZoomSignal = 0
}: ScatterCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<ZoomState | null>(null);

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

    const labels = layoutScatterLabels(candidates, plotArea, {
      fontSize: SCATTER_LABEL_FONT_SIZE,
      dotRadius: SCATTER_DOT_RADIUS,
      gap: SCATTER_LABEL_GAP,
      mode: labelMode
    });

    return new Map(labels.map((label) => [label.key, label]));
  }, [
    dataset.points,
    plotArea,
    xDomain,
    yDomain,
    xScale,
    yScale,
    labelMode,
    highlightedModel,
    yMetric.higherIsBetter
  ]);

  const xMedian = useMemo(() => (showGuides ? computeMedian(xValues) : null), [showGuides, xValues]);
  const yMedian = useMemo(() => (showGuides ? computeMedian(yValues) : null), [showGuides, yValues]);

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

  const renderDot = useCallback(
    (dotProps: ScatterDotRenderProps) => {
      const { cx, cy, payload } = dotProps;
      if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;

      const isHighlighted = payload.modelName === highlightedModel;
      const isPareto = showPareto && payload.isPareto;
      const radius = isPareto ? SCATTER_DOT_RADIUS_PARETO : SCATTER_DOT_RADIUS;
      const opacity = shouldDim && !payload.isPareto && !isHighlighted ? SCATTER_DIMMED_OPACITY : 1;
      const label = placedLabels.get(payload.modelName);
      const labelBox = label ? getPlacedLabelBox(label, SCATTER_LABEL_FONT_SIZE) : null;

      return (
        <g opacity={opacity}>
          {isHighlighted ? (
            <circle cx={cx} cy={cy} r={radius + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.85} />
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
                fill={isHighlighted ? "#ffffff" : SCATTER_LABEL_COLOR}
                fontWeight={isHighlighted ? 700 : 500}
                // 深色底上给文字描一圈底色，压过网格线与散点边缘
                stroke="rgba(11, 16, 32, 0.85)"
                strokeWidth={2.5}
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
    [highlightedModel, showPareto, shouldDim, placedLabels]
  );

  const handleSelect = useCallback(
    (point: unknown) => {
      const modelName = (point as { modelName?: string } | undefined)?.modelName;
      if (modelName) onSelectModel?.(modelName);
    },
    [onSelectModel]
  );

  return (
    <div
      ref={containerRef}
      className="scatter-chart-surface"
      onDoubleClick={() => setZoom(null)}
      title={isZoomed ? "双击可重置缩放" : undefined}
    >
      <ScatterChart width={width} height={height} margin={{ ...SCATTER_CHART_MARGIN }}>
        <CartesianGrid strokeDasharray="3 3" stroke={SCATTER_GRID_STROKE} />

        <XAxis
          type="number"
          dataKey="x"
          name={xMetric.label}
          scale={xScale}
          domain={xDomain}
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
          cursor={{ strokeDasharray: "3 3", stroke: SCATTER_AXIS_STROKE }}
          // 关掉 Recharts 默认的位移过渡：否则浮窗每次都从上一个位置（首次是左上角）滑过来
          isAnimationActive={false}
          content={<ScatterTooltip xMetric={xMetric} yMetric={yMetric} showPareto={showPareto} />}
        />

        {showGuides ? <ScatterGuideLayer xMedian={xMedian} yMedian={yMedian} /> : null}

        <Scatter data={dataset.points} shape={renderDot} isAnimationActive={false} onClick={handleSelect} />

        {showPareto ? (
          <ScatterParetoLayer path={dataset.paretoPath} lineStyle={paretoLineStyle} />
        ) : null}
      </ScatterChart>
    </div>
  );
}
