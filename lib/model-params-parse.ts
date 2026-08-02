/**
 * 从模型名推断参数量，用于后台「模型参数」tab 的建议值。
 *
 * 解析结果只作为建议呈现，由管理员确认后才落库，因此这里宁可少猜也不要猜错：
 * 任何无法唯一确定总参数量的写法（例如 Mixtral 的 8x22B）都只写 note，不填数值。
 */

/**
 * 可录入的参数量区间，单位 B（十亿）。两端都由 models.total_params_b 的列类型
 * numeric(10, 3) 决定：
 * - 小于 0.001 会被舍入成 0，触发 models_params_range 的 `> 0` 约束；
 * - 列的物理上限是 9999999.999，这里收紧到 100000B（即 100T），远超现实模型规模，
 *   实际作用是拦数量级填错（例如把 685B 填成 685000000000）。
 *
 * 定义在本模块是因为它不依赖 db，服务端 schema 与后台表单可以共用同一组边界。
 */
export const MIN_PARAMS_B = 0.001;
export const MAX_PARAMS_B = 100_000;

/** 1T = 1000B；建议与落库统一用 B，避免前后台单位分裂 */
const TRILLION_TO_BILLION = 1000;

/** 总参数量：`120B`、`1T`、`E4B`（E 前缀表示估算，沿用 extractModelScaleToken 的约定） */
const TOTAL_PARAMS_PATTERN = /\b(E?)(\d+(?:\.\d+)?)([BT])\b/gi;

/** 激活参数量：`A22B` / `A1T`（MoE 命名惯例，如 Qwen3-235B-A22B） */
const ACTIVATED_PARAMS_PATTERN = /\bA(\d+(?:\.\d+)?)([BT])\b/i;

/** 专家数 x 单专家规模：`8x22B`，总参数量不等于两者相乘，无法直接推断 */
const EXPERT_LAYOUT_PATTERN = /\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)([BT])\b/i;

/** 把名字里的 B/T 统一换算成 B（十亿） */
function toParamsInBillions(sizeText: string, unit: string): number | null {
  const value = toFiniteNumber(sizeText);
  if (value === null) return null;
  return unit.toUpperCase() === "T" ? value * TRILLION_TO_BILLION : value;
}

export type ParsedModelParams = {
  totalParamsB: number | null;
  activatedParamsB: number | null;
  isEstimated: boolean;
  note: string | null;
};

function toFiniteNumber(input: string): number | null {
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 取名字里最大的 `NNB` / `NNT`（换算为 B 后比较）作为总参数量。
 *
 * `A22B` 天然不会被 TOTAL_PARAMS_PATTERN 命中（`A` 与 `2` 之间没有单词边界），
 * 所以不需要先剔除激活标记。
 */
function extractTotalParams(modelName: string): { value: number; isEstimated: boolean } | null {
  let best: { value: number; isEstimated: boolean } | null = null;

  for (const match of modelName.matchAll(TOTAL_PARAMS_PATTERN)) {
    const [, estimatePrefix, sizeText, unit] = match;
    const value = toParamsInBillions(sizeText, unit);
    if (value === null) continue;

    if (!best || value > best.value) {
      best = { value, isEstimated: estimatePrefix.toLowerCase() === "e" };
    }
  }

  return best;
}

export function parseModelParamsFromName(modelName: string): ParsedModelParams | null {
  const name = modelName.trim();
  if (!name) return null;

  const expertLayoutMatch = name.match(EXPERT_LAYOUT_PATTERN);
  if (expertLayoutMatch) {
    const [matchedText] = expertLayoutMatch;
    return {
      totalParamsB: null,
      activatedParamsB: null,
      isEstimated: false,
      note: `MoE ${matchedText.replace(/\s+/g, "")}，总参数量需人工确认`
    };
  }

  const total = extractTotalParams(name);
  if (!total) return null;

  const activatedMatch = name.match(ACTIVATED_PARAMS_PATTERN);
  const activated = activatedMatch
    ? toParamsInBillions(activatedMatch[1], activatedMatch[2])
    : null;

  // 激活参数量不可能大于总参数量，出现这种情况说明其中一个标记被误读，丢弃激活值
  const safeActivated = activated !== null && activated <= total.value ? activated : null;

  return {
    totalParamsB: total.value,
    activatedParamsB: safeActivated,
    isEstimated: total.isEstimated,
    note: null
  };
}

/** 建议值是否含可直接写入的数值（仅有 note 的建议不参与「一键采纳」） */
export function hasParamsSuggestionValue(parsed: ParsedModelParams | null): boolean {
  return parsed !== null && parsed.totalParamsB !== null;
}
