import { and, asc, count, countDistinct, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers } from "@/lib/db/schema";
import { buildBenchmarkCanonicalKey, buildModelCanonicalKey } from "@/lib/db/normalize";
import { invalidateAllCaches } from "@/lib/db/queries";
import { normalizeProviderConfig } from "@/lib/provider-config";
import { isArtificialAnalysisSource } from "@/lib/source-utils";
import {
  ensureBenchmark,
  ensureModelByProviderId,
  ensureProvider,
  getModelDedupeRule,
  normalizeBenchmarkValueForStorage
} from "@/lib/admin-service";
import {
  formatRecordNumericValue,
  getRecordCellKey,
  isEmptyRecordValue,
  planDualValueSplit,
  planRecordDraftMutations,
  planRecordReassign,
  planRecordScaleNormalization,
  type RecordDraftInput,
  type RecordReassignConflictStrategy,
  type RecordScaleTarget
} from "@/lib/admin-records-planner";

type DbTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 单次批量保存允许提交的草稿上限，防止误操作把整库塞进一个事务 */
export const MAX_RECORD_DRAFTS_PER_SAVE = 2_000;
/** 矩阵默认/最大轴长度：矩阵是 O(模型×指标) 的，必须有硬上限 */
export const DEFAULT_RECORD_MATRIX_MODEL_LIMIT = 40;
export const DEFAULT_RECORD_MATRIX_BENCHMARK_LIMIT = 30;
export const MAX_RECORD_MATRIX_MODEL_LIMIT = 120;
export const MAX_RECORD_MATRIX_BENCHMARK_LIMIT = 80;
/** 单次批量删除的记录上限 */
export const MAX_RECORD_BATCH_DELETE = 200_000;

const DELETE_CHUNK_SIZE = 2_000;
const INSERT_CHUNK_SIZE = 500;

export type RecordSourceMode = "all" | "specific" | "empty";

/** 变更类接口的作用范围：只认显式 id + source，不接受模糊搜索条件 */
export type RecordMutationScope = {
  modelIds?: number[];
  benchmarkIds?: number[];
  sourceMode?: RecordSourceMode;
  source?: string | null;
};

export type AdminRecordMatrixFilters = RecordMutationScope & {
  search?: string | null;
  modelLimit?: number;
  benchmarkLimit?: number;
};

export type AdminRecordMatrixModel = {
  modelId: number;
  modelName: string;
  providerId: number;
  providerName: string;
  providerDisplayName: string;
  recordCount: number;
};

export type AdminRecordMatrixBenchmark = {
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  recordCount: number;
};

export type AdminRecordCell = {
  modelId: number;
  benchmarkId: number;
  /** 单元格主记录（benchTime 最新的一条），编辑写到这条上 */
  recordId: number;
  /** 该单元格在当前筛选范围内的全部记录 id，清空时一并删除 */
  recordIds: number[];
  recordCount: number;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  benchTime: string;
  records?: Array<{
    id: number;
    valueRaw: string;
    valueNum: number | null;
    valueNum2: number | null;
    valueNote: string | null;
    source: string | null;
    benchTime: string;
  }>;
};

export type AdminRecordMatrix = {
  generatedAt: string;
  models: AdminRecordMatrixModel[];
  benchmarks: AdminRecordMatrixBenchmark[];
  cells: AdminRecordCell[];
  /** 筛选范围内的全部记录数（不受矩阵截断影响） */
  totalRecordCount: number;
  /** 落在返回矩阵内的记录数 */
  visibleRecordCount: number;
  modelTotalCount: number;
  benchmarkTotalCount: number;
  truncated: { models: boolean; benchmarks: boolean };
  limits: { modelLimit: number; benchmarkLimit: number };
};

function normalizeIdList(ids: number[] | undefined): number[] {
  if (!ids?.length) return [];
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
}

function normalizeSourceValue(source: string | null | undefined): string | null {
  const trimmed = source?.trim();
  return trimmed ? trimmed : null;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), max);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumericColumn(value: number | null): string | null {
  return value === null ? null : formatRecordNumericValue(value);
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (matched) => `\\${matched}`);
}

/**
 * 只作用在 benchmark_values 自身列上的条件，不需要 join。
 * 变更类接口统一走这里，作用范围与前端传来的可见轴严格一致。
 */
function buildRecordValueConditions(scope: RecordMutationScope) {
  const conditions = [];
  const modelIds = normalizeIdList(scope.modelIds);
  const benchmarkIds = normalizeIdList(scope.benchmarkIds);
  const sourceMode = scope.sourceMode ?? "all";

  if (modelIds.length > 0) {
    conditions.push(inArray(benchmarkValues.modelId, modelIds));
  }
  if (benchmarkIds.length > 0) {
    conditions.push(inArray(benchmarkValues.benchmarkId, benchmarkIds));
  }
  if (sourceMode === "empty") {
    conditions.push(or(isNull(benchmarkValues.source), eq(benchmarkValues.source, "")));
  }
  if (sourceMode === "specific") {
    const source = normalizeSourceValue(scope.source);
    if (!source) {
      throw new Error("source 不能为空：sourceMode=specific 需要给出具体 source");
    }
    conditions.push(eq(benchmarkValues.source, source));
  }

  return conditions;
}

export function hasRecordMutationScope(scope: RecordMutationScope): boolean {
  return (
    normalizeIdList(scope.modelIds).length > 0
    || normalizeIdList(scope.benchmarkIds).length > 0
    || (scope.sourceMode ?? "all") !== "all"
  );
}

// --- 矩阵读取 ---

function buildMatrixConditions(filters: AdminRecordMatrixFilters) {
  const conditions = [
    isNull(models.mergedIntoModelId),
    isNull(benchmarks.mergedIntoBenchmarkId),
    ...buildRecordValueConditions(filters)
  ];

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    conditions.push(
      or(
        ilike(models.modelName, pattern),
        ilike(benchmarks.benchmarkName, pattern),
        ilike(benchmarks.benchmarkType, pattern),
        ilike(providers.name, pattern)
      )
    );
  }

  return conditions;
}

export async function getAdminRecordMatrix(
  filters: AdminRecordMatrixFilters = {}
): Promise<AdminRecordMatrix> {
  const modelLimit = clampLimit(
    filters.modelLimit,
    DEFAULT_RECORD_MATRIX_MODEL_LIMIT,
    MAX_RECORD_MATRIX_MODEL_LIMIT
  );
  const benchmarkLimit = clampLimit(
    filters.benchmarkLimit,
    DEFAULT_RECORD_MATRIX_BENCHMARK_LIMIT,
    MAX_RECORD_MATRIX_BENCHMARK_LIMIT
  );

  const whereClause = and(...buildMatrixConditions(filters));

  const specificSource = filters.sourceMode === "specific" ? normalizeSourceValue(filters.source) : null;
  const isSpecificSource = Boolean(specificSource);
  const isAa = Boolean(specificSource && isArtificialAnalysisSource(specificSource));
  const sourceScopedBenchmarkType = sql<string>`coalesce(${benchmarkSourceMeta.benchmarkType}, ${benchmarks.benchmarkType})`;

  const totalsQuery = db
    .select({
      totalRecordCount: count(),
      modelTotalCount: countDistinct(models.id),
      benchmarkTotalCount: countDistinct(benchmarks.id)
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(providers, eq(models.providerId, providers.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(whereClause);

  const modelQuery = db
    .select({
      modelId: models.id,
      modelName: models.modelName,
      providerId: providers.id,
      providerName: providers.name,
      providerConfig: providers.config,
      recordCount: count()
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(providers, eq(models.providerId, providers.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(whereClause)
    .groupBy(models.id, models.modelName, providers.id, providers.name, providers.config)
    .orderBy(desc(count()), asc(models.modelName))
    .limit(modelLimit);

  const benchmarkQuery = isSpecificSource
    ? db
        .select({
          benchmarkId: benchmarks.id,
          benchmarkName: benchmarks.benchmarkName,
          benchmarkType: sourceScopedBenchmarkType,
          unit: benchmarks.unit,
          higherIsBetter: benchmarks.higherIsBetter,
          modalities: benchmarks.modalities,
          recordCount: count()
        })
        .from(benchmarkValues)
        .innerJoin(models, eq(benchmarkValues.modelId, models.id))
        .innerJoin(providers, eq(models.providerId, providers.id))
        .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
        .leftJoin(
          benchmarkSourceMeta,
          and(
            eq(benchmarkSourceMeta.benchmarkId, benchmarks.id),
            eq(benchmarkSourceMeta.source, specificSource!)
          )
        )
        .where(whereClause)
        .groupBy(
          benchmarks.id,
          benchmarks.benchmarkName,
          benchmarks.benchmarkType,
          benchmarks.unit,
          benchmarks.higherIsBetter,
          benchmarks.modalities,
          benchmarkSourceMeta.benchmarkType
        )
        .orderBy(
          ...(isAa
            ? [
                // 与 isAaSecondaryCategory 一致：按 " / " 分段后整段等于 cost / performance
                asc(
                  sql`case when lower(${sourceScopedBenchmarkType}) ~ '(^| / )(cost|performance)($| / )' then 1 else 0 end`
                ),
                asc(sql`min(${benchmarkValues.id})`),
                asc(benchmarks.benchmarkName)
              ]
            : [
                asc(sql`min(${benchmarkValues.id})`),
                asc(benchmarks.benchmarkName)
              ])
        )
        .limit(benchmarkLimit)
    : db
        .select({
          benchmarkId: benchmarks.id,
          benchmarkName: benchmarks.benchmarkName,
          benchmarkType: benchmarks.benchmarkType,
          unit: benchmarks.unit,
          higherIsBetter: benchmarks.higherIsBetter,
          modalities: benchmarks.modalities,
          recordCount: count()
        })
        .from(benchmarkValues)
        .innerJoin(models, eq(benchmarkValues.modelId, models.id))
        .innerJoin(providers, eq(models.providerId, providers.id))
        .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
        .where(whereClause)
        .groupBy(
          benchmarks.id,
          benchmarks.benchmarkName,
          benchmarks.benchmarkType,
          benchmarks.unit,
          benchmarks.higherIsBetter,
          benchmarks.modalities
        )
        .orderBy(desc(count()), asc(benchmarks.benchmarkName))
        .limit(benchmarkLimit);

  const [totalsRows, modelRows, benchmarkRows] = await Promise.all([
    totalsQuery,
    modelQuery,
    benchmarkQuery
  ]);

  const totals = totalsRows[0];
  const matrixModels: AdminRecordMatrixModel[] = modelRows.map((row) => {
    const providerConfig = normalizeProviderConfig(row.providerConfig);
    return {
      modelId: row.modelId,
      modelName: row.modelName,
      providerId: row.providerId,
      providerName: row.providerName,
      providerDisplayName: providerConfig.displayName?.trim() || row.providerName,
      recordCount: Number(row.recordCount ?? 0)
    };
  });

  const matrixBenchmarks: AdminRecordMatrixBenchmark[] = benchmarkRows.map((row) => ({
    benchmarkId: row.benchmarkId,
    benchmarkName: row.benchmarkName,
    benchmarkType: row.benchmarkType,
    unit: row.unit,
    higherIsBetter: row.higherIsBetter,
    modalities: row.modalities ?? [],
    recordCount: Number(row.recordCount ?? 0)
  }));

  const visibleModelIds = matrixModels.map((item) => item.modelId);
  const visibleBenchmarkIds = matrixBenchmarks.map((item) => item.benchmarkId);

  const valueRows =
    visibleModelIds.length > 0 && visibleBenchmarkIds.length > 0
      ? await db
          .select({
            id: benchmarkValues.id,
            modelId: benchmarkValues.modelId,
            benchmarkId: benchmarkValues.benchmarkId,
            valueRaw: benchmarkValues.valueRaw,
            valueNum: benchmarkValues.valueNum,
            valueNum2: benchmarkValues.valueNum2,
            valueNote: benchmarkValues.valueNote,
            source: benchmarkValues.source,
            benchTime: benchmarkValues.benchTime
          })
          .from(benchmarkValues)
          .innerJoin(models, eq(benchmarkValues.modelId, models.id))
          .innerJoin(providers, eq(models.providerId, providers.id))
          .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
          .where(
            and(
              whereClause,
              inArray(benchmarkValues.modelId, visibleModelIds),
              inArray(benchmarkValues.benchmarkId, visibleBenchmarkIds)
            )
          )
          .orderBy(desc(benchmarkValues.benchTime), desc(benchmarkValues.id))
      : [];

  const cellByKey = new Map<string, AdminRecordCell>();
  valueRows.forEach((row) => {
    const key = getRecordCellKey(row.modelId, row.benchmarkId);
    const existing = cellByKey.get(key);

    if (existing) {
      existing.recordIds.push(row.id);
      existing.records?.push({
        id: row.id,
        valueRaw: row.valueRaw,
        valueNum: toFiniteNumber(row.valueNum),
        valueNum2: toFiniteNumber(row.valueNum2),
        valueNote: row.valueNote,
        source: row.source,
        benchTime: row.benchTime.toISOString()
      });
      existing.recordCount += 1;
      return;
    }

    cellByKey.set(key, {
      modelId: row.modelId,
      benchmarkId: row.benchmarkId,
      recordId: row.id,
      recordIds: [row.id],
      recordCount: 1,
      valueRaw: row.valueRaw,
      valueNum: toFiniteNumber(row.valueNum),
      valueNum2: toFiniteNumber(row.valueNum2),
      valueNote: row.valueNote,
      source: row.source,
      benchTime: row.benchTime.toISOString(),
      records: [{
        id: row.id,
        valueRaw: row.valueRaw,
        valueNum: toFiniteNumber(row.valueNum),
        valueNum2: toFiniteNumber(row.valueNum2),
        valueNote: row.valueNote,
        source: row.source,
        benchTime: row.benchTime.toISOString()
      }]
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    models: matrixModels,
    benchmarks: matrixBenchmarks,
    cells: Array.from(cellByKey.values()),
    totalRecordCount: Number(totals?.totalRecordCount ?? 0),
    visibleRecordCount: valueRows.length,
    modelTotalCount: Number(totals?.modelTotalCount ?? 0),
    benchmarkTotalCount: Number(totals?.benchmarkTotalCount ?? 0),
    truncated: {
      models: Number(totals?.modelTotalCount ?? 0) > matrixModels.length,
      benchmarks: Number(totals?.benchmarkTotalCount ?? 0) > matrixBenchmarks.length
    },
    limits: { modelLimit, benchmarkLimit }
  };
}

export async function getAdminRecordSourceEntities(scope: {
  sourceMode: RecordSourceMode;
  source?: string | null;
}): Promise<{ modelIds: number[]; benchmarkIds: number[] }> {
  if (scope.sourceMode === "all") {
    throw new Error("sourceMode 只能是 specific / empty");
  }

  const whereClause = and(
    isNull(models.mergedIntoModelId),
    isNull(benchmarks.mergedIntoBenchmarkId),
    ...buildRecordValueConditions({ sourceMode: scope.sourceMode, source: scope.source })
  );

  const [modelRows, benchmarkRows] = await Promise.all([
    db
      .selectDistinct({ modelId: benchmarkValues.modelId })
      .from(benchmarkValues)
      .innerJoin(models, eq(benchmarkValues.modelId, models.id))
      .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
      .where(whereClause),
    db
      .selectDistinct({ benchmarkId: benchmarkValues.benchmarkId })
      .from(benchmarkValues)
      .innerJoin(models, eq(benchmarkValues.modelId, models.id))
      .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
      .where(whereClause)
  ]);

  return {
    modelIds: modelRows.map((row) => row.modelId),
    benchmarkIds: benchmarkRows.map((row) => row.benchmarkId)
  };
}

// --- benchmark_source_meta 维护 ---

type SourceMetaUpsertRow = {
  benchmarkId: number;
  source: string;
  benchmarkType: string;
  modalities: string[];
};

async function upsertRecordSourceMeta(tx: DbTransactionClient, rows: SourceMetaUpsertRow[]) {
  if (rows.length === 0) return;

  for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
    await tx
      .insert(benchmarkSourceMeta)
      .values(batch)
      .onConflictDoNothing({
        target: [benchmarkSourceMeta.benchmarkId, benchmarkSourceMeta.source]
      });
  }
}

/**
 * 记录被删除 / 迁走以后，`(benchmarkId, source)` 上可能一条数据都不剩，
 * 这时对应的 source meta 覆盖行就是孤儿：留着会让该 source 仍出现在配置里。
 */
async function pruneOrphanRecordSourceMeta(
  tx: DbTransactionClient,
  pairs: Array<{ benchmarkId: number; source: string | null }>
): Promise<number> {
  const candidates = new Map<string, { benchmarkId: number; source: string }>();
  pairs.forEach((pair) => {
    const source = normalizeSourceValue(pair.source);
    if (!source) return;
    candidates.set(`${pair.benchmarkId}::${source}`, { benchmarkId: pair.benchmarkId, source });
  });

  if (candidates.size === 0) return 0;

  const candidateList = Array.from(candidates.values());
  const benchmarkIds = Array.from(new Set(candidateList.map((item) => item.benchmarkId)));
  const sources = Array.from(new Set(candidateList.map((item) => item.source)));

  const remainingRows = await tx
    .select({
      benchmarkId: benchmarkValues.benchmarkId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        inArray(benchmarkValues.benchmarkId, benchmarkIds),
        inArray(benchmarkValues.source, sources)
      )
    )
    .groupBy(benchmarkValues.benchmarkId, benchmarkValues.source);

  const remaining = new Set(
    remainingRows.map((row: { benchmarkId: number; source: string | null }) => `${row.benchmarkId}::${row.source ?? ""}`)
  );

  const orphans = candidateList.filter((item) => !remaining.has(`${item.benchmarkId}::${item.source}`));
  let deleted = 0;

  for (const orphan of orphans) {
    const deletedRows = await tx
      .delete(benchmarkSourceMeta)
      .where(
        and(
          eq(benchmarkSourceMeta.benchmarkId, orphan.benchmarkId),
          eq(benchmarkSourceMeta.source, orphan.source)
        )
      )
      .returning({ id: benchmarkSourceMeta.id });
    deleted += deletedRows.length;
  }

  return deleted;
}

// --- 批量保存草稿 ---

export type BatchSaveRecordDraftsResult = {
  ok: true;
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
  ignoredEmpty: number;
  nonNumeric: Array<{ modelId: number; benchmarkId: number; valueRaw: string }>;
  prunedSourceMeta: number;
};

export async function batchSaveRecordDrafts(input: {
  drafts: RecordDraftInput[];
}): Promise<BatchSaveRecordDraftsResult> {
  const drafts = input.drafts ?? [];

  if (drafts.length === 0) {
    throw new Error("没有需要保存的改动");
  }

  if (drafts.length > MAX_RECORD_DRAFTS_PER_SAVE) {
    throw new Error(`单次最多保存 ${MAX_RECORD_DRAFTS_PER_SAVE} 处改动，当前 ${drafts.length} 处`);
  }

  const modelIds = normalizeIdList(drafts.map((draft) => draft.modelId));
  const benchmarkIds = normalizeIdList(drafts.map((draft) => draft.benchmarkId));

  if (modelIds.length === 0 || benchmarkIds.length === 0) {
    throw new Error("草稿缺少有效的 modelId / benchmarkId");
  }

  const [modelRows, benchmarkRows] = await Promise.all([
    db
      .select({ id: models.id })
      .from(models)
      .where(and(inArray(models.id, modelIds), isNull(models.mergedIntoModelId))),
    db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName,
        benchmarkType: benchmarks.benchmarkType,
        modalities: benchmarks.modalities
      })
      .from(benchmarks)
      .where(and(inArray(benchmarks.id, benchmarkIds), isNull(benchmarks.mergedIntoBenchmarkId)))
  ]);

  const knownModelIds = new Set(modelRows.map((row) => row.id));
  const benchmarkById = new Map(benchmarkRows.map((row) => [row.id, row]));

  const missingModelIds = modelIds.filter((id) => !knownModelIds.has(id));
  const missingBenchmarkIds = benchmarkIds.filter((id) => !benchmarkById.has(id));

  if (missingModelIds.length > 0) {
    throw new Error(`model not found or merged: ${missingModelIds.join(", ")}`);
  }
  if (missingBenchmarkIds.length > 0) {
    throw new Error(`benchmark not found or merged: ${missingBenchmarkIds.join(", ")}`);
  }

  const plan = planRecordDraftMutations(drafts, (draft, raw) =>
    normalizeBenchmarkValueForStorage(benchmarkById.get(draft.benchmarkId)?.benchmarkName, raw)
  );

  const now = new Date();

  const applied = await db.transaction(async (tx: DbTransactionClient) => {
    let deleted = 0;
    const orphanCandidates: Array<{ benchmarkId: number; source: string | null }> = [];

    if (plan.deleteRecordIds.length > 0) {
      for (const batch of chunk(plan.deleteRecordIds, DELETE_CHUNK_SIZE)) {
        const deletedRows = await tx
          .delete(benchmarkValues)
          .where(inArray(benchmarkValues.id, batch))
          .returning({ benchmarkId: benchmarkValues.benchmarkId, source: benchmarkValues.source });
        deleted += deletedRows.length;
        orphanCandidates.push(...deletedRows);
      }
    }

    for (const update of plan.updates) {
      await tx
        .update(benchmarkValues)
        .set({
          valueRaw: update.parsed.valueRaw,
          valueNum: toNumericColumn(update.parsed.valueNum),
          valueNum2: toNumericColumn(update.parsed.valueNum2),
          valueNote: update.parsed.valueNote
        })
        .where(eq(benchmarkValues.id, update.recordId));
    }

    let inserted = 0;
    if (plan.inserts.length > 0) {
      const insertRows = plan.inserts.map((item) => ({
        modelId: item.modelId,
        benchmarkId: item.benchmarkId,
        benchTime: now,
        valueRaw: item.parsed.valueRaw,
        valueNum: toNumericColumn(item.parsed.valueNum),
        valueNum2: toNumericColumn(item.parsed.valueNum2),
        valueNote: item.parsed.valueNote,
        source: item.source
      }));

      for (const batch of chunk(insertRows, INSERT_CHUNK_SIZE)) {
        const insertedRows = await tx
          .insert(benchmarkValues)
          .values(batch)
          .returning({ id: benchmarkValues.id });
        inserted += insertedRows.length;
      }

      const metaRows: SourceMetaUpsertRow[] = [];
      const seenMeta = new Set<string>();
      plan.inserts.forEach((item) => {
        const source = normalizeSourceValue(item.source);
        if (!source) return;

        const key = `${item.benchmarkId}::${source}`;
        if (seenMeta.has(key)) return;
        seenMeta.add(key);

        const benchmark = benchmarkById.get(item.benchmarkId);
        metaRows.push({
          benchmarkId: item.benchmarkId,
          source,
          benchmarkType: benchmark?.benchmarkType ?? "general",
          modalities: benchmark?.modalities?.length ? benchmark.modalities : ["Text"]
        });
      });

      await upsertRecordSourceMeta(tx, metaRows);
    }

    const prunedSourceMeta = await pruneOrphanRecordSourceMeta(tx, orphanCandidates);

    return { deleted, inserted, prunedSourceMeta };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    inserted: applied.inserted,
    updated: plan.updates.length,
    deleted: applied.deleted,
    unchanged: plan.unchanged,
    ignoredEmpty: plan.ignoredEmptyInserts,
    nonNumeric: plan.nonNumericCells,
    prunedSourceMeta: applied.prunedSourceMeta
  };
}

export type RecordDetailMutation = {
  id: number;
  modelId: number;
  benchmarkId: number;
  valueRaw: string;
  benchTime: string | Date;
  source: string | null;
  valueNote: string | null;
  isDeleted?: boolean;
};

export async function updateAdminRecordDetails(input: {
  records: RecordDetailMutation[];
}): Promise<{ ok: true; updated: number; deleted: number; nonNumeric: Array<{ id: number; valueRaw: string }> }> {
  const records = input.records ?? [];
  if (records.length === 0) throw new Error("没有需要保存的记录");
  if (records.length > 500) throw new Error("单次最多保存 500 条记录");

  const ids = Array.from(new Set(records.map((record) => record.id).filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length !== records.length) throw new Error("记录 id 无效或重复");

  const rows = await db
    .select({
      id: benchmarkValues.id,
      modelId: benchmarkValues.modelId,
      benchmarkId: benchmarkValues.benchmarkId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(
      and(
        inArray(benchmarkValues.id, ids),
        isNull(models.mergedIntoModelId),
        isNull(benchmarks.mergedIntoBenchmarkId)
      )
    );
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const benchmarkIds = Array.from(new Set(records.map((record) => record.benchmarkId)));
  const benchmarkRows = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      modalities: benchmarks.modalities
    })
    .from(benchmarks)
    .where(and(inArray(benchmarks.id, benchmarkIds), isNull(benchmarks.mergedIntoBenchmarkId)));
  const benchmarkNameById = new Map(benchmarkRows.map((row) => [row.id, row.benchmarkName]));
  const benchmarkById = new Map(benchmarkRows.map((row) => [row.id, row]));

  for (const record of records) {
    const existing = rowById.get(record.id);
    if (!existing) throw new Error(`record not found: ${record.id}`);
    if (existing.modelId !== record.modelId || existing.benchmarkId !== record.benchmarkId) {
      throw new Error(`record ${record.id} 不属于指定的模型和指标`);
    }
    if (!benchmarkNameById.has(record.benchmarkId)) throw new Error(`benchmark not found: ${record.benchmarkId}`);
    const date = new Date(record.benchTime);
    if (Number.isNaN(date.getTime())) throw new Error(`记录 ${record.id} 的 benchTime 无效`);
  }

  const nonNumeric: Array<{ id: number; valueRaw: string }> = [];
  let updated = 0;
  let deleted = 0;

  await db.transaction(async (tx: DbTransactionClient) => {
    const orphanCandidates: Array<{ benchmarkId: number; source: string | null }> = [];
    const sourceMetaRows = new Map<string, SourceMetaUpsertRow>();
    for (const record of records) {
      const existing = rowById.get(record.id)!;
      const raw = record.valueRaw.trim();
      if (record.isDeleted === true || isEmptyRecordValue(raw)) {
        const deletedRows = await tx
          .delete(benchmarkValues)
          .where(
            and(
              eq(benchmarkValues.id, record.id),
              eq(benchmarkValues.modelId, record.modelId),
              eq(benchmarkValues.benchmarkId, record.benchmarkId)
            )
          )
          .returning({ benchmarkId: benchmarkValues.benchmarkId, source: benchmarkValues.source });
        if (deletedRows.length > 0) {
          deleted += deletedRows.length;
          orphanCandidates.push(...deletedRows);
        }
        continue;
      }

      const parsed = normalizeBenchmarkValueForStorage(benchmarkNameById.get(record.benchmarkId), raw);
      if (parsed.valueNum === null && parsed.valueNum2 === null) nonNumeric.push({ id: record.id, valueRaw: raw });
      const updatedRows = await tx
        .update(benchmarkValues)
        .set({
          valueRaw: parsed.valueRaw,
          valueNum: toNumericColumn(parsed.valueNum),
          valueNum2: toNumericColumn(parsed.valueNum2),
          valueNote: record.valueNote === undefined ? parsed.valueNote : record.valueNote?.trim() || null,
          source: normalizeSourceValue(record.source),
          benchTime: new Date(record.benchTime)
        })
        .where(
          and(
            eq(benchmarkValues.id, record.id),
            eq(benchmarkValues.modelId, record.modelId),
            eq(benchmarkValues.benchmarkId, record.benchmarkId)
          )
        )
        .returning({ id: benchmarkValues.id });
      if (updatedRows.length === 0) throw new Error(`record changed while editing: ${record.id}`);
      updated += updatedRows.length;
      if (existing.source) orphanCandidates.push({ benchmarkId: existing.benchmarkId, source: existing.source });
      const nextSource = normalizeSourceValue(record.source);
      const benchmark = benchmarkById.get(record.benchmarkId);
      if (nextSource && benchmark) {
        sourceMetaRows.set(`${record.benchmarkId}::${nextSource}`, {
          benchmarkId: record.benchmarkId,
          source: nextSource,
          benchmarkType: benchmark.benchmarkType,
          modalities: benchmark.modalities?.length ? benchmark.modalities : ["Text"]
        });
      }
    }
    await upsertRecordSourceMeta(tx, Array.from(sourceMetaRows.values()));
    await pruneOrphanRecordSourceMeta(tx, orphanCandidates);
  });

  await invalidateAllCaches();
  return { ok: true, updated, deleted, nonNumeric };
}

// --- 归属变更 ---

export type ReassignRecordsResult = {
  ok: true;
  entityType: "benchmark" | "model" | "source";
  movedCount: number;
  skippedCount: number;
  deletedTargetCount: number;
  conflictCount: number;
  createdTarget: boolean;
  fromId?: number;
  fromLabel: string;
  targetId?: number;
  targetLabel: string;
};

export async function reassignRecordBenchmark(input: {
  fromBenchmarkId: number;
  target: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
  scope?: RecordMutationScope;
  conflictStrategy?: RecordReassignConflictStrategy;
}): Promise<ReassignRecordsResult> {
  const conflictStrategy = input.conflictStrategy ?? "skip";
  const scope = input.scope ?? {};

  const [fromBenchmark] = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      unit: benchmarks.unit,
      higherIsBetter: benchmarks.higherIsBetter,
      modalities: benchmarks.modalities
    })
    .from(benchmarks)
    .where(and(eq(benchmarks.id, input.fromBenchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
    .limit(1);

  if (!fromBenchmark) {
    throw new Error(`benchmark not found or merged: ${input.fromBenchmarkId}`);
  }

  const targetName = input.target.benchmarkName?.trim();
  let createdTarget = false;
  let targetBenchmark: { id: number; benchmarkName: string; benchmarkType: string; modalities: string[] | null };

  if (typeof input.target.benchmarkId === "number") {
    const [existing] = await db
      .select({
        id: benchmarks.id,
        benchmarkName: benchmarks.benchmarkName,
        benchmarkType: benchmarks.benchmarkType,
        modalities: benchmarks.modalities
      })
      .from(benchmarks)
      .where(and(eq(benchmarks.id, input.target.benchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
      .limit(1);

    if (!existing) {
      throw new Error(`target benchmark not found or merged: ${input.target.benchmarkId}`);
    }
    targetBenchmark = existing;
  } else if (targetName) {
    const dedupeRule = await getModelDedupeRule();
    const targetType = input.target.benchmarkType?.trim() || fromBenchmark.benchmarkType;
    createdTarget = !(await hasBenchmarkByCanonicalKey(
      buildBenchmarkCanonicalKey(targetName, targetType, dedupeRule)
    ));
    targetBenchmark = await ensureBenchmark(
      {
        benchmarkName: targetName,
        benchmarkType: targetType,
        unit: fromBenchmark.unit,
        higherIsBetter: fromBenchmark.higherIsBetter,
        modalities: fromBenchmark.modalities ?? undefined
      },
      { dedupeRule }
    );
  } else {
    throw new Error("目标 benchmark 不能为空");
  }

  if (targetBenchmark.id === fromBenchmark.id) {
    throw new Error("目标 benchmark 与当前列相同，无需变更归属");
  }

  const sourceRecords = await db
    .select({
      id: benchmarkValues.id,
      otherAxisId: benchmarkValues.modelId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        eq(benchmarkValues.benchmarkId, fromBenchmark.id),
        ...buildRecordValueConditions({ ...scope, benchmarkIds: [] })
      )
    );

  if (sourceRecords.length === 0) {
    throw new Error("当前筛选范围内没有可迁移的数据");
  }

  const affectedModelIds = Array.from(new Set(sourceRecords.map((row) => row.otherAxisId)));
  const targetRecords = await db
    .select({
      id: benchmarkValues.id,
      otherAxisId: benchmarkValues.modelId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        eq(benchmarkValues.benchmarkId, targetBenchmark.id),
        inArray(benchmarkValues.modelId, affectedModelIds)
      )
    );

  const plan = planRecordReassign({ sourceRecords, targetRecords, conflictStrategy });
  const movedSources = new Set(
    sourceRecords
      .filter((row) => plan.moveRecordIds.includes(row.id))
      .map((row) => normalizeSourceValue(row.source))
      .filter((source): source is string => source !== null)
  );

  await db.transaction(async (tx: DbTransactionClient) => {
    if (plan.deleteTargetRecordIds.length > 0) {
      for (const batch of chunk(plan.deleteTargetRecordIds, DELETE_CHUNK_SIZE)) {
        await tx.delete(benchmarkValues).where(inArray(benchmarkValues.id, batch));
      }
    }

    for (const batch of chunk(plan.moveRecordIds, DELETE_CHUNK_SIZE)) {
      await tx
        .update(benchmarkValues)
        .set({ benchmarkId: targetBenchmark.id })
        .where(inArray(benchmarkValues.id, batch));
    }

    await upsertRecordSourceMeta(
      tx,
      Array.from(movedSources).map((source) => ({
        benchmarkId: targetBenchmark.id,
        source,
        benchmarkType: targetBenchmark.benchmarkType,
        modalities: targetBenchmark.modalities?.length ? targetBenchmark.modalities : ["Text"]
      }))
    );

    await pruneOrphanRecordSourceMeta(
      tx,
      Array.from(movedSources).map((source) => ({ benchmarkId: fromBenchmark.id, source }))
    );
  });

  await invalidateAllCaches();

  return {
    ok: true,
    entityType: "benchmark",
    movedCount: plan.moveRecordIds.length,
    skippedCount: plan.skippedRecordIds.length,
    deletedTargetCount: plan.deleteTargetRecordIds.length,
    conflictCount: plan.conflictCount,
    createdTarget,
    fromId: fromBenchmark.id,
    fromLabel: `${fromBenchmark.benchmarkName} (${fromBenchmark.benchmarkType})`,
    targetId: targetBenchmark.id,
    targetLabel: `${targetBenchmark.benchmarkName} (${targetBenchmark.benchmarkType})`
  };
}

/** 归属变更前先判断目标实体是否已存在，仅用于给前端「新建了目标实体」的提示 */
async function hasBenchmarkByCanonicalKey(canonicalKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: benchmarks.id })
    .from(benchmarks)
    .where(eq(benchmarks.canonicalKey, canonicalKey))
    .limit(1);
  return Boolean(row);
}

async function hasModelByCanonicalKey(canonicalKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: models.id })
    .from(models)
    .where(eq(models.canonicalKey, canonicalKey))
    .limit(1);
  return Boolean(row);
}

export async function reassignRecordModel(input: {
  fromModelId: number;
  target: { modelId?: number; modelName?: string; providerName?: string };
  scope?: RecordMutationScope;
  conflictStrategy?: RecordReassignConflictStrategy;
}): Promise<ReassignRecordsResult> {
  const conflictStrategy = input.conflictStrategy ?? "skip";
  const scope = input.scope ?? {};

  const [fromModel] = await db
    .select({ id: models.id, modelName: models.modelName, providerId: models.providerId })
    .from(models)
    .where(and(eq(models.id, input.fromModelId), isNull(models.mergedIntoModelId)))
    .limit(1);

  if (!fromModel) {
    throw new Error(`model not found or merged: ${input.fromModelId}`);
  }

  const targetName = input.target.modelName?.trim();
  let createdTarget = false;
  let targetModel: { id: number; modelName: string };

  if (typeof input.target.modelId === "number") {
    const [existing] = await db
      .select({ id: models.id, modelName: models.modelName })
      .from(models)
      .where(and(eq(models.id, input.target.modelId), isNull(models.mergedIntoModelId)))
      .limit(1);

    if (!existing) {
      throw new Error(`target model not found or merged: ${input.target.modelId}`);
    }
    targetModel = existing;
  } else if (targetName) {
    const providerName = input.target.providerName?.trim();
    const providerId = providerName ? (await ensureProvider(providerName)).id : fromModel.providerId;
    const dedupeRule = await getModelDedupeRule();
    createdTarget = !(await hasModelByCanonicalKey(buildModelCanonicalKey(targetName, dedupeRule)));
    targetModel = await ensureModelByProviderId({ providerId, modelName: targetName }, { dedupeRule });
  } else {
    throw new Error("目标 model 不能为空");
  }

  if (targetModel.id === fromModel.id) {
    throw new Error("目标 model 与当前行相同，无需变更归属");
  }

  const sourceRecords = await db
    .select({
      id: benchmarkValues.id,
      otherAxisId: benchmarkValues.benchmarkId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        eq(benchmarkValues.modelId, fromModel.id),
        ...buildRecordValueConditions({ ...scope, modelIds: [] })
      )
    );

  if (sourceRecords.length === 0) {
    throw new Error("当前筛选范围内没有可迁移的数据");
  }

  const affectedBenchmarkIds = Array.from(new Set(sourceRecords.map((row) => row.otherAxisId)));
  const targetRecords = await db
    .select({
      id: benchmarkValues.id,
      otherAxisId: benchmarkValues.benchmarkId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        eq(benchmarkValues.modelId, targetModel.id),
        inArray(benchmarkValues.benchmarkId, affectedBenchmarkIds)
      )
    );

  const plan = planRecordReassign({ sourceRecords, targetRecords, conflictStrategy });

  await db.transaction(async (tx: DbTransactionClient) => {
    if (plan.deleteTargetRecordIds.length > 0) {
      for (const batch of chunk(plan.deleteTargetRecordIds, DELETE_CHUNK_SIZE)) {
        await tx.delete(benchmarkValues).where(inArray(benchmarkValues.id, batch));
      }
    }

    for (const batch of chunk(plan.moveRecordIds, DELETE_CHUNK_SIZE)) {
      await tx
        .update(benchmarkValues)
        .set({ modelId: targetModel.id })
        .where(inArray(benchmarkValues.id, batch));
    }
  });

  await invalidateAllCaches();

  return {
    ok: true,
    entityType: "model",
    movedCount: plan.moveRecordIds.length,
    skippedCount: plan.skippedRecordIds.length,
    deletedTargetCount: plan.deleteTargetRecordIds.length,
    conflictCount: plan.conflictCount,
    createdTarget,
    fromId: fromModel.id,
    fromLabel: fromModel.modelName,
    targetId: targetModel.id,
    targetLabel: targetModel.modelName
  };
}

/**
 * 把筛选范围内记录的 source 改写为另一个值。
 *
 * 与「名称维护」里的 source 改名不同：改名是全库替换，这里只动选中的行，
 * 因此需要同时补齐新 source 的 meta 覆盖行，并清掉彻底空掉的旧 meta。
 */
export async function reassignRecordSource(input: {
  fromSource: string | null;
  toSource: string | null;
  scope?: RecordMutationScope;
}): Promise<ReassignRecordsResult & { prunedSourceMeta: number }> {
  const fromSource = normalizeSourceValue(input.fromSource);
  const toSource = normalizeSourceValue(input.toSource);
  const scope = input.scope ?? {};

  if (fromSource === toSource) {
    throw new Error("目标 source 与当前 source 相同，无需变更归属");
  }

  const scopeConditions = buildRecordValueConditions({
    ...scope,
    sourceMode: fromSource ? "specific" : "empty",
    source: fromSource
  });

  const affectedRows = await db
    .select({
      id: benchmarkValues.id,
      benchmarkId: benchmarkValues.benchmarkId,
      benchmarkType: benchmarks.benchmarkType,
      modalities: benchmarks.modalities
    })
    .from(benchmarkValues)
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(and(...scopeConditions));

  if (affectedRows.length === 0) {
    throw new Error("当前筛选范围内没有可变更归属的数据");
  }

  const recordIds = affectedRows.map((row) => row.id);
  const benchmarkMeta = new Map<number, { benchmarkType: string; modalities: string[] }>();
  affectedRows.forEach((row) => {
    if (benchmarkMeta.has(row.benchmarkId)) return;
    benchmarkMeta.set(row.benchmarkId, {
      benchmarkType: row.benchmarkType,
      modalities: row.modalities?.length ? row.modalities : ["Text"]
    });
  });

  const applied = await db.transaction(async (tx: DbTransactionClient) => {
    let moved = 0;
    for (const batch of chunk(recordIds, DELETE_CHUNK_SIZE)) {
      const updatedRows = await tx
        .update(benchmarkValues)
        .set({ source: toSource })
        .where(inArray(benchmarkValues.id, batch))
        .returning({ id: benchmarkValues.id });
      moved += updatedRows.length;
    }

    if (toSource) {
      await upsertRecordSourceMeta(
        tx,
        Array.from(benchmarkMeta.entries()).map(([benchmarkId, meta]) => ({
          benchmarkId,
          source: toSource,
          benchmarkType: meta.benchmarkType,
          modalities: meta.modalities
        }))
      );
    }

    const prunedSourceMeta = await pruneOrphanRecordSourceMeta(
      tx,
      Array.from(benchmarkMeta.keys()).map((benchmarkId) => ({ benchmarkId, source: fromSource }))
    );

    return { moved, prunedSourceMeta };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    entityType: "source",
    movedCount: applied.moved,
    skippedCount: 0,
    deletedTargetCount: 0,
    conflictCount: 0,
    createdTarget: false,
    fromLabel: fromSource ?? "（空 source）",
    targetLabel: toSource ?? "（空 source）",
    prunedSourceMeta: applied.prunedSourceMeta
  };
}

// --- 批量删除 ---

export type BatchDeleteRecordsResult = {
  ok: true;
  deleted: number;
  prunedSourceMeta: number;
};

export async function batchDeleteRecords(input: {
  scope?: RecordMutationScope;
  /** 无任何筛选条件时必须显式允许，避免误清空整库 */
  allowUnfiltered?: boolean;
}): Promise<BatchDeleteRecordsResult> {
  const scope = input.scope ?? {};

  if (!hasRecordMutationScope(scope) && input.allowUnfiltered !== true) {
    throw new Error("未设置任何筛选条件：如需清空全部数据请显式传 allowUnfiltered");
  }

  const conditions = buildRecordValueConditions(scope);
  const targetRows = await db
    .select({
      id: benchmarkValues.id,
      benchmarkId: benchmarkValues.benchmarkId,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(MAX_RECORD_BATCH_DELETE + 1);

  if (targetRows.length === 0) {
    throw new Error("当前筛选范围内没有可删除的数据");
  }

  if (targetRows.length > MAX_RECORD_BATCH_DELETE) {
    throw new Error(`匹配记录超过 ${MAX_RECORD_BATCH_DELETE} 条，请缩小筛选范围后再删除`);
  }

  const applied = await db.transaction(async (tx: DbTransactionClient) => {
    let deleted = 0;
    for (const batch of chunk(targetRows.map((row) => row.id), DELETE_CHUNK_SIZE)) {
      const deletedRows = await tx
        .delete(benchmarkValues)
        .where(inArray(benchmarkValues.id, batch))
        .returning({ id: benchmarkValues.id });
      deleted += deletedRows.length;
    }

    const prunedSourceMeta = await pruneOrphanRecordSourceMeta(
      tx,
      targetRows.map((row) => ({ benchmarkId: row.benchmarkId, source: row.source }))
    );

    return { deleted, prunedSourceMeta };
  });

  await invalidateAllCaches();

  return { ok: true, deleted: applied.deleted, prunedSourceMeta: applied.prunedSourceMeta };
}

// --- 批量量纲归一化 ---

export type BatchNormalizeRecordsResult = {
  ok: true;
  targetScale: RecordScaleTarget;
  updated: number;
  unchanged: number;
};

export async function batchNormalizeRecordScale(input: {
  scope?: RecordMutationScope;
  targetScale: RecordScaleTarget;
}): Promise<BatchNormalizeRecordsResult> {
  const scope = input.scope ?? {};

  if (input.targetScale !== 1 && input.targetScale !== 100) {
    throw new Error("targetScale 只能是 1 或 100");
  }

  if (!hasRecordMutationScope(scope)) {
    throw new Error("批量归一化必须限定筛选范围（模型 / 指标 / source 至少一项）");
  }

  const conditions = buildRecordValueConditions(scope);
  const records = await db
    .select({
      id: benchmarkValues.id,
      valueRaw: benchmarkValues.valueRaw,
      valueNum: benchmarkValues.valueNum,
      valueNum2: benchmarkValues.valueNum2,
      valueNote: benchmarkValues.valueNote
    })
    .from(benchmarkValues)
    .where(
      and(
        ...conditions,
        or(isNotNull(benchmarkValues.valueNum), isNotNull(benchmarkValues.valueNum2))
      )
    );

  if (records.length === 0) {
    throw new Error("当前筛选范围内没有可归一化的数值");
  }

  const plan = planRecordScaleNormalization(
    records.map((row) => ({
      id: row.id,
      valueRaw: row.valueRaw,
      valueNum: toFiniteNumber(row.valueNum),
      valueNum2: toFiniteNumber(row.valueNum2),
      valueNote: row.valueNote
    })),
    input.targetScale
  );

  if (plan.updates.length === 0) {
    throw new Error("当前筛选范围内的数值已经是目标量纲，无需归一化");
  }

  await db.transaction(async (tx: DbTransactionClient) => {
    for (const update of plan.updates) {
      await tx
        .update(benchmarkValues)
        .set({
          valueRaw: update.valueRaw,
          valueNum: toNumericColumn(update.valueNum),
          valueNum2: toNumericColumn(update.valueNum2),
          valueNote: update.valueNote
        })
        .where(eq(benchmarkValues.id, update.recordId));
    }
  });

  await invalidateAllCaches();

  return {
    ok: true,
    targetScale: input.targetScale,
    updated: plan.updates.length,
    unchanged: plan.unchanged
  };
}

// --- 双值分拆 ---

export type RecordDualValueCandidate = {
  benchmarkId: number;
  benchmarkName: string;
  benchmarkType: string;
  dualValueCount: number;
  totalCount: number;
  sampleValues: string[];
};

export async function getRecordDualValueCandidates(
  scope: RecordMutationScope = {}
): Promise<{ generatedAt: string; candidates: RecordDualValueCandidate[] }> {
  const conditions = buildRecordValueConditions(scope);

  const rows = await db
    .select({
      benchmarkId: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      totalCount: count(),
      dualValueCount: sql<number>`count(*) filter (where ${benchmarkValues.valueNum2} is not null)`,
      sampleValues: sql<
        string[]
      >`(array_agg(distinct ${benchmarkValues.valueRaw}) filter (where ${benchmarkValues.valueNum2} is not null))[1:3]`
    })
    .from(benchmarkValues)
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(and(isNull(benchmarks.mergedIntoBenchmarkId), ...conditions))
    .groupBy(benchmarks.id, benchmarks.benchmarkName, benchmarks.benchmarkType)
    .having(sql`count(*) filter (where ${benchmarkValues.valueNum2} is not null) > 0`)
    .orderBy(desc(sql`count(*) filter (where ${benchmarkValues.valueNum2} is not null)`));

  return {
    generatedAt: new Date().toISOString(),
    candidates: rows.map((row) => ({
      benchmarkId: row.benchmarkId,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      dualValueCount: Number(row.dualValueCount ?? 0),
      totalCount: Number(row.totalCount ?? 0),
      sampleValues: (row.sampleValues ?? []).filter((value): value is string => typeof value === "string")
    }))
  };
}

export type SplitDualValueRecordsResult = {
  ok: true;
  sourceBenchmarkId: number;
  sourceBenchmarkLabel: string;
  firstBenchmarkId: number;
  firstBenchmarkLabel: string;
  secondBenchmarkId: number;
  secondBenchmarkLabel: string;
  splitCount: number;
  createdCount: number;
  skipped: number;
};

export async function splitDualValueRecords(input: {
  benchmarkId: number;
  first: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
  second: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string };
  scope?: RecordMutationScope;
}): Promise<SplitDualValueRecordsResult> {
  const scope = input.scope ?? {};

  const [sourceBenchmark] = await db
    .select({
      id: benchmarks.id,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      unit: benchmarks.unit,
      higherIsBetter: benchmarks.higherIsBetter,
      modalities: benchmarks.modalities
    })
    .from(benchmarks)
    .where(and(eq(benchmarks.id, input.benchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
    .limit(1);

  if (!sourceBenchmark) {
    throw new Error(`benchmark not found or merged: ${input.benchmarkId}`);
  }

  const dedupeRule = await getModelDedupeRule();

  const resolveTarget = async (
    target: { benchmarkId?: number; benchmarkName?: string; benchmarkType?: string },
    label: string
  ) => {
    if (typeof target.benchmarkId === "number") {
      const [existing] = await db
        .select({
          id: benchmarks.id,
          benchmarkName: benchmarks.benchmarkName,
          benchmarkType: benchmarks.benchmarkType,
          modalities: benchmarks.modalities
        })
        .from(benchmarks)
        .where(and(eq(benchmarks.id, target.benchmarkId), isNull(benchmarks.mergedIntoBenchmarkId)))
        .limit(1);

      if (!existing) {
        throw new Error(`${label} benchmark not found or merged: ${target.benchmarkId}`);
      }
      return existing;
    }

    const name = target.benchmarkName?.trim();
    if (!name) {
      throw new Error(`${label} benchmark 名称不能为空`);
    }

    return ensureBenchmark(
      {
        benchmarkName: name,
        benchmarkType: target.benchmarkType?.trim() || sourceBenchmark.benchmarkType,
        unit: sourceBenchmark.unit,
        higherIsBetter: sourceBenchmark.higherIsBetter,
        modalities: sourceBenchmark.modalities ?? undefined
      },
      { dedupeRule }
    );
  };

  const firstBenchmark = await resolveTarget(input.first, "第一个");
  const secondBenchmark = await resolveTarget(input.second, "第二个");

  if (firstBenchmark.id === secondBenchmark.id) {
    throw new Error("两个拆分目标不能指向同一个 benchmark");
  }

  const records = await db
    .select({
      id: benchmarkValues.id,
      modelId: benchmarkValues.modelId,
      benchTime: benchmarkValues.benchTime,
      valueNum: benchmarkValues.valueNum,
      valueNum2: benchmarkValues.valueNum2,
      valueNote: benchmarkValues.valueNote,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .where(
      and(
        eq(benchmarkValues.benchmarkId, sourceBenchmark.id),
        isNotNull(benchmarkValues.valueNum2),
        ...buildRecordValueConditions({ ...scope, benchmarkIds: [] })
      )
    );

  if (records.length === 0) {
    throw new Error("当前筛选范围内没有可分拆的双值记录");
  }

  const plan = planDualValueSplit(
    records.map((row) => ({
      id: row.id,
      modelId: row.modelId,
      benchTime: row.benchTime,
      valueNum: toFiniteNumber(row.valueNum),
      valueNum2: toFiniteNumber(row.valueNum2),
      valueNote: row.valueNote,
      source: row.source
    })),
    { firstBenchmarkId: firstBenchmark.id, secondBenchmarkId: secondBenchmark.id }
  );

  if (plan.updates.length === 0) {
    throw new Error("当前筛选范围内没有可分拆的双值记录");
  }

  const applied = await db.transaction(async (tx: DbTransactionClient) => {
    for (const update of plan.updates) {
      await tx
        .update(benchmarkValues)
        .set({
          benchmarkId: update.benchmarkId,
          valueRaw: update.valueRaw,
          valueNum: toNumericColumn(update.valueNum),
          valueNum2: null,
          valueNote: update.valueNote
        })
        .where(eq(benchmarkValues.id, update.recordId));
    }

    let createdCount = 0;
    const insertRows = plan.inserts.map((item) => ({
      modelId: item.modelId,
      benchmarkId: item.benchmarkId,
      benchTime: item.benchTime instanceof Date ? item.benchTime : new Date(item.benchTime),
      valueRaw: item.valueRaw,
      valueNum: toNumericColumn(item.valueNum),
      valueNum2: null,
      valueNote: item.valueNote,
      source: item.source
    }));

    for (const batch of chunk(insertRows, INSERT_CHUNK_SIZE)) {
      const insertedRows = await tx
        .insert(benchmarkValues)
        .values(batch)
        .returning({ id: benchmarkValues.id });
      createdCount += insertedRows.length;
    }

    const metaSources = Array.from(
      new Set(
        records
          .map((row) => normalizeSourceValue(row.source))
          .filter((source): source is string => source !== null)
      )
    );

    await upsertRecordSourceMeta(tx, [
      ...metaSources.map((source) => ({
        benchmarkId: firstBenchmark.id,
        source,
        benchmarkType: firstBenchmark.benchmarkType,
        modalities: firstBenchmark.modalities?.length ? firstBenchmark.modalities : ["Text"]
      })),
      ...metaSources.map((source) => ({
        benchmarkId: secondBenchmark.id,
        source,
        benchmarkType: secondBenchmark.benchmarkType,
        modalities: secondBenchmark.modalities?.length ? secondBenchmark.modalities : ["Text"]
      }))
    ]);

    if (firstBenchmark.id !== sourceBenchmark.id) {
      await pruneOrphanRecordSourceMeta(
        tx,
        metaSources.map((source) => ({ benchmarkId: sourceBenchmark.id, source }))
      );
    }

    return { createdCount };
  });

  await invalidateAllCaches();

  return {
    ok: true,
    sourceBenchmarkId: sourceBenchmark.id,
    sourceBenchmarkLabel: `${sourceBenchmark.benchmarkName} (${sourceBenchmark.benchmarkType})`,
    firstBenchmarkId: firstBenchmark.id,
    firstBenchmarkLabel: `${firstBenchmark.benchmarkName} (${firstBenchmark.benchmarkType})`,
    secondBenchmarkId: secondBenchmark.id,
    secondBenchmarkLabel: `${secondBenchmark.benchmarkName} (${secondBenchmark.benchmarkType})`,
    splitCount: plan.updates.length,
    createdCount: applied.createdCount,
    skipped: plan.skipped
  };
}
