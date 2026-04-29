import { isValidHexColor } from "@/lib/provider-config";
import { DEFAULT_HEATMAP_ALPHA, MAX_HEATMAP_ALPHA, MIN_HEATMAP_ALPHA } from "./constants";
import type { HeatmapPaletteRgb } from "./types";

export function lerp(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

export function blendColor(from: readonly [number, number, number], to: readonly [number, number, number], t: number) {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)] as const;
}

export function normalizeHexColor(value: string, fallback: string): string {
  return isValidHexColor(value) ? value.trim().toLowerCase() : fallback;
}

export function clampHeatmapAlpha(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HEATMAP_ALPHA;
  return Math.min(MAX_HEATMAP_ALPHA, Math.max(MIN_HEATMAP_ALPHA, Number(value.toFixed(2))));
}

export function hexToRgbTuple(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

export function rgbaFromHex(value: string, alpha: number): string {
  const [red, green, blue] = hexToRgbTuple(value);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getHeatCellStyle(
  valueNum: number | null,
  minNum: number | null,
  maxNum: number | null,
  palette: HeatmapPaletteRgb,
  alpha: number
) {
  if (valueNum === null || minNum === null || maxNum === null) {
    return {} as const;
  }

  if (minNum === maxNum) {
    const mid = palette.mid;
    return {
      backgroundColor: `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, ${alpha})`,
      color: "#0f172a",
      textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
      WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
    } as const;
  }

  const ratio = Math.min(1, Math.max(0, (valueNum - minNum) / (maxNum - minNum)));

  const color = ratio <= 0.5
    ? blendColor(palette.low, palette.mid, ratio / 0.5)
    : blendColor(palette.mid, palette.high, (ratio - 0.5) / 0.5);

  return {
    backgroundColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`,
    color: "#0f172a",
    textShadow: "0 0 1px rgba(0, 0, 0, 0.28)",
    WebkitTextStroke: "0.25px rgba(0, 0, 0, 0.25)"
  } as const;
}
