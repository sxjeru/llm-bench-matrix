import { beforeAll, afterEach, describe, expect, test, vi } from "vitest";
import { benchmarks } from "@/lib/db/schema";

type DeleteBenchmarkAndAllValuesFn = typeof import("@/lib/admin-service").deleteBenchmarkAndAllValues;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let deleteBenchmarkAndAllValues: DeleteBenchmarkAndAllValuesFn;
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

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
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
