import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import {
  SCATTER_AXIS_X_STORAGE_KEY,
  SCATTER_AXIS_Y_STORAGE_KEY,
  SCATTER_LABEL_MODE_STORAGE_KEY,
  SCATTER_PARETO_LINE_STYLE_STORAGE_KEY,
  SCATTER_PARETO_ONLY_STORAGE_KEY,
  SCATTER_PARETO_STORAGE_KEY,
  SCATTER_SCALE_X_STORAGE_KEY,
  SCATTER_SCALE_Y_STORAGE_KEY,
  SCATTER_SHOW_GUIDES_STORAGE_KEY
} from "./constants";
import type { ScatterAxisScale, ScatterLabelMode, ScatterParetoLineStyle } from "./types";

/** 一次完整的视图状态，URL 与 localStorage 都围绕它序列化。 */
export type ScatterViewState = {
  xKey: string | null;
  yKey: string | null;
  xSnapshot: string | null;
  ySnapshot: string | null;
  overlaySnapshot: string | null;
  xScale: ScatterAxisScale;
  yScale: ScatterAxisScale;
  showPareto: boolean;
  dimNonPareto: boolean;
  paretoLineStyle: ScatterParetoLineStyle;
  labelMode: ScatterLabelMode;
  showGuides: boolean;
  activeSource: string;
};

export const DEFAULT_SCATTER_VIEW_STATE: ScatterViewState = {
  xKey: null,
  yKey: null,
  xSnapshot: null,
  ySnapshot: null,
  overlaySnapshot: null,
  xScale: "linear",
  yScale: "linear",
  showPareto: true,
  dimNonPareto: false,
  paretoLineStyle: "linear",
  labelMode: "auto",
  showGuides: false,
  activeSource: SOURCE_ALL
};

function readString(storageKey: string): string | null {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved && saved.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function readBoolean(storageKey: string): boolean | null {
  const saved = readString(storageKey);
  if (saved === "0" || saved === "1") return saved === "1";
  return null;
}

export function writeStoredString(storageKey: string, value: string | null) {
  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, value);
  } catch {
    // 隐私模式或配额耗尽时静默降级：偏好丢失不影响主流程
  }
}

export function writeStoredBoolean(storageKey: string, value: boolean) {
  writeStoredString(storageKey, value ? "1" : "0");
}

function isAxisScale(value: string | null): value is ScatterAxisScale {
  return value === "linear" || value === "log";
}

function isLabelMode(value: string | null): value is ScatterLabelMode {
  return value === "auto" || value === "all" || value === "none";
}

function isParetoLineStyle(value: string | null): value is ScatterParetoLineStyle {
  return value === "linear" || value === "step";
}

/** 读取 localStorage 里的偏好；未设置的键留空由调用方决定默认值。 */
export function loadScatterPreferences(): Partial<ScatterViewState> {
  const preferences: Partial<ScatterViewState> = {};

  const xKey = readString(SCATTER_AXIS_X_STORAGE_KEY);
  if (xKey) preferences.xKey = xKey;

  const yKey = readString(SCATTER_AXIS_Y_STORAGE_KEY);
  if (yKey) preferences.yKey = yKey;

  const xScale = readString(SCATTER_SCALE_X_STORAGE_KEY);
  if (isAxisScale(xScale)) preferences.xScale = xScale;

  const yScale = readString(SCATTER_SCALE_Y_STORAGE_KEY);
  if (isAxisScale(yScale)) preferences.yScale = yScale;

  const showPareto = readBoolean(SCATTER_PARETO_STORAGE_KEY);
  if (showPareto !== null) preferences.showPareto = showPareto;

  const dimNonPareto = readBoolean(SCATTER_PARETO_ONLY_STORAGE_KEY);
  if (dimNonPareto !== null) preferences.dimNonPareto = dimNonPareto;

  const paretoLineStyle = readString(SCATTER_PARETO_LINE_STYLE_STORAGE_KEY);
  if (isParetoLineStyle(paretoLineStyle)) preferences.paretoLineStyle = paretoLineStyle;

  const labelMode = readString(SCATTER_LABEL_MODE_STORAGE_KEY);
  if (isLabelMode(labelMode)) preferences.labelMode = labelMode;

  const showGuides = readBoolean(SCATTER_SHOW_GUIDES_STORAGE_KEY);
  if (showGuides !== null) preferences.showGuides = showGuides;

  return preferences;
}

export function saveScatterPreferences(state: ScatterViewState) {
  writeStoredString(SCATTER_AXIS_X_STORAGE_KEY, state.xKey);
  writeStoredString(SCATTER_AXIS_Y_STORAGE_KEY, state.yKey);
  writeStoredString(SCATTER_SCALE_X_STORAGE_KEY, state.xScale);
  writeStoredString(SCATTER_SCALE_Y_STORAGE_KEY, state.yScale);
  writeStoredBoolean(SCATTER_PARETO_STORAGE_KEY, state.showPareto);
  writeStoredBoolean(SCATTER_PARETO_ONLY_STORAGE_KEY, state.dimNonPareto);
  writeStoredString(SCATTER_PARETO_LINE_STYLE_STORAGE_KEY, state.paretoLineStyle);
  writeStoredString(SCATTER_LABEL_MODE_STORAGE_KEY, state.labelMode);
  writeStoredBoolean(SCATTER_SHOW_GUIDES_STORAGE_KEY, state.showGuides);
}

type ReadableSearchParams = Pick<URLSearchParams, "get">;

/**
 * URL 参数优先级高于 localStorage：分享出去的链接必须能原样复现对方看到的图。
 * 只解析出现过的键，其余交回调用方回落。
 */
export function parseScatterSearchParams(searchParams: ReadableSearchParams): Partial<ScatterViewState> {
  const parsed: Partial<ScatterViewState> = {};

  const xKey = searchParams.get("x");
  if (xKey) parsed.xKey = xKey;

  const yKey = searchParams.get("y");
  if (yKey) parsed.yKey = yKey;

  const xSnapshot = searchParams.get("xt");
  if (xSnapshot) parsed.xSnapshot = xSnapshot;

  const ySnapshot = searchParams.get("yt");
  if (ySnapshot) parsed.ySnapshot = ySnapshot;

  const overlaySnapshot = searchParams.get("oy");
  if (overlaySnapshot) parsed.overlaySnapshot = overlaySnapshot;

  const xScale = searchParams.get("logx");
  if (xScale === "1" || xScale === "0") parsed.xScale = xScale === "1" ? "log" : "linear";

  const yScale = searchParams.get("logy");
  if (yScale === "1" || yScale === "0") parsed.yScale = yScale === "1" ? "log" : "linear";

  const pareto = searchParams.get("pareto");
  if (pareto === "1" || pareto === "0") parsed.showPareto = pareto === "1";

  const dim = searchParams.get("dim");
  if (dim === "1" || dim === "0") parsed.dimNonPareto = dim === "1";

  const lineStyle = searchParams.get("line");
  if (isParetoLineStyle(lineStyle)) parsed.paretoLineStyle = lineStyle;

  const labelMode = searchParams.get("labels");
  if (isLabelMode(labelMode)) parsed.labelMode = labelMode;

  const guides = searchParams.get("guides");
  if (guides === "1" || guides === "0") parsed.showGuides = guides === "1";

  const source = searchParams.get("source");
  if (source) parsed.activeSource = source;

  return parsed;
}

/**
 * 把视图状态写回查询串。
 *
 * 与默认值相同的项直接省略，链接才不会因为一堆 `pareto=1&line=linear`
 * 变得没法读；非默认项一个不落，分享才完整。
 */
export function buildScatterSearchParams(
  state: ScatterViewState,
  existing?: ReadableSearchParams
): string {
  const params = new URLSearchParams();

  // 保留其它页面可能带上的无关参数
  if (existing && typeof (existing as URLSearchParams).forEach === "function") {
    (existing as URLSearchParams).forEach((value, key) => {
      if (
        [
          "x",
          "y",
          "xt",
          "yt",
          "oy",
          "logx",
          "logy",
          "pareto",
          "dim",
          "line",
          "labels",
          "guides",
          "source"
        ].includes(key)
      ) {
        return;
      }
      params.set(key, value);
    });
  }

  if (state.xKey) params.set("x", state.xKey);
  if (state.yKey) params.set("y", state.yKey);
  if (state.xSnapshot) params.set("xt", state.xSnapshot);
  if (state.ySnapshot) params.set("yt", state.ySnapshot);
  if (state.overlaySnapshot) params.set("oy", state.overlaySnapshot);
  if (state.xScale !== DEFAULT_SCATTER_VIEW_STATE.xScale) params.set("logx", state.xScale === "log" ? "1" : "0");
  if (state.yScale !== DEFAULT_SCATTER_VIEW_STATE.yScale) params.set("logy", state.yScale === "log" ? "1" : "0");
  if (state.showPareto !== DEFAULT_SCATTER_VIEW_STATE.showPareto) params.set("pareto", state.showPareto ? "1" : "0");
  if (state.dimNonPareto !== DEFAULT_SCATTER_VIEW_STATE.dimNonPareto) params.set("dim", state.dimNonPareto ? "1" : "0");
  if (state.paretoLineStyle !== DEFAULT_SCATTER_VIEW_STATE.paretoLineStyle) params.set("line", state.paretoLineStyle);
  if (state.labelMode !== DEFAULT_SCATTER_VIEW_STATE.labelMode) params.set("labels", state.labelMode);
  if (state.showGuides !== DEFAULT_SCATTER_VIEW_STATE.showGuides) params.set("guides", state.showGuides ? "1" : "0");
  if (state.activeSource !== SOURCE_ALL) params.set("source", state.activeSource);

  return params.toString();
}
