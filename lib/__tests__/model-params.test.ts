import { beforeEach, describe, expect, test, vi } from "vitest";

const dbClientMock = vi.hoisted(() => ({ db: {} as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return dbClientMock.db;
  }
}));

type UpdatedRow = { id: number; modelName?: string };

function createDbMock() {
  const returning = vi.fn<() => Promise<UpdatedRow[]>>().mockResolvedValue([{ id: 1, modelName: "Model A" }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const transaction = vi.fn(async (callback: (tx: { update: typeof update }) => Promise<unknown>) =>
    callback({ update })
  );

  return {
    db: { update, transaction },
    update,
    set,
    where,
    returning,
    transaction
  };
}

async function importParamsModule(dbMock: ReturnType<typeof createDbMock>["db"]) {
  dbClientMock.db = dbMock;
  return import("@/lib/model-params");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("updateModelParams", () => {
  test("serializes numbers and normalizes an empty note to null", async () => {
    const mock = createDbMock();
    const { updateModelParams } = await importParamsModule(mock.db);

    const result = await updateModelParams({
      modelId: 1,
      totalParamsB: 235,
      activatedParamsB: 22,
      isEstimated: true,
      note: "   "
    });

    expect(mock.set).toHaveBeenCalledWith({
      totalParamsB: "235",
      activatedParamsB: "22",
      paramsIsEstimated: true,
      paramsNote: null
    });
    expect(result).toEqual({ ok: true, modelId: 1, modelName: "Model A", updated: true });
  });

  test("does not touch the database when nothing but modelId is provided", async () => {
    const mock = createDbMock();
    const { updateModelParams } = await importParamsModule(mock.db);

    const result = await updateModelParams({ modelId: 5 });

    expect(mock.update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, modelId: 5, updated: false });
  });

  test("rejects an activated value larger than the total", async () => {
    const mock = createDbMock();
    const { updateModelParams } = await importParamsModule(mock.db);
    const { ZodError } = await import("zod");

    await expect(
      updateModelParams({ modelId: 1, totalParamsB: 20, activatedParamsB: 30 })
    ).rejects.toBeInstanceOf(ZodError);
    expect(mock.update).not.toHaveBeenCalled();
  });
});

describe("updateModelParamsBatch", () => {
  test("updates every entry inside one transaction", async () => {
    const mock = createDbMock();
    mock.returning.mockResolvedValue([{ id: 1 }]);
    const { updateModelParamsBatch } = await importParamsModule(mock.db);

    const result = await updateModelParamsBatch([
      { modelId: 1, totalParamsB: 235, activatedParamsB: 22 },
      { modelId: 2, totalParamsB: 72, note: "官方博客" }
    ]);

    expect(result).toEqual({ ok: true, updatedCount: 2 });
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.set).toHaveBeenCalledTimes(2);
    expect(mock.set).toHaveBeenNthCalledWith(1, { totalParamsB: "235", activatedParamsB: "22" });
    expect(mock.set).toHaveBeenNthCalledWith(2, { totalParamsB: "72", paramsNote: "官方博客" });
  });

  test("rejects the whole batch when one entry is invalid", async () => {
    const mock = createDbMock();
    const { updateModelParamsBatch } = await importParamsModule(mock.db);

    await expect(
      updateModelParamsBatch([
        { modelId: 1, totalParamsB: 235 },
        { modelId: 7, totalParamsB: 20, activatedParamsB: 30 }
      ])
    ).rejects.toThrow(/模型 #7/);

    // 校验在写库之前完成，合法的那条也不应落库
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  test("keeps the last entry when a modelId repeats", async () => {
    const mock = createDbMock();
    mock.returning.mockResolvedValue([{ id: 1 }]);
    const { updateModelParamsBatch } = await importParamsModule(mock.db);

    const result = await updateModelParamsBatch([
      { modelId: 1, totalParamsB: 100 },
      { modelId: 1, totalParamsB: 200 }
    ]);

    expect(result).toEqual({ ok: true, updatedCount: 1 });
    expect(mock.set).toHaveBeenCalledTimes(1);
    expect(mock.set).toHaveBeenCalledWith({ totalParamsB: "200" });
  });

  test("throws so the transaction rolls back when a model is missing", async () => {
    const mock = createDbMock();
    mock.returning.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    const { updateModelParamsBatch } = await importParamsModule(mock.db);

    await expect(
      updateModelParamsBatch([
        { modelId: 1, totalParamsB: 100 },
        { modelId: 999, totalParamsB: 200 }
      ])
    ).rejects.toThrow("model not found: 999");
  });

  test("skips the database entirely when no entry carries a value", async () => {
    const mock = createDbMock();
    const { updateModelParamsBatch } = await importParamsModule(mock.db);

    await expect(updateModelParamsBatch([])).resolves.toEqual({ ok: true, updatedCount: 0 });
    await expect(updateModelParamsBatch([{ modelId: 1 }])).resolves.toEqual({ ok: true, updatedCount: 0 });
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
