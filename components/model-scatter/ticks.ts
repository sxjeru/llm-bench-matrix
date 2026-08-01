import type { ScatterAxisScale } from "./types";

/**
 * 坐标轴刻度生成。
 *
 * Recharts 自动生成的刻度会直接落在 domain 的等分点上，于是常常读到
 * 32.7 / 48.1 / 63.5 这种数；对数轴则只在整数量级处打点，跨度不到两个
 * 数量级时整条轴上只剩一两个刻度。这里自己算刻度，让读数落在人类友好的
 * 位置上 —— domain 本身不动，顶部底部的留白保持原样。
 */

/** 线性刻度的步长候选（× 10^k）。 */
const LINEAR_STEP_CANDIDATES = [1, 2, 2.5, 5, 10];

/**
 * 对数刻度的尾数分级，从稀疏到密。
 *
 * 跨度大时只标量级（1、10、100）；跨度小时先加密到经典的 1-2-5，
 * 再往下细分。价格轴常见的 0.1 ~ 20 这类不足三个数量级的跨度，
 * 因此能拿到 0.1 / 0.2 / 0.5 / 1 / 2 / 5 / 10 / 20 这样的读数，
 * 而不是整条轴上只剩 0.1、1、10 三个点。
 */
const LOG_MANTISSA_LEVELS: readonly (readonly number[])[] = [
  [1],
  [1, 2, 5],
  [1, 1.5, 2, 3, 5, 7],
  [1, 2, 3, 4, 5, 6, 7, 8, 9]
];

/** 抹掉浮点累加的尾巴，避免出现 0.30000000000000004 这样的刻度。 */
function cleanFloat(value: number): number {
  return Number(Number(value).toPrecision(12));
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;

  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const chosen = LINEAR_STEP_CANDIDATES.find((candidate) => candidate >= normalized - 1e-9) ?? 10;

  return chosen * magnitude;
}

/**
 * 线性轴刻度：步长取 1 / 2 / 2.5 / 5 × 10^k，刻度值一律是步长的整数倍。
 *
 * 例：0–100 的分数轴得到 0、20、40、60、80、100；0–1 的比率轴得到
 * 0、0.2、0.4、0.6、0.8、1。数据最大值离 100 还远时，最大刻度自然贴着
 * 数据本身，不会硬撑到 100。
 */
export function buildLinearTicks(
  domain: readonly [number, number],
  targetCount = 6
): number[] {
  const [low, high] = domain;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return [];

  const step = niceStep((high - low) / Math.max(1, targetCount));
  const ticks: number[] = [];

  const firstIndex = Math.ceil(low / step - 1e-9);
  const lastIndex = Math.floor(high / step + 1e-9);

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    ticks.push(cleanFloat(index * step));
  }

  return ticks;
}

/**
 * 对数轴刻度：在量级之间按 1-2-5 之类的尾数细分。
 *
 * 逐级加密到刻度数够读为止，同时不超过上限 —— 价格轴常见的
 * 0.1 ~ 20 这种不到三个数量级的跨度，因此不会只剩 1 和 10 两个刻度。
 */
export function buildLogTicks(
  domain: readonly [number, number],
  minTicks = 4,
  maxTicks = 11
): number[] {
  const [low, high] = domain;
  if (!(low > 0) || !(high > low)) return [];

  const lowExponent = Math.floor(Math.log10(low));
  const highExponent = Math.ceil(Math.log10(high));

  const collect = (mantissas: readonly number[]): number[] => {
    const ticks: number[] = [];
    for (let exponent = lowExponent; exponent <= highExponent; exponent += 1) {
      mantissas.forEach((mantissa) => {
        const value = mantissa * 10 ** exponent;
        if (value >= low * (1 - 1e-9) && value <= high * (1 + 1e-9)) {
          ticks.push(cleanFloat(value));
        }
      });
    }
    return ticks.sort((left, right) => left - right);
  };

  let best: number[] | null = null;

  for (const mantissas of LOG_MANTISSA_LEVELS) {
    const ticks = collect(mantissas);

    if (best === null) {
      best = ticks;
    } else if (ticks.length <= maxTicks) {
      best = ticks;
    } else {
      break;
    }

    if (best.length >= minTicks) break;
  }

  // 跨度小到连最密的尾数都撑不出刻度时，退回线性刻度总比空轴强
  if (!best || best.length < 2) {
    return buildLinearTicks(domain, minTicks);
  }

  return best;
}

export function buildAxisTicks(
  domain: readonly [number, number],
  scale: ScatterAxisScale,
  targetCount = 6
): number[] {
  return scale === "log" ? buildLogTicks(domain) : buildLinearTicks(domain, targetCount);
}
