"use client";

import {
  ArrowLeftRight,
  Copy,
  Crosshair,
  Expand,
  ImageDown,
  Minimize2,
  Tag,
  TrendingUp,
  Waypoints
} from "lucide-react";
import type { ExportPresetKey } from "@/components/benchmark-matrix/types";
import type { SourceOption } from "@/components/benchmark-matrix/selectors";
import { EXPORT_PRESET_MAP, SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import { sourceTabDisplayLabel } from "@/components/benchmark-matrix/utils";
import { MetricCombobox } from "./metric-combobox";
import { describeMetricDirection } from "./metrics";
import type {
  ScatterAxisScale,
  ScatterLabelMode,
  ScatterMetric,
  ScatterMetricGroup,
  ScatterOverlayMode,
  ScatterParetoLineStyle
} from "./types";

type ScatterControlsProps = {
  metricGroups: ScatterMetricGroup[];
  xMetric: ScatterMetric | null;
  yMetric: ScatterMetric | null;
  onChangeAxis: (axis: "x" | "y", key: string) => void;
  onSwapAxes: () => void;
  /** 轴选择器里输入了搜索词，供上层顺带放开低覆盖指标 */
  onAxisQueryChange?: (query: string) => void;

  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  onChangeScale: (axis: "x" | "y", scale: ScatterAxisScale) => void;

  showPareto: boolean;
  onChangeShowPareto: (value: boolean) => void;
  overlayMode: ScatterOverlayMode;
  dimNonPareto: boolean;
  onChangeDimNonPareto: (value: boolean) => void;
  paretoLineStyle: ScatterParetoLineStyle;
  onChangeParetoLineStyle: (value: ScatterParetoLineStyle) => void;

  labelMode: ScatterLabelMode;
  onChangeLabelMode: (value: ScatterLabelMode) => void;
  showGuides: boolean;
  onChangeShowGuides: (value: boolean) => void;

  sourceOptions: SourceOption[];
  activeSource: string;
  onChangeSource: (key: string) => void;

  exportPreset: ExportPresetKey;
  onChangeExportPreset: (value: ExportPresetKey) => void;
  availableExportPresetKeys: ExportPresetKey[];
  includeLegendInExport: boolean;
  onChangeIncludeLegendInExport: (value: boolean) => void;
  onDownloadImage: () => void;
  onCopyImage: () => void;
  isDownloading: boolean;
  isCopying: boolean;
  isExportBusy: boolean;

  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

const LABEL_MODE_OPTIONS: Array<{ value: ScatterLabelMode; label: string; title: string }> = [
  { value: "auto", label: "自动", title: "按优先级放置，放不下的标签自动省略" },
  { value: "all", label: "全部", title: "强制显示所有模型名，可能重叠" },
  { value: "none", label: "隐藏", title: "只保留散点，靠悬浮查看模型" }
];

function AxisSelect({
  axis,
  metric,
  metricGroups,
  scale,
  onChangeAxis,
  onChangeScale,
  onAxisQueryChange
}: {
  axis: "x" | "y";
  metric: ScatterMetric | null;
  metricGroups: ScatterMetricGroup[];
  scale: ScatterAxisScale;
  onChangeAxis: (axis: "x" | "y", key: string) => void;
  onChangeScale: (axis: "x" | "y", scale: ScatterAxisScale) => void;
  onAxisQueryChange?: (query: string) => void;
}) {
  const axisLabel = axis === "x" ? "X 轴" : "Y 轴";

  return (
    <div className="scatter-axis-field">
      <label className="scatter-control-label" htmlFor={`scatter-axis-${axis}`}>
        {axisLabel}
        {metric ? (
          <span className={`scatter-direction-hint ${metric.higherIsBetter ? "is-up" : "is-down"}`}>
            {metric.higherIsBetter ? "↑" : "↓"} {describeMetricDirection(metric)}
          </span>
        ) : null}
      </label>

      <div className="scatter-axis-row">
        <MetricCombobox
          id={`scatter-axis-${axis}`}
          axisName={axisLabel}
          metric={metric}
          metricGroups={metricGroups}
          onChange={(key) => onChangeAxis(axis, key)}
          onQueryChange={onAxisQueryChange}
        />

        <div className="scatter-segment" role="group" aria-label={`${axisLabel}刻度`}>
          <button
            type="button"
            className={`scatter-btn scatter-segment-btn ${scale === "linear" ? "is-active" : ""}`}
            onClick={() => onChangeScale(axis, "linear")}
            title="线性刻度"
          >
            线性
          </button>
          <button
            type="button"
            className={`scatter-btn scatter-segment-btn ${scale === "log" ? "is-active" : ""}`}
            onClick={() => onChangeScale(axis, "log")}
            title="对数刻度（仅正数参与绘制）"
          >
            对数
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScatterControls(props: ScatterControlsProps) {
  const {
    metricGroups,
    xMetric,
    yMetric,
    onChangeAxis,
    onSwapAxes,
    onAxisQueryChange,
    xScale,
    yScale,
    onChangeScale,
    showPareto,
    onChangeShowPareto,
    overlayMode,
    dimNonPareto,
    onChangeDimNonPareto,
    paretoLineStyle,
    onChangeParetoLineStyle,
    labelMode,
    onChangeLabelMode,
    showGuides,
    onChangeShowGuides,
    sourceOptions,
    activeSource,
    onChangeSource,
    exportPreset,
    onChangeExportPreset,
    availableExportPresetKeys,
    includeLegendInExport,
    onChangeIncludeLegendInExport,
    onDownloadImage,
    onCopyImage,
    isDownloading,
    isCopying,
    isExportBusy,
    isFullscreen,
    onToggleFullscreen
  } = props;

  return (
    <div className="scatter-controls" data-nosnippet>
      <div className="scatter-controls-row">
        <div className="scatter-axis-field scatter-source-field">
          <label className="scatter-control-label" htmlFor="scatter-source">
            数据来源
          </label>
          <select
            id="scatter-source"
            className="select select-sm scatter-axis-select"
            value={activeSource}
            onChange={(event) => onChangeSource(event.target.value)}
          >
            {sourceOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {/* 与矩阵页签一致：只显示冒号后的正文，不带 text: 之类的前缀 */}
                {option.key === SOURCE_ALL ? option.label : sourceTabDisplayLabel(option.key)}
              </option>
            ))}
          </select>
        </div>

        <AxisSelect
          axis="y"
          metric={yMetric}
          metricGroups={metricGroups}
          scale={yScale}
          onChangeAxis={onChangeAxis}
          onChangeScale={onChangeScale}
          onAxisQueryChange={onAxisQueryChange}
        />

        <button
          type="button"
          className="scatter-btn scatter-swap-btn"
          onClick={onSwapAxes}
          title="交换 X / Y 轴"
          aria-label="交换 X / Y 轴"
        >
          <ArrowLeftRight size={16} />
        </button>

        <AxisSelect
          axis="x"
          metric={xMetric}
          metricGroups={metricGroups}
          scale={xScale}
          onChangeAxis={onChangeAxis}
          onChangeScale={onChangeScale}
          onAxisQueryChange={onAxisQueryChange}
        />
      </div>

      <div className="scatter-controls-row scatter-controls-row-secondary">
        <div className="scatter-toggle-group">
          <label
            className="scatter-toggle"
            title={overlayMode === "trend" ? "绘制当前散点的线性回归趋势" : "连出不被任何模型全面压制的边界"}
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={showPareto}
              onChange={(event) => onChangeShowPareto(event.target.checked)}
            />
            {overlayMode === "trend" ? <TrendingUp size={14} /> : <Waypoints size={14} />}
            <span>{overlayMode === "trend" ? "散点趋势线" : "帕累托前沿"}</span>
          </label>

          {overlayMode === "pareto" ? (
            <>
              <label
                className={`scatter-toggle ${showPareto ? "" : "is-disabled"}`}
                title="把非前沿模型降到低透明度，突出结论"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={dimNonPareto}
                  disabled={!showPareto}
                  onChange={(event) => onChangeDimNonPareto(event.target.checked)}
                />
                <span>淡化非前沿</span>
              </label>

              <div className={`scatter-segment ${showPareto ? "" : "is-disabled"}`} role="group" aria-label="前沿线型">
                <button
                  type="button"
                  className={`scatter-btn scatter-segment-btn ${paretoLineStyle === "linear" ? "is-active" : ""}`}
                  disabled={!showPareto}
                  onClick={() => onChangeParetoLineStyle("linear")}
                  title="直线：直接连接相邻前沿点"
                >
                  直线
                </button>
                <button
                  type="button"
                  className={`scatter-btn scatter-segment-btn ${paretoLineStyle === "step" ? "is-active" : ""}`}
                  disabled={!showPareto}
                  onClick={() => onChangeParetoLineStyle("step")}
                  title="阶梯：还原被压制区域的真实边界"
                >
                  阶梯
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="scatter-toggle-group">
          <span className="scatter-control-label scatter-inline-label">
            <Tag size={14} /> 标签
          </span>
          <div className="scatter-segment" role="group" aria-label="标签模式">
            {LABEL_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`scatter-btn scatter-segment-btn ${labelMode === option.value ? "is-active" : ""}`}
                onClick={() => onChangeLabelMode(option.value)}
                title={option.title}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="scatter-toggle" title="画出两轴中位数，把图切成四象限">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={showGuides}
              onChange={(event) => onChangeShowGuides(event.target.checked)}
            />
            <Crosshair size={14} />
            <span>中位参考线</span>
          </label>
        </div>

        <div className="scatter-toggle-group scatter-export-group">
          <select
            className="select select-xs scatter-export-select"
            value={includeLegendInExport ? "include" : "exclude"}
            onChange={(event) => onChangeIncludeLegendInExport(event.target.value === "include")}
            aria-label="导出图例"
          >
            <option value="exclude">不含图例</option>
            <option value="include">包含图例</option>
          </select>

          <select
            className="select select-xs scatter-export-select"
            value={exportPreset}
            onChange={(event) => onChangeExportPreset(event.target.value as ExportPresetKey)}
            aria-label="导出规格"
          >
            {availableExportPresetKeys.map((key) => (
              <option key={key} value={key}>
                {EXPORT_PRESET_MAP[key].label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={onDownloadImage}
            disabled={isExportBusy}
          >
            <ImageDown size={14} />
            {isDownloading ? "导出中…" : "导出图片"}
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={onCopyImage}
            disabled={isExportBusy}
          >
            <Copy size={14} />
            {isCopying ? "复制中…" : "复制"}
          </button>

          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={onToggleFullscreen}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Expand size={14} />}
            {isFullscreen ? "退出全屏" : "全屏"}
          </button>
        </div>
      </div>
    </div>
  );
}
