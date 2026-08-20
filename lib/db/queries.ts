import { and, count, countDistinct, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers, settings } from "@/lib/db/schema";
import { normalizeProviderConfig } from "@/lib/provider-config";
import { bumpCacheVersions, getCacheVersion, type CacheVersionDomain } from "@/lib/cache-versions";
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
const modelParamsStore = createVersionedCacheStore<ModelParamsInfo[]>();

const cacheInvalidators: Array<() => void> = [];

export function registerCacheInvalidator(fn: () => void) {
  cacheInvalidators.push(fn);
}

/** invalidateAllCaches 默认会 bump 的缓存版本域 */
const ALL_CACHE_VERSION_DOMAINS: CacheVersionDomain[] = ["dashboard", "pricing", "admin_entities", "settings"];

/**
 * Clear dashboard caches after admin write operations
 * (import, merge, delete, etc.) so subsequent reads reflect updated data.
 *
 * 公开页已是静态壳 + 客户端拉 `/api/public/dashboard`，新鲜度靠版本号 / ETag。
 * 不要再 revalidatePath 公开 layout：Vercel ISR 会把 `revalidate = false` 的首页
 * 打进按需重生锁，导入后访问 `/` 会卡死。
 *
 * skipVersionBump 用于调用链上已经 bump 过的域：lib/model-pricing 的写函数内部会
 * 自行 bump "pricing"，价格相关路由再无条件走这里就会重复写一次 settings 表。
 * 只跳过版本号 bump，进程内缓存仍然照常清空（清 Map 是幂等的，成本可忽略）。
 */
export async function invalidateAllCaches(options?: { skipVersionBump?: CacheVersionDomain[] }) {
  invalidateVersionedCacheStore(dashboardRowsStore);
  invalidateVersionedCacheStore(dashboardStatsStore);
  invalidateVersionedCacheStore(sourceOptionsStore);
  invalidateVersionedCacheStore(modelParamsStore);
  invalidateModelPricingCaches();
  for (const fn of cacheInvalidators) {
    fn();
  }

  const skipped = new Set(options?.skipVersionBump ?? []);
  await bumpCacheVersions(ALL_CACHE_VERSION_DOMAINS.filter((domain) => !skipped.has(domain)));
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

async function loadDashboardRows(limit: number, sourceFilter: string | null): Promise<DashboardRow[]> {
  const whereClause = resolveDashboardWhereClause(sourceFilter);

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
    .limit(limit);

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

export async function getDashboardRows(
  limit: number | null = null,
  sourceFilter?: string | null,
  forceVersion?: string
): Promise<DashboardRow[]> {
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
      loader: () => loadDashboardRows(normalizedLimit, normalizedSourceFilter),
      forceVersion
    }
  );
}

export type DashboardStats = {
  providerCount: number;
  modelCount: number;
  benchmarkCount: number;
  totalRecords: number;
};

async function loadDashboardStats(sourceFilter: string | null): Promise<DashboardStats> {
  const whereClause = resolveDashboardWhereClause(sourceFilter);

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

export async function getDashboardStats(
  sourceFilter?: string | null,
  forceVersion?: string
): Promise<DashboardStats> {
  const normalizedSourceFilter = sourceFilter?.trim() || null;
  const cacheKey = normalizeSourceFilterKey(normalizedSourceFilter);

  return withVersionedCache(
    dashboardStatsStore,
    cacheKey,
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: () => loadDashboardStats(normalizedSourceFilter),
      forceVersion
    }
  );
}

export async function getActiveEntities() {
  const [providerRows, modelRows, benchmarkRows, benchmarkValueStats] = await Promise.all([
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
      .orderBy(benchmarks.benchmarkName),
    db
      .select({
        benchmarkId: benchmarkValues.benchmarkId,
        valueCount: sql<number>`count(*)`,
        overHundredValueCount: sql<number>`count(*) filter (where ${benchmarkValues.valueNum} > 100 or ${benchmarkValues.valueNum2} > 100)`
      })
      .from(benchmarkValues)
      .groupBy(benchmarkValues.benchmarkId)
  ]);

  const statsByBenchmarkId = new Map(
    benchmarkValueStats.map((item) => [
      item.benchmarkId,
      {
        valueCount: toNullableNumber(item.valueCount) ?? 0,
        overHundredValueCount: toNullableNumber(item.overHundredValueCount) ?? 0
      }
    ])
  );

  return {
    providers: providerRows,
    models: modelRows,
    benchmarks: benchmarkRows.map((benchmark) => ({
      ...benchmark,
      valueCount: statsByBenchmarkId.get(benchmark.id)?.valueCount ?? 0,
      overHundredValueCount: statsByBenchmarkId.get(benchmark.id)?.overHundredValueCount ?? 0
    }))
  };
}

async function loadSourceOptions(): Promise<string[]> {
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

export async function getSourceOptions(forceVersion?: string): Promise<string[]> {
  return withVersionedCache(
    sourceOptionsStore,
    "all",
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: loadSourceOptions,
      forceVersion
    }
  );
}

export type ModelParamsInfo = {
  modelId: number;
  modelName: string;
  /** 总参数量（B）。null 表示未填写 */
  totalParamsB: number | null;
  /** 激活参数量（B）。null 表示稠密模型或未填写 */
  activatedParamsB: number | null;
  isEstimated: boolean;
  note: string | null;
};

/**
 * 参数量是模型自身属性，与 benchmark_values 无关，因此不能复用 dashboard rows
 * （那是 benchmark_values 驱动的，尚无测评值的模型不会出现在里面）。
 */
async function loadModelParamsRows(): Promise<ModelParamsInfo[]> {
  const rows = await db
    .select({
      modelId: models.id,
      modelName: models.modelName,
      totalParamsB: models.totalParamsB,
      activatedParamsB: models.activatedParamsB,
      paramsIsEstimated: models.paramsIsEstimated,
      paramsNote: models.paramsNote
    })
    .from(models)
    .where(isNull(models.mergedIntoModelId))
    .orderBy(models.modelName);

  return rows
    .map((row) => ({
      modelId: row.modelId,
      modelName: row.modelName,
      totalParamsB: toNullableNumber(row.totalParamsB),
      activatedParamsB: toNullableNumber(row.activatedParamsB),
      isEstimated: row.paramsIsEstimated,
      note: row.paramsNote
    }))
    .filter((row) => row.totalParamsB !== null || row.activatedParamsB !== null);
}

export async function getModelParamsRows(forceVersion?: string): Promise<ModelParamsInfo[]> {
  return withVersionedCache(
    modelParamsStore,
    "all",
    {
      versionProbeTtlMs: CACHE_VERSION_PROBE_TTL_MS,
      staleIfErrorMs: CACHE_STALE_IF_ERROR_MS,
      getVersion: getDashboardCacheVersion,
      loader: loadModelParamsRows,
      forceVersion
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
