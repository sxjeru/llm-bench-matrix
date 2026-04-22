import { and, asc, count, countDistinct, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers, providerPrefixRules, settings } from "@/lib/db/schema";

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type DashboardRow = {
  id: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  higherIsBetter: boolean;
  benchmarkCanonicalKey: string;
  modalities: string[];
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
};

const SOURCE_EMPTY_KEY = "__EMPTY__";
const DASHBOARD_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_DASHBOARD_ROWS = 50_000;

type TimedCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const dashboardRowsCache = new Map<string, TimedCacheEntry<DashboardRow[]>>();
const dashboardRowsInFlight = new Map<string, Promise<DashboardRow[]>>();
const dashboardStatsCache = new Map<string, TimedCacheEntry<DashboardStats>>();
const dashboardStatsInFlight = new Map<string, Promise<DashboardStats>>();
const sourceOptionsCache = new Map<string, TimedCacheEntry<string[]>>();
const sourceOptionsInFlight = new Map<string, Promise<string[]>>();

/**
 * Clear all in-memory query caches. Call after admin write operations
 * (import, merge, delete, etc.) so subsequent reads reflect updated data.
 */
export function invalidateAllCaches() {
  dashboardRowsCache.clear();
  dashboardStatsCache.clear();
  sourceOptionsCache.clear();

  dashboardRowsInFlight.clear();
  dashboardStatsInFlight.clear();
  sourceOptionsInFlight.clear();
}

function normalizeSourceFilterKey(sourceFilter?: string | null): string {
  const normalized = sourceFilter?.trim();
  return normalized && normalized.length > 0 ? normalized : "__ALL__";
}

async function withTimedCache<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  inFlight: Map<string, Promise<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const promise = loader()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
      });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function resolveDashboardWhereClause(sourceFilter?: string | null) {
  const normalizedSourceFilter = sourceFilter?.trim();
  const baseFilter = and(isNull(models.mergedIntoModelId), isNull(benchmarks.mergedIntoBenchmarkId));

  if (!normalizedSourceFilter) {
    return baseFilter;
  }

  if (normalizedSourceFilter === SOURCE_EMPTY_KEY) {
    return and(
      baseFilter,
      or(isNull(benchmarkValues.source), eq(benchmarkValues.source, ""))
    );
  }

  return and(baseFilter, eq(benchmarkValues.source, normalizedSourceFilter));
}

export async function getDashboardRows(limit: number | null = null, sourceFilter?: string | null): Promise<DashboardRow[]> {
  const rawLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : DEFAULT_MAX_DASHBOARD_ROWS;
  const normalizedLimit = Math.min(rawLimit, DEFAULT_MAX_DASHBOARD_ROWS);
  const normalizedSourceFilter = sourceFilter?.trim() || null;
  const cacheKey = `${normalizedLimit ?? "all"}::${normalizeSourceFilterKey(normalizedSourceFilter)}`;

  return withTimedCache(
    dashboardRowsCache,
    dashboardRowsInFlight,
    cacheKey,
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const whereClause = resolveDashboardWhereClause(normalizedSourceFilter);

      const baseQuery = db
        .select({
          id: benchmarkValues.id,
          providerName: providers.name,
          providerDisplayName: providers.displayName,
          modelName: models.modelName,
          benchmarkName: benchmarks.benchmarkName,
          benchmarkType: benchmarks.benchmarkType,
          higherIsBetter: benchmarks.higherIsBetter,
          benchmarkTypeOverride: benchmarkSourceMeta.benchmarkType,
          benchmarkCanonicalKey: benchmarks.canonicalKey,
          modalities: benchmarks.modalities,
          modalitiesOverride: benchmarkSourceMeta.modalities,
          benchTime: benchmarkValues.benchTime,
          valueRaw: benchmarkValues.valueRaw,
          valueNum: benchmarkValues.valueNum,
          valueNum2: benchmarkValues.valueNum2,
          valueNote: benchmarkValues.valueNote,
          source: benchmarkValues.source
        })
        .from(benchmarkValues)
        .innerJoin(models, eq(benchmarkValues.modelId, models.id))
        .innerJoin(providers, eq(models.providerId, providers.id))
        .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
        .leftJoin(
          benchmarkSourceMeta,
          and(
            eq(benchmarkSourceMeta.benchmarkId, benchmarks.id),
            eq(benchmarkSourceMeta.source, benchmarkValues.source)
          )
        )
        .where(whereClause)
        .orderBy(desc(benchmarkValues.benchTime), desc(benchmarkValues.id))
        .limit(normalizedLimit);

      const rows = await baseQuery;

      const shouldUseSourceMeta = Boolean(
        normalizedSourceFilter && normalizedSourceFilter !== SOURCE_EMPTY_KEY
      );

      return rows.map((row) => ({
        id: row.id,
        providerName: row.providerDisplayName ?? row.providerName,
        modelName: row.modelName,
        benchmarkName: row.benchmarkName,
        benchmarkType: shouldUseSourceMeta
          ? (row.benchmarkTypeOverride ?? row.benchmarkType)
          : row.benchmarkType,
        higherIsBetter: row.higherIsBetter,
        benchmarkCanonicalKey: row.benchmarkCanonicalKey,
        modalities: shouldUseSourceMeta
          ? (row.modalitiesOverride ?? row.modalities ?? [])
          : (row.modalities ?? []),
        benchTime: row.benchTime.toISOString(),
        valueRaw: row.valueRaw,
        valueNum: toNullableNumber(row.valueNum),
        valueNum2: toNullableNumber(row.valueNum2),
        valueNote: row.valueNote,
        source: row.source
      }));
    }
  );
}

export type DashboardStats = {
  providerCount: number;
  modelCount: number;
  benchmarkCount: number;
  totalRecords: number;
};

export async function getDashboardStats(sourceFilter?: string | null): Promise<DashboardStats> {
  const normalizedSourceFilter = sourceFilter?.trim() || null;
  const cacheKey = normalizeSourceFilterKey(normalizedSourceFilter);

  return withTimedCache(
    dashboardStatsCache,
    dashboardStatsInFlight,
    cacheKey,
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const whereClause = resolveDashboardWhereClause(normalizedSourceFilter);

      const [result] = await db
        .select({
          providerCount: countDistinct(providers.id),
          modelCount: countDistinct(models.id),
          benchmarkCount: countDistinct(benchmarks.id),
          totalRecords: count()
        })
        .from(benchmarkValues)
        .innerJoin(models, eq(benchmarkValues.modelId, models.id))
        .innerJoin(providers, eq(models.providerId, providers.id))
        .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
        .where(whereClause);

      return {
        providerCount: Number(result?.providerCount ?? 0),
        modelCount: Number(result?.modelCount ?? 0),
        benchmarkCount: Number(result?.benchmarkCount ?? 0),
        totalRecords: Number(result?.totalRecords ?? 0)
      };
    }
  );
}

export async function getActiveEntities() {
  const [providerRows, modelRows, benchmarkRows] = await Promise.all([
    db.select().from(providers).orderBy(providers.name),
    db
      .select()
      .from(models)
      .where(isNull(models.mergedIntoModelId))
      .orderBy(models.modelName),
    db
      .select()
      .from(benchmarks)
      .where(isNull(benchmarks.mergedIntoBenchmarkId))
      .orderBy(benchmarks.benchmarkName)
  ]);

  return {
    providers: providerRows,
    models: modelRows,
    benchmarks: benchmarkRows
  };
}

export async function getSourceOptions(): Promise<string[]> {
  return withTimedCache(
    sourceOptionsCache,
    sourceOptionsInFlight,
    "all",
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const rows = await db
        .selectDistinct({ source: benchmarkValues.source })
        .from(benchmarkValues)
        .where(isNotNull(benchmarkValues.source))
        .orderBy(benchmarkValues.source);

      const normalized = rows
        .map((item) => item.source?.trim() ?? "")
        .filter((item): item is string => item.length > 0);

      // Keep post-trim uniqueness semantics stable even if DB distinct values differ
      // only by surrounding whitespace.
      return Array.from(new Set(normalized));
    }
  );
}

export async function getSettings() {
  const rows = await db.select().from(settings);

  return rows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.key] = row.valueJson;
    return acc;
  }, {});
}

export type MergedEntityRecord = {
  entityType: "model" | "benchmark";
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
};

export async function getMergedEntityRecords(): Promise<MergedEntityRecord[]> {
  const [mergedModels, mergedBenchmarks] = await Promise.all([
    db
      .select({ sourceId: models.id, sourceName: models.modelName, targetId: models.mergedIntoModelId })
      .from(models)
      .where(isNotNull(models.mergedIntoModelId)),
    db
      .select({ sourceId: benchmarks.id, sourceName: benchmarks.benchmarkName, targetId: benchmarks.mergedIntoBenchmarkId })
      .from(benchmarks)
      .where(isNotNull(benchmarks.mergedIntoBenchmarkId))
  ]);

  const modelTargetIds = Array.from(
    new Set(mergedModels.map((item) => item.targetId).filter((id): id is number => id !== null))
  );
  const benchmarkTargetIds = Array.from(
    new Set(mergedBenchmarks.map((item) => item.targetId).filter((id): id is number => id !== null))
  );

  const [targetModels, targetBenchmarks] = await Promise.all([
    modelTargetIds.length > 0
      ? db.select({ id: models.id, modelName: models.modelName }).from(models).where(inArray(models.id, modelTargetIds))
      : Promise.resolve([]),
    benchmarkTargetIds.length > 0
      ? db
          .select({ id: benchmarks.id, benchmarkName: benchmarks.benchmarkName, benchmarkType: benchmarks.benchmarkType })
          .from(benchmarks)
          .where(inArray(benchmarks.id, benchmarkTargetIds))
      : Promise.resolve([])
  ]);

  const modelNameById = new Map(targetModels.map((item) => [item.id, item.modelName]));
  const benchmarkNameById = new Map(
    targetBenchmarks.map((item) => [item.id, `${item.benchmarkName} (${item.benchmarkType})`])
  );

  const modelRecords: MergedEntityRecord[] = mergedModels
    .filter((item) => item.targetId !== null)
    .map((item) => ({
      entityType: "model",
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      targetId: item.targetId as number,
      targetName: modelNameById.get(item.targetId as number) ?? `#${item.targetId}`
    }));

  const benchmarkRecords: MergedEntityRecord[] = mergedBenchmarks
    .filter((item) => item.targetId !== null)
    .map((item) => ({
      entityType: "benchmark",
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      targetId: item.targetId as number,
      targetName: benchmarkNameById.get(item.targetId as number) ?? `#${item.targetId}`
    }));

  return [...modelRecords, ...benchmarkRecords].sort((a, b) => {
    const typeCompare = a.entityType.localeCompare(b.entityType);
    if (typeCompare !== 0) return typeCompare;
    return a.sourceName.localeCompare(b.sourceName, "zh-Hans-CN");
  });
}

export async function saveSetting(input: {
  key: string;
  valueJson: unknown;
  updatedBy?: string;
  note?: string;
}) {
  await db
    .insert(settings)
    .values({
      key: input.key,
      valueJson: input.valueJson,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
      note: input.note
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueJson: input.valueJson,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
        note: input.note
      }
    });
}

// ──────────────────────────────────────────────
// Provider customization helpers
// ──────────────────────────────────────────────

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/;

/**
 * Normalize a prefix string to a stable lookup key:
 * lowercase, remove all non-alphanumeric characters (keep letters and digits only).
 */
export function normalizePrefixKey(prefix: string): string {
  return prefix.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ProviderPrefixRule = {
  id: number;
  providerId: number;
  prefix: string;
  prefixKey: string;
  priority: number;
  isEnabled: boolean;
};

export async function getProviderPrefixRules(providerId?: number): Promise<ProviderPrefixRule[]> {
  const query = db
    .select({
      id: providerPrefixRules.id,
      providerId: providerPrefixRules.providerId,
      prefix: providerPrefixRules.prefix,
      prefixKey: providerPrefixRules.prefixKey,
      priority: providerPrefixRules.priority,
      isEnabled: providerPrefixRules.isEnabled
    })
    .from(providerPrefixRules)
    .orderBy(asc(providerPrefixRules.priority), asc(providerPrefixRules.id));

  if (providerId !== undefined) {
    return query.where(eq(providerPrefixRules.providerId, providerId));
  }

  return query;
}

/**
 * Resolve a provider name from a model name using prefix rules (sorted by priority asc).
 * Returns the provider name string on match, null when no rule matches
 * (caller should fall back to inferProviderNameFromModel).
 */
export function resolveProviderNameByModelName(
  modelName: string,
  prefixRules: ProviderPrefixRule[],
  providerNameById: Map<number, string>
): string | null {
  const normalizedModel = normalizePrefixKey(modelName);
  const enabledRules = prefixRules.filter((r) => r.isEnabled);

  for (const rule of enabledRules) {
    if (rule.prefixKey.length > 0 && normalizedModel.startsWith(rule.prefixKey)) {
      const name = providerNameById.get(rule.providerId);
      if (name) return name;
    }
  }

  return null;
}

export type ProviderConfigInput = {
  displayName?: string | null;
  brandColor?: string | null;
  brandTextColor?: string | null;
};

export async function upsertProviderConfig(
  providerId: number,
  input: ProviderConfigInput
): Promise<void> {
  if (input.brandColor !== null && input.brandColor !== undefined && input.brandColor !== "") {
    if (!HEX_COLOR_REGEX.test(input.brandColor)) {
      throw Object.assign(new Error("invalid hex color: brandColor"), { statusCode: 400 });
    }
  }
  if (input.brandTextColor !== null && input.brandTextColor !== undefined && input.brandTextColor !== "") {
    if (!HEX_COLOR_REGEX.test(input.brandTextColor)) {
      throw Object.assign(new Error("invalid hex color: brandTextColor"), { statusCode: 400 });
    }
  }

  await db
    .update(providers)
    .set({
      displayName: input.displayName ?? null,
      brandColor: input.brandColor ?? null,
      brandTextColor: input.brandTextColor ?? null
    })
    .where(eq(providers.id, providerId));
}

export type AddPrefixRuleInput = {
  providerId: number;
  prefix: string;
  priority?: number;
  isEnabled?: boolean;
};

export async function addProviderPrefixRule(input: AddPrefixRuleInput): Promise<ProviderPrefixRule> {
  const prefixKey = normalizePrefixKey(input.prefix.trim());

  if (!prefixKey) {
    throw Object.assign(new Error("prefix cannot be empty after normalization"), { statusCode: 400 });
  }

  // Check global uniqueness
  const existing = await db
    .select({ id: providerPrefixRules.id })
    .from(providerPrefixRules)
    .where(eq(providerPrefixRules.prefixKey, prefixKey))
    .limit(1);

  if (existing.length > 0) {
    throw Object.assign(new Error(`prefix_key "${prefixKey}" already exists`), { statusCode: 409 });
  }

  const [inserted] = await db
    .insert(providerPrefixRules)
    .values({
      providerId: input.providerId,
      prefix: input.prefix.trim(),
      prefixKey,
      priority: input.priority ?? 0,
      isEnabled: input.isEnabled ?? true
    })
    .returning();

  if (!inserted) {
    throw new Error("failed to insert prefix rule");
  }

  return {
    id: inserted.id,
    providerId: inserted.providerId,
    prefix: inserted.prefix,
    prefixKey: inserted.prefixKey,
    priority: inserted.priority,
    isEnabled: inserted.isEnabled
  };
}

export type UpdatePrefixRuleInput = {
  prefix?: string;
  priority?: number;
  isEnabled?: boolean;
};

export async function updateProviderPrefixRule(
  ruleId: number,
  input: UpdatePrefixRuleInput
): Promise<ProviderPrefixRule> {
  const updateValues: Partial<typeof providerPrefixRules.$inferInsert> = {};

  if (input.prefix !== undefined) {
    const prefixKey = normalizePrefixKey(input.prefix.trim());
    if (!prefixKey) {
      throw Object.assign(new Error("prefix cannot be empty after normalization"), { statusCode: 400 });
    }

    // Check uniqueness (excluding current rule)
    const existing = await db
      .select({ id: providerPrefixRules.id })
      .from(providerPrefixRules)
      .where(and(eq(providerPrefixRules.prefixKey, prefixKey), ne(providerPrefixRules.id, ruleId)))
      .limit(1);

    if (existing.length > 0) {
      throw Object.assign(new Error(`prefix_key "${prefixKey}" already exists`), { statusCode: 409 });
    }

    updateValues.prefix = input.prefix.trim();
    updateValues.prefixKey = prefixKey;
  }

  if (input.priority !== undefined) {
    updateValues.priority = input.priority;
  }

  if (input.isEnabled !== undefined) {
    updateValues.isEnabled = input.isEnabled;
  }

  if (Object.keys(updateValues).length === 0) {
    const [current] = await db
      .select()
      .from(providerPrefixRules)
      .where(eq(providerPrefixRules.id, ruleId))
      .limit(1);

    if (!current) {
      throw Object.assign(new Error(`rule ${ruleId} not found`), { statusCode: 404 });
    }

    return current;
  }

  const [updated] = await db
    .update(providerPrefixRules)
    .set(updateValues)
    .where(eq(providerPrefixRules.id, ruleId))
    .returning();

  if (!updated) {
    throw Object.assign(new Error(`rule ${ruleId} not found`), { statusCode: 404 });
  }

  return {
    id: updated.id,
    providerId: updated.providerId,
    prefix: updated.prefix,
    prefixKey: updated.prefixKey,
    priority: updated.priority,
    isEnabled: updated.isEnabled
  };
}

export async function deleteProviderPrefixRule(ruleId: number): Promise<void> {
  const deleted = await db
    .delete(providerPrefixRules)
    .where(eq(providerPrefixRules.id, ruleId))
    .returning({ id: providerPrefixRules.id });

  if (deleted.length === 0) {
    throw Object.assign(new Error(`rule ${ruleId} not found`), { statusCode: 404 });
  }
}
