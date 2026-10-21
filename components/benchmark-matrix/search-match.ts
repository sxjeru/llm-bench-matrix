/**
 * 搜索匹配公共逻辑。
 *
 * 表格筛选（buildFilteredRows）与单元格高亮（HighlightText）必须共用同一套
 * 分词与匹配规则，否则会出现「行被筛出来了但没有高亮」或「高亮了但行没被筛出来」
 * 这种口径不一致的情况。
 */

/** 转义正则特殊字符，让用户输入的搜索词按字面量匹配。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 拆分搜索关键词：整句 + 按空白切分的单词，去重后按长度倒序。
 *
 * 长词优先，保证搜索 "math 500" 时 "Math 500" 整句会先作为一个整体命中，
 * 而不是被拆成 "math" 和 "500" 两段。
 */
export function extractSearchTokens(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const words = trimmed.split(/\s+/).filter(Boolean);
  return Array.from(new Set([trimmed, ...words])).sort((left, right) => right.length - left.length);
}

/**
 * 生成搜索匹配器：命中条件为「文本包含任一关键词」（忽略大小写）。
 *
 * 搜索词为空时返回 null，表示不做任何过滤。
 */
export function createSearchMatcher(query: string): ((text: string | null | undefined) => boolean) | null {
  const normalizedTokens = extractSearchTokens(query).map((token) => token.toLowerCase());
  if (normalizedTokens.length === 0) return null;

  return (text) => {
    if (!text) return false;

    const normalized = text.toLowerCase();
    return normalizedTokens.some((token) => normalized.includes(token));
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
