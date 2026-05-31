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

type PricingSelectRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  source: string;
  sourceProviderId: string | null;
  sourceProviderName: string | null;
  sourceModelId: string | null;
  sourceModelName: string | null;
  inputCost: string | number | null;
  outputCost: string | number | null;
  reasoningCost: string | number | null;
  cacheReadCost: string | number | null;
  cacheWriteCost: string | number | null;
  inputAudioCost: string | number | null;
  outputAudioCost: string | number | null;
  currency: string;
  unit: string;
  matchConfidence: number;
  matchStatus: string;
  manualOverride: boolean;
  note: string | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
};

const MODELS_DEV_MAX_BYTES = 8 * 1024 * 1024;

function createDbMock(activeModels: ActiveModelRow[], existingRows: ExistingPricingRow[], pricingRows: PricingSelectRow[] = []) {
  const select = vi.fn((selection?: unknown) => {
    if (selection) {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([])
          })),
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue(pricingRows)
              }))
            })),
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
    insert,
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

  test("getModelPricingRows 使用进程内缓存并在手动失效后重新读取", async () => {
    const pricingRows: PricingSelectRow[] = [
      {
        modelId: 1,
        modelName: "GPT-4",
        providerName: "OpenAI",
        source: "models.dev",
        sourceProviderId: "openai",
        sourceProviderName: "OpenAI",
        sourceModelId: "gpt-4",
        sourceModelName: "GPT-4",
        inputCost: "1.5",
        outputCost: "2.5",
        reasoningCost: null,
        cacheReadCost: null,
        cacheWriteCost: null,
        inputAudioCost: null,
        outputAudioCost: null,
        currency: "USD",
        unit: "per_1m_tokens",
        matchConfidence: 100,
        matchStatus: "matched",
        manualOverride: false,
        note: null,
        lastSyncedAt: null,
        updatedAt: new Date("2026-05-01T00:00:00.000Z")
      }
    ];
    const { db } = createDbMock([], [], pricingRows);
    const { getModelPricingRows, invalidateModelPricingCaches } = await importPricingModule(db);

    await expect(getModelPricingRows()).resolves.toEqual([
      expect.objectContaining({ modelId: 1, inputCost: 1.5, updatedAt: "2026-05-01T00:00:00.000Z" })
    ]);
    await getModelPricingRows();

    expect(db.select).toHaveBeenCalledTimes(2);

    invalidateModelPricingCaches();
    await getModelPricingRows();

    expect(db.select).toHaveBeenCalledTimes(4);
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

  test("updateModelPricing preserves omitted fields and clears explicit nulls", async () => {
    const { db, onConflictDoUpdate } = createDbMock([], []);
    const { updateModelPricing } = await importPricingModule(db);

    await updateModelPricing({
      modelId: 3,
      inputCost: undefined,
      outputCost: null,
      sourceProviderId: undefined,
      sourceModelId: "gpt-4.1",
      note: null,
      manualOverride: false,
    });

    const [onConflictArg] = onConflictDoUpdate.mock.calls[0];
    const set = onConflictArg.set;

    expect(set).toEqual(
      expect.objectContaining({
        outputCost: null,
        sourceModelId: "gpt-4.1",
        note: null,
        source: "models.dev",
        matchStatus: "matched",
        matchConfidence: 0,
        manualOverride: false,
      })
    );
    expect(set).not.toHaveProperty("inputCost");
    expect(set).not.toHaveProperty("sourceProviderId");
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

  test("syncModelsDevPricing 在多个全局模型候选时使用 provider 信息消歧", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 9,
          modelName: "Claude Opus 4.6",
          sourceModelId: null,
          providerName: "Claude",
          providerSlug: "claude",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        models: {
          "anthropic/claude-opus-4.6": {
            id: "anthropic/claude-opus-4.6",
            name: "Claude Opus 4.6",
            cost: { input: 5.5, output: 27.5 }
          }
        }
      },
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-opus-4-6": {
            id: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            cost: { input: 5, output: 25, cache_read: 0.5 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 9,
        sourceProviderId: "anthropic",
        sourceModelId: "claude-opus-4-6",
        inputCost: "5",
        outputCost: "25",
        cacheReadCost: "0.5",
        matchStatus: "matched",
        note: "normalized-model-name-provider-disambiguated"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 匹配价格时忽略模型末尾变体标记和括号内容", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 10,
          modelName: "Foo Bar-think",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 11,
          modelName: "Foo Bar-no-think",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 12,
          modelName: "Foo Bar-non-think",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 13,
          modelName: "Foo Bar-nothink",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 14,
          modelName: "Foo Bar-nonthink",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 15,
          modelName: "Foo Bar high",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 16,
          modelName: "Foo Bar max (preview)",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        },
        {
          id: 17,
          modelName: "Foo Bar（fast）",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      test: {
        id: "test",
        name: "Test",
        models: {
          "foo-bar": {
            id: "foo-bar",
            name: "Foo Bar",
            cost: { input: 1, output: 2 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17
    ].map((modelId) => expect.objectContaining({
      modelId,
      sourceProviderId: "test",
      sourceModelId: "foo-bar",
      inputCost: "1",
      outputCost: "2",
      matchStatus: "matched",
      note: "normalized-model-variant"
    })));
    expect(result.matchedCount).toBe(8);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 将 DeepSeek-V3.2-nothink 回退匹配到 DeepSeek-V3.2", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 18,
          modelName: "DeepSeek-V3.2-nothink",
          sourceModelId: null,
          providerName: "DeepSeek",
          providerSlug: "deepseek",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        models: {
          "deepseek-v3.2": {
            id: "deepseek-v3.2",
            name: "DeepSeek V3.2",
            cost: { input: 0.27, output: 0.42 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 18,
        sourceProviderId: "deepseek",
        sourceModelId: "deepseek-v3.2",
        inputCost: "0.27",
        outputCost: "0.42",
        matchStatus: "matched",
        note: "normalized-model-variant"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 规范化模型名时保留点号", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 20,
          modelName: "Foo-4.1",
          sourceModelId: null,
          providerName: "Test",
          providerSlug: "test",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      test: {
        id: "test",
        name: "Test",
        models: {
          "foo-4-1": {
            id: "foo-4-1",
            name: "Foo 4 1",
            cost: { input: 1, output: 2 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 20,
        sourceProviderId: null,
        sourceModelId: null,
        matchStatus: "unmatched",
        note: "no-match"
      })
    ]);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(1);
  });

  test("syncModelsDevPricing 匹配上游 model id 时忽略斜杠前缀", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 21,
          modelName: "Claude Opus 4.6",
          sourceModelId: null,
          providerName: "Anthropic",
          providerSlug: "anthropic",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "anthropic/claude-opus-4.6": {
            id: "anthropic/claude-opus-4.6",
            cost: { input: 5, output: 25 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 21,
        sourceProviderId: "anthropic",
        sourceModelId: "anthropic/claude-opus-4.6",
        inputCost: "5",
        outputCost: "25",
        matchStatus: "matched",
        note: "normalized-model-name"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 匹配上游 name 时忽略冒号和斜杠前缀", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 22,
          modelName: "Llama 3.1 8B",
          sourceModelId: null,
          providerName: "Meta",
          providerSlug: "meta",
          providerConfig: {}
        },
        {
          id: 23,
          modelName: "Llama 3.2 8B",
          sourceModelId: null,
          providerName: "Meta",
          providerSlug: "meta",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      meta: {
        id: "meta",
        name: "Meta",
        models: {
          "meta-llama-31-8b": {
            id: "meta-llama-31-8b",
            name: "Meta: Llama 3.1 8B",
            cost: { input: 1, output: 2 }
          },
          "meta-llama-32-8b": {
            id: "meta-llama-32-8b",
            name: "Meta/Llama 3.2 8B",
            cost: { input: 3, output: 4 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 22,
        sourceProviderId: "meta",
        sourceModelId: "meta-llama-31-8b",
        inputCost: "1",
        outputCost: "2",
        matchStatus: "matched",
        note: "normalized-model-name"
      }),
      expect.objectContaining({
        modelId: 23,
        sourceProviderId: "meta",
        sourceModelId: "meta-llama-32-8b",
        inputCost: "3",
        outputCost: "4",
        matchStatus: "matched",
        note: "normalized-model-name"
      })
    ]);
    expect(result.matchedCount).toBe(2);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 完整匹配无结果时使用最大包含模糊匹配", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 24,
          modelName: "Qwen 3 Coder 480B A35B Instruct",
          sourceModelId: null,
          providerName: "Alibaba",
          providerSlug: "alibaba",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      alibaba: {
        id: "alibaba",
        name: "Alibaba",
        models: {
          qwen3: {
            id: "qwen3",
            name: "Qwen 3",
            cost: { input: 0.2, output: 0.8 }
          },
          "qwen3-coder": {
            id: "qwen3-coder",
            name: "Qwen 3 Coder",
            cost: { input: 0.3, output: 1.2 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 24,
        sourceProviderId: "alibaba",
        sourceModelId: "qwen3-coder",
        inputCost: "0.3",
        outputCost: "1.2",
        matchStatus: "matched",
        matchConfidence: 70,
        note: "fuzzy-model-name"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 模糊候选无法唯一消歧时使用所有模糊候选的众数价格", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 25,
          modelName: "Gemini-3-Pro",
          sourceModelId: null,
          providerName: "Unknown Proxy",
          providerSlug: "unknown-proxy",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      providerA: {
        id: "provider-a",
        name: "Provider A",
        models: {
          "google/gemini-3-pro-preview": {
            id: "google/gemini-3-pro-preview",
            name: "Gemini 3 Pro Preview",
            cost: { input: 2, output: 12, cache_read: 0.2 }
          }
        }
      },
      providerB: {
        id: "provider-b",
        name: "Provider B",
        models: {
          "google/gemini-3-pro-preview": {
            id: "google/gemini-3-pro-preview",
            name: "Gemini 3 Pro Preview",
            cost: { input: 3, output: 15, cache_read: 0.3 }
          }
        }
      },
      providerC: {
        id: "provider-c",
        name: "Provider C",
        models: {
          "google/gemini-3-pro-image-preview": {
            id: "google/gemini-3-pro-image-preview",
            name: "Gemini 3 Pro Image Preview",
            cost: { input: 2, output: 12, cache_read: 0.2 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 25,
        sourceProviderId: "provider-a",
        sourceModelId: "google/gemini-3-pro-preview",
        inputCost: "2",
        outputCost: "12",
        cacheReadCost: "0.2",
        matchStatus: "matched",
        matchConfidence: 70,
        note: "global-price-mode"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 精确候选无法消歧时仍使用模糊候选众数价格", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 26,
          modelName: "Gemini-3-Pro",
          sourceModelId: null,
          providerName: "Unknown Proxy",
          providerSlug: "unknown-proxy",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      providerA: {
        id: "provider-a",
        name: "Provider A",
        models: {
          "legacy/gemini-3-pro": {
            id: "legacy/gemini-3-pro",
            name: "Gemini 3 Pro Legacy",
            cost: { input: 7, output: 8 }
          }
        }
      },
      providerB: {
        id: "provider-b",
        name: "Provider B",
        models: {
          "alt/gemini-3-pro": {
            id: "alt/gemini-3-pro",
            name: "Gemini 3 Pro Alternate",
            cost: { input: 9, output: 10 }
          }
        }
      },
      providerC: {
        id: "provider-c",
        name: "Provider C",
        models: {
          "google/gemini-3-pro-preview": {
            id: "google/gemini-3-pro-preview",
            name: "Gemini 3 Pro Preview",
            cost: { input: 2, output: 12, cache_read: 0.2 }
          }
        }
      },
      providerD: {
        id: "provider-d",
        name: "Provider D",
        models: {
          "google/gemini-3-pro-preview-thinking": {
            id: "google/gemini-3-pro-preview-thinking",
            name: "Gemini 3 Pro Thinking",
            cost: { input: 2, output: 12, cache_read: 0.2 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 26,
        sourceProviderId: "provider-c",
        sourceModelId: "google/gemini-3-pro-preview",
        inputCost: "2",
        outputCost: "12",
        cacheReadCost: "0.2",
        matchStatus: "matched",
        matchConfidence: 70,
        note: "global-price-mode"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 在无匹配 provider 时使用其他 provider 的众数价格", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 10,
          modelName: "Shared Model",
          sourceModelId: "shared-model",
          providerName: "Unknown Proxy",
          providerSlug: "unknown-proxy",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      providerA: {
        id: "provider-a",
        name: "Provider A",
        models: {
          "shared-model": {
            id: "shared-model",
            name: "Shared Model",
            cost: { input: 1, output: 2, cache_read: 0.1 }
          }
        }
      },
      providerB: {
        id: "provider-b",
        name: "Provider B",
        models: {
          "shared-model": {
            id: "shared-model",
            name: "Shared Model",
            cost: { input: 1, output: 2, cache_read: 0.1 }
          }
        }
      },
      providerC: {
        id: "provider-c",
        name: "Provider C",
        models: {
          "shared-model": {
            id: "shared-model",
            name: "Shared Model",
            cost: { input: 3, output: 6, cache_read: 0.3 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 10,
        sourceProviderId: "provider-a",
        sourceModelId: "shared-model",
        inputCost: "1",
        outputCost: "2",
        cacheReadCost: "0.1",
        matchStatus: "matched",
        note: "global-price-mode"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
  });

  test("syncModelsDevPricing 在无合适 provider 时使用所有同名模型的众数价格", async () => {
    const { db, values } = createDbMock(
      [
        {
          id: 19,
          modelName: "GLM-4.7",
          sourceModelId: null,
          providerName: "GLM",
          providerSlug: "glm",
          providerConfig: {}
        }
      ],
      []
    );

    mockModelsDevResponse({
      zai: {
        id: "zai",
        name: "Z AI",
        models: {
          "glm-4.7": {
            id: "glm-4.7",
            name: "GLM-4.7",
            cost: { input: 0.6, output: 2.2, cache_read: 0.11, cache_write: 0 }
          },
          "z-ai/glm-4.7": {
            id: "z-ai/glm-4.7",
            name: "GLM-4.7",
            cost: { input: 0.6, output: 2.2, cache_read: 0.11, cache_write: 0 }
          }
        }
      },
      deepinfra: {
        id: "deepinfra",
        name: "DeepInfra",
        models: {
          "zai-org/GLM-4.7": {
            id: "zai-org/GLM-4.7",
            name: "GLM-4.7",
            cost: { input: 0.43, output: 1.75, cache_read: 0.08 }
          }
        }
      }
    });

    const pricingModule = await importPricingModule(db);
    const result = await pricingModule.syncModelsDevPricing();

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        modelId: 19,
        sourceProviderId: "zai",
        sourceModelId: "glm-4.7",
        inputCost: "0.6",
        outputCost: "2.2",
        cacheReadCost: "0.11",
        cacheWriteCost: "0",
        matchStatus: "matched",
        note: "global-price-mode"
      })
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(0);
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

