import { beforeAll, afterEach, describe, expect, test, vi } from "vitest";
import { benchmarkSourceMeta, benchmarkValues } from "@/lib/db/schema";

type DeleteBenchmarkValuesBySourceFn = typeof import("@/lib/admin-service").deleteBenchmarkValuesBySource;

type TransactionCallback = (tx: unknown) => Promise<unknown>;

let deleteBenchmarkValuesBySource: DeleteBenchmarkValuesBySourceFn;
let dbForTest: {
  transaction: (callback: TransactionCallback) => Promise<unknown>;
};

function createDeleteMock() {
  const valuesReturning = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
  const sourceMetaReturning = vi.fn().mockResolvedValue([{ id: 10 }]);
  const valuesWhere = vi.fn(() => ({ returning: valuesReturning }));
  const sourceMetaWhere = vi.fn(() => ({ returning: sourceMetaReturning }));
  const deleteMock = vi.fn((table: unknown) => {
    if (table === benchmarkValues) return { where: valuesWhere };
    if (table === benchmarkSourceMeta) return { where: sourceMetaWhere };
    throw new Error("unexpected delete table");
  });

  return {
    deleteMock,
    valuesWhere,
    valuesReturning,
    sourceMetaWhere,
    sourceMetaReturning
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  deleteBenchmarkValuesBySource = adminServiceModule.deleteBenchmarkValuesBySource;

  const dbClientModule = await import("@/lib/db/client");
  dbForTest = dbClientModule.db as typeof dbForTest;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteBenchmarkValuesBySource", () => {
  test("非空 source 会在同一事务中删除 values 和 source meta", async () => {
    const mocks = createDeleteMock();
    const transactionSpy = vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback) => {
      return callback({ delete: mocks.deleteMock });
    });

    const result = await deleteBenchmarkValuesBySource("text:Seed2.0");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMock).toHaveBeenNthCalledWith(1, benchmarkValues);
    expect(mocks.deleteMock).toHaveBeenNthCalledWith(2, benchmarkSourceMeta);
    expect(mocks.valuesWhere).toHaveBeenCalledTimes(1);
    expect(mocks.sourceMetaWhere).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      source: "text:Seed2.0",
      normalizedSource: "text:Seed2.0",
      deleted: 2,
      deletedSourceMeta: 1,
      deletedEmptySource: false
    });
  });

  test("空 source 会在同一事务中删除空 source values 和空 source meta", async () => {
    const mocks = createDeleteMock();
    const transactionSpy = vi.spyOn(dbForTest, "transaction").mockImplementation(async (callback) => {
      return callback({ delete: mocks.deleteMock });
    });

    const result = await deleteBenchmarkValuesBySource("  ");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMock).toHaveBeenNthCalledWith(1, benchmarkValues);
    expect(mocks.deleteMock).toHaveBeenNthCalledWith(2, benchmarkSourceMeta);
    expect(mocks.valuesWhere).toHaveBeenCalledTimes(1);
    expect(mocks.sourceMetaWhere).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      source: "",
      normalizedSource: null,
      matchedSources: ["", "<NULL>"],
      deleted: 2,
      deletedSourceMeta: 1,
      deletedEmptySource: true
    });
  });
});
