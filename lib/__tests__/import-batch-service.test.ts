import { beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

vi.mock("@/lib/db/queries", () => ({
  invalidateAllCaches: vi.fn().mockResolvedValue(undefined)
}));

type DbClient = import("@/lib/import-batch-service").DbClient;
let resolveBatchTimeWindow: typeof import("@/lib/import-batch-service").resolveBatchTimeWindow;
let buildBatchWhereClause: typeof import("@/lib/import-batch-service").buildBatchWhereClause;
let deleteImportBatch: typeof import("@/lib/import-batch-service").deleteImportBatch;
let listImportBatches: typeof import("@/lib/import-batch-service").listImportBatches;
let previewImportBatch: typeof import("@/lib/import-batch-service").previewImportBatch;
let benchmarkValues: typeof import("@/lib/db/schema").benchmarkValues;
let benchmarkSourceMeta: typeof import("@/lib/db/schema").benchmarkSourceMeta;

const dialect = new PgDialect();

beforeAll(async () => {
  const service = await import("@/lib/import-batch-service");
  resolveBatchTimeWindow = service.resolveBatchTimeWindow;
  buildBatchWhereClause = service.buildBatchWhereClause;
  deleteImportBatch = service.deleteImportBatch;
  listImportBatches = service.listImportBatches;
  previewImportBatch = service.previewImportBatch;

  const schema = await import("@/lib/db/schema");
  benchmarkValues = schema.benchmarkValues;
  benchmarkSourceMeta = schema.benchmarkSourceMeta;
});

describe("import-batch-service", () => {
  describe("resolveBatchTimeWindow", () => {
    test("保留精确批次时间窗口（毫秒级别），避免同秒多次导入被合并", () => {
      const window1 = resolveBatchTimeWindow("2026-10-23T15:10:25.100Z");
      const window2 = resolveBatchTimeWindow("2026-10-23T15:10:25.800Z");

      expect(window1.start.toISOString()).toBe("2026-10-23T15:10:25.100Z");
      expect(window1.end.toISOString()).toBe("2026-10-23T15:10:25.101Z");
      expect(window1.isoString).toBe("2026-10-23T15:10:25.100Z");

      expect(window2.start.toISOString()).toBe("2026-10-23T15:10:25.800Z");
      expect(window2.end.toISOString()).toBe("2026-10-23T15:10:25.801Z");

      // 同一秒内不同毫秒的时间窗口互不重叠
      expect(window1.end.getTime()).toBeLessThanOrEqual(window2.start.getTime());
    });

    test("非法时间抛出异常", () => {
      expect(() => resolveBatchTimeWindow("invalid-time")).toThrow("无效的导入时间批次格式");
    });
  });

  describe("buildBatchWhereClause", () => {
    test("支持指定 source", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "text:test");
      const compiled = dialect.sqlToQuery(sql`${clause}`);
      // 验证时间范围条件
      expect(compiled.sql).toContain('"benchmark_values"."created_at" >=');
      expect(compiled.sql).toContain('"benchmark_values"."created_at" <');
      // 验证指定来源条件与参数
      expect(compiled.sql).toContain('"benchmark_values"."source" =');
      expect(compiled.params).toContain("text:test");
      // 确保与未标注/空来源互斥，不包含 is null 条件
      expect(compiled.sql).not.toContain('"benchmark_values"."source" is null');
    });

    test("支持空 source", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "");
      const compiled = dialect.sqlToQuery(sql`${clause}`);
      // 验证时间范围条件
      expect(compiled.sql).toContain('"benchmark_values"."created_at" >=');
      expect(compiled.sql).toContain('"benchmark_values"."created_at" <');
      // 验证未标注/空来源条件（同时匹配 NULL 与空字符串）
      expect(compiled.sql).toContain('"benchmark_values"."source" is null');
      expect(compiled.sql).toContain('"benchmark_values"."source" =');
      expect(compiled.params).toContain("");
      expect(compiled.params).not.toContain("text:test");
    });

    test("支持 null 与 undefined source（匹配未标注/空来源）", () => {
      for (const emptySource of [null, undefined, "   "]) {
        const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", emptySource);
        const compiled = dialect.sqlToQuery(sql`${clause}`);
        expect(compiled.sql).toContain('"benchmark_values"."created_at" >=');
        expect(compiled.sql).toContain('"benchmark_values"."created_at" <');
        expect(compiled.sql).toContain('"benchmark_values"."source" is null');
        expect(compiled.sql).toContain('"benchmark_values"."source" =');
        expect(compiled.params).toContain("");
        expect(compiled.params).not.toContain("text:test");
      }
    });

    test("字面值为 __ALL__ 时作为具体来源精确匹配，不当作通配符", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "__ALL__");
      const compiled = dialect.sqlToQuery(sql`${clause}`);
      // 必须包含 source = '__ALL__' 的等值匹配，不能因为是 '__ALL__' 就被通配
      expect(compiled.sql).toContain('"benchmark_values"."source" =');
      expect(compiled.params).toContain("__ALL__");
      expect(compiled.sql).not.toContain('"benchmark_values"."source" is null');
    });

    test("字面值为 __EMPTY__ 时作为具体来源精确匹配", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "__EMPTY__");
      const compiled = dialect.sqlToQuery(sql`${clause}`);
      expect(compiled.sql).toContain('"benchmark_values"."source" =');
      expect(compiled.params).toContain("__EMPTY__");
      expect(compiled.sql).not.toContain('"benchmark_values"."source" is null');
    });

    test("显式指定 matchAllSources 为 true 时通配所有来源", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", undefined, { matchAllSources: true });
      const compiled = dialect.sqlToQuery(sql`${clause}`);
      // 包含时间条件
      expect(compiled.sql).toContain('"benchmark_values"."created_at" >=');
      expect(compiled.sql).toContain('"benchmark_values"."created_at" <');
      // 不应包含任何 source 字段过滤
      expect(compiled.sql).not.toContain('"benchmark_values"."source"');
    });
  });

  describe("deleteImportBatch", () => {
    test("在事务中原子删除并级联清理孤儿 source meta", async () => {
      const mockReturningValues = vi.fn().mockResolvedValue([{ id: 101 }, { id: 102 }]);
      const mockReturningMeta = vi.fn().mockResolvedValue([{ id: 201 }]);

      const mockDeleteWhere = vi.fn((table) => {
        if (table === benchmarkValues) {
          return { returning: mockReturningValues };
        }
        if (table === benchmarkSourceMeta) {
          return { returning: mockReturningMeta };
        }
        throw new Error("unexpected table");
      });

      const mockSelectWhere = vi.fn();
      // First select: target rows
      mockSelectWhere.mockResolvedValueOnce([
        { id: 101, benchmarkId: 1, source: "text:test" },
        { id: 102, benchmarkId: 1, source: "text:test" }
      ]);
      // Second select: check remaining for benchmarkId 1, source text:test -> 0 remaining
      mockSelectWhere.mockResolvedValueOnce([{ count: 0 }]);

      const mockTx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: mockSelectWhere
          }))
        })),
        delete: vi.fn((table) => ({
          where: vi.fn(() => mockDeleteWhere(table))
        }))
      };

      const mockDb = {
        transaction: vi.fn(async (cb) => cb(mockTx))
      };

      const result = await deleteImportBatch({
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        executor: mockDb as unknown as DbClient
      });

      expect(result).toEqual({
        ok: true,
        deleted: 2,
        prunedSourceMeta: 1,
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test"
      });
    });

    test("没有匹配记录时安全退出", async () => {
      const mockTx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([])
          }))
        }))
      };

      const mockDb = {
        transaction: vi.fn(async (cb) => cb(mockTx))
      };

      const result = await deleteImportBatch({
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test",
        executor: mockDb as unknown as DbClient
      });

      expect(result).toEqual({
        ok: true,
        deleted: 0,
        prunedSourceMeta: 0,
        batchTime: "2026-10-23T15:10:25.000Z",
        source: "text:test"
      });
    });
  });

  describe("listImportBatches", () => {
    test("使用 nullif(trim(source), '') 归一化未标注来源，确保同一批次的 NULL 与空字符串记录聚合为单一批次", async () => {
      let capturedGroupBy: unknown[] = [];
      let capturedSelect: unknown = null;

      const mockLimit = vi.fn().mockResolvedValue([
        {
          batchTime: new Date("2026-10-23T15:10:25.100Z"),
          source: null,
          recordCount: 8,
          modelCount: 2,
          benchmarkCount: 4,
          minBenchTime: new Date("2026-10-23T15:00:00.000Z"),
          maxBenchTime: new Date("2026-10-23T15:05:00.000Z"),
          minCreatedAt: new Date("2026-10-23T15:10:25.100Z"),
          maxCreatedAt: new Date("2026-10-23T15:10:25.150Z")
        }
      ]);

      const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
      const mockGroupBy = vi.fn((...args: unknown[]) => {
        capturedGroupBy = args;
        return { orderBy: mockOrderBy };
      });
      const mockFrom = vi.fn(() => ({ groupBy: mockGroupBy }));
      const mockSelect = vi.fn((fields: unknown) => {
        capturedSelect = fields;
        return { from: mockFrom };
      });

      const mockDb = {
        select: mockSelect
      };

      const summaries = await listImportBatches({ executor: mockDb as unknown as DbClient });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        batchKey: "2026-10-23T15:10:25.100Z::__EMPTY__",
        batchTime: "2026-10-23T15:10:25.100Z",
        source: null,
        sourceLabel: "未标注",
        recordCount: 8,
        modelCount: 2,
        benchmarkCount: 4
      });

      // 验证 groupBy 与 select 中包含对 source 的 nullif(trim(...), '') 归一化表达式
      expect(capturedGroupBy).toHaveLength(2);
      const groupByCompiled = dialect.sqlToQuery(sql`${capturedGroupBy[1] as any}`);
      expect(groupByCompiled.sql.toLowerCase()).toContain("nullif");
      expect(groupByCompiled.sql.toLowerCase()).toContain("trim");
      expect(groupByCompiled.sql).toContain('"benchmark_values"."source"');

      // 验证此批次对应的 buildBatchWhereClause 与汇总生成的 source: null 严格一致，且覆盖 NULL 与空字符串
      const whereClause = buildBatchWhereClause(summaries[0].batchTime, summaries[0].source);
      const whereCompiled = dialect.sqlToQuery(sql`${whereClause}`);
      expect(whereCompiled.sql).toContain('"benchmark_values"."source" is null');
      expect(whereCompiled.sql).toContain('"benchmark_values"."source" =');
      expect(whereCompiled.params).toContain("");
    });
  });

  describe("previewImportBatch", () => {
    test("按数据库 ID 统计并区分同名模型与基准实体，避免低估计数与漏显实体", async () => {
      const mockRows = [
        {
          id: 1,
          modelId: 101,
          modelName: "DeepSeek-V3",
          benchmarkId: 201,
          benchmarkName: "MMLU",
          benchmarkType: "5-shot",
          valueRaw: "88.5",
          valueNum: "88.500000",
          valueNum2: null,
          valueNote: null,
          benchTime: new Date("2026-10-23T15:00:00.000Z"),
          source: "test:source",
          createdAt: new Date("2026-10-23T15:10:25.100Z")
        },
        {
          id: 2,
          modelId: 102,
          modelName: "DeepSeek-V3", // 同名模型，来自不同 provider (modelId: 102)
          benchmarkId: 201,
          benchmarkName: "MMLU",
          benchmarkType: "5-shot",
          valueRaw: "87.0",
          valueNum: "87.000000",
          valueNum2: null,
          valueNote: null,
          benchTime: new Date("2026-10-23T15:00:00.000Z"),
          source: "test:source",
          createdAt: new Date("2026-10-23T15:10:25.100Z")
        },
        {
          id: 3,
          modelId: 101,
          modelName: "DeepSeek-V3",
          benchmarkId: 202,
          benchmarkName: "MMLU", // 同名基准，不同类型/设置 (benchmarkId: 202, 0-shot)
          benchmarkType: "0-shot",
          valueRaw: "82.0",
          valueNum: "82.000000",
          valueNum2: null,
          valueNote: null,
          benchTime: new Date("2026-10-23T15:00:00.000Z"),
          source: "test:source",
          createdAt: new Date("2026-10-23T15:10:25.100Z")
        },
        {
          id: 4,
          modelId: 103,
          modelName: "Qwen-2.5-72B", // 独一无二的模型
          benchmarkId: 203,
          benchmarkName: "HumanEval", // 独一无二的基准
          benchmarkType: "Pass@1",
          valueRaw: "86.0",
          valueNum: "86.000000",
          valueNum2: null,
          valueNote: null,
          benchTime: new Date("2026-10-23T15:00:00.000Z"),
          source: "test:source",
          createdAt: new Date("2026-10-23T15:10:25.100Z")
        }
      ];

      const createQueryBuilder = () => {
        const qb: any = {
          innerJoin: vi.fn(() => qb),
          where: vi.fn(() => qb),
          orderBy: vi.fn().mockResolvedValue(mockRows),
          limit: vi.fn().mockResolvedValue([])
        };
        return qb;
      };

      const mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => createQueryBuilder())
        }))
      };

      const preview = await previewImportBatch({
        batchTime: "2026-10-23T15:10:25.100Z",
        source: "test:source",
        executor: mockDb as unknown as DbClient
      });

      // 验证受影响模型按 ID 统计，计数值为 3（而非按名称去重后的 2）
      expect(preview.modelCount).toBe(3);
      // 验证受影响基准按 ID 统计，计数值为 3（而非按名称去重后的 2）
      expect(preview.benchmarkCount).toBe(3);

      // 验证模型列表中包含同名但不同 ID 的两个独立模型实体，通过 (#id) 区分，且无重名模型保持原名
      expect(preview.models).toEqual([
        "DeepSeek-V3 (#101)",
        "DeepSeek-V3 (#102)",
        "Qwen-2.5-72B"
      ]);

      // 验证基准列表中包含同名但不同 ID 的两个独立基准实体，通过 (#id) 区分，且无重名基准保持原名
      expect(preview.benchmarks).toEqual([
        "HumanEval",
        "MMLU (#201)",
        "MMLU (#202)"
      ]);

      // 验证样本记录中包含 modelId 与 benchmarkId，且 modelName 与 benchmarkName 保持一致的实体区分名称
      expect(preview.sampleRecords).toHaveLength(4);
      expect(preview.sampleRecords[0]).toMatchObject({
        id: 1,
        modelId: 101,
        modelName: "DeepSeek-V3 (#101)",
        benchmarkId: 201,
        benchmarkName: "MMLU (#201)"
      });
      expect(preview.sampleRecords[1]).toMatchObject({
        id: 2,
        modelId: 102,
        modelName: "DeepSeek-V3 (#102)",
        benchmarkId: 201,
        benchmarkName: "MMLU (#201)"
      });
      expect(preview.sampleRecords[3]).toMatchObject({
        id: 4,
        modelId: 103,
        modelName: "Qwen-2.5-72B",
        benchmarkId: 203,
        benchmarkName: "HumanEval"
      });
    });

    test("没有同名实体时保持标准名称，不附加冗余后缀", async () => {
      const mockRows = [
        {
          id: 1,
          modelId: 101,
          modelName: "GPT-4o",
          benchmarkId: 201,
          benchmarkName: "MMLU",
          benchmarkType: "Overall",
          valueRaw: "88.5",
          valueNum: "88.500000",
          valueNum2: null,
          valueNote: null,
          benchTime: new Date("2026-10-23T15:00:00.000Z"),
          source: "test:source",
          createdAt: new Date("2026-10-23T15:10:25.100Z")
        }
      ];

      const createQueryBuilder = () => {
        const qb: any = {
          innerJoin: vi.fn(() => qb),
          where: vi.fn(() => qb),
          orderBy: vi.fn().mockResolvedValue(mockRows),
          limit: vi.fn().mockResolvedValue([])
        };
        return qb;
      };

      const mockDb = {
        select: vi.fn(() => ({
          from: vi.fn(() => createQueryBuilder())
        }))
      };

      const preview = await previewImportBatch({
        batchTime: "2026-10-23T15:10:25.100Z",
        source: "test:source",
        executor: mockDb as unknown as DbClient
      });

      expect(preview.modelCount).toBe(1);
      expect(preview.benchmarkCount).toBe(1);
      expect(preview.models).toEqual(["GPT-4o"]);
      expect(preview.benchmarks).toEqual(["MMLU"]);
      expect(preview.sampleRecords[0].modelName).toBe("GPT-4o");
      expect(preview.sampleRecords[0].benchmarkName).toBe("MMLU");
    });
  });
});
