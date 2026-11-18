/**
 * 带量级后缀的数值解析（`1.2M`、`128K`、`$687.25k`）的唯一事实来源。
 *
 * 约定：
 * - 量级字母必须紧贴数字：`1.2M` 是量级，`1.2 M` 不是（留给 note）；
 * - 只认 `k`/`K` 与**大写** `M`/`B`/`T`。小写 `m`/`b`/`t` 在论文/HTML 表格里
 *   常是脚注字母（`85.3b`），也可能是分钟等单位，换算会静默错值，因此保持原样；
 * - 量级字母后面紧跟其它字母（`1.2MB`、`1.2million`）时整体不识别，
 *   由调用方按「数值 + note」处理；
 * - 货币符号是可选的：`1.2M` 与 `$1.2M` 都换算成 1200000，符号只影响展示。
 */

const CURRENCY_SYMBOL_CLASS = "[$¥€£]";
const MAGNITUDE_SUFFIX_PATTERN = "[kKMBT](?![A-Za-z])";

/** 供各处正则复用的「数值 token」片段：可选货币符号 + 数字 + 可选量级后缀 */
export const SCALED_NUMBER_TOKEN_SOURCE =
  `(?:${CURRENCY_SYMBOL_CLASS}\\s*)?[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:${MAGNITUDE_SUFFIX_PATTERN})?`;

const MAGNITUDE_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12
};

const STRICT_SCALED_AMOUNT_REGEX = new RegExp(
  `^\\s*(?:(${CURRENCY_SYMBOL_CLASS})\\s*)?([+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)([kKMBT])?\\s*$`
);

const LEADING_SCALED_TOKEN_REGEX = new RegExp(`^\\s*(${SCALED_NUMBER_TOKEN_SOURCE})`);

export type ParsedScaledAmount = {
  /** 量级换算后的数值，按落库精度收敛到 6 位小数 */
  amount: number;
  /** 原始尾数文本（可能含千分位与正负号） */
  mantissaText: string;
  /** 尾数小数位数，用于保持原书写精度 */
  fractionDigits: number;
  /** 量级字母，未带后缀时为 null */
  magnitude: string | null;
  /** 货币符号，未带符号时为 null */
  symbol: string | null;
};

function roundToStoredScale(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(6));
}

function readFractionDigits(mantissaText: string): number {
  return mantissaText.match(/\.(\d+)/)?.[1]?.length ?? 0;
}

/**
 * 严格解析一个完整的数值 token（前后允许空白）。
 * 带任何附加文本时返回 null，调用方应回退到「数值 + note」的旧路径。
 */
export function parseScaledAmount(rawInput: string): ParsedScaledAmount | null {
  const match = rawInput.match(STRICT_SCALED_AMOUNT_REGEX);
  if (!match) return null;

  const [, symbol, mantissaText, magnitude] = match;
  const mantissa = Number.parseFloat(mantissaText.replace(/,/g, ""));
  if (!Number.isFinite(mantissa)) return null;

  const multiplier = magnitude ? MAGNITUDE_MULTIPLIERS[magnitude] ?? 1 : 1;

  return {
    amount: roundToStoredScale(mantissa * multiplier),
    mantissaText,
    fractionDigits: readFractionDigits(mantissaText),
    magnitude: magnitude ?? null,
    symbol: symbol ?? null
  };
}

const ATTACHED_MARKER_SUFFIX_REGEX = /[*∗﹡✱✳✻^][0-9A-Za-z]*$/;

/**
 * 宽松解析：先按量级规则解析，失败再退回旧的「去符号 + parseFloat」。
 * 用于 `valueNum` 计算这类「必须给出一个数」的场景。
 */
export function parseNumericTokenAmount(rawInput: string): number | null {
  const scaled = parseScaledAmount(rawInput)
    ?? parseScaledAmount(rawInput.replace(ATTACHED_MARKER_SUFFIX_REGEX, ""));
  if (scaled) return scaled.amount;

  const parsed = Number.parseFloat(rawInput.replace(/[$¥€£,#＃\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 按原书写风格格式化：`$1.03825M` 编辑后仍是 `$1.03825M`，
 * 而不是展开成 `$1,038,250`。无法用原量级表达时返回 null，由调用方回退。
 */
export function formatScaledAmountLike(rawInput: string, amount: number): string | null {
  const leadingToken = rawInput.match(LEADING_SCALED_TOKEN_REGEX)?.[1];
  if (!leadingToken) return null;

  const parsed = parseScaledAmount(leadingToken);
  if (!parsed || !parsed.magnitude) return null;

  if (parsed.amount === roundToStoredScale(amount)) {
    return leadingToken.trim();
  }

  const multiplier = MAGNITUDE_MULTIPLIERS[parsed.magnitude] ?? 1;
  const mantissa = amount / multiplier;
  // 太小会被写成 `$0.000001M` 这类无意义形式，让调用方改用完整数字
  if (mantissa !== 0 && Math.abs(mantissa) < 0.01) return null;

  const roundedMantissa = Number(mantissa.toFixed(6));
  if (!Number.isFinite(roundedMantissa)) return null;

  return `${parsed.symbol ?? ""}${roundedMantissa}${parsed.magnitude}`;
}
