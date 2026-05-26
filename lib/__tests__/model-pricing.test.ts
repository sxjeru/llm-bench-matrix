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

const MODELS_DEV_MAX_BYTES = 8 * 1024 * 1024;

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

function mockModelsDevStreamResponse(chunks: Uint8Array[], cancel = vi.fn()) {
  const pendingChunks = [...chunks];

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(null)
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = pendingChunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
        cancel
      }),
      text: vi.fn()
    })
  );

  return { cancel };
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

  test("updateModelPricing persists validated payload with defaults", async () => {
    const { db, onConflictDoUpdate } = createDbMock([], []);
    const { updateModelPricing } = await importPricingModule(db);

    await updateModelPricing({
      modelId: 1,
      sourceModelId: "gpt-4",
      inputCost: 0.1,
      outputCost: 0.2,
      reasoningCost: null,
    });

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);

    const [onConflictArg] = onConflictDoUpdate.mock.calls[0];
    const set = onConflictArg.set;

    expect(set).toEqual(
      expect.objectContaining({
        modelId: 1,
        sourceModelId: "gpt-4",
        inputCost: "0.1",
        outputCost: "0.2",
        reasoningCost: null,
        source: "manual",
        matchStatus: "manual",
        matchConfidence: 100,
        manualOverride: true,
      })
    );
  });

  test("updateModelPricing rejects invalid inputs with zod errors", async () => {
    const { db } = createDbMock([], []);
    const { updateModelPricing } = await importPricingModule(db);
    const { ZodError } = await import("zod");

    await expect(
      updateModelPricing({
        modelId: 0,
        inputCost: 0.1,
      })
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      updateModelPricing({
        modelId: 1,
        inputCost: -0.1,
      })
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      updateModelPricing({
        modelId: 1,
        outputCost: -0.2,
      })
    ).rejects.toBeInstanceOf(ZodError);
  });

  test("updateModelPricing respects explicit overrides for matchStatus and manualOverride", async () => {
    const { db, onConflictDoUpdate } = createDbMock([], []);
    const { updateModelPricing } = await importPricingModule(db);

    await updateModelPricing({
      modelId: 2,
      sourceModelId: "gpt-4-32k",
      inputCost: 0.3,
      outputCost: 0.4,
      matchStatus: "matched",
      manualOverride: false,
    });

    const [onConflictArg] = onConflictDoUpdate.mock.calls[0];
    const set = onConflictArg.set;

    expect(set).toEqual(
      expect.objectContaining({
        modelId: 2,
        sourceModelId: "gpt-4-32k",
        inputCost: "0.3",
        outputCost: "0.4",
        source: "models.dev",
        matchStatus: "matched",
        matchConfidence: 0,
        manualOverride: false,
      })
    );
  });


  test("syncModelsDevPricing 应将禁用价格匹配的 provider 标记为 ignored 并清空旧匹配", async () => {
    const { db, values, onConflictDoUpdate } = createDbMock(
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
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        matchStatus: "ignored",
        sourceProviderId: null,
        sourceModelId: null,
        inputCost: null,
        outputCost: null,
        note: "provider-pricing-disabled"
      })
    ]);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(0);
    expect(result.skippedManualCount).toBe(0);
  });

  test("syncModelsDevPricing 在找不到匹配时应回写 unmatched 以清理陈旧价格", async () => {
    const { db, values, onConflictDoUpdate } = createDbMock(
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
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        matchStatus: "unmatched",
        matchConfidence: 0,
        sourceProviderId: null,
        sourceModelId: null,
        inputCost: null,
        outputCost: null,
        note: "no-match"
      })
    ]);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(1);
    expect(result.skippedManualCount).toBe(0);
  });

  test("syncModelsDevPricing 首次同步禁用价格匹配的 provider 时，即使没有 prior data 也应写入 ignored", async () => {
    const { db, values, onConflictDoUpdate } = createDbMock(
      [
        {
          id: 3,
          modelName: "GPT-4.2",
          sourceModelId: null,
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: { pricing: { disabled: true } }
        }
      ],
      [] // empty prior data
    );
    mockModelsDevResponse({});

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        matchStatus: "ignored",
        note: "provider-pricing-disabled"
      })
    ]);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 首次同步找不到匹配时，即使没有 prior data 也应写入 unmatched", async () => {
    const { db, values, onConflictDoUpdate } = createDbMock(
      [
        {
          id: 4,
          modelName: "Unknown Model 2",
          sourceModelId: null,
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: {}
        }
      ],
      [] // empty prior data
    );
    mockModelsDevResponse({});

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        matchStatus: "unmatched",
        note: "no-match"
      })
    ]);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(1);
  });

  test("syncModelsDevPricing 批量 upsert 非手动覆盖的同步结果", async () => {
    const { db, values, onConflictDoUpdate } = createDbMock(
      [
        {
          id: 6,
          modelName: "GPT-4",
          sourceModelId: "gpt-4",
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: {}
        },
        {
          id: 7,
          modelName: "Unknown Model",
          sourceModelId: null,
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      openai: {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4": {
            id: "gpt-4",
            name: "GPT-4",
            cost: {
              input: 30,
              output: 60,
              cache_read: 3
            }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 6,
        sourceProviderId: "openai",
        sourceModelId: "gpt-4",
        inputCost: "30",
        outputCost: "60",
        cacheReadCost: "3",
        matchStatus: "matched"
      }),
      expect.objectContaining({
        modelId: 7,
        sourceProviderId: null,
        sourceModelId: null,
        inputCost: null,
        outputCost: null,
        matchStatus: "unmatched",
        note: "no-match"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.skippedManualCount).toBe(0);
  });

  test("syncModelsDevPricing 支持分块读取 models.dev 响应", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 8,
          modelName: "GPT-4",
          sourceModelId: "gpt-4",
          providerName: "OpenAI",
          providerSlug: "openai",
          providerConfig: {}
        }
      ],
      []
    );
    const encoder = new TextEncoder();
    const bytes = encoder.encode(JSON.stringify({
      openai: {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4": {
            id: "gpt-4",
            name: "GPT-4",
            cost: {
              input: 30,
              output: 60
            }
          }
        }
      }
    }));
    mockModelsDevStreamResponse([
      bytes.slice(0, 12),
      bytes.slice(12, 48),
      bytes.slice(48)
    ]);

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 8,
        sourceProviderId: "openai",
        sourceModelId: "gpt-4",
        matchStatus: "matched"
      })
    ]);
    expect(result.matchedCount).toBe(1);
  });

  test("syncModelsDevPricing 在无 content-length 的流式响应超限时取消读取", async () => {
    const { db } = createDbMock([], []);
    const cancel = vi.fn();
    const releaseLock = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MODELS_DEV_MAX_BYTES) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: vi.fn().mockReturnValue(null)
        },
        body: {
          getReader: vi.fn().mockReturnValue({ read, cancel, releaseLock })
        },
        text: vi.fn()
      })
    );

    const pricingModule = await importPricingModule(db);

    await expect(pricingModule.syncModelsDevPricing()).rejects.toThrow("models.dev 响应过大");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  test("syncModelsDevPricing skips manualOverride rows and increments skippedManualCount", async () => {
    const activeModels = [
      {
        id: 5,
        modelName: "GPT-4",
        sourceModelId: "gpt-4",
        providerName: "OpenAI",
        providerSlug: "openai",
        providerConfig: {}
      }
    ];
    const existingRows = [
      {
        modelId: 5,
        manualOverride: true
      }
    ];

    const { db } = createDbMock(activeModels, existingRows);

    mockModelsDevResponse({
      openai: {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4": {
            id: "gpt-4",
            name: "GPT-4",
            cost: {
              input: 30,
              output: 60
            }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(db.insert).not.toHaveBeenCalled();
    expect(result.skippedManualCount).toBe(1);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(0);
  });
});

