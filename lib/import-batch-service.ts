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
    modelId?: number;
    modelName: string;
    benchmarkId?: number;
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

export type BatchTimeWindowOptions = {
  windowMs?: number;
};

export type BuildBatchWhereClauseOptions = {
  matchAllSources?: boolean;
  windowMs?: number;
};

/**
 * 格式化批次展示时间，包含毫秒（当毫秒非零时）以便区分同一秒内的不同导入批次
 */
export function formatDisplayTime(date: Date): string {
  const base = date.toLocaleString("zh-CN", { hour12: false });
  const ms = date.getMilliseconds();
  return ms > 0 ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

/**
 * 将任意 ISO 字符串或 Date 规范化到毫秒级批次窗口 [start, end)
 * 默认使用 1 毫秒窗口，确保同一秒内不同提交时间戳的批次被作为独立批次对待
 */
export function resolveBatchTimeWindow(
  batchTime: string | Date,
  options?: BatchTimeWindowOptions
): { start: Date; end: Date; isoString: string } {
  const targetDate = batchTime instanceof Date ? batchTime : new Date(batchTime);
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error(`无效的导入时间批次格式: ${String(batchTime)}`);
  }

  const startMs = targetDate.getTime();
  const windowMs = Math.max(1, options?.windowMs ?? 1);
  const start = new Date(startMs);
  const end = new Date(startMs + windowMs);

  return {
    start,
    end,
    isoString: start.toISOString()
  };
}

/**
 * 构造查询/删除指定批次的 SQL Where 条件
 * 注意：将“所有来源”选项（matchAllSources）与存储的来源值严格分开表示，
 * 避免字面值为 "__ALL__" 或 "__EMPTY__" 的来源被误当成通配符而删除其它来源数据。
 */
export function buildBatchWhereClause(
  batchTime: string | Date,
  source?: string | null,
  options?: BuildBatchWhereClauseOptions
) {
  const { start, end } = resolveBatchTimeWindow(batchTime, { windowMs: options?.windowMs });

  const timeCondition = and(
    gte(benchmarkValues.createdAt, start),
    lt(benchmarkValues.createdAt, end)
  );

  // 仅在显式声明 matchAllSources 时才跳过来源过滤（通配所有来源）
  if (options?.matchAllSources) {
    return timeCondition;
  }

  // source 为 null、undefined 或空字符串时，匹配未标注/空来源
  if (source === null || source === undefined || source.trim() === "") {
    return and(
      timeCondition,
      or(isNull(benchmarkValues.source), eq(benchmarkValues.source, ""))
    );
  }

  // 任何具体字符串（包括字面值 "__ALL__"、"__EMPTY__"）均按字面值精确过滤
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

  const batchTimeExpr = sql<Date>`date_trunc('milliseconds', ${benchmarkValues.createdAt})`;
  // 将 NULL、空字符串及纯空白 source 统一归一化为 NULL，确保同时间窗口的未标注记录归并为单一批次
  const normalizedSourceExpr = sql<string | null>`nullif(trim(${benchmarkValues.source}), '')`;

  const rows = await client
    .select({
      batchTime: batchTimeExpr,
      source: normalizedSourceExpr,
      recordCount: sql<number>`count(*)::int`,
      modelCount: sql<number>`count(distinct ${benchmarkValues.modelId})::int`,
      benchmarkCount: sql<number>`count(distinct ${benchmarkValues.benchmarkId})::int`,
      minBenchTime: sql<Date | null>`min(${benchmarkValues.benchTime})`,
      maxBenchTime: sql<Date | null>`max(${benchmarkValues.benchTime})`,
      minCreatedAt: sql<Date>`min(${benchmarkValues.createdAt})`,
      maxCreatedAt: sql<Date>`max(${benchmarkValues.createdAt})`
    })
    .from(benchmarkValues)
    .groupBy(batchTimeExpr, normalizedSourceExpr)
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
      displayTime: formatDisplayTime(rawBatchTime),
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
  matchAllSources?: boolean;
  sampleLimit?: number;
  executor?: DbClient;
}): Promise<ImportBatchPreview> {
  const client = input.executor ?? db;
  const whereClause = buildBatchWhereClause(input.batchTime, input.source, {
    matchAllSources: input.matchAllSources
  });
  const { isoString } = resolveBatchTimeWindow(input.batchTime);
  const sampleLimit = Math.max(1, Math.min(input.sampleLimit ?? 1000, 2000));

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

  const sourceKey = input.matchAllSources ? SOURCE_ALL : getSourceKey(input.source);
  const sourceLabel = input.matchAllSources ? "全部来源" : getSourceLabel(sourceKey);
  const targetDate = new Date(isoString);

  if (rows.length === 0) {
    return {
      batchKey: `${isoString}::${sourceKey}`,
      batchTime: isoString,
      displayTime: formatDisplayTime(targetDate),
      source: input.matchAllSources ? null : (input.source ?? null),
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

  // 1. 按数据库 ID 统计并区分受影响的模型
  const modelMap = new Map<number, string>();
  rows.forEach((r) => {
    if (!modelMap.has(r.modelId)) {
      modelMap.set(r.modelId, r.modelName);
    }
  });

  const modelNameCounts = new Map<string, number>();
  modelMap.forEach((name) => {
    modelNameCounts.set(name, (modelNameCounts.get(name) ?? 0) + 1);
  });

  const getModelDisplayName = (modelId: number, modelName: string) => {
    if ((modelNameCounts.get(modelName) ?? 0) > 1) {
      return `${modelName} (#${modelId})`;
    }
    return modelName;
  };

  const uniqueModels = Array.from(modelMap.entries())
    .map(([id, name]) => getModelDisplayName(id, name))
    .sort();

  // 2. 按数据库 ID 统计并区分受影响的基准
  const benchmarkMap = new Map<number, { name: string; type: string }>();
  rows.forEach((r) => {
    if (!benchmarkMap.has(r.benchmarkId)) {
      benchmarkMap.set(r.benchmarkId, {
        name: r.benchmarkName,
        type: r.benchmarkType
      });
    }
  });

  const benchmarkNameCounts = new Map<string, number>();
  benchmarkMap.forEach(({ name }) => {
    benchmarkNameCounts.set(name, (benchmarkNameCounts.get(name) ?? 0) + 1);
  });

  const getBenchmarkDisplayName = (benchmarkId: number, benchmarkName: string) => {
    if ((benchmarkNameCounts.get(benchmarkName) ?? 0) > 1) {
      return `${benchmarkName} (#${benchmarkId})`;
    }
    return benchmarkName;
  };

  const uniqueBenchmarks = Array.from(benchmarkMap.entries())
    .map(([id, b]) => getBenchmarkDisplayName(id, b.name))
    .sort();

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
    modelId: r.modelId,
    modelName: getModelDisplayName(r.modelId, r.modelName),
    benchmarkId: r.benchmarkId,
    benchmarkName: getBenchmarkDisplayName(r.benchmarkId, r.benchmarkName),
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
    displayTime: formatDisplayTime(targetDate),
    source: input.matchAllSources ? null : (input.source ?? null),
    sourceLabel,
    totalRecords: rows.length,
    modelCount: modelMap.size,
    benchmarkCount: benchmarkMap.size,
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
  matchAllSources?: boolean;
  executor?: DbClient;
}): Promise<DeleteImportBatchResult> {
  const client = input.executor ?? db;
  const whereClause = buildBatchWhereClause(input.batchTime, input.source, {
    matchAllSources: input.matchAllSources
  });
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
    source: input.matchAllSources ? null : (input.source ?? null)
  };
}

