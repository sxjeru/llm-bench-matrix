/**
 * 搜索匹配公共逻辑。
 *
 * 表格筛选（buildFilteredRows）与单元格高亮（HighlightText）必须共用同一套
 * 分词与匹配规则，否则会出现「行被筛出来了但没有高亮」或「高亮了但行没被筛出来」
 * 这种口径不一致的情况。
 *
 * 支持以下修饰语法（修饰符与检索词之间不能有空格）：
 * - !term      : 排除包含 term 的结果（否定匹配）
 * - ^term      : 筛选以 term 开头的结果（前缀匹配）
 * - !^term     : 排除以 term 开头的结果（兼容 ^!term）
 * - term$      : 筛选以 term 结尾的结果（后缀匹配）
 * - !term$     : 排除以 term 结尾的结果
 * - ^term$     : 筛选完全匹配 term 的结果
 * - !^term$    : 排除完全匹配 term 的结果（兼容 ^!term$）
 * - "多词短语" : 引号内的空格不参与拆分，按连续子串匹配
 * - \x         : 反斜杠转义紧随其后的单个字符，按字面量处理（如 100\$、\!foo）
 * - 未闭合引号 : 按普通空白切分降级（打字中间态不阻塞后续检索词）
 * - 多词组合   : 多个规则以空格分隔，遵循交集（AND / 必须同时满足）
 *
 * 多字段目标（数组，如 [benchmarkName, benchmarkType]）的匹配口径：
 * 每条规则只需命中任意一个字段；空字段会被忽略。
 * 因此 ^foo 表示「某个字段以 foo 开头」，^foo$ 表示「某个字段完全等于 foo」。
 * 未加引号的多词查询会被拆成多条规则，仍可分别命中不同字段。
 */

/** 转义正则特殊字符，让用户输入的搜索词按字面量匹配。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SearchRuleKind =
  | "include"        // 包含词：word
  | "exclude"        // 排除词：!word
  | "prefix"         // 开头匹配：^word
  | "exclude_prefix" // 排除以...开头：!^word 或 ^!word
  | "suffix"         // 结尾匹配：word$
  | "exclude_suffix" // 排除以...结尾：!word$
  | "exact"          // 完全匹配：^word$
  | "exclude_exact"; // 排除完全匹配：!^word$

interface SearchRule {
  kind: SearchRuleKind;
  term: string;          // 小写，去除修饰符和首尾引号
  displayTerm: string;   // 保留用户输入大小写，用于高亮
  isNegative: boolean;   // 是否为排除/否定规则
}

interface ParsedSearchQuery {
  rules: readonly SearchRule[];
  hasRules: boolean;
  isPureNegation: boolean;
}

type ScannedToken = {
  /** 已解码的字符（反斜杠转义已消费）。 */
  chars: string[];
  /** 与 chars 对齐，标记该字符在原始 token 中是否被反斜杠转义。 */
  escaped: boolean[];
};

/**
 * 扫描 token，解码反斜杠转义并记录转义位置。
 *
 * 修饰符只在「未被转义」的字符上生效：`100\$` 是字面量，
 * `\!foo` 里的 `!` 也不再是否定修饰符。
 */
function scanToken(rawToken: string): ScannedToken {
  const chars: string[] = [];
  const escaped: boolean[] = [];
  let isEscaped = false;

  for (const char of rawToken) {
    if (isEscaped) {
      chars.push(char);
      escaped.push(true);
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    chars.push(char);
    escaped.push(false);
  }

  // 末尾孤立的反斜杠按字面量保留
  if (isEscaped) {
    chars.push("\\");
    escaped.push(false);
  }

  return { chars, escaped };
}

/** 去掉未转义的成对首尾引号，并裁剪首尾空白。 */
function stripQuotes(chars: string[], escaped: boolean[]): string {
  let start = 0;
  let end = chars.length;

  if (
    end - start >= 2 &&
    chars[start] === '"' &&
    !escaped[start] &&
    chars[end - 1] === '"' &&
    !escaped[end - 1]
  ) {
    start += 1;
    end -= 1;
  }

  return chars.slice(start, end).join("").trim();
}

/** 引号是否成对（转义字符不参与配对）。 */
function hasBalancedQuotes(query: string): boolean {
  let inQuotes = false;
  let isEscaped = false;

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === "\\") {
      isEscaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
    }
  }

  return !inQuotes;
}

function scanQueryTokens(query: string, enableQuotes: boolean): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let isEscaped = false;

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;

    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      if (enableQuotes) {
        inQuotes = !inQuotes;
        current += char;
      }
      // 未闭合引号的降级路径：丢弃引号，按普通空白切分
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * 将用户输入切分为独立 token，并保留成对双引号内的内容。
 *
 * 引号未闭合（通常是打字中间态）时按普通字符处理并丢弃引号，
 * 避免 `"math` 这类输入把后续检索词一起吞掉、导致整表为空。
 */
function tokenizeSearchQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return hasBalancedQuotes(trimmed)
    ? scanQueryTokens(trimmed, true)
    : scanQueryTokens(trimmed, false);
}

/**
 * 解析单个 Token 为对应的搜索规则。
 *
 * 修饰符只在未转义的位置生效，检索词部分统一在扫描阶段完成 unescape。
 */
function parseTokenRule(rawToken: string): SearchRule | null {
  const { chars, escaped } = scanToken(rawToken);
  if (chars.length === 0) return null;

  let kind: SearchRuleKind = "include";
  let start = 0;

  // 1. 检测前缀修饰符；被转义的字符不参与判定
  if (!escaped[0]) {
    const hasUnescapedSecond = chars.length > 1 && !escaped[1];
    if (
      hasUnescapedSecond &&
      ((chars[0] === "!" && chars[1] === "^") || (chars[0] === "^" && chars[1] === "!"))
    ) {
      kind = "exclude_prefix";
      start = 2;
    } else if (chars[0] === "!") {
      kind = "exclude";
      start = 1;
    } else if (chars[0] === "^") {
      kind = "prefix";
      start = 1;
    }
  }

  // 2. 检测结尾未转义的 $ 修饰符
  let end = chars.length;
  const lastIndex = end - 1;
  if (end - start > 1 && chars[lastIndex] === "$" && !escaped[lastIndex]) {
    if (kind === "exclude_prefix") {
      kind = "exclude_exact";
    } else if (kind === "prefix") {
      kind = "exact";
    } else if (kind === "exclude") {
      kind = "exclude_suffix";
    } else {
      kind = "suffix";
    }
    end = lastIndex;
  }

  // 3. 解码后的剩余部分即检索词
  const displayTerm = stripQuotes(chars.slice(start, end), escaped.slice(start, end));
  if (!displayTerm) {
    // 只有修饰符没有实际内容（如仅输入 ! 或 ^），视为未完成输入，忽略此 token
    return null;
  }

  const isNegative =
    kind === "exclude" ||
    kind === "exclude_prefix" ||
    kind === "exclude_suffix" ||
    kind === "exclude_exact";

  return {
    kind,
    term: displayTerm.toLowerCase(),
    displayTerm,
    isNegative
  };
}

/** 解析完整搜索查询为结构化规则。 */
function parseSearchQuery(query: string): ParsedSearchQuery {
  const tokens = tokenizeSearchQuery(query);
  const rules: SearchRule[] = [];

  for (const token of tokens) {
    const rule = parseTokenRule(token);
    if (rule) {
      rules.push(rule);
    }
  }

  const hasRules = rules.length > 0;

  return {
    rules,
    hasRules,
    isPureNegation: hasRules && rules.every((rule) => rule.isNegative)
  };
}

type HighlightEntry = {
  /** 保留用户输入大小写的检索词。 */
  term: string;
  /** 该词只允许出现在字段开头。 */
  anchorStart: boolean;
  /** 该词只允许出现在字段结尾。 */
  anchorEnd: boolean;
};

/**
 * 构建高亮词条：把正向规则转换为带锚点信息的匹配项。
 *
 * - include 词不带锚点，随处高亮；
 * - prefix / suffix / exact 分别生成 ^term / term$ / ^term$，
 *   与筛选时的「任一字段」口径保持一致，避免高亮文本中间的同名片段；
 * - 纯包含查询额外保留整句，让连续命中的短语作为整体呈现；
 * - 排除词不参与高亮。
 */
function buildHighlightEntries(query: string): HighlightEntry[] {
  const parsed = parseSearchQuery(query);
  const positiveRules = parsed.rules.filter((rule) => !rule.isNegative);
  if (positiveRules.length === 0) return [];

  const entries: HighlightEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (term: string, anchorStart = false, anchorEnd = false) => {
    if (!term) return;
    const key = `${anchorStart ? "^" : ""}${term}${anchorEnd ? "$" : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ term, anchorStart, anchorEnd });
  };

  const allPlain = positiveRules.every((rule) => rule.kind === "include");
  const hasNegative = parsed.rules.some((rule) => rule.isNegative);
  if (allPlain && (!hasNegative || positiveRules.length > 1)) {
    addEntry(positiveRules.map((rule) => rule.displayTerm).join(" "));
  }

  for (const rule of positiveRules) {
    addEntry(
      rule.displayTerm,
      rule.kind === "prefix" || rule.kind === "exact",
      rule.kind === "suffix" || rule.kind === "exact"
    );
  }

  return entries.sort((left, right) => right.term.length - left.term.length);
}

export type SearchTarget = string | readonly (string | null | undefined)[] | null | undefined;

/** 归一化匹配目标：裁剪空白、忽略空字段并统一转小写。 */
function normalizeSearchFields(
  target: string | readonly (string | null | undefined)[]
): string[] {
  const rawFields = typeof target === "string" ? [target] : target;
  const fields: string[] = [];

  for (const item of rawFields) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    fields.push(trimmed.toLowerCase());
  }

  return fields;
}

/**
 * 判断单条规则是否命中任意一个字段。
 *
 * 采用「任一字段」而非拼接后的整串：这样 ^foo 表示某个字段以 foo 开头。
 * 多词查询会被拆成多条规则，因此「名称命中一个词、分类命中另一个词」仍然成立；
 * 而引号短语作为单条规则，不会被跨字段拼接误命中。
 */
function matchesRule(rule: SearchRule, fields: readonly string[]): boolean {
  const term = rule.term;

  switch (rule.kind) {
    case "include":
      return fields.some((field) => field.includes(term));
    case "exclude":
      return !fields.some((field) => field.includes(term));
    case "prefix":
      return fields.some((field) => field.startsWith(term));
    case "exclude_prefix":
      return !fields.some((field) => field.startsWith(term));
    case "suffix":
      return fields.some((field) => field.endsWith(term));
    case "exclude_suffix":
      return !fields.some((field) => field.endsWith(term));
    case "exact":
      return fields.some((field) => field === term);
    case "exclude_exact":
      return !fields.some((field) => field === term);
  }
}

/**
 * 生成搜索匹配器：
 * - 命中条件为「满足全部规则」（交集，忽略大小写）。
 * - 每条规则只需命中任一字段；target 支持单个字符串，或属性字段数组。
 * - 纯否定查询对「没有任何可检索内容」的目标返回 true（不含 X 天然成立）。
 *
 * 搜索词为空或没有有效规则时返回 null，表示不做任何过滤。
 */
export function createSearchMatcher(
  query: string
): ((target: SearchTarget) => boolean) | null {
  const parsed = parseSearchQuery(query);
  if (!parsed.hasRules) return null;

  const rules = parsed.rules;

  return (target: SearchTarget): boolean => {
    if (!target) return false;

    const fields = normalizeSearchFields(target);
    if (fields.length === 0) {
      // 空行：含正向规则时不命中；纯否定查询应保留。
      return parsed.isPureNegation;
    }

    for (let i = 0; i < rules.length; i++) {
      if (!matchesRule(rules[i]!, fields)) return false;
    }

    return true;
  };
}

export type SearchHighlightPlan = {
  /** 命中的关键词，保留用户输入的大小写。 */
  tokens: readonly string[];
  /** 关键词的小写集合，用于判断切分出来的片段是否命中。 */
  normalizedTokens: ReadonlySet<string>;
  /** 带捕获组的正则：split 之后命中片段位于奇数下标。 */
  pattern: RegExp;
};

const HIGHLIGHT_PLAN_CACHE = new Map<string, SearchHighlightPlan | null>();
const HIGHLIGHT_PLAN_CACHE_LIMIT = 32;

/**
 * 生成高亮计划；同一搜索词复用同一份正则，避免每个单元格重复编译。
 *
 * 正则按规则类型带锚点（^ / $），与筛选口径保持一致。
 */
export function getSearchHighlightPlan(query: string): SearchHighlightPlan | null {
  const cached = HIGHLIGHT_PLAN_CACHE.get(query);
  if (cached !== undefined) return cached;

  const entries = buildHighlightEntries(query);
  const tokens = Array.from(new Set(entries.map((entry) => entry.term)));

  const plan: SearchHighlightPlan | null = entries.length === 0
    ? null
    : {
        tokens,
        normalizedTokens: new Set(tokens.map((token) => token.toLowerCase())),
        pattern: new RegExp(
          `(${entries
            .map(
              (entry) =>
                `${entry.anchorStart ? "^" : ""}${escapeRegExp(entry.term)}${entry.anchorEnd ? "$" : ""}`
            )
            .join("|")})`,
          "gi"
        )
      };

  if (HIGHLIGHT_PLAN_CACHE.size >= HIGHLIGHT_PLAN_CACHE_LIMIT) {
    HIGHLIGHT_PLAN_CACHE.clear();
  }
  HIGHLIGHT_PLAN_CACHE.set(query, plan);
  return plan;
}
