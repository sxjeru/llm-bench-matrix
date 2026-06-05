import {
  HEATMAP_PRESETS,
  MAX_HEATMAP_ALPHA,
  MIN_HEATMAP_ALPHA
} from "./constants";
import { clampHeatmapAlpha } from "./colors";
import type {
  HeatmapPaletteHex,
  HeatmapPresetKey,
  HeatmapPresetSelection
} from "./types";

type HeatmapPanelProps = {
  heatmapPalette: HeatmapPaletteHex;
  heatmapAlpha: number;
  heatmapPresetSelection: HeatmapPresetSelection;
  heatmapGradientPreview: string;
  setHeatmapAlpha: (value: number) => void;
  setHeatmapPresetSelection: (value: HeatmapPresetSelection) => void;
  updateHeatmapPaletteColor: (key: keyof HeatmapPaletteHex, nextColor: string) => void;
  applyHeatmapPreset: (nextPreset: HeatmapPresetKey) => void;
  resetHeatmapPaletteToDefault: () => void;
};

export function HeatmapPanel({
  heatmapPalette,
  heatmapAlpha,
  heatmapPresetSelection,
  heatmapGradientPreview,
  setHeatmapAlpha,
  setHeatmapPresetSelection,
  updateHeatmapPaletteColor,
  applyHeatmapPreset,
  resetHeatmapPaletteToDefault
}: HeatmapPanelProps) {
  return (
    <div className="heatmap-panel" data-nosnippet>
      <div className="heatmap-panel-top">
        <div className="heatmap-panel-title-wrap">
          <span className="heatmap-panel-title">热力图渐变设置</span>
        </div>

        <div className="heatmap-panel-actions">
          <label className="heatmap-preset-group">
            <span>预设</span>
            <select
              className="select select-sm heatmap-preset-select"
              value={heatmapPresetSelection}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "custom") {
                  setHeatmapPresetSelection("custom");
                  return;
                }

                if (next in HEATMAP_PRESETS) {
                  applyHeatmapPreset(next as HeatmapPresetKey);
                }
              }}
            >
              {(Object.entries(HEATMAP_PRESETS) as [HeatmapPresetKey, (typeof HEATMAP_PRESETS)[HeatmapPresetKey]][]).map(
                ([presetKey, preset]) => (
                  <option key={presetKey} value={presetKey}>{preset.label}</option>
                )
              )}
              <option value="custom">自定义</option>
            </select>
          </label>

          <button type="button" className="btn btn-sm heatmap-reset-btn" onClick={resetHeatmapPaletteToDefault}>
            恢复默认
          </button>
        </div>
      </div>

      <div className="heatmap-gradient-track" style={{ background: heatmapGradientPreview }} />

      <div className="heatmap-panel-bottom">
        <span className="heatmap-hex-readout">
          {heatmapPalette.low.toUpperCase()} · {heatmapPalette.mid.toUpperCase()} · {heatmapPalette.high.toUpperCase()}
        </span>

        <div className="heatmap-stop-controls">
          <label className="heatmap-alpha-inline">
            <span>透明度</span>
            <input
              type="range"
              className="heatmap-alpha-range"
              min={Math.round(MIN_HEATMAP_ALPHA * 100)}
              max={Math.round(MAX_HEATMAP_ALPHA * 100)}
              step={1}
              value={Math.round(heatmapAlpha * 100)}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                setHeatmapAlpha(clampHeatmapAlpha(next));
              }}
            />
            <span>{Math.round(heatmapAlpha * 100)}%</span>
          </label>

          <label className="heatmap-stop-pill">
            <span>较差</span>
            <input
              type="color"
              className="input heatmap-color-input"
              value={heatmapPalette.low}
              onChange={(event) => updateHeatmapPaletteColor("low", event.target.value)}
            />
          </label>

          <label className="heatmap-stop-pill">
            <span>中等</span>
            <input
              type="color"
              className="input heatmap-color-input"
              value={heatmapPalette.mid}
              onChange={(event) => updateHeatmapPaletteColor("mid", event.target.value)}
            />
          </label>

          <label className="heatmap-stop-pill">
            <span>优秀</span>
            <input
              type="color"
              className="input heatmap-color-input"
              value={heatmapPalette.high}
              onChange={(event) => updateHeatmapPaletteColor("high", event.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
