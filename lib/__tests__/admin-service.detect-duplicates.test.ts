/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let detectDuplicateEntityCandidates: any;
let invalidateAllCaches: any;
let db: any;
let getCacheVersion: any;
let invalidateDuplicateCandidatesCacheForTest: any;

function mockDbQuery(resolveValue: any) {
  const query: any = {
    from: vi.fn().mockImplementation(() => query),
    innerJoin: vi.fn().mockImplementation(() => query),
    where: vi.fn().mockImplementation(() => query),
    groupBy: vi.fn().mockImplementation(() => query),
    limit: vi.fn().mockImplementation(() => query),
    then: vi.fn().mockImplementation((onfulfilled: any) => {
      return Promise.resolve(resolveValue).then(onfulfilled);
    }),
  };
  return query;
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const adminServiceModule = await import("@/lib/admin-service");
  detectDuplicateEntityCandidates = adminServiceModule.detectDuplicateEntityCandidates;
  invalidateDuplicateCandidatesCacheForTest = adminServiceModule.__invalidateDuplicateCandidatesCacheForTest;

  const dbQueriesModule = await import("@/lib/db/queries");
  invalidateAllCaches = dbQueriesModule.invalidateAllCaches;

  const dbClientModule = await import("@/lib/db/client");
  db = dbClientModule.db;

  const cacheVersionsModule = await import("@/lib/cache-versions");
  getCacheVersion = cacheVersionsModule.getCacheVersion;
});

describe("detectDuplicateEntityCandidates with caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (invalidateDuplicateCandidatesCacheForTest) {
      invalidateDuplicateCandidatesCacheForTest();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("正确识别重复候选，并且在多次调用时命中缓存", async () => {
    const currentVersion = "V1";

    vi.mocked(getCacheVersion).mockImplementation(async () => currentVersion);

    const modelsData = [
      { id: 1, modelName: "GPT-4", providerName: "OpenAI" },
      { id: 2, modelName: "GPT 4", providerName: "OpenAI" },
      { id: 3, modelName: "Claude 3", providerName: "Anthropic" }
    ];

    const benchmarksData = [
      { id: 10, benchmarkName: "MMLU", benchmarkType: "general", modalities: ["Text"] },
      { id: 11, benchmarkName: "MMLU max", benchmarkType: "general", modalities: ["Text"] }
    ];

    const modelStatsData = [
      { modelId: 1, count: 50 },
      { modelId: 2, count: 40 },
      { modelId: 3, count: 10 }
    ];

    const benchmarkValueStatsData = [
      { benchmarkId: 10, count: 20 },
      { benchmarkId: 11, count: 15 }
    ];

    const benchmarkSourceStatsData = [
      { benchmarkId: 10, source: "OpenAI Paper", count: 20 },
      { benchmarkId: 11, source: "Anthropic Paper", count: 15 }
    ];

    const selectSpy = vi.spyOn(db, "select").mockImplementation((fields: any) => {
      if (fields.modelName) {
        return mockDbQuery(modelsData);
      }
      if (fields.benchmarkName) {
        return mockDbQuery(benchmarksData);
      }
      if (fields.modelId) {
        return mockDbQuery(modelStatsData);
      }
      if (fields.benchmarkId && fields.source) {
        return mockDbQuery(benchmarkSourceStatsData);
      }
      if (fields.benchmarkId) {
        return mockDbQuery(benchmarkValueStatsData);
      }
      throw new Error("Unknown db.select call in test: " + JSON.stringify(fields));
    });

    // 1. 首次触发重复项检测 (应该发生计算并缓存)
    const result1 = await detectDuplicateEntityCandidates();

    expect(result1.modelCandidates).toHaveLength(1);
    expect(result1.modelCandidates[0].sourceName).toBe("GPT 4"); // value count 较小的作为 source
    expect(result1.modelCandidates[0].targetName).toBe("GPT-4");
    expect(result1.modelCandidates[0].confidence).toBe("high");

    expect(result1.benchmarkCandidates).toHaveLength(1);
    expect(result1.benchmarkCandidates[0].sourceName).toBe("MMLU max");
    expect(result1.benchmarkCandidates[0].targetName).toBe("MMLU");

    const totalSelectCallsAfterFirst = selectSpy.mock.calls.length;
    expect(totalSelectCallsAfterFirst).toBe(5); // 5个数据源查询 (getVersion由于被Mock没有调用db)

    // 2. 第二次触发检测 (直接命中 cache)
    const result2 = await detectDuplicateEntityCandidates();
    expect(result2).toBe(result1); // 引用完全相同，说明是缓存命中
    expect(selectSpy.mock.calls.length).toBe(totalSelectCallsAfterFirst); // 没有发生任何数据库查询
  });

  test("调用 invalidateAllCaches 后，缓存应当失效并重新计算", async () => {
    let currentVersion = "V1";

    vi.mocked(getCacheVersion).mockImplementation(async () => currentVersion);

    const selectSpy = vi.spyOn(db, "select").mockImplementation((fields: any) => {
      if (fields.modelName) {
        return mockDbQuery([]);
      }
      if (fields.benchmarkName) {
        return mockDbQuery([]);
      }
      if (fields.modelId) {
        return mockDbQuery([]);
      }
      if (fields.benchmarkId && fields.source) {
        return mockDbQuery([]);
      }
      if (fields.benchmarkId) {
        return mockDbQuery([]);
      }
      throw new Error("Unknown db.select call in test: " + JSON.stringify(fields));
    });

    // 1. 首次调用，触发版本 V1 的计算并缓存
    const result1 = await detectDuplicateEntityCandidates();
    expect(selectSpy.mock.calls.length).toBe(5);

    // 2. 模拟数据写变更，调用 invalidateAllCaches
    await invalidateAllCaches();
    currentVersion = "V2"; // 手动更新版本号，模拟 bumpCacheVersions 成功后的效果

    // 3. 再次调用，此时版本探针检测到 V2，版本更新导致 Cache Miss，触发重新计算
    const result2 = await detectDuplicateEntityCandidates();
    expect(result2).not.toBe(result1); // 引用不再相同，说明是重新生成的实例
    expect(selectSpy.mock.calls.length).toBe(10); // 又执行了 5个数据源查询
  });

  test("将末尾新增 low/medium/high/max 的 model 候选视为低置信度", async () => {
    const currentVersion = "V1";
    vi.mocked(getCacheVersion).mockImplementation(async () => currentVersion);

    const modelsData = [
      { id: 1, modelName: "DeepSeek-V4-Flash High", providerName: "DeepSeek" },
      { id: 2, modelName: "DeepSeek-V4-Flash", providerName: "DeepSeek" },
      { id: 3, modelName: "DeepSeek-V4-Flash Low", providerName: "DeepSeek" },
      { id: 4, modelName: "DeepSeek-V4-Flash Max", providerName: "DeepSeek" },
    ];

    const benchmarksData: any[] = [];
    const modelStatsData = [
      { modelId: 1, count: 50 },
      { modelId: 2, count: 40 },
      { modelId: 3, count: 10 },
      { modelId: 4, count: 5 }
    ];
    const benchmarkValueStatsData: any[] = [];
    const benchmarkSourceStatsData: any[] = [];

    vi.spyOn(db, "select").mockImplementation((fields: any) => {
      if (fields.modelName) {
        return mockDbQuery(modelsData);
      }
      if (fields.benchmarkName) {
        return mockDbQuery(benchmarksData);
      }
      if (fields.modelId) {
        return mockDbQuery(modelStatsData);
      }
      if (fields.benchmarkId && fields.source) {
        return mockDbQuery(benchmarkSourceStatsData);
      }
      if (fields.benchmarkId) {
        return mockDbQuery(benchmarkValueStatsData);
      }
      throw new Error("Unknown db.select call in test: " + JSON.stringify(fields));
    });

    const result = await detectDuplicateEntityCandidates();

    expect(result.modelCandidates.length).toBeGreaterThan(0);
    for (const candidate of result.modelCandidates) {
      expect(candidate.confidence).toBe("low");
      expect(candidate.reasons).toContain("trailing-variant-mismatch");
    }
  });
});
