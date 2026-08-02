import type { ScatterAxisScale } from "./types";

/** 散点浮窗专用：浅红→浅黄→浅绿，适配暗色底且保持色相差。 */
const SCATTER_RANK_PALETTE = {
  low: [255, 148, 138] as const, // 浅珊瑚红
  mid: [255, 228, 120] as const, // 浅暖黄
  high: [126, 226, 168] as const // 浅薄荷绿
};

function lerpChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

function blendRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number
): readonly [number, number, number] {
  return [
    lerpChannel(from[0], to[0], t),
    lerpChannel(from[1], to[1], t),
    lerpChannel(from[2], to[2], t)
  ] as const;
}

/**
 * 把原始轴值投到「越大越好」的排名空间。
 * 对数轴用 log 拉开数量级，线性轴直接用原值；越小越好则取负。
 */
export function toScatterRankScore(
  value: number,
  higherIsBetter: boolean,
  scale: ScatterAxisScale
): number | null {
  if (!Number.isFinite(value)) return null;

  let rankSpace: number;
  if (scale === "log") {
    if (value <= 0) return null;
    rankSpace = Math.log(value);
  } else {
    rankSpace = value;
  }

  return higherIsBetter ? rankSpace : -rankSpace;
}

export function computeScatterRankRange(
  values: readonly number[],
  higherIsBetter: boolean,
  scale: ScatterAxisScale
): { min: number | null; max: number | null } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  values.forEach((value) => {
    const score = toScatterRankScore(value, higherIsBetter, scale);
    if (score === null) return;
    if (score < min) min = score;
    if (score > max) max = score;
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: null, max: null };
  }

  return { min, max };
}

/**
 * 按有数值点的 min/max 排名取色；不透明。
 * 对数轴的边界也在 log 排名空间里计算。
 */
export function getScatterRankColor(
  value: number,
  values: readonly number[],
  higherIsBetter: boolean,
  scale: ScatterAxisScale
): string | null {
  const score = toScatterRankScore(value, higherIsBetter, scale);
  const range = computeScatterRankRange(values, higherIsBetter, scale);
  if (score === null || range.min === null || range.max === null) return null;

  let color: readonly [number, number, number];
  if (range.min === range.max) {
    color = SCATTER_RANK_PALETTE.mid;
  } else {
    const ratio = Math.min(1, Math.max(0, (score - range.min) / (range.max - range.min)));
    color =
      ratio <= 0.5
        ? blendRgb(SCATTER_RANK_PALETTE.low, SCATTER_RANK_PALETTE.mid, ratio / 0.5)
        : blendRgb(SCATTER_RANK_PALETTE.mid, SCATTER_RANK_PALETTE.high, (ratio - 0.5) / 0.5);
  }

  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}
