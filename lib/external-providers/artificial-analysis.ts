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
 * artificialanalysis.ai 免费数据 API 适配。
 *
 * 只负责「抓取 → 指标目录 → 模型匹配 → 生成导入行」，落库由
 * `importExternalBenchmarkRows`（lib/admin-service.ts）负责。
 *
 * 接口文档：https://artificialanalysis.ai/api-reference
 * 鉴权 header `x-api-key`，限流 1000 次/日 —— 所以这里必须缓存，不能每次预览都打上游。
 */

export const ARTIFICIAL_ANALYSIS_SOURCE_ID = "artificial-analysis";
/** 写进 benchmark_values.source 的展示名（落库时会被加上 `text:` 前缀） */
export const ARTIFICIAL_ANALYSIS_SOURCE_LABEL = "Artificial Analysis";
export const ARTIFICIAL_ANALYSIS_SETTINGS_KEY = "external_import:artificial-analysis";

const API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;

const snapshotStore = createTimedCacheStore<ArtificialAnalysisSnapshot>();

export function invalidateArtificialAnalysisSnapshotCache() {
  invalidateTimedCacheStore(snapshotStore);
}

// ---------------------------------------------------------------------------
// 上游响应
// ---------------------------------------------------------------------------

const modelCreatorSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional()
  })
  .passthrough();

/**
 * `evaluations` 与 `pricing` 都用宽松 record 承接：上游随版本增删指标是常态
 * （文档示例还是 mmlu_pro/gpqa 那一代，站上已经换到 GDPval-AA / Terminal-Bench 一代），
 * 枚举字段只会让适配层比上游先坏掉。指标目录改为运行时发现。
 */
const numericRecordSchema = z.record(z.string(), z.union([z.number(), z.null()]));

const aaModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    slug: z.string().optional(),
    model_creator: modelCreatorSchema.optional(),
    evaluations: numericRecordSchema.optional(),
    pricing: numericRecordSchema.optional(),
    median_output_tokens_per_second: z.number().nullable().optional(),
    median_time_to_first_token_seconds: z.number().nullable().optional(),
    median_time_to_first_answer_token: z.number().nullable().optional()
  })
  .passthrough();

const aaResponseSchema = z
  .object({
    status: z.number().optional(),
    data: z.array(aaModelSchema)
  })
  .passthrough();

export type ArtificialAnalysisModel = z.output<typeof aaModelSchema>;

// ---------------------------------------------------------------------------
// 指标目录
// ---------------------------------------------------------------------------

export type MetricGroup = "evaluation" | "performance";
export type MetricValueScale = "fraction" | "absolute";

export type MetricCatalogEntry = {
  /** 上游字段路径，evaluations 下的项带 `evaluations.` 前缀，顶层性能指标就是字段名 */
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
};

/** 顶层性能指标白名单。这些是绝对量纲，不参与 fraction 自动推断。 */
const PERFORMANCE_METRICS: Array<{
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
}> = [
  {
    key: "median_output_tokens_per_second",
    label: "Output Speed",
    unit: "tokens/s",
    higherIsBetter: true
  },
  {
    key: "median_time_to_first_token_seconds",
    label: "Time To First Token",
    unit: "s",
    higherIsBetter: false
  },
  {
    key: "median_time_to_first_answer_token",
    label: "Time To First Answer Token",
    unit: "s",
    higherIsBetter: false
  }
];

const PERFORMANCE_METRIC_KEYS = new Set(PERFORMANCE_METRICS.map((item) => item.key));

/**
 * 已知 evaluations 指标的展示名与分类。
 *
 * 命中这里的用固定标签，命中不到的走 `humanizeMetricKey` 兜底 —— 上游加新指标不需要改代码。
 * 这份表覆盖文档示例的那一代 key 以及站上现行指标的常见命名。
 */
const KNOWN_EVALUATION_METRICS: Record<string, { label: string; benchmarkType: string; modalities?: string[] }> = {
  artificial_analysis_intelligence_index: { label: "AA Intelligence Index", benchmarkType: "Overall" },
  artificial_analysis_coding_index: { label: "AA Coding Index", benchmarkType: "Coding" },
  artificial_analysis_math_index: { label: "AA Math Index", benchmarkType: "Math" },
  artificial_analysis_agentic_index: { label: "AA Agentic Index", benchmarkType: "Agentic" },
  mmlu_pro: { label: "MMLU-Pro", benchmarkType: "Knowledge" },
  gpqa: { label: "GPQA Diamond", benchmarkType: "Reasoning" },
  gpqa_diamond: { label: "GPQA Diamond", benchmarkType: "Reasoning" },
  hle: { label: "Humanity's Last Exam", benchmarkType: "Reasoning" },
  livecodebench: { label: "LiveCodeBench", benchmarkType: "Coding" },
  scicode: { label: "SciCode", benchmarkType: "Coding" },
  math_500: { label: "MATH-500", benchmarkType: "Math" },
  aime: { label: "AIME", benchmarkType: "Math" },
  aime_2025: { label: "AIME 2025", benchmarkType: "Math" },
  ifbench: { label: "IFBench", benchmarkType: "Instruction Following" },
  lcr: { label: "AA-LCR", benchmarkType: "Long Context" },
  aa_lcr: { label: "AA-LCR", benchmarkType: "Long Context" },
  terminal_bench_hard: { label: "Terminal-Bench Hard", benchmarkType: "Agentic" },
  terminal_bench: { label: "Terminal-Bench", benchmarkType: "Agentic" },
  aa_omniscience: { label: "AA-Omniscience Index", benchmarkType: "Knowledge" },
  aa_omniscience_accuracy: { label: "AA-Omniscience Accuracy", benchmarkType: "Knowledge" },
  tau2_bench_telecom: { label: "𝜏²-Bench Telecom", benchmarkType: "Agentic" },
  tau3_banking: { label: "𝜏³-Banking", benchmarkType: "Agentic" },
  gdpval_aa: { label: "GDPval-AA", benchmarkType: "Agentic" },
  critpt: { label: "CritPt", benchmarkType: "Reasoning" },
  mmmu_pro: { label: "MMMU-Pro", benchmarkType: "Vision", modalities: ["Vision"] }
};

/** 价格类指标由既有的「价格管理」（models.dev）负责，不进候选 */
const EXCLUDED_METRIC_PATTERN = /(^|_)(price|pricing|cost)(_|$)/i;
/** 兜底的 lower-is-better 判定：延迟/耗时类 */
const LOWER_IS_BETTER_PATTERN = /(latency|time_to|_time|_seconds|_ms$|duration|hallucination)/i;

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

type MetricStats = {
  values: number[];
  min: number;
  max: number;
};

function collectMetricStats(models: ArtificialAnalysisModel[]) {
  const evaluationStats = new Map<string, MetricStats>();
  const performanceStats = new Map<string, MetricStats>();

  const record = (target: Map<string, MetricStats>, key: string, value: number) => {
    const existing = target.get(key);
    if (existing) {
      existing.values.push(value);
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      return;
    }
    target.set(key, { values: [value], min: value, max: value });
  };

  for (const model of models) {
    for (const [key, rawValue] of Object.entries(model.evaluations ?? {})) {
      if (EXCLUDED_METRIC_PATTERN.test(key)) continue;
      const value = toFiniteNumber(rawValue);
      if (value === null) continue;
      record(evaluationStats, key, value);
    }

    for (const key of PERFORMANCE_METRIC_KEYS) {
      const value = toFiniteNumber((model as Record<string, unknown>)[key]);
      if (value === null) continue;
      record(performanceStats, key, value);
    }
  }

  return { evaluationStats, performanceStats };
}

/**
 * 推断量纲。
 *
 * AA 的 evaluations 是混合量纲的：`artificial_analysis_intelligence_index` 是 0-100，
 * 而 `mmlu_pro`/`gpqa`/`hle` 是 0-1 小数。直接原样落库会让同一批数据里出现
 * 0.79 和 62.9 两种尺度，正好踩中本项目「混合量纲」的一致性告警。
 * 所以对全部取值都落在 [0, 1] 的指标按小数处理，落库前 ×100。
 */
function inferValueScale(stats: MetricStats): MetricValueScale {
  return stats.min >= 0 && stats.max <= 1 ? "fraction" : "absolute";
}

export function buildMetricCatalog(models: ArtificialAnalysisModel[]): MetricCatalogEntry[] {
  const { evaluationStats, performanceStats } = collectMetricStats(models);
  const entries: MetricCatalogEntry[] = [];

  for (const [key, stats] of evaluationStats) {
    const known = KNOWN_EVALUATION_METRICS[key];
    const valueScale = inferValueScale(stats);
    entries.push({
      key,
      group: "evaluation",
      label: known?.label ?? humanizeMetricKey(key),
      benchmarkType: known?.benchmarkType ?? "General",
      unit: valueScale === "fraction" ? "%" : "score",
      higherIsBetter: !LOWER_IS_BETTER_PATTERN.test(key),
      modalities: known?.modalities ?? ["Text"],
      valueScale,
      modelCount: stats.values.length,
      minValue: stats.min,
      maxValue: stats.max,
      sampleValues: stats.values.slice(0, 3)
    });
  }

  for (const performance of PERFORMANCE_METRICS) {
    const stats = performanceStats.get(performance.key);
    if (!stats) continue;
    entries.push({
      key: performance.key,
      group: "performance",
      label: performance.label,
      benchmarkType: "Performance",
      unit: performance.unit,
      higherIsBetter: performance.higherIsBetter,
      modalities: ["Text"],
      valueScale: "absolute",
      modelCount: stats.values.length,
      minValue: stats.min,
      maxValue: stats.max,
      sampleValues: stats.values.slice(0, 3)
    });
  }

  return entries.sort((left, right) => {
    if (left.group !== right.group) return left.group === "evaluation" ? -1 : 1;
    return left.label.localeCompare(right.label, "en");
  });
}

function readMetricValue(model: ArtificialAnalysisModel, key: string): number | null {
  if (PERFORMANCE_METRIC_KEYS.has(key)) {
    return toFiniteNumber((model as Record<string, unknown>)[key]);
  }
  return toFiniteNumber(model.evaluations?.[key]);
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

export async function fetchArtificialAnalysisModels(): Promise<ArtificialAnalysisModel[]> {
  const apiKey = getArtificialAnalysisApiKey();
  if (!apiKey) {
    throw new Error("未配置 ARTIFICIAL_ANALYSIS_API_KEY，无法拉取 Artificial Analysis 数据");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json", "x-api-key": apiKey }
    });

    if (response.status === 401) {
      throw new Error("Artificial Analysis 鉴权失败：API key 无效或已失效");
    }
    if (response.status === 429) {
      throw new Error("Artificial Analysis 触发限流（免费 API 每天 1000 次），请稍后再试");
    }
    if (!response.ok) {
      throw new Error(`Artificial Analysis 请求失败：${response.status}`);
    }

    const text = await readResponseTextWithLimit(response);
    const parsed = aaResponseSchema.parse(JSON.parse(text) as unknown);
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
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
      creatorKey: normalizeMatchToken(model.model_creator?.name ?? model.model_creator?.slug ?? "")
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
    externalCreator: candidate.model.model_creator?.name ?? null,
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
};

export async function getArtificialAnalysisSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<ArtificialAnalysisSnapshot> {
  if (options?.forceRefresh) {
    invalidateArtificialAnalysisSnapshotCache();
  }

  return withTimedCache(snapshotStore, "llms", SNAPSHOT_CACHE_TTL_MS, async () => {
    const models = await fetchArtificialAnalysisModels();
    return {
      fetchedAt: new Date().toISOString(),
      models,
      catalog: buildMetricCatalog(models)
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
