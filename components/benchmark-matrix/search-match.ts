/**
 * 搜索匹配公共逻辑。
 *
 * 表格筛选（buildFilteredRows）与单元格高亮（HighlightText）必须共用同一套
 * 分词与匹配规则，否则会出现「行被筛出来了但没有高亮」或「高亮了但行没被筛出来」
 * 这种口径不一致的情况。
 *
 * 支持高级类正则修饰语法：
 * - !term     : 排除包含 term 的结果（否定匹配）
 * - ^term     : 筛选以 term 开头的结果（前缀匹配）
 * - !^term    : 排除以 term 开头的结果
 * - term$     : 筛选以 term 结尾的结果（后缀匹配）
 * - !term$    : 排除以 term 结尾的结果
 * - ^term$    : 筛选完全匹配 term 的结果
 * - \!term    : 转义，作为普通字面量搜索 "!term"
 * - \^term    : 转义，作为普通字面量搜索 "^term"
 * - 多词组合   : 多个规则以空格分隔，遵循交集（AND / 必须同时满足）
 */

/** 转义正则特殊字符，让用户输入的搜索词按字面量匹配。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type SearchRuleKind =
  | "include"        // 包含词：word
  | "exclude"        // 排除词：!word
  | "prefix"         // 开头匹配：^word
  | "exclude_prefix" // 排除以...开头：!^word 或 ^!word
  | "suffix"         // 结尾匹配：word$
  | "exclude_suffix" // 排除以...结尾：!word$
  | "exact"          // 完全匹配：^word$
  | "exclude_exact"; // 排除完全匹配：!^word$

export interface SearchRule {
  raw: string;
  kind: SearchRuleKind;
  term: string;          // 小写，去除修饰符和首尾引号
  displayTerm: string;   // 保留用户输入大小写，用于高亮
  isNegative: boolean;   // 是否为排除/否定规则
}

export interface ParsedSearchQuery {
  rawQuery: string;
  rules: readonly SearchRule[];
  positiveTerms: readonly string[];
  excludeTerms: readonly string[];
  prefixTerms: readonly string[];
  hasRules: boolean;
  isPureNegation: boolean;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * 将用户输入的查询字符串按空格/引号切分为独立 token，并保留成对双引号内的内容。
 */
export function tokenizeSearchQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]!;

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
      inQuotes = !inQuotes;
      current += char;
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
 * 解析单个 Token 为对应的搜索规则。
 */
export function parseTokenRule(rawToken: string): SearchRule | null {
  if (!rawToken) return null;

  // 1. 如果是以 \! 或 \^ 开头，表示转义字符，用户字面搜索 ! 或 ^
  if (rawToken.startsWith("\\!") || rawToken.startsWith("\\^")) {
    const displayTerm = stripQuotes(rawToken.slice(1));
    if (!displayTerm) return null;
    return {
      raw: rawToken,
      kind: "include",
      term: displayTerm.toLowerCase(),
      displayTerm,
      isNegative: false
    };
  }

  let kind: SearchRuleKind = "include";
  let rest = rawToken;

  // 2. 检测前缀修饰符
  if (rest.startsWith("!^") || rest.startsWith("^!")) {
    kind = "exclude_prefix";
    rest = rest.slice(2);
  } else if (rest.startsWith("!")) {
    kind = "exclude";
    rest = rest.slice(1);
  } else if (rest.startsWith("^")) {
    kind = "prefix";
    rest = rest.slice(1);
  }

  // 3. 检测后缀修饰符 $（需非 \$ 转义）
  if (rest.endsWith("$") && !rest.endsWith("\\$") && rest.length > 1) {
    if (kind === "exclude_prefix") {
      kind = "exclude_exact";
    } else if (kind === "prefix") {
      kind = "exact";
    } else if (kind === "exclude") {
      kind = "exclude_suffix";
    } else {
      kind = "suffix";
    }
    rest = rest.slice(0, -1);
  }

  // 4. 处理结尾转义的 \$
  if (rest.endsWith("\\$")) {
    rest = rest.slice(0, -2) + "$";
  }

  // 5. 去除首尾成对引号
  const displayTerm = stripQuotes(rest);
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
    raw: rawToken,
    kind,
    term: displayTerm.toLowerCase(),
    displayTerm,
    isNegative
  };
}

/**
 * 解析完整搜索查询为结构化规则。
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const tokens = tokenizeSearchQuery(query);
  const rules: SearchRule[] = [];

  for (const token of tokens) {
    const rule = parseTokenRule(token);
    if (rule) {
      rules.push(rule);
    }
  }

  const positiveTerms: string[] = [];
  const excludeTerms: string[] = [];
  const prefixTerms: string[] = [];

  for (const rule of rules) {
    if (!rule.isNegative) {
      positiveTerms.push(rule.term);
      if (rule.kind === "prefix" || rule.kind === "exact") {
        prefixTerms.push(rule.term);
      }
    } else {
      excludeTerms.push(rule.term);
    }
  }

  const hasRules = rules.length > 0;
  const isPureNegation = hasRules && rules.every((rule) => rule.isNegative);

  return {
    rawQuery: query,
    rules,
    positiveTerms,
    excludeTerms,
    prefixTerms,
    hasRules,
    isPureNegation
  };
}

/**
 * 拆分搜索关键词（供高亮使用）：整句 + 按规则切分的正向单词，去重后按长度倒序。
 *
 * 排除词（!term）绝对不参与高亮。
 * 当只有排除规则时返回空数组，单元格不高亮任何文本。
 */
export function extractSearchTokens(query: string): string[] {
  const parsed = parseSearchQuery(query);
  if (!parsed.hasRules) return [];

  // 仅提取正向匹配词进行高亮
  const positiveRules = parsed.rules.filter((rule) => !rule.isNegative);
  if (positiveRules.length === 0) return [];

  const positiveDisplayTerms = positiveRules.map((rule) => rule.displayTerm);

  // 如果原始 query 没有排除/前缀等特殊修饰符，保持原有逻辑：整句 + 各单词
  const trimmed = query.trim();
  const hasModifiers = parsed.rules.some((rule) => rule.kind !== "include");

  const tokens = new Set<string>();

  if (!hasModifiers) {
    tokens.add(trimmed);
    positiveDisplayTerms.forEach((term) => {
      if (term) tokens.add(term);
    });
  } else {
    // 包含修饰符时：如果有多个正向词，把正向词连接的短语也作为整体尝试高亮
    if (positiveDisplayTerms.length > 1) {
      tokens.add(positiveDisplayTerms.join(" "));
    }
    positiveDisplayTerms.forEach((term) => {
      if (term) tokens.add(term);
    });
  }

  return Array.from(tokens).sort((left, right) => right.length - left.length);
}

/**
 * 提取必须同时命中的正向检索词：忽略大小写并去重。
 *
 * 排除词（!term）不计入正向检索词列表。
 */
export function extractSearchTerms(query: string): string[] {
  const parsed = parseSearchQuery(query);
  return Array.from(new Set(parsed.positiveTerms));
}

export type SearchTarget = string | readonly (string | null | undefined)[] | null | undefined;

/**
 * 生成搜索匹配器：
 * - 命中条件为「满足全部规则」（交集，忽略大小写）。
 * - 支持 !term（排除）、^term（以...开头）、!^term（排除开头）以及普通词包含。
 * - target 支持单个字符串，或由多个属性字段构成的数组（如 [benchmarkName, benchmarkType]）。
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

    let fieldLowers: string[];
    let combined: string;

    if (Array.isArray(target)) {
      const validFields = target.filter(
        (item): item is string => item != null && typeof item === "string" && item.trim().length > 0
      );
      if (validFields.length === 0) return false;
      fieldLowers = validFields.map((field) => field.toLowerCase());
      combined = fieldLowers.join(" ");
    } else if (typeof target === "string") {
      const trimmed = target.trim();
      if (trimmed.length === 0) return false;
      const lower = target.toLowerCase();
      fieldLowers = [lower];
      combined = lower;
    } else {
      return false;
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      const term = rule.term;

      switch (rule.kind) {
        case "include": {
          const hit = fieldLowers.some((f) => f.includes(term)) || combined.includes(term);
          if (!hit) return false;
          break;
        }
        case "exclude": {
          const hit = fieldLowers.some((f) => f.includes(term)) || combined.includes(term);
          if (hit) return false;
          break;
        }
        case "prefix": {
          const hit = fieldLowers.some((f) => f.startsWith(term)) || combined.startsWith(term);
          if (!hit) return false;
          break;
        }
        case "exclude_prefix": {
          const hit = fieldLowers.some((f) => f.startsWith(term)) || combined.startsWith(term);
          if (hit) return false;
          break;
        }
        case "suffix": {
          const hit = fieldLowers.some((f) => f.endsWith(term)) || combined.endsWith(term);
          if (!hit) return false;
          break;
        }
        case "exclude_suffix": {
          const hit = fieldLowers.some((f) => f.endsWith(term)) || combined.endsWith(term);
          if (hit) return false;
          break;
        }
        case "exact": {
          const hit = fieldLowers.some((f) => f === term) || combined === term;
          if (!hit) return false;
          break;
        }
        case "exclude_exact": {
          const hit = fieldLowers.some((f) => f === term) || combined === term;
          if (hit) return false;
          break;
        }
      }
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
 */
export function getSearchHighlightPlan(query: string): SearchHighlightPlan | null {
  const cached = HIGHLIGHT_PLAN_CACHE.get(query);
  if (cached !== undefined) return cached;

  const tokens = extractSearchTokens(query);
  const plan: SearchHighlightPlan | null = tokens.length === 0
    ? null
    : {
        tokens,
        normalizedTokens: new Set(tokens.map((token) => token.toLowerCase())),
        pattern: new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi")
      };

  if (HIGHLIGHT_PLAN_CACHE.size >= HIGHLIGHT_PLAN_CACHE_LIMIT) {
    HIGHLIGHT_PLAN_CACHE.clear();
  }
  HIGHLIGHT_PLAN_CACHE.set(query, plan);
  return plan;
}
