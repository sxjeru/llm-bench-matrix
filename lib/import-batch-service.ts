import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarkSourceMeta, benchmarkValues, benchmarks, models } from "@/lib/db/schema";
import { invalidateAllCaches } from "@/lib/db/queries";
import { getSourceKey, getSourceLabel, SOURCE_ALL, SOURCE_EMPTY } from "@/lib/source-utils";

export type ImportBatchSummary = {
  batchKey: string;
  batchTime: string;
  displayTime: string;
  source: string | null;
  sourceLabel: string;
  recordCount: number;
  modelCount: number;
  benchmarkCount: number;
  minBenchTime: string | null;
  maxBenchTime: string | null;
  minCreatedAt: string;
  maxCreatedAt: string;
};

export type ImportBatchPreview = {
  batchKey: string;
  batchTime: string;
  displayTime: string;
  source: string | null;
  sourceLabel: string;
  totalRecords: number;
  modelCount: number;
  benchmarkCount: number;
  models: string[];
  benchmarks: string[];
  orphanSourceMetaCount: number;
  sampleRecords: Array<{
    id: number;
    modelName: string;
    benchmarkName: string;
    benchmarkType: string;
    valueRaw: string;
    valueNum: number | null;
    valueNum2: number | null;
    valueNote: string | null;
    benchTime: string;
    source: string | null;
  }>;
};

export type DeleteImportBatchResult = {
  ok: true;
  deleted: number;
  prunedSourceMeta: number;
  batchTime: string;
  source: string | null;
};

export type DbClient = typeof db;

/**
 * 将任意 ISO 字符串或 Date 规范化到整秒窗口 [start, end)
 */
export function resolveBatchTimeWindow(batchTime: string | Date): { start: Date; end: Date; isoString: string } {
  const targetDate = batchTime instanceof Date ? batchTime : new Date(batchTime);
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error(`无效的导入时间批次格式: ${String(batchTime)}`);
  }

  const startMs = Math.floor(targetDate.getTime() / 1000) * 1000;
  const start = new Date(startMs);
  const end = new Date(startMs + 1000);

  return {
    start,
    end,
    isoString: start.toISOString()
  };
}

/**
 * 构造查询/删除指定批次的 SQL Where 条件
 */
export function buildBatchWhereClause(batchTime: string | Date, source?: string | null) {
  const { start, end } = resolveBatchTimeWindow(batchTime);

  const timeCondition = and(
    gte(benchmarkValues.createdAt, start),
    lt(benchmarkValues.createdAt, end)
  );

  if (source === undefined || source === SOURCE_ALL) {
    return timeCondition;
  }

  if (source === null || source === "" || source === SOURCE_EMPTY) {
    return and(
      timeCondition,
      or(isNull(benchmarkValues.source), eq(benchmarkValues.source, ""))
    );
  }

  const trimmedSource = source.trim();
  return and(
    timeCondition,
    eq(benchmarkValues.source, trimmedSource)
  );
}

/**
 * 获取最近的导入时间批次列表
 */
export async function listImportBatches(options?: {
  limit?: number;
  executor?: DbClient;
}): Promise<ImportBatchSummary[]> {
  const client = options?.executor ?? db;
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));

  const batchTimeExpr = sql<Date>`date_trunc('second', ${benchmarkValues.createdAt})`;

  const rows = await client
    .select({
      batchTime: batchTimeExpr,
      source: benchmarkValues.source,
      recordCount: sql<number>`count(*)::int`,
      modelCount: sql<number>`count(distinct ${benchmarkValues.modelId})::int`,
      benchmarkCount: sql<number>`count(distinct ${benchmarkValues.benchmarkId})::int`,
      minBenchTime: sql<Date | null>`min(${benchmarkValues.benchTime})`,
      maxBenchTime: sql<Date | null>`max(${benchmarkValues.benchTime})`,
      minCreatedAt: sql<Date>`min(${benchmarkValues.createdAt})`,
      maxCreatedAt: sql<Date>`max(${benchmarkValues.createdAt})`
    })
    .from(benchmarkValues)
    .groupBy(batchTimeExpr, benchmarkValues.source)
    .orderBy(desc(batchTimeExpr), desc(sql`max(${benchmarkValues.createdAt})`))
    .limit(limit);

  return rows.map((row) => {
    const rawBatchTime = row.batchTime instanceof Date ? row.batchTime : new Date(row.batchTime);
    const batchTimeIso = rawBatchTime.toISOString();
    const sourceKey = getSourceKey(row.source);
    const sourceLabel = getSourceLabel(sourceKey);

    const minBench = row.minBenchTime ? (row.minBenchTime instanceof Date ? row.minBenchTime.toISOString() : String(row.minBenchTime)) : null;
    const maxBench = row.maxBenchTime ? (row.maxBenchTime instanceof Date ? row.maxBenchTime.toISOString() : String(row.maxBenchTime)) : null;
    const minCreated = row.minCreatedAt instanceof Date ? row.minCreatedAt.toISOString() : String(row.minCreatedAt);
    const maxCreated = row.maxCreatedAt instanceof Date ? row.maxCreatedAt.toISOString() : String(row.maxCreatedAt);

    return {
      batchKey: `${batchTimeIso}::${sourceKey}`,
      batchTime: batchTimeIso,
      displayTime: rawBatchTime.toLocaleString("zh-CN", { hour12: false }),
      source: row.source,
      sourceLabel,
      recordCount: Number(row.recordCount ?? 0),
      modelCount: Number(row.modelCount ?? 0),
      benchmarkCount: Number(row.benchmarkCount ?? 0),
      minBenchTime: minBench,
      maxBenchTime: maxBench,
      minCreatedAt: minCreated,
      maxCreatedAt: maxCreated
    };
  });
}

/**
 * 预览即将删除的导入批次内容与级联影响
 */
export async function previewImportBatch(input: {
  batchTime: string | Date;
  source?: string | null;
  sampleLimit?: number;
  executor?: DbClient;
}): Promise<ImportBatchPreview> {
  const client = input.executor ?? db;
  const whereClause = buildBatchWhereClause(input.batchTime, input.source);
  const { isoString } = resolveBatchTimeWindow(input.batchTime);
  const sampleLimit = Math.max(1, Math.min(input.sampleLimit ?? 50, 200));

  const rows = await client
    .select({
      id: benchmarkValues.id,
      modelId: benchmarkValues.modelId,
      modelName: models.modelName,
      benchmarkId: benchmarkValues.benchmarkId,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      valueRaw: benchmarkValues.valueRaw,
      valueNum: benchmarkValues.valueNum,
      valueNum2: benchmarkValues.valueNum2,
      valueNote: benchmarkValues.valueNote,
      benchTime: benchmarkValues.benchTime,
      source: benchmarkValues.source,
      createdAt: benchmarkValues.createdAt
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(whereClause)
    .orderBy(desc(benchmarkValues.id));

  const sourceKey = getSourceKey(input.source);
  const sourceLabel = getSourceLabel(sourceKey);
  const targetDate = new Date(isoString);

  if (rows.length === 0) {
    return {
      batchKey: `${isoString}::${sourceKey}`,
      batchTime: isoString,
      displayTime: targetDate.toLocaleString("zh-CN", { hour12: false }),
      source: input.source ?? null,
      sourceLabel,
      totalRecords: 0,
      modelCount: 0,
      benchmarkCount: 0,
      models: [],
      benchmarks: [],
      orphanSourceMetaCount: 0,
      sampleRecords: []
    };
  }

  const uniqueModels = Array.from(new Set(rows.map((r) => r.modelName))).sort();
  const uniqueBenchmarks = Array.from(new Set(rows.map((r) => r.benchmarkName))).sort();

  // 计算可能成为孤儿并被级联清理的 source_meta 数量
  const candidatePairs = new Map<string, { benchmarkId: number; source: string }>();
  rows.forEach((r) => {
    const s = r.source?.trim() || "";
    if (s) {
      candidatePairs.set(`${r.benchmarkId}::${s}`, { benchmarkId: r.benchmarkId, source: s });
    }
  });

  let orphanSourceMetaCount = 0;
  const candidateList = Array.from(candidatePairs.values());

  if (candidateList.length > 0) {
    // 检查是否有该批次以外的数据保留相同的 (benchmarkId, source)
    const currentBatchIds = new Set(rows.map((r) => r.id));
    for (const pair of candidateList) {
      const remainingRows = await client
        .select({ id: benchmarkValues.id })
        .from(benchmarkValues)
        .where(
          and(
            eq(benchmarkValues.benchmarkId, pair.benchmarkId),
            eq(benchmarkValues.source, pair.source)
          )
        )
        .limit(rows.length + 1);

      const hasOther = remainingRows.some((item) => !currentBatchIds.has(item.id));
      if (!hasOther) {
        // 进一步确认 benchmark_source_meta 中是否有这条元数据
        const [meta] = await client
          .select({ id: benchmarkSourceMeta.id })
          .from(benchmarkSourceMeta)
          .where(
            and(
              eq(benchmarkSourceMeta.benchmarkId, pair.benchmarkId),
              eq(benchmarkSourceMeta.source, pair.source)
            )
          )
          .limit(1);

        if (meta) {
          orphanSourceMetaCount++;
        }
      }
    }
  }

  const sampleRecords = rows.slice(0, sampleLimit).map((r) => ({
    id: r.id,
    modelName: r.modelName,
    benchmarkName: r.benchmarkName,
    benchmarkType: r.benchmarkType,
    valueRaw: r.valueRaw,
    valueNum: r.valueNum !== null ? Number(r.valueNum) : null,
    valueNum2: r.valueNum2 !== null ? Number(r.valueNum2) : null,
    valueNote: r.valueNote,
    benchTime: r.benchTime instanceof Date ? r.benchTime.toISOString() : String(r.benchTime),
    source: r.source
  }));

  return {
    batchKey: `${isoString}::${sourceKey}`,
    batchTime: isoString,
    displayTime: targetDate.toLocaleString("zh-CN", { hour12: false }),
    source: input.source ?? null,
    sourceLabel,
    totalRecords: rows.length,
    modelCount: uniqueModels.length,
    benchmarkCount: uniqueBenchmarks.length,
    models: uniqueModels,
    benchmarks: uniqueBenchmarks,
    orphanSourceMetaCount,
    sampleRecords
  };
}

/**
 * 按导入时间批次执行原子删除，并级联清理孤儿 source_meta 与失效缓存
 */
export async function deleteImportBatch(input: {
  batchTime: string | Date;
  source?: string | null;
  executor?: DbClient;
}): Promise<DeleteImportBatchResult> {
  const client = input.executor ?? db;
  const whereClause = buildBatchWhereClause(input.batchTime, input.source);
  const { isoString } = resolveBatchTimeWindow(input.batchTime);

  type TransactionCallback = Parameters<DbClient["transaction"]>[0];

  const result = await client.transaction(async (tx: Parameters<TransactionCallback>[0]) => {
    // 1. 查询待删除的目标记录及关联的 (benchmarkId, source)
    const targetRows = await tx
      .select({
        id: benchmarkValues.id,
        benchmarkId: benchmarkValues.benchmarkId,
        source: benchmarkValues.source
      })
      .from(benchmarkValues)
      .where(whereClause);

    if (targetRows.length === 0) {
      return {
        deleted: 0,
        prunedSourceMeta: 0
      };
    }

    const targetIds = targetRows.map((r) => r.id);

    // 2. 分批删除 benchmark_values (防止超出单语句参数上限)
    const CHUNK_SIZE = 1000;
    let deletedCount = 0;
    for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
      const chunk = targetIds.slice(i, i + CHUNK_SIZE);
      const res = await tx
        .delete(benchmarkValues)
        .where(inArray(benchmarkValues.id, chunk))
        .returning({ id: benchmarkValues.id });
      deletedCount += res.length;
    }

    // 3. 级联清理孤儿 benchmark_source_meta
    const pairsMap = new Map<string, { benchmarkId: number; source: string }>();
    targetRows.forEach((r) => {
      const s = r.source?.trim() || "";
      if (s) {
        pairsMap.set(`${r.benchmarkId}::${s}`, { benchmarkId: r.benchmarkId, source: s });
      }
    });

    let prunedSourceMeta = 0;
    for (const pair of pairsMap.values()) {
      // 检查该 (benchmarkId, source) 是否已无残留数据
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(benchmarkValues)
        .where(
          and(
            eq(benchmarkValues.benchmarkId, pair.benchmarkId),
            eq(benchmarkValues.source, pair.source)
          )
        );

      if (!remaining || Number(remaining.count ?? 0) === 0) {
        const deletedMeta = await tx
          .delete(benchmarkSourceMeta)
          .where(
            and(
              eq(benchmarkSourceMeta.benchmarkId, pair.benchmarkId),
              eq(benchmarkSourceMeta.source, pair.source)
            )
          )
          .returning({ id: benchmarkSourceMeta.id });
        prunedSourceMeta += deletedMeta.length;
      }
    }

    return {
      deleted: deletedCount,
      prunedSourceMeta
    };
  });

  // 4. 级联刷新所有缓存
  await invalidateAllCaches();

  return {
    ok: true,
    deleted: result.deleted,
    prunedSourceMeta: result.prunedSourceMeta,
    batchTime: isoString,
    source: input.source ?? null
  };
}

