import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { modelPricing, models, providers } from "@/lib/db/schema";
import { normalizeProviderConfig } from "@/lib/provider-config";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_FETCH_TIMEOUT_MS = 10_000;
const MODELS_DEV_MAX_BYTES = 8 * 1024 * 1024;
const MODELS_DEV_SOURCE = "models.dev";

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
    .replace(/[\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_\s.\/\\:]+/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeProviderCandidate(value: string): string {
  return normalizeToken(value.replace(/\.ai$/i, "ai"));
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

function resolveModelMatch(model: DbModel, sourceProvider: ModelsDevProvider | null, providersById: Map<string, ModelsDevProvider>) {
  const sourceModelId = model.sourceModelId?.trim();
  const modelName = model.modelName.trim();

  const findInProvider = (provider: ModelsDevProvider) => {
    if (sourceModelId) {
      const direct = provider.models[sourceModelId];
      if (direct) return { provider, modelKey: sourceModelId, model: direct, confidence: 100, reason: "source-model-id" };
    }

    const direct = provider.models[modelName];
    if (direct) return { provider, modelKey: modelName, model: direct, confidence: 96, reason: "model-name" };

    const normalizedModelName = normalizeToken(modelName);
    for (const [modelKey, sourceModel] of Object.entries(provider.models)) {
      const sourceModelName = sourceModel.name ?? sourceModel.id ?? modelKey;
      if (
        normalizeToken(modelKey) === normalizedModelName ||
        normalizeToken(sourceModelName) === normalizedModelName
      ) {
        return { provider, modelKey, model: sourceModel, confidence: 92, reason: "normalized-model-name" };
      }
    }

    return null;
  };

  if (sourceProvider) {
    const matched = findInProvider(sourceProvider);
    if (matched) return matched;
  }

  const globalMatches: Array<ReturnType<typeof findInProvider> & object> = [];
  for (const provider of providersById.values()) {
    const matched = findInProvider(provider);
    if (matched) globalMatches.push(matched);
  }

  if (globalMatches.length === 1) {
    return { ...globalMatches[0]!, confidence: Math.min(globalMatches[0]!.confidence, 72), reason: `global-${globalMatches[0]!.reason}` };
  }

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

    const text = await response.text();
    if (text.length > MODELS_DEV_MAX_BYTES) {
      throw new Error("models.dev 响应过大");
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
  const activeModels = await getActiveModelRows();
  const pricingRows = await getModelPricingRows();
  const pricingByModelId = new Map(pricingRows.map((row) => [row.modelId, row]));
  const now = new Date().toISOString();

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
    updatedAt: now
  });
}

export async function syncModelsDevPricing(): Promise<ModelPricingSyncResult> {
  const [sourceProvidersRaw, activeModels, existingRows] = await Promise.all([
    fetchModelsDevApi(),
    getActiveModelRows(),
    db.select().from(modelPricing)
  ]);

  const sourceProviders = new Map(Object.entries(sourceProvidersRaw));
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

export async function updateModelPricing(input: ModelPricingUpdateInput) {
  const parsed = updateSchema.parse(input);
  const updatedAt = new Date();
  const manualOverride = parsed.manualOverride ?? true;
  const matchStatus = parsed.matchStatus ?? (manualOverride ? "manual" : "matched");

  const values = {
    modelId: parsed.modelId,
    source: manualOverride ? "manual" : MODELS_DEV_SOURCE,
    sourceProviderId: parsed.sourceProviderId ?? null,
    sourceProviderName: parsed.sourceProviderName ?? null,
    sourceModelId: parsed.sourceModelId ?? null,
    sourceModelName: parsed.sourceModelName ?? null,
    inputCost: parsed.inputCost === undefined || parsed.inputCost === null ? null : parsed.inputCost.toString(),
    outputCost: parsed.outputCost === undefined || parsed.outputCost === null ? null : parsed.outputCost.toString(),
    reasoningCost: parsed.reasoningCost === undefined || parsed.reasoningCost === null ? null : parsed.reasoningCost.toString(),
    cacheReadCost: parsed.cacheReadCost === undefined || parsed.cacheReadCost === null ? null : parsed.cacheReadCost.toString(),
    cacheWriteCost: parsed.cacheWriteCost === undefined || parsed.cacheWriteCost === null ? null : parsed.cacheWriteCost.toString(),
    inputAudioCost: parsed.inputAudioCost === undefined || parsed.inputAudioCost === null ? null : parsed.inputAudioCost.toString(),
    outputAudioCost: parsed.outputAudioCost === undefined || parsed.outputAudioCost === null ? null : parsed.outputAudioCost.toString(),
    currency: "USD",
    unit: "per_1m_tokens",
    matchConfidence: manualOverride ? 100 : 0,
    matchStatus,
    manualOverride,
    note: parsed.note ?? null,
    updatedAt
  };

  await db
    .insert(modelPricing)
    .values(values)
    .onConflictDoUpdate({
      target: modelPricing.modelId,
      set: values
    });
}

export async function clearModelPricingManualOverride(modelId: number) {
  await db
    .update(modelPricing)
    .set({ manualOverride: false, matchStatus: "matched", updatedAt: new Date() })
    .where(and(eq(modelPricing.modelId, modelId), eq(modelPricing.manualOverride, true)));
}

export async function getModelPricingCount(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(modelPricing);
  return Number(result?.count ?? 0);
}
