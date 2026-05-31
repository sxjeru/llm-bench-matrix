import { and, count, countDistinct, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers, settings } from "@/lib/db/schema";
import { normalizeProviderConfig } from "@/lib/provider-config";
import { bumpCacheVersions, getCacheVersion } from "@/lib/cache-versions";
import { createVersionedCacheStore, invalidateVersionedCacheStore, withVersionedCache } from "@/lib/server-cache";
import { invalidateModelPricingCaches } from "@/lib/model-pricing";

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
  providerDisplayName: string;
  providerBrandColor: string | null;
  providerEntityId: number;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  sourceBenchmarkType: string | null;
  higherIsBetter: boolean;
  benchmarkCanonicalKey: string;
  modalities: string[];
  sourceModalities: string[] | null;
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  updatedAt: string;
};

const SOURCE_EMPTY_KEY = "__EMPTY__";
const CACHE_VERSION_PROBE_TTL_MS = 5_000;
const CACHE_STALE_IF_ERROR_MS = 30 * 60_000;
const DEFAULT_MAX_DASHBOARD_ROWS = 50_000;

const dashboardRowsStore = createVersionedCacheStore<DashboardRow[]>();
const dashboardStatsStore = createVersionedCacheStore<DashboardStats>();
const sourceOptionsStore = createVersionedCacheStore<string[]>();

/**
 * Clear dashboard caches after admin write operations
 * (import, merge, delete, etc.) so subsequent reads reflect updated data.
 */
export function invalidateAllCaches() {
  invalidateVersionedCacheStore(dashboardRowsStore);
  invalidateVersionedCacheStore(dashboardStatsStore);
  invalidateVersionedCacheStore(sourceOptionsStore);
  invalidateModelPricingCaches();

  void bumpCacheVersions(["dashboard", "pricing", "admin_entities"]);

  try {
    revalidatePath("/");
    revalidatePath("/admin");
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) {
      return;
    }

    throw error;
  }
}

function normalizeSourceFilterKey(sourceFilter?: string | null): string {
  const normalized = sourceFilter?.trim();
  return normalized && normalized.length > 0 ? normalized : "__ALL__";
}

function getDashboardCacheVersion() {
  return getCacheVersion("dashboard");
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

  return withVersionedCache(
    dashboardRowsStore,
    cacheKey,
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: async () => {
      const whereClause = resolveDashboardWhereClause(normalizedSourceFilter);

      const baseQuery = db
        .select({
          id: benchmarkValues.id,
          providerId: providers.id,
          providerName: providers.name,
          providerConfig: providers.config,
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
          source: benchmarkValues.source,
          updatedAt: benchmarkValues.createdAt
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

      const providerIds = Array.from(new Set(rows.map((row) => {
        const config = normalizeProviderConfig(row.providerConfig);
        return typeof config.displayTargetProviderId === "number" ? config.displayTargetProviderId : -1;
      }).filter((id) => id > 0)));

      const displayTargetProviders = providerIds.length > 0
        ? await db.select().from(providers).where(inArray(providers.id, providerIds))
        : [];
      const displayTargetProviderById = new Map(displayTargetProviders.map((provider) => [provider.id, provider]));

      return rows.map((row) => {
        const providerConfig = normalizeProviderConfig(row.providerConfig);
        const displayTargetProvider = typeof providerConfig.displayTargetProviderId === "number"
          ? displayTargetProviderById.get(providerConfig.displayTargetProviderId) ?? null
          : null;
        const displayTargetConfig = displayTargetProvider ? normalizeProviderConfig(displayTargetProvider.config) : null;
        const resolvedProviderName = displayTargetProvider?.name ?? row.providerName;
        const resolvedProviderDisplayName = displayTargetConfig?.displayName?.trim()
          || providerConfig.displayName?.trim()
          || displayTargetProvider?.name
          || row.providerName;
        const resolvedProviderBrandColor = displayTargetConfig?.branding?.color
          ?? providerConfig.branding?.color
          ?? null;

        return {
        id: row.id,
        providerName: resolvedProviderName,
        providerDisplayName: resolvedProviderDisplayName,
        providerBrandColor: resolvedProviderBrandColor,
        providerEntityId: displayTargetProvider?.id ?? row.providerId,
        modelName: row.modelName,
        benchmarkName: row.benchmarkName,
        benchmarkType: row.benchmarkType,
        sourceBenchmarkType: row.benchmarkTypeOverride,
        higherIsBetter: row.higherIsBetter,
        benchmarkCanonicalKey: row.benchmarkCanonicalKey,
        modalities: row.modalities ?? [],
        sourceModalities: row.modalitiesOverride,
        benchTime: row.benchTime.toISOString(),
        valueRaw: row.valueRaw,
        valueNum: toNullableNumber(row.valueNum),
        valueNum2: toNullableNumber(row.valueNum2),
        valueNote: row.valueNote,
        source: row.source,
        updatedAt: row.updatedAt.toISOString()
        };
      });
      }
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

  return withVersionedCache(
    dashboardStatsStore,
    cacheKey,
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: async () => {
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
  return withVersionedCache(
    sourceOptionsStore,
    "all",
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: async () => {
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
