"use client";

import { ArrowLeftRight, Copy, Crosshair, ImageDown, Tag, Waypoints } from "lucide-react";
import type { ExportPresetKey } from "@/components/benchmark-matrix/types";
import type { SourceOption } from "@/components/benchmark-matrix/selectors";
import { EXPORT_PRESET_MAP, SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import { sourceTabDisplayLabel } from "@/components/benchmark-matrix/utils";
import { describeMetricDirection } from "./metrics";
import type {
  ScatterAxisScale,
  ScatterLabelMode,
  ScatterMetric,
  ScatterMetricGroup,
  ScatterParetoLineStyle
} from "./types";

type ScatterControlsProps = {
  metricGroups: ScatterMetricGroup[];
  xMetric: ScatterMetric | null;
  yMetric: ScatterMetric | null;
  onChangeAxis: (axis: "x" | "y", key: string) => void;
  onSwapAxes: () => void;

  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  onChangeScale: (axis: "x" | "y", scale: ScatterAxisScale) => void;

  showPareto: boolean;
  onChangeShowPareto: (value: boolean) => void;
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
  onDownloadImage: () => void;
  onCopyImage: () => void;
  isDownloading: boolean;
  isCopying: boolean;
  isExportBusy: boolean;
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
  onChangeScale
}: {
  axis: "x" | "y";
  metric: ScatterMetric | null;
  metricGroups: ScatterMetricGroup[];
  scale: ScatterAxisScale;
  onChangeAxis: (axis: "x" | "y", key: string) => void;
  onChangeScale: (axis: "x" | "y", scale: ScatterAxisScale) => void;
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
        <select
          id={`scatter-axis-${axis}`}
          className="select select-sm scatter-axis-select"
          value={metric?.key ?? ""}
          onChange={(event) => onChangeAxis(axis, event.target.value)}
        >
          {metric ? null : <option value="">选择指标…</option>}
          {metricGroups.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.metrics.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

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
    xScale,
    yScale,
    onChangeScale,
    showPareto,
    onChangeShowPareto,
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
    onDownloadImage,
    onCopyImage,
    isDownloading,
    isCopying,
    isExportBusy
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
        />
      </div>

      <div className="scatter-controls-row scatter-controls-row-secondary">
        <div className="scatter-toggle-group">
          <label className="scatter-toggle" title="连出不被任何模型全面压制的边界">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={showPareto}
              onChange={(event) => onChangeShowPareto(event.target.checked)}
            />
            <Waypoints size={14} />
            <span>帕累托前沿</span>
          </label>

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
        </div>
      </div>
    </div>
  );
}
