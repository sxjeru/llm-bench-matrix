import { beforeEach, describe, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { saveArtificialAnalysisMappings } from "@/lib/external-providers/artificial-analysis-service";

const mocks = vi.hoisted(() => ({
  existing: vi.fn(),
  deleteWhere: vi.fn(),
  insertValues: vi.fn()
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: () => ({ from: () => ({ where: mocks.existing }) }),
      delete: () => ({ where: mocks.deleteWhere }),
      insert: () => ({ values: mocks.insertValues })
    })
  }
}));
vi.mock("@/lib/db/queries", () => ({}));
vi.mock("@/lib/admin-service", () => ({}));
vi.mock("@/lib/external-providers/artificial-analysis", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/external-providers/artificial-analysis")>(),
  hasArtificialAnalysisApiKey: () => false
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing.mockResolvedValue([]);
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.insertValues.mockResolvedValue(undefined);
});

describe("saveArtificialAnalysisMappings", () => {
  test("自动匹配不能覆盖批次外的已有绑定，整批不写入", async () => {
    mocks.existing.mockResolvedValue([{ modelId: 1, externalModelId: "aa-x" }]);
    await expect(saveArtificialAnalysisMappings([
      { modelId: 2, externalModelId: "aa-x", matchStatus: "matched", manualOverride: false },
      { modelId: 3, externalModelId: "aa-y", matchStatus: "matched", manualOverride: false }
    ])).rejects.toThrow("模型 #1");
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  test("允许同一批次互换绑定，但仅删除本批次模型的旧映射", async () => {
    mocks.existing.mockResolvedValue([
      { modelId: 1, externalModelId: "aa-x" },
      { modelId: 2, externalModelId: "aa-y" }
    ]);
    await expect(saveArtificialAnalysisMappings([
      { modelId: 1, externalModelId: "aa-y", matchStatus: "manual", manualOverride: true },
      { modelId: 2, externalModelId: "aa-x", matchStatus: "matched", manualOverride: false }
    ])).resolves.toEqual({ updatedCount: 2 });
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
    const deletion = new PgDialect().sqlToQuery(mocks.deleteWhere.mock.calls[0][0]);
    expect(deletion.sql).toContain('"model_id" in');
    expect(deletion.sql).not.toContain('"external_model_id"');
    expect(deletion.params).toEqual(["artificial-analysis", 1, 2]);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ modelId: 1, externalModelId: "aa-y", manualOverride: true }),
      expect.objectContaining({ modelId: 2, externalModelId: "aa-x", manualOverride: false })
    ]);
  });
});
