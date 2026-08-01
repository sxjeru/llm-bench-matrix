import { beforeAll, beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { benchmarks } from "@/lib/db/schema";

/**
 * 只替换 invalidateAllCaches：admin-service 还会在模块顶层调用同一模块导出的
 * registerCacheInvalidator，整包替换会让它变成 undefined 并在 import 阶段直接抛错。
 */
vi.mock("@/lib/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/queries")>();
  return {
    ...actual,
    invalidateAllCaches: vi.fn().mockResolvedValue(undefined)
  };
});

type DeleteBenchmarkAndAllValuesFn = typeof import("@/lib/admin-service").deleteBenchmarkAndAllValues;

type InvalidateAllCachesFn = typeof import("@/lib/db/queries").invalidateAllCaches;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let deleteBenchmarkAndAllValues: DeleteBenchmarkAndAllValuesFn;
let invalidateAllCachesMock: MockedFunction<InvalidateAllCachesFn>;
let dbForTest: {
  transaction: (callback: TransactionCallback) => Promise<unknown>;
  select: (...args: unknown[]) => unknown;
};

const existingBenchmark = {
  id: 970,
  benchmarkName: "Params (B) (activated / total)",
  benchmarkType: "Model Info"
};

/**
 * deleteBenchmarkAndAllValues 先后发两次 select：
 * 第一次查 benchmark 本体，第二次统计 benchmark_values 条数。
 */
function mockSelects(benchmarkRows: unknown[], valueCount: number) {
  let call = 0;
  return vi.spyOn(dbForTest, "select").mockImplementation(() => {
    call += 1;
    if (call === 1) {
      return {
        from: () => ({
          where: () => ({
            limit: async () => benchmarkRows
          })
        })
      };
    }

    return {
      from: () => ({
        where: async () => [{ valueCount }]
      })
    };
  });
}

function createTransactionMock() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const updateMock = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhere }));

  return { updateMock, updateSet, updateWhere, deleteMock, deleteWhere };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  deleteBenchmarkAndAllValues = adminServiceModule.deleteBenchmarkAndAllValues;

  const dbQueriesModule = await import("@/lib/db/queries");
  invalidateAllCachesMock = vi.mocked(dbQueriesModule.invalidateAllCaches);

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

beforeEach(() => {
  // vi.mock 工厂里的 vi.fn 不受 afterEach 的 restoreAllMocks 影响，调用次数需手动清理
  invalidateAllCachesMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteBenchmarkAndAllValues", () => {
  test("先清合并指针再删 benchmark，并返回受影响的记录数", async () => {
    mockSelects([existingBenchmark], 7);
    const mocks = createTransactionMock();
    const transactionSpy = vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback) =>
      callback({ update: mocks.updateMock, delete: mocks.deleteMock })
    );

    const result = await deleteBenchmarkAndAllValues(970);

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(mocks.updateMock).toHaveBeenCalledWith(benchmarks);
    expect(mocks.updateSet).toHaveBeenCalledWith({ mergedIntoBenchmarkId: null });
    expect(mocks.deleteMock).toHaveBeenCalledWith(benchmarks);
    expect(invalidateAllCachesMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      benchmarkId: 970,
      benchmarkName: "Params (B) (activated / total)",
      benchmarkType: "Model Info",
      deletedValueCount: 7
    });
  });

  test("benchmark 不存在时抛错且不进入事务", async () => {
    mockSelects([], 0);
    const transactionSpy = vi.spyOn(dbForTest, "transaction");

    await expect(deleteBenchmarkAndAllValues(12345)).rejects.toThrow("benchmark not found: 12345");
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(invalidateAllCachesMock).not.toHaveBeenCalled();
  });

  test("事务失败时向上抛错，且不失效缓存", async () => {
    mockSelects([existingBenchmark], 7);
    const mocks = createTransactionMock();
    mocks.deleteWhere.mockRejectedValue(new Error("delete benchmark failed"));
    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback) =>
      callback({ update: mocks.updateMock, delete: mocks.deleteMock })
    );

    await expect(deleteBenchmarkAndAllValues(970)).rejects.toThrow("delete benchmark failed");
    // 缓存失效必须发生在事务提交之后：回滚时若仍失效缓存，会把未删除的数据当成已删除
    expect(invalidateAllCachesMock).not.toHaveBeenCalled();
  });

  test("没有关联记录时 deletedValueCount 为 0", async () => {
    mockSelects([existingBenchmark], 0);
    const mocks = createTransactionMock();
    vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback) =>
      callback({ update: mocks.updateMock, delete: mocks.deleteMock })
    );

    const result = await deleteBenchmarkAndAllValues(970);

    expect(result.deletedValueCount).toBe(0);
  });
});
