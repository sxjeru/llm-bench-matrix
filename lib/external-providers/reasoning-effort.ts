/**
 * 推理强度（reasoning effort）解析。
 *
 * 本地库与 artificialanalysis.ai 都把推理强度写在模型名的尾部，但写法不统一：
 *
 * - 本地库偏向裸尾缀：`GPT 5.4 Xhigh`、`Gemini 3.1 Pro High`、`K2.6 Thinking`
 * - AA 偏向尾部括号，且可能是逗号分隔的复合子句：
 *   `Claude Opus 5 (max)`、`Claude Opus 5 (Adaptive Reasoning, Max Effort)`、
 *   `DeepSeek V4 Flash 0731 (Reasoning, Max Effort)`、`Gemma 4 E4B (Non-reasoning)`
 *
 * 这里把两种写法都归一到同一套档位上，供匹配时比较；并提供「同族里取最高档」的能力，
 * 用于本地模型未标注推理强度时默认对齐上游最强的那一条。
 */

/** 档位从弱到强。数值本身不对外暴露，只用于比较大小。 */
const EFFORT_RANK = {
  nonthinking: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  /** `(Reasoning)` / `(Thinking)` 这类只说明「开了推理」但没给档位的写法 */
  thinking: 4,
  high: 5,
  xhigh: 6,
  max: 7
} as const;

export type ReasoningEffort = keyof typeof EFFORT_RANK;

export const REASONING_EFFORT_VALUES = Object.keys(EFFORT_RANK) as ReasoningEffort[];

export function getReasoningEffortRank(effort: ReasoningEffort): number {
  return EFFORT_RANK[effort];
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && value in EFFORT_RANK;
}

/** 归一化后的词 -> 档位。键都是「去掉所有非字母数字」后的小写形式。 */
const EFFORT_ALIASES: Record<string, ReasoningEffort> = {
  nonreasoning: "nonthinking",
  nonthinking: "nonthinking",
  nothinking: "nonthinking",
  noreasoning: "nonthinking",
  reasoningoff: "nonthinking",
  thinkingoff: "nonthinking",

  minimal: "minimal",
  none: "minimal",

  low: "low",
  lowest: "low",

  medium: "medium",
  mid: "medium",
  standard: "medium",
  default: "medium",

  thinking: "thinking",
  think: "thinking",
  reasoning: "thinking",
  adaptivereasoning: "thinking",
  extendedthinking: "thinking",
  reasoningon: "thinking",

  high: "high",
  higher: "high",

  xhigh: "xhigh",
  extrahigh: "xhigh",
  veryhigh: "xhigh",

  max: "max",
  maximum: "max",
  ultra: "max"
};

/** 各种 Unicode 连字符，与 lib/model-pricing.ts 的处理保持一致 */
const HYPHEN_CLASS = "\\-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D";
const TRAILING_BRACKET_PATTERN = /\s*(?:\(([^()]*)\)|（([^（）]*)）|\[([^\[\]]*)\]|【([^【】]*)】)\s*$/;
const CLAUSE_SEPARATOR = /[,，;；/]+/;
/**
 * 裸尾缀：`-xhigh` / ` Max` / `_thinking` / `kimi-k2-6-thinking`。
 *
 * 只取最后一个单词，不能贪心地把前面的词一起吞掉 —— 否则 `Gemini 3.1 Pro High`
 * 会被当成「`Pro High` 是强度标记」，连 `Pro` 一起剥掉。
 */
const TRAILING_BARE_WORD_PATTERN = new RegExp(`[\\s_${HYPHEN_CLASS}]+([A-Za-z]+)$`);
/** `Gemini 2.5 Flash Non-reasoning` 这种连字符复合词，只在前面是空格/下划线时才认 */
const TRAILING_BARE_COMPOUND_PATTERN = new RegExp(`[\\s_]+([A-Za-z]+[${HYPHEN_CLASS}][A-Za-z]+)$`);

function normalizeEffortWord(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stripEffortQualifier(value: string): string {
  return value.replace(/\b(?:effort|mode|setting|level)\b/gi, " ").trim();
}

/**
 * 把单个子句解析成档位。
 *
 * 会先剥掉 `Effort` / `Mode` 这类后缀词，`Max Effort` 与 `max` 因此得到同一个档位。
 * 子句里若还夹带了别的信息（如 `Opus 4.8 Fallback`）会返回 null，由调用方忽略。
 */
function parseEffortClause(clause: string): ReasoningEffort | null {
  const trimmed = clause.trim();
  if (!trimmed) return null;

  const withoutQualifier = stripEffortQualifier(trimmed);
  const direct = EFFORT_ALIASES[normalizeEffortWord(withoutQualifier)];
  if (direct) return direct;

  // `Adaptive Reasoning` 这类多词写法在整体归一后已经能命中；
  // 到这里说明子句里混了其他内容，再退一步按单词逐个试，取最强的那个。
  let best: ReasoningEffort | null = null;
  for (const word of withoutQualifier.split(/\s+/)) {
    const matched = EFFORT_ALIASES[normalizeEffortWord(word)];
    if (!matched) continue;
    if (!best || EFFORT_RANK[matched] > EFFORT_RANK[best]) {
      best = matched;
    }
  }

  return best;
}

/**
 * 裸尾缀只做精确匹配，不走 `parseEffortClause` 的逐词兜底。
 *
 * 尾缀是从模型名里截出来的，逐词兜底会让 `Pro High` 这种组合被误判，
 * 而括号里的内容是上游明确写出来的强度描述，才需要那层宽松处理。
 */
function parseBareEffortToken(token: string): ReasoningEffort | null {
  const normalized = normalizeEffortWord(stripEffortQualifier(token));
  return normalized ? EFFORT_ALIASES[normalized] ?? null : null;
}

/** 括号内容里可能有多个子句，取其中档位最高的一个（`(Adaptive Reasoning, Max Effort)` → max） */
function parseEffortFromBracket(content: string): ReasoningEffort | null {
  let best: ReasoningEffort | null = null;

  for (const clause of content.split(CLAUSE_SEPARATOR)) {
    const parsed = parseEffortClause(clause);
    if (!parsed) continue;
    if (!best || EFFORT_RANK[parsed] > EFFORT_RANK[best]) {
      best = parsed;
    }
  }

  return best;
}

export type ParsedModelEffort = {
  /** 去掉推理强度标记后的模型名，供归一化后比较同族 */
  base: string;
  /** 未标注推理强度时为 null —— 这正是「默认对齐上游最高档」的触发条件 */
  effort: ReasoningEffort | null;
};

/**
 * 从模型名里剥离推理强度标记。
 *
 * 会反复剥离，`Claude Opus 5 (Adaptive Reasoning) (max)` 这类叠写也能一路剥干净；
 * 剥到的档位取所有标记里最高的一个。括号里如果完全不含档位信息（如 `(Preview)`、
 * `(2025-06)`）则保留，避免把版本号之类的有效信息误删。
 */
export function parseModelReasoningEffort(modelName: string): ParsedModelEffort {
  let base = modelName.trim();
  let effort: ReasoningEffort | null = null;

  const record = (parsed: ReasoningEffort | null) => {
    if (!parsed) return;
    if (!effort || EFFORT_RANK[parsed] > EFFORT_RANK[effort]) {
      effort = parsed;
    }
  };

  let changed = true;
  while (changed && base) {
    changed = false;

    const bracketMatch = TRAILING_BRACKET_PATTERN.exec(base);
    if (bracketMatch) {
      const content = bracketMatch[1] ?? bracketMatch[2] ?? bracketMatch[3] ?? bracketMatch[4] ?? "";
      const parsed = parseEffortFromBracket(content);
      if (parsed) {
        record(parsed);
        base = base.slice(0, bracketMatch.index).trim();
        changed = true;
        continue;
      }
    }

    const compoundMatch = TRAILING_BARE_COMPOUND_PATTERN.exec(base);
    if (compoundMatch?.[1]) {
      const parsed = parseBareEffortToken(compoundMatch[1]);
      if (parsed) {
        record(parsed);
        base = base.slice(0, compoundMatch.index).trim();
        changed = true;
        continue;
      }
    }

    const bareMatch = TRAILING_BARE_WORD_PATTERN.exec(base);
    if (bareMatch?.[1]) {
      const parsed = parseBareEffortToken(bareMatch[1]);
      if (parsed) {
        record(parsed);
        base = base.slice(0, bareMatch.index).trim();
        changed = true;
      }
    }
  }

  return { base, effort };
}

/** 取一组档位里最高的那个；空数组返回 null。 */
export function pickHighestReasoningEffort(
  efforts: Array<ReasoningEffort | null>
): ReasoningEffort | null {
  let best: ReasoningEffort | null = null;

  for (const effort of efforts) {
    if (!effort) continue;
    if (!best || EFFORT_RANK[effort] > EFFORT_RANK[best]) {
      best = effort;
    }
  }

  return best;
}

/** 展示用中文标签，后台下拉框直接用 */
export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  nonthinking: "关闭推理",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  thinking: "开启推理（未分档）",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};
