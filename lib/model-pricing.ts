import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { bumpCacheVersions, getCacheVersion } from "@/lib/cache-versions";
import { db } from "@/lib/db/client";
import { modelPricing, models, providers } from "@/lib/db/schema";
import { normalizeProviderConfig } from "@/lib/provider-config";
import { createVersionedCacheStore, invalidateVersionedCacheStore, withVersionedCache } from "@/lib/server-cache";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_FETCH_TIMEOUT_MS = 10_000;
const MODELS_DEV_MAX_BYTES = 8 * 1024 * 1024;
const MODELS_DEV_SOURCE = "models.dev";
const MODEL_PRICING_VERSION_PROBE_TTL_MS = 5_000;
const MODEL_PRICING_STALE_IF_ERROR_MS = 30 * 60_000;

const modelPricingRowsStore = createVersionedCacheStore<ModelPricingRow[]>();
const adminModelPricingRowsStore = createVersionedCacheStore<ModelPricingRow[]>();

export function invalidateModelPricingCaches() {
  invalidateVersionedCacheStore(modelPricingRowsStore);
  invalidateVersionedCacheStore(adminModelPricingRowsStore);
}

function getModelPricingCacheVersion() {
  return getCacheVersion("pricing");
}

async function invalidateChangedModelPricingCaches() {
  invalidateModelPricingCaches();
  if (process.env.NODE_ENV === "test") return;
  await bumpCacheVersions(["pricing"]);
}

type DbModel = {
  id: number;
  modelName: string;
  sourceModelId: string | null;
  providerName: string;
  providerSlug: string;
  providerDisplayName: string | null;
  providerModelsDevId: string | null;
  providerModelsDevAliases: string[];
  pricingDisabled: boolean;
};

type ModelsDevProvider = {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
};

type ModelsDevModel = {
  id?: string;
  name?: string;
  cost?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
    input_audio?: number;
    output_audio?: number;
  };
};

type ModelPricingUpsertRow = typeof modelPricing.$inferInsert;

type ModelMatch = {
  provider: ModelsDevProvider;
  modelKey: string;
  model: ModelsDevModel;
  confidence: number;
  reason: string;
  fuzzyScore?: number;
};

const COST_KEYS = [
  "input",
  "output",
  "reasoning",
  "cache_read",
  "cache_write",
  "input_audio",
  "output_audio"
] as const;

export type ModelPricingRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  source: string;
  sourceProviderId: string | null;
  sourceProviderName: string | null;
  sourceModelId: string | null;
  sourceModelName: string | null;
  inputCost: number | null;
  outputCost: number | null;
  reasoningCost: number | null;
  cacheReadCost: number | null;
  cacheWriteCost: number | null;
  inputAudioCost: number | null;
  outputAudioCost: number | null;
  currency: string;
  unit: string;
  matchConfidence: number;
  matchStatus: "matched" | "unmatched" | "ignored" | "manual";
  manualOverride: boolean;
  note: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
};

export type ModelPricingSyncResult = {
  providerCount: number;
  sourceModelCount: number;
  matchedCount: number;
  unmatchedCount: number;
  skippedManualCount: number;
  syncedAt: string;
};

const costSchema = z.object({
  input: z.number().min(0).optional(),
  output: z.number().min(0).optional(),
  reasoning: z.number().min(0).optional(),
  cache_read: z.number().min(0).optional(),
  cache_write: z.number().min(0).optional(),
  input_audio: z.number().min(0).optional(),
  output_audio: z.number().min(0).optional()
}).optional();

const modelSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  cost: costSchema
}).passthrough();

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.record(z.string(), modelSchema)
}).passthrough();

const apiSchema = z.record(z.string(), providerSchema);

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_\s\/\\:]+/g, "")
    .replace(/[^a-z0-9.]+/g, "");
}

const MODEL_VARIANT_SEPARATOR = String.raw`[\s._/\\:\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]+`;
const TRAILING_MODEL_BRACKET_PATTERN = /\s*(?:\([^()]*\)|（[^（）]*）|\[[^\[\]]*\]|【[^【】]*】)\s*$/;
const TRAILING_MODEL_VARIANT_PATTERN = new RegExp(
  `${MODEL_VARIANT_SEPARATOR}(?:non(?:${MODEL_VARIANT_SEPARATOR})?think|no(?:${MODEL_VARIANT_SEPARATOR})?think|think|high|max)$`,
  "i"
);

function stripModelVariantSuffix(value: string): string {
  let normalized = value.trim();
  let previous = "";

  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(TRAILING_MODEL_BRACKET_PATTERN, "")
      .trim()
      .replace(TRAILING_MODEL_VARIANT_PATTERN, "")
      .trim();
  }

  return normalized;
}

function getModelMatchTokens(values: string[]): { exact: Set<string>; variant: Set<string> } {
  const exact = new Set<string>();
  const variant = new Set<string>();

  for (const value of values) {
    const exactToken = normalizeToken(value);
    if (exactToken) exact.add(exactToken);

    const variantToken = normalizeToken(stripModelVariantSuffix(value));
    if (variantToken) variant.add(variantToken);
  }

  return { exact, variant };
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stripUpstreamModelIdPrefix(value: string) {
  const slashIndex = value.lastIndexOf("/");
  return slashIndex >= 0 ? value.slice(slashIndex + 1).trim() : value.trim();
}

function stripUpstreamModelNamePrefix(value: string) {
  const prefixIndex = Math.max(value.lastIndexOf(":"), value.lastIndexOf("："), value.lastIndexOf("/"));
  return prefixIndex >= 0 ? value.slice(prefixIndex + 1).trim() : value.trim();
}

function getUpstreamModelMatchTokens(modelKey: string, sourceModel: ModelsDevModel) {
  const sourceModelId = sourceModel.id ?? "";
  const sourceModelName = sourceModel.name ?? "";

  return getModelMatchTokens(uniqueValues([
    modelKey,
    stripUpstreamModelIdPrefix(modelKey),
    sourceModelId,
    stripUpstreamModelIdPrefix(sourceModelId),
    sourceModelName,
    stripUpstreamModelNamePrefix(sourceModelName)
  ]));
}

function getContainmentFuzzyScore(left: Set<string>, right: Set<string>) {
  let bestScore = 0;

  for (const leftToken of left) {
    for (const rightToken of right) {
      if (leftToken === rightToken) continue;

      const shorter = leftToken.length <= rightToken.length ? leftToken : rightToken;
      const longer = leftToken.length > rightToken.length ? leftToken : rightToken;
      if (shorter.length < 4 || !longer.includes(shorter)) continue;

      const ratio = shorter.length / longer.length;
      bestScore = Math.max(bestScore, shorter.length * 1000 + Math.round(ratio * 100));
    }
  }

  return bestScore;
}

function getFuzzyMatchScore(
  modelTokens: { exact: Set<string>; variant: Set<string> },
  sourceTokens: { exact: Set<string>; variant: Set<string> }
) {
  return Math.max(
    getContainmentFuzzyScore(modelTokens.exact, sourceTokens.exact),
    getContainmentFuzzyScore(modelTokens.variant, sourceTokens.variant)
  );
}

function isFuzzyMatch(match: ModelMatch) {
  return match.reason === "fuzzy-model-name";
}

function getBestFuzzyMatches(matches: ModelMatch[]) {
  const bestScore = Math.max(0, ...matches.map((match) => match.fuzzyScore ?? 0));
  if (bestScore <= 0) return [];
  return matches.filter((match) => match.fuzzyScore === bestScore);
}

function groupMatchesByProvider(matches: ModelMatch[]) {
  const providerMatches = new Map<string, ModelMatch[]>();

  for (const match of matches) {
    const matchesForProvider = providerMatches.get(match.provider.id);
    if (matchesForProvider) {
      matchesForProvider.push(match);
    } else {
      providerMatches.set(match.provider.id, [match]);
    }
  }

  return providerMatches;
}

function hasTokenIntersection(left: Set<string>, right: Set<string>) {
  for (const token of left) {
    if (right.has(token)) return true;
  }

  return false;
}

function normalizeProviderCandidate(value: string): string {
  return normalizeToken(value.replace(/\.ai$/i, "ai"));
}

function inferProviderAliases(model: DbModel): string[] {
  const normalized = [model.sourceModelId ?? "", model.modelName]
    .map(normalizeToken)
    .filter(Boolean);

  const hasPrefix = (prefixes: string[]) => normalized.some((value) => prefixes.some((prefix) => value.startsWith(prefix)));

  if (hasPrefix(["claude"])) return ["anthropic"];
  if (hasPrefix(["gemini", "gemma"])) return ["google"];
  if (hasPrefix(["gpt", "chatgpt", "codex", "o1", "o3", "o4"])) return ["openai"];
  if (hasPrefix(["deepseek"])) return ["deepseek"];
  if (hasPrefix(["grok"])) return ["xai"];
  if (hasPrefix(["kimi"])) return ["moonshot"];
  if (hasPrefix(["mistral", "mixtral", "codestral", "devstral", "ministral"])) return ["mistral"];
  if (hasPrefix(["llama"])) return ["llama", "meta"];
  if (hasPrefix(["qwen"])) return ["alibaba", "qwen"];

  return [];
}

function getProviderPricingConfig(config: unknown): { modelsDevProviderId?: string; modelsDevProviderAliases: string[]; disabled: boolean } {
  const normalized = normalizeProviderConfig(config);
  const pricing = (normalized as { pricing?: unknown }).pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
    return { modelsDevProviderAliases: [], disabled: false };
  }

  const raw = pricing as Record<string, unknown>;
  return {
    modelsDevProviderId: typeof raw.modelsDevProviderId === "string" && raw.modelsDevProviderId.trim()
      ? raw.modelsDevProviderId.trim()
      : undefined,
    modelsDevProviderAliases: Array.isArray(raw.modelsDevProviderAliases)
      ? raw.modelsDevProviderAliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    disabled: raw.disabled === true
  };
}

function resolveProviderMatch(model: DbModel, providersById: Map<string, ModelsDevProvider>) {
  if (model.providerModelsDevId) {
    const configured = providersById.get(model.providerModelsDevId);
    if (configured) return { provider: configured, confidenceBoost: 8 };
  }

  const candidates = [
    model.providerSlug,
    model.providerName,
    model.providerDisplayName ?? "",
    ...model.providerModelsDevAliases
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeProviderCandidate(candidate);
    for (const provider of providersById.values()) {
      if (
        normalizeProviderCandidate(provider.id) === normalizedCandidate ||
        normalizeProviderCandidate(provider.name) === normalizedCandidate
      ) {
        return { provider, confidenceBoost: 0 };
      }
    }
  }

  return { provider: null, confidenceBoost: 0 };
}

function scoreProviderDisambiguation(model: DbModel, match: ModelMatch) {
  const providerTokens = [match.provider.id, match.provider.name].map(normalizeProviderCandidate);
  const candidates = [
    model.providerModelsDevId ?? "",
    model.providerSlug,
    model.providerName,
    model.providerDisplayName ?? "",
    ...model.providerModelsDevAliases,
    ...inferProviderAliases(model)
  ].filter(Boolean);

  let score = 0;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeProviderCandidate(candidate);
    if (providerTokens.some((token) => token === normalizedCandidate)) {
      score = Math.max(score, candidate === model.providerModelsDevId ? 100 : 80);
      continue;
    }

    if (providerTokens.some((token) => token.includes(normalizedCandidate) || normalizedCandidate.includes(token))) {
      score = Math.max(score, 40);
    }
  }

  const sourceModelId = match.model.id ?? match.modelKey;
  const sourceNamespace = sourceModelId.split(/[/:@]/)[0] ?? "";
  const sourceNamePrefix = (match.model.name ?? "").split(":")[0] ?? "";
  const sourceHints = [sourceNamespace, sourceNamePrefix].map(normalizeProviderCandidate);
  for (const alias of inferProviderAliases(model)) {
    const normalizedAlias = normalizeProviderCandidate(alias);
    if (sourceHints.some((hint) => hint === normalizedAlias)) {
      score = Math.max(score, 35);
    }
  }

  return score;
}

function resolvePriceModeMatch(matches: ModelMatch[]): ModelMatch | null {
  const groups = new Map<string, { match: ModelMatch; count: number }>();

  for (const match of matches) {
    const cost = match.model.cost;
    if (!cost || !COST_KEYS.some((key) => typeof cost[key] === "number")) continue;

    const key = JSON.stringify(COST_KEYS.map((costKey) => cost[costKey] ?? null));
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { match, count: 1 });
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count);
  const bestGroup = sortedGroups[0];
  if (!bestGroup || bestGroup.count <= 1 || sortedGroups[1]?.count === bestGroup.count) return null;

  return {
    ...bestGroup.match,
    confidence: Math.min(bestGroup.match.confidence, 74),
    reason: "global-price-mode"
  };
}

function resolveModelMatch(model: DbModel, sourceProvider: ModelsDevProvider | null, providersById: Map<string, ModelsDevProvider>) {
  const sourceModelId = model.sourceModelId?.trim();
  const modelName = model.modelName.trim();
  const modelTokens = getModelMatchTokens([sourceModelId ?? "", modelName]);

  const collectInProvider = (provider: ModelsDevProvider): ModelMatch[] => {
    const matches: ModelMatch[] = [];
    const seenModelKeys = new Set<string>();
    const fuzzyMatches: ModelMatch[] = [];

    const addMatch = (modelKey: string, sourceModel: ModelsDevModel, confidence: number, reason: string) => {
      if (seenModelKeys.has(modelKey)) return;
      seenModelKeys.add(modelKey);
      matches.push({ provider, modelKey, model: sourceModel, confidence, reason });
    };

    const addFuzzyCandidate = (modelKey: string, sourceModel: ModelsDevModel, fuzzyScore: number) => {
      if (seenModelKeys.has(modelKey) || fuzzyScore <= 0) return;
      fuzzyMatches.push({ provider, modelKey, model: sourceModel, confidence: 70, reason: "fuzzy-model-name", fuzzyScore });
    };

    if (sourceModelId) {
      const direct = provider.models[sourceModelId];
      if (direct) addMatch(sourceModelId, direct, 100, "source-model-id");
    }

    const direct = provider.models[modelName];
    if (direct) addMatch(modelName, direct, 96, "model-name");

    for (const [modelKey, sourceModel] of Object.entries(provider.models)) {
      const sourceTokens = getUpstreamModelMatchTokens(modelKey, sourceModel);

      if (hasTokenIntersection(modelTokens.exact, sourceTokens.exact)) {
        addMatch(modelKey, sourceModel, 92, "normalized-model-name");
        continue;
      }

      if (hasTokenIntersection(modelTokens.variant, sourceTokens.variant)) {
        addMatch(modelKey, sourceModel, 90, "normalized-model-variant");
        continue;
      }

      addFuzzyCandidate(modelKey, sourceModel, getFuzzyMatchScore(modelTokens, sourceTokens));
    }

    if (fuzzyMatches.length > 0) {
      matches.push(...fuzzyMatches);
    }

    return matches;
  };

  const collectedMatches: ModelMatch[] = [];
  for (const provider of providersById.values()) {
    const matches = collectInProvider(provider);
    if (matches.length > 0) {
      collectedMatches.push(...matches);
    }
  }

  const exactMatches = collectedMatches.filter((match) => !isFuzzyMatch(match));
  const fuzzyMatches = collectedMatches.filter(isFuzzyMatch);
  const hasExactMatches = exactMatches.length > 0;
  const globalMatches = hasExactMatches ? exactMatches : getBestFuzzyMatches(fuzzyMatches);
  const providerMatches = groupMatchesByProvider(globalMatches);

  if (sourceProvider) {
    const providerMatch = providerMatches.get(sourceProvider.id)?.[0];
    if (providerMatch) return providerMatch;
  }

  const priceModeMatch = resolvePriceModeMatch(globalMatches);
  if (priceModeMatch) return priceModeMatch;

  if (globalMatches.length === 1) {
    return { ...globalMatches[0]!, confidence: Math.min(globalMatches[0]!.confidence, 72), reason: `global-${globalMatches[0]!.reason}` };
  }

  if (globalMatches.length > 1) {
    const scoredMatches = globalMatches.map((match) => ({ match, score: scoreProviderDisambiguation(model, match) }));
    const bestScore = Math.max(...scoredMatches.map((item) => item.score));
    const bestMatches = scoredMatches.filter((item) => item.score === bestScore);

    if (bestScore > 0 && bestMatches.length === 1) {
      const bestMatch = bestMatches[0]!.match;
      return {
        ...bestMatch,
        confidence: Math.min(bestMatch.confidence, bestScore >= 80 ? 88 : 78),
        reason: `${bestMatch.reason}-provider-disambiguated`
      };
    }
  }

  const fuzzyPriceModeMatch = resolvePriceModeMatch(fuzzyMatches);
  if (fuzzyPriceModeMatch) return fuzzyPriceModeMatch;

  return null;
}

async function fetchModelsDevApi(): Promise<Record<string, ModelsDevProvider>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`models.dev 请求失败：${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MODELS_DEV_MAX_BYTES) {
      throw new Error("models.dev 响应过大");
    }

    let text: string;
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const decodedChunks: string[] = [];
      let receivedLength = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedLength += value.byteLength;
          if (receivedLength > MODELS_DEV_MAX_BYTES) {
            await reader.cancel();
            throw new Error("models.dev 响应过大");
          }

          decodedChunks.push(decoder.decode(value, { stream: true }));
        }
      } finally {
        reader.releaseLock();
      }

      decodedChunks.push(decoder.decode());
      text = decodedChunks.join("");
    } else {
      text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MODELS_DEV_MAX_BYTES) {
        throw new Error("models.dev 响应过大");
      }
    }

    const parsedJson = JSON.parse(text) as unknown;
    return apiSchema.parse(parsedJson);
  } finally {
    clearTimeout(timer);
  }
}

async function getActiveModelRows(): Promise<DbModel[]> {
  const rows = await db
    .select({
      id: models.id,
      modelName: models.modelName,
      sourceModelId: models.sourceModelId,
      providerName: providers.name,
      providerSlug: providers.slug,
      providerConfig: providers.config
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(isNull(models.mergedIntoModelId))
    .orderBy(providers.name, models.modelName);

  return rows.map((row) => {
    const providerConfig = normalizeProviderConfig(row.providerConfig);
    const pricingConfig = getProviderPricingConfig(row.providerConfig);
    return {
      id: row.id,
      modelName: row.modelName,
      sourceModelId: row.sourceModelId,
      providerName: row.providerName,
      providerSlug: row.providerSlug,
      providerDisplayName: providerConfig.displayName ?? null,
      providerModelsDevId: pricingConfig.disabled ? null : pricingConfig.modelsDevProviderId ?? null,
      providerModelsDevAliases: pricingConfig.disabled ? [] : pricingConfig.modelsDevProviderAliases,
      pricingDisabled: pricingConfig.disabled
    };
  });
}

export async function getModelPricingRows(): Promise<ModelPricingRow[]> {
  return withVersionedCache(
    modelPricingRowsStore,
    "all",
    {
      versionProbeTtlMs: MODEL_PRICING_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: MODEL_PRICING_STALE_IF_ERROR_MS,
      getVersion: getModelPricingCacheVersion,
      loader: loadModelPricingRows
    }
  );
}

async function loadModelPricingRows(): Promise<ModelPricingRow[]> {
  const rows = await db
    .select({
      modelId: models.id,
      modelName: models.modelName,
      providerName: providers.name,
      source: modelPricing.source,
      sourceProviderId: modelPricing.sourceProviderId,
      sourceProviderName: modelPricing.sourceProviderName,
      sourceModelId: modelPricing.sourceModelId,
      sourceModelName: modelPricing.sourceModelName,
      inputCost: modelPricing.inputCost,
      outputCost: modelPricing.outputCost,
      reasoningCost: modelPricing.reasoningCost,
      cacheReadCost: modelPricing.cacheReadCost,
      cacheWriteCost: modelPricing.cacheWriteCost,
      inputAudioCost: modelPricing.inputAudioCost,
      outputAudioCost: modelPricing.outputAudioCost,
      currency: modelPricing.currency,
      unit: modelPricing.unit,
      matchConfidence: modelPricing.matchConfidence,
      matchStatus: modelPricing.matchStatus,
      manualOverride: modelPricing.manualOverride,
      note: modelPricing.note,
      lastSyncedAt: modelPricing.lastSyncedAt,
      updatedAt: modelPricing.updatedAt
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .innerJoin(modelPricing, eq(modelPricing.modelId, models.id))
    .where(isNull(models.mergedIntoModelId))
    .orderBy(providers.name, models.modelName);

  return rows.map((row) => ({
    modelId: row.modelId,
    modelName: row.modelName,
    providerName: row.providerName,
    source: row.source,
    sourceProviderId: row.sourceProviderId,
    sourceProviderName: row.sourceProviderName,
    sourceModelId: row.sourceModelId,
    sourceModelName: row.sourceModelName,
    inputCost: toNullableNumber(row.inputCost),
    outputCost: toNullableNumber(row.outputCost),
    reasoningCost: toNullableNumber(row.reasoningCost),
    cacheReadCost: toNullableNumber(row.cacheReadCost),
    cacheWriteCost: toNullableNumber(row.cacheWriteCost),
    inputAudioCost: toNullableNumber(row.inputAudioCost),
    outputAudioCost: toNullableNumber(row.outputAudioCost),
    currency: row.currency,
    unit: row.unit,
    matchConfidence: row.matchConfidence,
    matchStatus: row.matchStatus as ModelPricingRow["matchStatus"],
    manualOverride: row.manualOverride,
    note: row.note,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  }));
}

export async function getAdminModelPricingRows(): Promise<ModelPricingRow[]> {
  return withVersionedCache(
    adminModelPricingRowsStore,
    "all",
    {
      versionProbeTtlMs: MODEL_PRICING_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: MODEL_PRICING_STALE_IF_ERROR_MS,
      getVersion: getModelPricingCacheVersion,
      loader: loadAdminModelPricingRows
    }
  );
}

async function loadAdminModelPricingRows(): Promise<ModelPricingRow[]> {
  const activeModels = await getActiveModelRows();
  const pricingRows = await getModelPricingRows();
  const pricingByModelId = new Map(pricingRows.map((row) => [row.modelId, row]));

  return activeModels.map((model) => pricingByModelId.get(model.id) ?? {
    modelId: model.id,
    modelName: model.modelName,
    providerName: model.providerName,
    source: MODELS_DEV_SOURCE,
    sourceProviderId: null,
    sourceProviderName: null,
    sourceModelId: null,
    sourceModelName: null,
    inputCost: null,
    outputCost: null,
    reasoningCost: null,
    cacheReadCost: null,
    cacheWriteCost: null,
    inputAudioCost: null,
    outputAudioCost: null,
    currency: "USD",
    unit: "per_1m_tokens",
    matchConfidence: 0,
    matchStatus: "unmatched",
    manualOverride: false,
    note: null,
    lastSyncedAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z"
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function syncModelsDevPricing(): Promise<ModelPricingSyncResult> {
  const [sourceProvidersRaw, activeModels, existingRows] = await Promise.all([
    fetchModelsDevApi(),
    getActiveModelRows(),
    db.select().from(modelPricing)
  ]);

  const sourceProviders = new Map(Object.values(sourceProvidersRaw).map((provider) => [provider.id, provider]));
  const existingByModelId = new Map(existingRows.map((row) => [row.modelId, row]));
  const syncedAt = new Date();
  let matchedCount = 0;
  let unmatchedCount = 0;
  let skippedManualCount = 0;
  const pricingUpserts: ModelPricingUpsertRow[] = [];

  function createClearedPricingUpsert(
    modelId: number,
    matchStatus: ModelPricingRow["matchStatus"],
    matchConfidence: number,
    note: string
  ): ModelPricingUpsertRow {
    return {
      modelId,
      source: MODELS_DEV_SOURCE,
      sourceProviderId: null,
      sourceProviderName: null,
      sourceModelId: null,
      sourceModelName: null,
      inputCost: null,
      outputCost: null,
      reasoningCost: null,
      cacheReadCost: null,
      cacheWriteCost: null,
      inputAudioCost: null,
      outputAudioCost: null,
      currency: "USD",
      unit: "per_1m_tokens",
      matchConfidence,
      matchStatus,
      manualOverride: false,
      rawJson: {},
      note,
      lastSyncedAt: syncedAt,
      updatedAt: syncedAt
    };
  }

  for (const model of activeModels) {
    const existing = existingByModelId.get(model.id);
    if (existing?.manualOverride) {
      skippedManualCount += 1;
      continue;
    }

    if (model.pricingDisabled) {
      pricingUpserts.push(createClearedPricingUpsert(model.id, "ignored", 0, "provider-pricing-disabled"));
      continue;
    }

    const { provider: sourceProvider, confidenceBoost } = resolveProviderMatch(model, sourceProviders);
    const match = resolveModelMatch(model, sourceProvider, sourceProviders);
    if (!match) {
      pricingUpserts.push(createClearedPricingUpsert(model.id, "unmatched", 0, "no-match"));
      unmatchedCount += 1;
      continue;
    }

    const confidence = Math.min(100, match.confidence + confidenceBoost);
    if (confidence < 70) {
      pricingUpserts.push(createClearedPricingUpsert(model.id, "unmatched", confidence, "low-confidence"));
      unmatchedCount += 1;
      continue;
    }

    const cost = match.model.cost ?? {};
    const sourceModelName = match.model.name ?? match.model.id ?? match.modelKey;

    pricingUpserts.push({
      modelId: model.id,
      source: MODELS_DEV_SOURCE,
      sourceProviderId: match.provider.id,
      sourceProviderName: match.provider.name,
      sourceModelId: match.model.id ?? match.modelKey,
      sourceModelName,
      inputCost: cost.input?.toString() ?? null,
      outputCost: cost.output?.toString() ?? null,
      reasoningCost: cost.reasoning?.toString() ?? null,
      cacheReadCost: cost.cache_read?.toString() ?? null,
      cacheWriteCost: cost.cache_write?.toString() ?? null,
      inputAudioCost: cost.input_audio?.toString() ?? null,
      outputAudioCost: cost.output_audio?.toString() ?? null,
      currency: "USD",
      unit: "per_1m_tokens",
      matchConfidence: confidence,
      matchStatus: "matched",
      manualOverride: false,
      rawJson: match.model,
      note: match.reason,
      lastSyncedAt: syncedAt,
      updatedAt: syncedAt
    });
    matchedCount += 1;
  }

  if (pricingUpserts.length > 0) {
    await db
      .insert(modelPricing)
      .values(pricingUpserts)
      .onConflictDoUpdate({
        target: modelPricing.modelId,
        set: {
          source: sql.raw("excluded.source"),
          sourceProviderId: sql.raw("excluded.source_provider_id"),
          sourceProviderName: sql.raw("excluded.source_provider_name"),
          sourceModelId: sql.raw("excluded.source_model_id"),
          sourceModelName: sql.raw("excluded.source_model_name"),
          inputCost: sql.raw("excluded.input_cost"),
          outputCost: sql.raw("excluded.output_cost"),
          reasoningCost: sql.raw("excluded.reasoning_cost"),
          cacheReadCost: sql.raw("excluded.cache_read_cost"),
          cacheWriteCost: sql.raw("excluded.cache_write_cost"),
          inputAudioCost: sql.raw("excluded.input_audio_cost"),
          outputAudioCost: sql.raw("excluded.output_audio_cost"),
          currency: sql.raw("excluded.currency"),
          unit: sql.raw("excluded.unit"),
          matchConfidence: sql.raw("excluded.match_confidence"),
          matchStatus: sql.raw("excluded.match_status"),
          manualOverride: sql.raw("excluded.manual_override"),
          rawJson: sql.raw("excluded.raw_json"),
          note: sql.raw("excluded.note"),
          lastSyncedAt: sql.raw("excluded.last_synced_at"),
          updatedAt: sql.raw("excluded.updated_at")
        }
      });
  }

  await invalidateChangedModelPricingCaches();

  const sourceModelCount = Array.from(sourceProviders.values()).reduce(
    (sum, provider) => sum + Object.keys(provider.models).length,
    0
  );

  return {
    providerCount: sourceProviders.size,
    sourceModelCount,
    matchedCount,
    unmatchedCount,
    skippedManualCount,
    syncedAt: syncedAt.toISOString()
  };
}

const updateSchema = z.object({
  modelId: z.number().int().positive(),
  inputCost: z.number().min(0).nullable().optional(),
  outputCost: z.number().min(0).nullable().optional(),
  reasoningCost: z.number().min(0).nullable().optional(),
  cacheReadCost: z.number().min(0).nullable().optional(),
  cacheWriteCost: z.number().min(0).nullable().optional(),
  inputAudioCost: z.number().min(0).nullable().optional(),
  outputAudioCost: z.number().min(0).nullable().optional(),
  sourceProviderId: z.string().trim().nullable().optional(),
  sourceProviderName: z.string().trim().nullable().optional(),
  sourceModelId: z.string().trim().nullable().optional(),
  sourceModelName: z.string().trim().nullable().optional(),
  matchStatus: z.enum(["matched", "unmatched", "ignored", "manual"]).optional(),
  manualOverride: z.boolean().optional(),
  note: z.string().trim().nullable().optional()
});

export type ModelPricingUpdateInput = z.input<typeof updateSchema>;

const pricingCostFields = [
  "inputCost",
  "outputCost",
  "reasoningCost",
  "cacheReadCost",
  "cacheWriteCost",
  "inputAudioCost",
  "outputAudioCost"
] as const;

const pricingNullableTextFields = [
  "sourceProviderId",
  "sourceProviderName",
  "sourceModelId",
  "sourceModelName",
  "note"
] as const;

export async function updateModelPricing(input: ModelPricingUpdateInput) {
  const parsed = updateSchema.parse(input);
  const updatedAt = new Date();
  const insertManualOverride = parsed.manualOverride ?? (parsed.matchStatus === undefined || parsed.matchStatus === "manual");
  const insertMatchStatus = parsed.matchStatus ?? (insertManualOverride ? "manual" : "matched");

  const values: ModelPricingUpsertRow = {
    modelId: parsed.modelId,
    source: insertManualOverride ? "manual" : MODELS_DEV_SOURCE,
    currency: "USD",
    unit: "per_1m_tokens",
    matchConfidence: insertManualOverride ? 100 : 0,
    matchStatus: insertMatchStatus,
    manualOverride: insertManualOverride,
    updatedAt
  };

  const updateValues: Partial<ModelPricingUpsertRow> = { updatedAt };

  if (parsed.manualOverride !== undefined) {
    values.manualOverride = parsed.manualOverride;
    values.source = parsed.manualOverride ? "manual" : MODELS_DEV_SOURCE;
    values.matchConfidence = parsed.manualOverride ? 100 : 0;
    updateValues.manualOverride = parsed.manualOverride;
    updateValues.source = parsed.manualOverride ? "manual" : MODELS_DEV_SOURCE;
    updateValues.matchConfidence = parsed.manualOverride ? 100 : 0;
    if (parsed.matchStatus === undefined) {
      values.matchStatus = parsed.manualOverride ? "manual" : "matched";
      updateValues.matchStatus = values.matchStatus;
    }
  } else if (parsed.matchStatus === undefined) {
    updateValues.manualOverride = true;
    updateValues.source = "manual";
    updateValues.matchConfidence = 100;
    updateValues.matchStatus = "manual";
  }

  if (parsed.matchStatus !== undefined) {
    values.matchStatus = parsed.matchStatus;
    updateValues.matchStatus = parsed.matchStatus;
  }

  for (const field of pricingCostFields) {
    const value = parsed[field];
    if (value !== undefined) {
      const serialized = value === null ? null : value.toString();
      values[field] = serialized;
      updateValues[field] = serialized;
    }
  }

  for (const field of pricingNullableTextFields) {
    const value = parsed[field];
    if (value !== undefined) {
      values[field] = value;
      updateValues[field] = value;
    }
  }

  await db
    .insert(modelPricing)
    .values(values)
    .onConflictDoUpdate({
      target: modelPricing.modelId,
      set: updateValues
    });
  await invalidateChangedModelPricingCaches();
}

export async function clearModelPricingManualOverride(modelId: number) {
  await db
    .update(modelPricing)
    .set({ manualOverride: false, matchStatus: "matched", updatedAt: new Date() })
    .where(and(eq(modelPricing.modelId, modelId), eq(modelPricing.manualOverride, true)));
  await invalidateChangedModelPricingCaches();
}

export async function getModelPricingCount(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(modelPricing);
  return Number(result?.count ?? 0);
}
