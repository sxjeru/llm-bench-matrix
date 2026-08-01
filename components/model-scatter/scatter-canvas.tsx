"use client";

import { useMemo } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  SCATTER_AXIS_STROKE,
  SCATTER_AXIS_TICK_COLOR,
  SCATTER_CHART_MARGIN,
  SCATTER_DIMMED_OPACITY,
  SCATTER_DOT_RADIUS,
  SCATTER_DOT_RADIUS_PARETO,
  SCATTER_GRID_STROKE
} from "./constants";
import { computeAxisDomain, computeMedian } from "./dataset";
import { ScatterGuideLayer } from "./guide-layer";
import { ScatterLabelLayer } from "./label-layer";
import { formatScatterAxisTick, getMetricAxisLabel } from "./metrics";
import { ScatterParetoLayer } from "./pareto-layer";
import { ScatterTooltip } from "./scatter-tooltip";
import type {
  ScatterAxisScale,
  ScatterLabelMode,
  ScatterMetric,
  ScatterParetoLineStyle,
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
};

type ScatterDotRenderProps = {
  cx?: number;
  cy?: number;
  payload?: ScatterPoint;
};

/**
 * 二维散点图。
 *
 * 坐标轴、网格与命中检测交给 Recharts，帕累托线与标签走自定义层
 * （与 `components/custom-boxplot-layer.tsx` 同一模式：用 v3 的
 * `useXAxisScale` / `useYAxisScale` 取比例尺后画原生 SVG）。
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
  onSelectModel
}: ScatterCanvasProps) {
  const xValues = useMemo(() => dataset.points.map((point) => point.x), [dataset.points]);
  const yValues = useMemo(() => dataset.points.map((point) => point.y), [dataset.points]);

  const xDomain = useMemo(() => computeAxisDomain(xValues, xScale), [xValues, xScale]);
  const yDomain = useMemo(() => computeAxisDomain(yValues, yScale), [yValues, yScale]);

  const xMedian = useMemo(() => (showGuides ? computeMedian(xValues) : null), [showGuides, xValues]);
  const yMedian = useMemo(() => (showGuides ? computeMedian(yValues) : null), [showGuides, yValues]);

  const shouldDim = showPareto && dimNonPareto;

  const renderDot = (dotProps: ScatterDotRenderProps) => {
    const { cx, cy, payload } = dotProps;
    if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g />;

    const isHighlighted = payload.modelName === highlightedModel;
    const isPareto = showPareto && payload.isPareto;
    const radius = isPareto ? SCATTER_DOT_RADIUS_PARETO : SCATTER_DOT_RADIUS;
    const opacity = shouldDim && !payload.isPareto && !isHighlighted ? SCATTER_DIMMED_OPACITY : 1;

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
      </g>
    );
  };

  return (
    <ScatterChart width={width} height={height} margin={{ ...SCATTER_CHART_MARGIN }}>
      <CartesianGrid strokeDasharray="3 3" stroke={SCATTER_GRID_STROKE} />

      <XAxis
        type="number"
        dataKey="x"
        name={xMetric.label}
        scale={xScale}
        domain={xDomain}
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

      <ScatterLabelLayer
        points={dataset.points}
        mode={labelMode}
        yHigherIsBetter={yMetric.higherIsBetter}
        highlightedModel={highlightedModel}
      />
    </ScatterChart>
  );
}
