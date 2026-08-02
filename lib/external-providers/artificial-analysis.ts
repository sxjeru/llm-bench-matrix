import { z } from "zod";
import {
  createTimedCacheStore,
  invalidateTimedCacheStore,
  withTimedCache
} from "@/lib/server-cache";
import {
  getReasoningEffortRank,
  parseModelReasoningEffort,
  type ReasoningEffort
} from "./reasoning-effort";

/**
 * artificialanalysis.ai 数据 API 适配。
 *
 * 只负责「抓取 → 指标目录 → 模型匹配 → 生成导入行」，落库由
 * `importExternalBenchmarkRows`（lib/admin-service.ts）负责。
 *
 * 同时用两个端点，因为免费档下它们的数据是互补的：
 *
 * - 新 API `/api/v2/language/models/free`（文档 https://artificialanalysis.ai/data-api/docs）
 *   是主源：三个复合指数、`artificial_analysis_intelligence_index_cost`、pricing、performance
 *   都以它为准。分页返回，必须枚举完所有页。
 * - 旧 API `/api/v2/data/llms/models` 仍可用，且免费档下**反而**带着逐项 benchmark
 *   （mmlu_pro / gpqa / hle / livecodebench / scicode / math_500 / aime）——
 *   新 API 免费档明确「Excludes the full evaluation set」，逐项分数是 Pro 档才有的。
 *   所以旧 API 只用来补齐新 API 没有的 evaluations，其余字段一律不采信。
 *
 * 两者都用 `x-api-key` 鉴权。使用需按 AA 要求标注数据来源。
 */

export const ARTIFICIAL_ANALYSIS_SOURCE_ID = "artificial-analysis";
/** 写进 benchmark_values.source 的展示名（落库时会被加上 `text:` 前缀） */
export const ARTIFICIAL_ANALYSIS_SOURCE_LABEL = "Artificial Analysis";
export const ARTIFICIAL_ANALYSIS_SETTINGS_KEY = "external_import:artificial-analysis";
/** AA 要求所有使用其 API 的场景都标注来源 */
export const ARTIFICIAL_ANALYSIS_ATTRIBUTION_URL = "https://artificialanalysis.ai/";

/**
 * `/api-reference` 是给人看的文档页（`/documentation` 会 301 到它），不是数据接口；
 * 数据一律走 `/api/v2`。`/api/v1` 已经下线（返回 HTML 404），无需兼容。
 *
 * `/api/v2` 下还有一批媒体类端点（image / video / speech / music arena），返回的是
 * elo / ci_95 / samples。本项目已有 Vision/Audio/Video 模态与 Elo 专属处理，
 * 将来接它们时在这里加端点常量即可，不必再动请求层。
 */
const API_BASE_URL = "https://artificialanalysis.ai/api/v2";
/** 新 API：主源，分页 */
const FREE_LANGUAGE_MODELS_ENDPOINT = "/language/models/free";
/** 旧 API：只用来补 evaluations，单次返回全量 */
const LEGACY_LLM_MODELS_ENDPOINT = "/data/llms/models";
const FETCH_TIMEOUT_MS = 60_000;
const MAX_BYTES = 16 * 1024 * 1024;
/** 分页失控时的兜底上限，正常终止条件是 pagination.has_more */
const MAX_PAGES = 100;
/**
 * 缓存 1 小时。
 *
 * 一次快照要打「分页数 + 1」次上游，而免费档有每日调用上限；
 * 上游数据本身也是天级更新，5 分钟级的新鲜度没有意义。
 */
const SNAPSHOT_CACHE_TTL_MS = 60 * 60_000;

const snapshotStore = createTimedCacheStore<ArtificialAnalysisSnapshot>();

export function invalidateArtificialAnalysisSnapshotCache() {
  invalidateTimedCacheStore(snapshotStore);
}

// ---------------------------------------------------------------------------
// 上游响应
// ---------------------------------------------------------------------------

/**
 * 数值型字段一律用宽松 record 承接：上游随版本增删指标是常态，
 * 枚举字段只会让适配层比上游先坏掉。指标目录改为运行时发现。
 */
const numericRecordSchema = z.record(z.string(), z.union([z.number(), z.null()]));

const freeModelCreatorSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional()
  })
  .loose();

const intelligenceIndexCostSchema = z
  .object({
    total_cost: z.number().nullable().optional(),
    cost_per_task: z
      .object({ total_cost: z.number().nullable().optional() })
      .loose()
      .nullable()
      .optional()
  })
  .loose();

const freeModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().nullable().optional(),
    release_date: z.string().nullable().optional(),
    model_creator: freeModelCreatorSchema.nullable().optional(),
    evaluations: numericRecordSchema.nullable().optional(),
    artificial_analysis_intelligence_index_cost: intelligenceIndexCostSchema.nullable().optional(),
    pricing: numericRecordSchema.nullable().optional(),
    performance: numericRecordSchema.nullable().optional()
  })
  .loose();

const paginationSchema = z
  .object({
    page: z.number(),
    page_size: z.number(),
    total_pages: z.number(),
    has_more: z.boolean()
  })
  .loose();

const freeResponseSchema = z
  .object({
    tier: z.string().optional(),
    intelligence_index_version: z.number().nullable().optional(),
    pagination: paginationSchema,
    data: z.array(freeModelSchema)
  })
  .loose();

const legacyModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    slug: z.string().optional(),
    model_creator: z.object({ name: z.string().optional() }).loose().optional(),
    evaluations: numericRecordSchema.optional()
  })
  .loose();

const legacyResponseSchema = z
  .object({
    data: z.array(legacyModelSchema)
  })
  .loose();

/** 指标键的组前缀。带前缀是为了让两个来源的字段不会撞名，也让 sourceBenchmarkId 自解释。 */
export const METRIC_GROUP_PREFIX = {
  evaluation: "evaluations.",
  performance: "performance.",
  cost: "cost."
} as const;

/**
 * 归一化后的上游模型：两个 API 合并的结果。
 *
 * `metrics` 是扁平化的指标表，键即 catalog 的 key，避免下游还要区分
 * 「这个字段在 evaluations 里还是顶层」。
 */
export type ArtificialAnalysisModel = {
  id: string;
  name: string;
  slug: string | null;
  creatorName: string | null;
  releaseDate: string | null;
  metrics: Record<string, number>;
  /** 哪些指标是旧 API 补进来的，供后台排查用 */
  legacyMetricKeys: string[];
};

// ---------------------------------------------------------------------------
// 指标目录
// ---------------------------------------------------------------------------

export type MetricGroup = "evaluation" | "performance" | "cost";
export type MetricValueScale = "fraction" | "absolute";

export type MetricCatalogEntry = {
  /** 带组前缀的指标键，如 `evaluations.mmlu_pro`、`performance.median_output_tokens_per_second` */
  key: string;
  group: MetricGroup;
  /** 默认 benchmark 名称，后台可覆盖 */
  label: string;
  benchmarkType: string;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  /** fraction 表示上游给的是 0-1 小数，落库前需要 ×100 对齐库里的百分制 */
  valueScale: MetricValueScale;
  /** 覆盖到的上游模型数，供后台判断这一项值不值得导 */
  modelCount: number;
  minValue: number | null;
  maxValue: number | null;
  sampleValues: number[];
  /** 该指标是否只能从旧 API 拿到 */
  legacyOnly: boolean;
};

type KnownMetric = {
  label: string;
  benchmarkType: string;
  unit?: string;
  higherIsBetter?: boolean;
  modalities?: string[];
  valueScale?: MetricValueScale;
};

/**
 * 已知指标的展示名与分类。命中不到的走 `humanizeMetricKey` 兜底 ——
 * 上游加新指标不需要改代码。
 */
const KNOWN_METRICS: Record<string, KnownMetric> = {
  // --- 复合指数：新旧 API 都有，0-100 绝对量纲 ---
  "evaluations.artificial_analysis_intelligence_index": {
    label: "AA Intelligence Index",
    benchmarkType: "Overall",
    valueScale: "absolute"
  },
  "evaluations.artificial_analysis_coding_index": {
    label: "AA Coding Index",
    benchmarkType: "Coding",
    valueScale: "absolute"
  },
  "evaluations.artificial_analysis_agentic_index": {
    label: "AA Agentic Index",
    benchmarkType: "Agentic",
    valueScale: "absolute"
  },
  "evaluations.artificial_analysis_math_index": {
    label: "AA Math Index",
    benchmarkType: "Math",
    valueScale: "absolute"
  },

  // --- 逐项 benchmark：免费档只有旧 API 给，0-1 小数 ---
  "evaluations.mmlu_pro": { label: "MMLU-Pro", benchmarkType: "Knowledge" },
  "evaluations.gpqa": { label: "GPQA Diamond", benchmarkType: "Reasoning" },
  "evaluations.gpqa_diamond": { label: "GPQA Diamond", benchmarkType: "Reasoning" },
  "evaluations.hle": { label: "Humanity's Last Exam", benchmarkType: "Reasoning" },
  "evaluations.livecodebench": { label: "LiveCodeBench", benchmarkType: "Coding" },
  "evaluations.scicode": { label: "SciCode", benchmarkType: "Coding" },
  "evaluations.math_500": { label: "MATH-500", benchmarkType: "Math" },
  "evaluations.aime": { label: "AIME", benchmarkType: "Math" },
  "evaluations.aime_2025": { label: "AIME 2025", benchmarkType: "Math" },
  "evaluations.ifbench": { label: "IFBench", benchmarkType: "Instruction Following" },
  "evaluations.aa_lcr": { label: "AA-LCR", benchmarkType: "Long Context" },
  "evaluations.terminalbench_hard": { label: "Terminal-Bench Hard", benchmarkType: "Agentic" },
  "evaluations.terminalbench_v2_1": { label: "Terminal-Bench v2.1", benchmarkType: "Agentic" },
  "evaluations.tau2_telecom": { label: "𝜏²-Bench Telecom", benchmarkType: "Agentic" },
  "evaluations.tau_banking": { label: "𝜏³-Banking", benchmarkType: "Agentic" },
  "evaluations.critpt": { label: "CritPt", benchmarkType: "Reasoning" },
  "evaluations.gdpval_aa_normalized": { label: "GDPval-AA", benchmarkType: "Agentic" },
  "evaluations.gdpval_aa_elo": {
    label: "GDPval-AA (Elo)",
    benchmarkType: "Agentic",
    valueScale: "absolute"
  },
  "evaluations.aa_omniscience_index": {
    label: "AA-Omniscience Index",
    benchmarkType: "Knowledge",
    valueScale: "absolute"
  },
  "evaluations.aa_omniscience_accuracy": { label: "AA-Omniscience Accuracy", benchmarkType: "Knowledge" },
  "evaluations.aa_omniscience_non_hallucination_rate": {
    label: "AA-Omniscience Non-Hallucination Rate",
    benchmarkType: "Knowledge"
  },
  "evaluations.mmmu_pro": { label: "MMMU-Pro", benchmarkType: "Vision", modalities: ["Vision"] },
  "evaluations.artificial_analysis_openness_index": {
    label: "AA Openness Index",
    benchmarkType: "Overall",
    valueScale: "absolute"
  },
  "evaluations.artificial_analysis_multilingual_index": {
    label: "AA Multilingual Index",
    benchmarkType: "Overall",
    valueScale: "absolute"
  },

  // --- 性能：绝对量纲 ---
  "performance.median_output_tokens_per_second": {
    label: "Output Speed",
    benchmarkType: "Performance",
    unit: "tokens/s",
    higherIsBetter: true,
    valueScale: "absolute"
  },
  "performance.median_time_to_first_token_seconds": {
    label: "Time To First Token",
    benchmarkType: "Performance",
    unit: "s",
    higherIsBetter: false,
    valueScale: "absolute"
  },
  "performance.median_time_to_first_answer_token_seconds": {
    label: "Time To First Answer Token",
    benchmarkType: "Performance",
    unit: "s",
    higherIsBetter: false,
    valueScale: "absolute"
  },
  "performance.median_end_to_end_response_time_seconds": {
    label: "End-to-End Response Time",
    benchmarkType: "Performance",
    unit: "s",
    higherIsBetter: false,
    valueScale: "absolute"
  },

  // --- 跑一次 Intelligence Index 的成本：与 token 单价是两回事，越低越好 ---
  "cost.intelligence_index_total_cost": {
    label: "AA Intelligence Index Total Cost",
    benchmarkType: "Cost",
    unit: "USD",
    higherIsBetter: false,
    valueScale: "absolute"
  },
  "cost.intelligence_index_cost_per_task": {
    label: "AA Intelligence Index Cost per Task",
    benchmarkType: "Cost",
    unit: "USD",
    higherIsBetter: false,
    valueScale: "absolute"
  }
};

/** token 单价由既有的「价格管理」（models.dev）负责，不进候选 */
const EXCLUDED_EVALUATION_PATTERN = /(^|_)(price|pricing)(_|$)/i;
/** 兜底的 lower-is-better 判定：延迟/耗时/幻觉率类 */
const LOWER_IS_BETTER_PATTERN = /(latency|time_to|_time|_seconds|_ms$|duration|hallucination_rate|_cost$|_wer)/i;

/**
 * 未知指标 key 的展示名兜底。
 *
 * 缩写走显式白名单而不是「短词就全大写」—— 后者会把 `some_new_eval` 里的 `new`
 * 也变成 `NEW`。上游新指标的 key 更多是可读单词，不该被误伤。
 */
const METRIC_KEY_ACRONYMS = new Set([
  "aa",
  "hle",
  "lcr",
  "gpqa",
  "mmlu",
  "mmmu",
  "swe",
  "gsm",
  "arc",
  "elo",
  "api",
  "ocr",
  "vqa",
  "asr",
  "tts",
  "sql",
  "rag",
  "llm",
  "vlm",
  "if",
  "io"
]);

export function humanizeMetricKey(key: string): string {
  return key
    .split(/[._]+/)
    .filter(Boolean)
    .map((word) =>
      METRIC_KEY_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

type MetricStats = {
  values: number[];
  min: number;
  max: number;
  legacyOnly: boolean;
};

function collectMetricStats(models: ArtificialAnalysisModel[]) {
  const stats = new Map<string, MetricStats>();

  for (const model of models) {
    const legacyKeys = new Set(model.legacyMetricKeys);

    for (const [key, value] of Object.entries(model.metrics)) {
      const fromLegacy = legacyKeys.has(key);
      const existing = stats.get(key);

      if (existing) {
        existing.values.push(value);
        existing.min = Math.min(existing.min, value);
        existing.max = Math.max(existing.max, value);
        // 只要有一个模型是从新 API 拿到的，这一项就不算「仅旧 API」
        existing.legacyOnly = existing.legacyOnly && fromLegacy;
        continue;
      }

      stats.set(key, { values: [value], min: value, max: value, legacyOnly: fromLegacy });
    }
  }

  return stats;
}

/**
 * 推断量纲。
 *
 * AA 的 evaluations 是混合量纲的：`artificial_analysis_intelligence_index` 是 0-100，
 * 而 `mmlu_pro`/`gpqa`/`hle` 是 0-1 小数。直接原样落库会让同一批数据里出现
 * 0.79 和 62.9 两种尺度，正好踩中本项目「混合量纲」的一致性告警。
 * 所以对全部取值都落在 [0, 1] 的指标按小数处理，落库前 ×100。
 *
 * 已知指标在 KNOWN_METRICS 里显式声明量纲，只有未知指标才走这套推断。
 */
function inferValueScale(stats: MetricStats): MetricValueScale {
  return stats.min >= 0 && stats.max <= 1 ? "fraction" : "absolute";
}

function getMetricGroup(key: string): MetricGroup {
  if (key.startsWith(METRIC_GROUP_PREFIX.performance)) return "performance";
  if (key.startsWith(METRIC_GROUP_PREFIX.cost)) return "cost";
  return "evaluation";
}

/** 去掉组前缀后的裸字段名，用于兜底命名与方向推断 */
function stripMetricGroupPrefix(key: string): string {
  for (const prefix of Object.values(METRIC_GROUP_PREFIX)) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}

const GROUP_SORT_ORDER: Record<MetricGroup, number> = { evaluation: 0, performance: 1, cost: 2 };

export function buildMetricCatalog(models: ArtificialAnalysisModel[]): MetricCatalogEntry[] {
  const entries: MetricCatalogEntry[] = [];

  for (const [key, stats] of collectMetricStats(models)) {
    const known = KNOWN_METRICS[key];
    const bareKey = stripMetricGroupPrefix(key);
    const group = getMetricGroup(key);
    const valueScale = known?.valueScale ?? inferValueScale(stats);

    entries.push({
      key,
      group,
      label: known?.label ?? humanizeMetricKey(bareKey),
      benchmarkType: known?.benchmarkType ?? "General",
      unit: known?.unit ?? (valueScale === "fraction" ? "%" : "score"),
      higherIsBetter: known?.higherIsBetter ?? !LOWER_IS_BETTER_PATTERN.test(bareKey),
      modalities: known?.modalities ?? ["Text"],
      valueScale,
      modelCount: stats.values.length,
      minValue: stats.min,
      maxValue: stats.max,
      sampleValues: stats.values.slice(0, 3),
      legacyOnly: stats.legacyOnly
    });
  }

  return entries.sort((left, right) => {
    if (left.group !== right.group) return GROUP_SORT_ORDER[left.group] - GROUP_SORT_ORDER[right.group];
    return left.label.localeCompare(right.label, "en");
  });
}

function readMetricValue(model: ArtificialAnalysisModel, key: string): number | null {
  const value = model.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 按量纲换算后格式化。保留 3 位小数并去掉尾随 0，避免 0.791×100 写成 79.10000000000001 */
export function formatMetricValue(value: number, valueScale: MetricValueScale): string {
  const scaled = valueScale === "fraction" ? value * 100 : value;
  const rounded = Math.round(scaled * 1000) / 1000;
  return String(rounded);
}

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

export function getArtificialAnalysisApiKey(): string | null {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  return key ? key : null;
}

export function hasArtificialAnalysisApiKey(): boolean {
  return getArtificialAnalysisApiKey() !== null;
}

async function readResponseTextWithLimit(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    throw new Error("Artificial Analysis 响应过大");
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
      throw new Error("Artificial Analysis 响应过大");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedLength += value.byteLength;
      if (receivedLength > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Artificial Analysis 响应过大");
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

async function requestJson<T>(path: string, apiKey: string, schema: z.ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "x-api-key": apiKey }
    });

    if (response.status === 401) {
      throw new Error("Artificial Analysis 鉴权失败：API key 无效或已失效");
    }
    if (response.status === 403) {
      throw new Error("Artificial Analysis 拒绝访问：该端点需要 Pro 及以上档位的 API key");
    }
    if (response.status === 429) {
      throw new Error("Artificial Analysis 触发限流，请稍后再试");
    }
    if (!response.ok) {
      throw new Error(`Artificial Analysis 请求失败：${response.status}（${path}）`);
    }

    const text = await readResponseTextWithLimit(response);
    return schema.parse(JSON.parse(text) as unknown);
  } finally {
    clearTimeout(timer);
  }
}

type FreeModel = z.output<typeof freeModelSchema>;
type LegacyModel = z.output<typeof legacyModelSchema>;

/**
 * 新 API 是分页的，必须一路翻到 `has_more === false` 为止。
 *
 * `MAX_PAGES` 只是兜底：上游若因为 bug 一直返回 has_more=true，
 * 宁可报错也不能让循环把每日调用额度打光。
 */
async function fetchAllFreeLanguageModels(apiKey: string) {
  const models: FreeModel[] = [];
  let intelligenceIndexVersion: number | null = null;
  let pageCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const parsed = await requestJson(
      `${FREE_LANGUAGE_MODELS_ENDPOINT}?page=${page}`,
      apiKey,
      freeResponseSchema
    );

    pageCount = page;
    if (intelligenceIndexVersion === null && typeof parsed.intelligence_index_version === "number") {
      intelligenceIndexVersion = parsed.intelligence_index_version;
    }
    models.push(...parsed.data);

    if (!parsed.pagination.has_more) {
      return { models, intelligenceIndexVersion, pageCount };
    }
  }

  throw new Error(`Artificial Analysis 分页超过 ${MAX_PAGES} 页仍未结束，已中止以免耗尽调用额度`);
}

function collectFreeMetrics(model: FreeModel): Record<string, number> {
  const metrics: Record<string, number> = {};

  const put = (key: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
    }
  };

  for (const [key, value] of Object.entries(model.evaluations ?? {})) {
    if (EXCLUDED_EVALUATION_PATTERN.test(key)) continue;
    put(`${METRIC_GROUP_PREFIX.evaluation}${key}`, value);
  }

  for (const [key, value] of Object.entries(model.performance ?? {})) {
    put(`${METRIC_GROUP_PREFIX.performance}${key}`, value);
  }

  // pricing 有意不进指标表：token 单价由既有的「价格管理」(models.dev) 负责，
  // 两边都导会在矩阵里出现两套互相打架的价格行。
  const cost = model.artificial_analysis_intelligence_index_cost;
  put(`${METRIC_GROUP_PREFIX.cost}intelligence_index_total_cost`, cost?.total_cost);
  put(`${METRIC_GROUP_PREFIX.cost}intelligence_index_cost_per_task`, cost?.cost_per_task?.total_cost);

  return metrics;
}

function collectLegacyEvaluationMetrics(model: LegacyModel): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const [key, value] of Object.entries(model.evaluations ?? {})) {
    if (EXCLUDED_EVALUATION_PATTERN.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[`${METRIC_GROUP_PREFIX.evaluation}${key}`] = value;
    }
  }

  return metrics;
}

/**
 * 合并两个来源。
 *
 * 新 API 为准，旧 API 只补它没有的 evaluations 键 —— 同名键一律不覆盖，
 * 免得旧接口的陈旧分数把新接口的现行指数盖掉。
 * 按 id 对齐，对不上再退回 slug（AA 明确说 id 稳定、slug 可能变）。
 */
function mergeUpstreamModels(freeModels: FreeModel[], legacyModels: LegacyModel[]): ArtificialAnalysisModel[] {
  const legacyById = new Map<string, LegacyModel>();
  const legacyBySlug = new Map<string, LegacyModel>();
  for (const legacy of legacyModels) {
    legacyById.set(legacy.id, legacy);
    const slugKey = normalizeMatchToken(legacy.slug ?? legacy.name ?? "");
    if (slugKey && !legacyBySlug.has(slugKey)) legacyBySlug.set(slugKey, legacy);
  }

  const consumedLegacyIds = new Set<string>();
  const merged: ArtificialAnalysisModel[] = freeModels.map((free) => {
    const slugKey = normalizeMatchToken(free.slug ?? free.name);
    const legacy = legacyById.get(free.id) ?? (slugKey ? legacyBySlug.get(slugKey) : undefined);
    if (legacy) consumedLegacyIds.add(legacy.id);

    const metrics = collectFreeMetrics(free);
    const legacyMetricKeys: string[] = [];

    if (legacy) {
      for (const [key, value] of Object.entries(collectLegacyEvaluationMetrics(legacy))) {
        if (key in metrics) continue;
        metrics[key] = value;
        legacyMetricKeys.push(key);
      }
    }

    return {
      id: free.id,
      name: free.name,
      slug: free.slug ?? null,
      creatorName: free.model_creator?.name ?? null,
      releaseDate: free.release_date ?? null,
      metrics,
      legacyMetricKeys
    };
  });

  // 旧 API 独有的模型（多为已下架条目）也保留：静默丢数据比多几个候选更糟
  for (const legacy of legacyModels) {
    if (consumedLegacyIds.has(legacy.id)) continue;
    const metrics = collectLegacyEvaluationMetrics(legacy);
    if (Object.keys(metrics).length === 0) continue;

    merged.push({
      id: legacy.id,
      name: legacy.name ?? legacy.slug ?? legacy.id,
      slug: legacy.slug ?? null,
      creatorName: legacy.model_creator?.name ?? null,
      releaseDate: null,
      metrics,
      legacyMetricKeys: Object.keys(metrics)
    });
  }

  return merged;
}

export type FetchUpstreamResult = {
  models: ArtificialAnalysisModel[];
  intelligenceIndexVersion: number | null;
  freePageCount: number;
  /** 旧 API 拉取失败时的原因；失败不阻断，只是拿不到逐项 benchmark */
  legacyWarning: string | null;
};

export async function fetchArtificialAnalysisModels(): Promise<FetchUpstreamResult> {
  const apiKey = getArtificialAnalysisApiKey();
  if (!apiKey) {
    throw new Error("未配置 ARTIFICIAL_ANALYSIS_API_KEY，无法拉取 Artificial Analysis 数据");
  }

  // 旧 API 只是补充来源，它挂掉不该让整次拉取失败 —— 降级成「少了逐项 benchmark」
  const [free, legacy] = await Promise.all([
    fetchAllFreeLanguageModels(apiKey),
    requestJson(LEGACY_LLM_MODELS_ENDPOINT, apiKey, legacyResponseSchema).then(
      (parsed) => ({ models: parsed.data, warning: null as string | null }),
      (error: unknown) => ({
        models: [] as LegacyModel[],
        warning: error instanceof Error ? error.message : "旧接口拉取失败"
      })
    )
  ]);

  return {
    models: mergeUpstreamModels(free.models, legacy.models),
    intelligenceIndexVersion: free.intelligenceIndexVersion,
    freePageCount: free.pageCount,
    legacyWarning: legacy.warning
  };
}

// ---------------------------------------------------------------------------
// 模型匹配
// ---------------------------------------------------------------------------

export type ExternalMatchStatus = "matched" | "unmatched" | "ignored" | "manual";

export type LocalModelInput = {
  id: number;
  modelName: string;
  sourceModelId: string | null;
  providerName: string;
  providerSlug: string;
  providerDisplayName: string | null;
};

export type ModelMatchResult = {
  modelId: number;
  externalModelId: string | null;
  externalModelName: string | null;
  externalModelSlug: string | null;
  externalCreator: string | null;
  reasoningEffort: ReasoningEffort | null;
  matchStatus: ExternalMatchStatus;
  matchConfidence: number;
  matchReason: string;
};

export type ModelMatchConflict = {
  externalModelId: string;
  externalModelName: string;
  modelIds: number[];
};

/** 与 lib/model-pricing.ts 同款的 token 归一：去掉连字符/空格/下划线/斜杠后比较 */
export function normalizeMatchToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\-‐-―−﹘﹣－_\s\/\\:]+/g, "")
    .replace(/[^a-z0-9.]+/g, "");
}

export type UpstreamCandidate = {
  model: ArtificialAnalysisModel;
  baseKey: string;
  effort: ReasoningEffort | null;
  creatorKey: string;
};

export function buildUpstreamCandidates(models: ArtificialAnalysisModel[]): UpstreamCandidate[] {
  return models.map((model) => {
    const displayName = model.name ?? model.slug ?? model.id;
    const parsedName = parseModelReasoningEffort(displayName);
    const parsedSlug = model.slug ? parseModelReasoningEffort(model.slug) : null;

    return {
      model,
      // slug 里的强度标记（`--high`）与 name 里的（`(high)`）二选一，name 优先
      baseKey: normalizeMatchToken(parsedName.base),
      effort: parsedName.effort ?? parsedSlug?.effort ?? null,
      creatorKey: normalizeMatchToken(model.creatorName ?? "")
    };
  });
}

function getContainmentScore(left: string, right: string): number {
  if (!left || !right || left === right) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length < 4 || !longer.includes(shorter)) return 0;
  return shorter.length * 1000 + Math.round((shorter.length / longer.length) * 100);
}

/** provider 一致时优先，纯粹作为同分候选之间的平手判定 */
function scoreCreatorAffinity(local: LocalModelInput, candidate: UpstreamCandidate): number {
  if (!candidate.creatorKey) return 0;
  const localKeys = [local.providerName, local.providerSlug, local.providerDisplayName ?? ""]
    .filter(Boolean)
    .map(normalizeMatchToken);

  if (localKeys.some((key) => key === candidate.creatorKey)) return 2;
  if (localKeys.some((key) => key && (key.includes(candidate.creatorKey) || candidate.creatorKey.includes(key)))) return 1;
  return 0;
}

function pickByCreator(local: LocalModelInput, candidates: UpstreamCandidate[]): UpstreamCandidate {
  let best = candidates[0]!;
  let bestScore = scoreCreatorAffinity(local, best);

  for (const candidate of candidates.slice(1)) {
    const score = scoreCreatorAffinity(local, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function toMatchResult(
  modelId: number,
  candidate: UpstreamCandidate,
  confidence: number,
  reason: string,
  status: ExternalMatchStatus = "matched"
): ModelMatchResult {
  return {
    modelId,
    externalModelId: candidate.model.id,
    externalModelName: candidate.model.name ?? candidate.model.slug ?? candidate.model.id,
    externalModelSlug: candidate.model.slug ?? null,
    externalCreator: candidate.model.creatorName ?? null,
    reasoningEffort: candidate.effort,
    matchStatus: status,
    matchConfidence: confidence,
    matchReason: reason
  };
}

function toUnmatchedResult(modelId: number, reason: string): ModelMatchResult {
  return {
    modelId,
    externalModelId: null,
    externalModelName: null,
    externalModelSlug: null,
    externalCreator: null,
    reasoningEffort: null,
    matchStatus: "unmatched",
    matchConfidence: 0,
    matchReason: reason
  };
}

/**
 * 单个本地模型的匹配。分档从强到弱：
 *
 * 1. `source_model_id` 命中上游 id/slug          → 100
 * 2. 同族且推理强度完全一致（含两边都没标）      → 95
 * 3. 同族、本地未标强度 → 取上游最高档            → 88  ← 需求点名的默认行为
 * 4. 同族、本地标了但上游没这一档 → 就近取档      → 76
 * 5. 归一后包含式模糊匹配                         → 70
 */
export function resolveModelMatch(
  local: LocalModelInput,
  candidates: UpstreamCandidate[]
): ModelMatchResult {  const sourceModelId = local.sourceModelId?.trim();
  if (sourceModelId) {
    const normalized = normalizeMatchToken(sourceModelId);
    const direct = candidates.find(
      (candidate) =>
        candidate.model.id === sourceModelId ||
        normalizeMatchToken(candidate.model.slug ?? "") === normalized ||
        normalizeMatchToken(candidate.model.id) === normalized
    );
    if (direct) return toMatchResult(local.id, direct, 100, "source-model-id");
  }

  const parsedLocal = parseModelReasoningEffort(local.modelName);
  const localBaseKey = normalizeMatchToken(parsedLocal.base);
  if (!localBaseKey) return toUnmatchedResult(local.id, "empty-model-name");

  const sameFamily = candidates.filter((candidate) => candidate.baseKey === localBaseKey);

  if (sameFamily.length > 0) {
    const exact = sameFamily.filter((candidate) => candidate.effort === parsedLocal.effort);
    if (exact.length > 0) {
      return toMatchResult(local.id, pickByCreator(local, exact), 95, "effort-exact");
    }

    if (parsedLocal.effort === null) {
      // 本地没写推理强度：默认对齐上游最强的那一条
      const ranked = [...sameFamily].sort((left, right) => {
        const rankDiff =
          getReasoningEffortRank(right.effort ?? "nonthinking") -
          getReasoningEffortRank(left.effort ?? "nonthinking");
        if (rankDiff !== 0) return rankDiff;
        return scoreCreatorAffinity(local, right) - scoreCreatorAffinity(local, left);
      });
      return toMatchResult(local.id, ranked[0]!, 88, "highest-effort-default");
    }

    // 本地标了强度但上游没这一档：优先就近往上取，没有更高的再往下取
    const localRank = getReasoningEffortRank(parsedLocal.effort);
    const withRank = sameFamily.map((candidate) => ({
      candidate,
      rank: candidate.effort ? getReasoningEffortRank(candidate.effort) : -1
    }));
    const higher = withRank.filter((item) => item.rank > localRank).sort((a, b) => a.rank - b.rank);
    const lower = withRank.filter((item) => item.rank < localRank).sort((a, b) => b.rank - a.rank);
    const fallback = higher[0] ?? lower[0];
    if (fallback) {
      return toMatchResult(local.id, fallback.candidate, 76, "effort-fallback");
    }
  }

  let bestFuzzy: { candidate: UpstreamCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = getContainmentScore(localBaseKey, candidate.baseKey);
    if (score <= 0) continue;
    if (!bestFuzzy || score > bestFuzzy.score) {
      bestFuzzy = { candidate, score };
    }
  }

  if (bestFuzzy) {
    return toMatchResult(local.id, bestFuzzy.candidate, 70, "fuzzy-model-name");
  }

  return toUnmatchedResult(local.id, "no-match");
}

export type ResolveMatchesResult = {
  matches: ModelMatchResult[];
  conflicts: ModelMatchConflict[];
};

/**
 * 批量匹配。
 *
 * `manualOverrides` 里的模型（后台勾了「手动覆盖」的）完全跳过自动匹配，直接沿用已存映射，
 * 与 models.dev 价格同步里跳过 manual_override 的处理保持一致。
 */
export function resolveModelMatches(
  localModels: LocalModelInput[],
  upstreamModels: ArtificialAnalysisModel[],
  manualOverrides: Map<number, ModelMatchResult> = new Map()
): ResolveMatchesResult {
  const candidates = buildUpstreamCandidates(upstreamModels);
  const matches = localModels.map((local) => {
    const manual = manualOverrides.get(local.id);
    if (manual) return manual;
    return resolveModelMatch(local, candidates);
  });

  const byExternalId = new Map<string, ModelMatchResult[]>();
  for (const match of matches) {
    if (!match.externalModelId || match.matchStatus === "ignored") continue;
    const existing = byExternalId.get(match.externalModelId);
    if (existing) {
      existing.push(match);
    } else {
      byExternalId.set(match.externalModelId, [match]);
    }
  }

  const conflicts: ModelMatchConflict[] = [];
  for (const [externalModelId, group] of byExternalId) {
    if (group.length < 2) continue;
    conflicts.push({
      externalModelId,
      externalModelName: group[0]!.externalModelName ?? externalModelId,
      modelIds: group.map((item) => item.modelId)
    });
  }

  return { matches, conflicts };
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export type ArtificialAnalysisSnapshot = {
  fetchedAt: string;
  models: ArtificialAnalysisModel[];
  catalog: MetricCatalogEntry[];
  /** AA 明确说不同版本的 Intelligence Index 分数不可直接比较，需要在后台显示出来 */
  intelligenceIndexVersion: number | null;
  /** 新 API 这次翻了几页，用于判断调用额度消耗 */
  freePageCount: number;
  /** 旧 API 拉取失败时的原因；此时逐项 benchmark 会缺失，但复合指数仍在 */
  legacyWarning: string | null;
};

export async function getArtificialAnalysisSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<ArtificialAnalysisSnapshot> {
  if (options?.forceRefresh) {
    invalidateArtificialAnalysisSnapshotCache();
  }

  return withTimedCache(snapshotStore, "llms", SNAPSHOT_CACHE_TTL_MS, async () => {
    const upstream = await fetchArtificialAnalysisModels();
    return {
      fetchedAt: new Date().toISOString(),
      models: upstream.models,
      catalog: buildMetricCatalog(upstream.models),
      intelligenceIndexVersion: upstream.intelligenceIndexVersion,
      freePageCount: upstream.freePageCount,
      legacyWarning: upstream.legacyWarning
    };
  });
}

// ---------------------------------------------------------------------------
// 导入行
// ---------------------------------------------------------------------------

export type MetricOverride = {
  benchmarkName?: string;
  benchmarkType?: string;
  higherIsBetter?: boolean;
  modalities?: string[];
  valueScale?: MetricValueScale;
};

export type ArtificialAnalysisImportConfig = {
  selectedMetrics: string[];
  metricOverrides: Record<string, MetricOverride>;
  lastImportedAt?: string;
};

export const EMPTY_IMPORT_CONFIG: ArtificialAnalysisImportConfig = {
  selectedMetrics: [],
  metricOverrides: {}
};

/** settings 里存的是任意 JSON，读出来要先收窄 */
export function normalizeImportConfig(raw: unknown): ArtificialAnalysisImportConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_IMPORT_CONFIG };

  const source = raw as Record<string, unknown>;
  const selectedMetrics = Array.isArray(source.selectedMetrics)
    ? Array.from(
        new Set(
          source.selectedMetrics.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        )
      )
    : [];

  const metricOverrides: Record<string, MetricOverride> = {};
  const rawOverrides = source.metricOverrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [key, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const override = value as Record<string, unknown>;
      const normalized: MetricOverride = {};

      if (typeof override.benchmarkName === "string" && override.benchmarkName.trim()) {
        normalized.benchmarkName = override.benchmarkName.trim();
      }
      if (typeof override.benchmarkType === "string" && override.benchmarkType.trim()) {
        normalized.benchmarkType = override.benchmarkType.trim();
      }
      if (typeof override.higherIsBetter === "boolean") {
        normalized.higherIsBetter = override.higherIsBetter;
      }
      if (Array.isArray(override.modalities)) {
        const modalities = override.modalities.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        );
        if (modalities.length > 0) normalized.modalities = modalities;
      }
      if (override.valueScale === "fraction" || override.valueScale === "absolute") {
        normalized.valueScale = override.valueScale;
      }

      if (Object.keys(normalized).length > 0) {
        metricOverrides[key] = normalized;
      }
    }
  }

  return {
    selectedMetrics,
    metricOverrides,
    lastImportedAt: typeof source.lastImportedAt === "string" ? source.lastImportedAt : undefined
  };
}

export type ExternalImportRow = {
  rowNumber: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeProvided: true;
  higherIsBetter: boolean;
  modalities: string[];
  unit: string;
  rawValue: string;
  source: string;
  sourceModelId: string | null;
  sourceBenchmarkId: string;
};

export type BuildImportRowsInput = {
  upstreamModels: ArtificialAnalysisModel[];
  catalog: MetricCatalogEntry[];
  config: ArtificialAnalysisImportConfig;
  /** 只有 matched / manual 的映射会产出行 */
  matches: ModelMatchResult[];
  localModelsById: Map<number, { modelName: string; providerName: string }>;
};

export function buildImportRows(input: BuildImportRowsInput): ExternalImportRow[] {
  const upstreamById = new Map(input.upstreamModels.map((model) => [model.id, model]));
  const catalogByKey = new Map(input.catalog.map((entry) => [entry.key, entry]));
  const selected = input.config.selectedMetrics.filter((key) => catalogByKey.has(key));
  const rows: ExternalImportRow[] = [];

  for (const match of input.matches) {
    if (match.matchStatus !== "matched" && match.matchStatus !== "manual") continue;
    if (!match.externalModelId) continue;

    const upstream = upstreamById.get(match.externalModelId);
    const local = input.localModelsById.get(match.modelId);
    if (!upstream || !local) continue;

    for (const metricKey of selected) {
      const entry = catalogByKey.get(metricKey)!;
      const value = readMetricValue(upstream, metricKey);
      if (value === null) continue;

      const override = input.config.metricOverrides[metricKey] ?? {};
      const valueScale = override.valueScale ?? entry.valueScale;

      rows.push({
        rowNumber: rows.length + 1,
        providerName: local.providerName,
        modelName: local.modelName,
        benchmarkName: override.benchmarkName ?? entry.label,
        benchmarkType: override.benchmarkType ?? entry.benchmarkType,
        benchmarkTypeProvided: true,
        higherIsBetter: override.higherIsBetter ?? entry.higherIsBetter,
        modalities: override.modalities ?? entry.modalities,
        unit: entry.unit,
        rawValue: formatMetricValue(value, valueScale),
        source: ARTIFICIAL_ANALYSIS_SOURCE_LABEL,
        sourceModelId: match.externalModelId,
        sourceBenchmarkId: metricKey
      });
    }
  }

  return rows;
}
