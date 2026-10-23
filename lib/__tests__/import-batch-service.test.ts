import { beforeAll, describe, expect, test, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

vi.mock("@/lib/db/queries", () => ({
  invalidateAllCaches: vi.fn().mockResolvedValue(undefined)
}));

let resolveBatchTimeWindow: typeof import("@/lib/import-batch-service").resolveBatchTimeWindow;
let buildBatchWhereClause: typeof import("@/lib/import-batch-service").buildBatchWhereClause;
let deleteImportBatch: typeof import("@/lib/import-batch-service").deleteImportBatch;
let benchmarkValues: typeof import("@/lib/db/schema").benchmarkValues;
let benchmarkSourceMeta: typeof import("@/lib/db/schema").benchmarkSourceMeta;

beforeAll(async () => {
  const service = await import("@/lib/import-batch-service");
  resolveBatchTimeWindow = service.resolveBatchTimeWindow;
  buildBatchWhereClause = service.buildBatchWhereClause;
  deleteImportBatch = service.deleteImportBatch;

  const schema = await import("@/lib/db/schema");
  benchmarkValues = schema.benchmarkValues;
  benchmarkSourceMeta = schema.benchmarkSourceMeta;
});

describe("import-batch-service", () => {
  describe("resolveBatchTimeWindow", () => {
    test("将时间精确归一化为整秒区间", () => {
      const window = resolveBatchTimeWindow("2026-10-23T15:10:25.456Z");
      expect(window.start.toISOString()).toBe("2026-10-23T15:10:25.000Z");
      expect(window.end.toISOString()).toBe("2026-10-23T15:10:26.000Z");
      expect(window.isoString).toBe("2026-10-23T15:10:25.000Z");
    });

    test("非法时间抛出异常", () => {
      expect(() => resolveBatchTimeWindow("invalid-time")).toThrow("无效的导入时间批次格式");
    });
  });

  describe("buildBatchWhereClause", () => {
    test("支持指定 source", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "text:test");
      expect(clause).toBeDefined();
    });

    test("支持空 source", () => {
      const clause = buildBatchWhereClause("2026-10-23T15:10:25.000Z", "");
      expect(clause).toBeDefined();
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
        executor: mockDb as any
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
        executor: mockDb as any
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
});
