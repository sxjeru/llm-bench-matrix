"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { enqueueStateUpdate } from "@/components/benchmark-matrix/utils";
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
  SCATTER_WHEEL_ZOOM_STEP
} from "./constants";
import { computeAxisDomain, computeMedian, isDomainZoomed, zoomAxisDomain } from "./dataset";
import { ScatterGuideLayer } from "./guide-layer";
import { getPlacedLabelBox } from "./label-layout";
import { formatScatterAxisTick, getMetricAxisLabel } from "./metrics";
import { ScatterOverlayProbe, type ScatterOverlayResolution } from "./overlay-probe";
import { ScatterParetoLayer } from "./pareto-layer";
import { ScatterTooltip } from "./scatter-tooltip";
import type {
  ScatterAxisBounds,
  ScatterAxisScale,
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
 * 二维散点图。
 *
 * 坐标轴、网格与命中检测交给 Recharts，帕累托线走自定义层
 * （与 `components/custom-boxplot-layer.tsx` 同一模式：用 v3 的
 * `useXAxisScale` / `useYAxisScale` 取比例尺后画原生 SVG）。
 *
 * 模型名标签刻意画进 `<Scatter>` 的自定义 shape 里而不是单独一层：
 * Recharts 把 `onMouseEnter/Leave` 挂在包裹 shape 的 `<Layer>` 上，
 * 标签待在里面就能和散点共享同一套命中区域，鼠标移到文字上照样出浮窗与十字光标。
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
  const plotAreaRef = useRef<ScatterAxisBounds | null>(null);
  const [placedLabels, setPlacedLabels] = useState<ReadonlyMap<string, ScatterPlacedLabel>>(new Map());
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

  const xMedian = useMemo(() => (showGuides ? computeMedian(xValues) : null), [showGuides, xValues]);
  const yMedian = useMemo(() => (showGuides ? computeMedian(yValues) : null), [showGuides, yValues]);

  const handleOverlayResolve = useCallback((resolution: ScatterOverlayResolution) => {
    plotAreaRef.current = resolution.plotArea;
    const nextMap = new Map(resolution.labels.map((label) => [label.key, label]));
    enqueueStateUpdate(() => setPlacedLabels(nextMap));
  }, []);

  // 滚轮缩放必须拿到非 passive 的监听才能 preventDefault，React 的 onWheel 做不到
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleWheel = (event: WheelEvent) => {
      const plotArea = plotAreaRef.current;
      if (!plotArea || event.deltaY === 0) return;

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

      const plotWidth = plotArea.right - plotArea.left;
      const plotHeight = plotArea.bottom - plotArea.top;
      if (plotWidth <= 0 || plotHeight <= 0) return;

      const factor = event.deltaY > 0 ? SCATTER_WHEEL_ZOOM_STEP : 1 / SCATTER_WHEEL_ZOOM_STEP;
      const xRatio = (pointerX - plotArea.left) / plotWidth;
      // 屏幕 y 向下增长、数据 y 向上增长，锚点比例要翻过来
      const yRatio = 1 - (pointerY - plotArea.top) / plotHeight;

      setZoom((previous) => {
        const current = previous && previous.key === domainKey ? previous : null;
        const currentX = current?.x ?? baseXDomain;
        const currentY = current?.y ?? baseYDomain;

        return {
          key: domainKey,
          x: zoomAxisDomain(currentX, baseXDomain, xScale, xRatio, factor),
          y: zoomAxisDomain(currentY, baseYDomain, yScale, yRatio, factor)
        };
      });
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [domainKey, baseXDomain, baseYDomain, xScale, yScale]);

  const shouldDim = showPareto && dimNonPareto;

  const renderDot = (dotProps: ScatterDotRenderProps) => {
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
  };

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
          width="auto"
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

        <Scatter
          data={dataset.points}
          shape={renderDot}
          isAnimationActive={false}
          onClick={(point: unknown) => {
            const modelName = (point as { modelName?: string } | undefined)?.modelName;
            if (modelName) onSelectModel?.(modelName);
          }}
        />

        {showPareto ? (
          <ScatterParetoLayer path={dataset.paretoPath} lineStyle={paretoLineStyle} />
        ) : null}

        <ScatterOverlayProbe
          points={dataset.points}
          mode={labelMode}
          yHigherIsBetter={yMetric.higherIsBetter}
          highlightedModel={highlightedModel}
          onResolve={handleOverlayResolve}
        />
      </ScatterChart>
    </div>
  );
}
