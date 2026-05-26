import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {}
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type ActiveModelRow = {
  id: number;
  modelName: string;
  sourceModelId: string | null;
  providerName: string;
  providerSlug: string;
  providerConfig: Record<string, unknown>;
};

type ExistingPricingRow = {
  modelId: number;
  manualOverride: boolean;
};

function createDbMock(activeModels: ActiveModelRow[], existingRows: ExistingPricingRow[]) {
  const select = vi.fn((selection?: unknown) => {
    if (selection) {
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn().mockResolvedValue(activeModels)
            }))
          }))
        }))
      };
    }

    return {
      from: vi.fn().mockResolvedValue(existingRows)
    };
  });

  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  return {
    db: { select, insert },
    values,
    onConflictDoUpdate
  };
}

async function importPricingModule(dbMock: ReturnType<typeof createDbMock>["db"]) {
  vi.doMock("@/lib/db/client", () => ({ db: dbMock }));
  return import("@/lib/model-pricing");
}

function mockModelsDevResponse(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? JSON.stringify(body).length.toString() : null)
      },
      text: vi.fn().mockResolvedValue(JSON.stringify(body))
    })
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("model pricing module", () => {
  test("exports public pricing helpers", async () => {
    const { db } = createDbMock([], []);
    const pricingModule = await importPricingModule(db);

    expect(typeof pricingModule.getModelPricingRows).toBe("function");
    expect(typeof pricingModule.syncModelsDevPricing).toBe("function");
    expect(typeof pricingModule.updateModelPricing).toBe("function");
  });

  test("syncModelsDevPricing 应将禁用价格匹配的 provider 标记为 ignored 并清空旧匹配", async () => {
    const { db, onConflictDoUpdate } = createDbMock(
      [
        {
          id: 1,
          modelName: "GPT-4.1",
          sourceModelId: null,
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: { pricing: { disabled: true } }
        }
      ],
      [{ modelId: 1, manualOverride: false }]
    );
    mockModelsDevResponse({});

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          matchStatus: "ignored",
          sourceProviderId: null,
          sourceModelId: null,
          inputCost: null,
          outputCost: null,
          note: "provider-pricing-disabled"
        })
      })
    );
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(0);
    expect(result.skippedManualCount).toBe(0);
  });

  test("syncModelsDevPricing 在找不到匹配时应回写 unmatched 以清理陈旧价格", async () => {
    const { db, onConflictDoUpdate } = createDbMock(
      [
        {
          id: 2,
          modelName: "Unknown Model",
          sourceModelId: null,
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: {}
        }
      ],
      [{ modelId: 2, manualOverride: false }]
    );
    mockModelsDevResponse({});

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          matchStatus: "unmatched",
          matchConfidence: 0,
          sourceProviderId: null,
          sourceModelId: null,
          inputCost: null,
          outputCost: null,
          note: "no-match"
        })
      })
    );
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(1);
    expect(result.skippedManualCount).toBe(0);
  });
});
