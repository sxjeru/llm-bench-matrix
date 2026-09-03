import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCacheVersion } from "@/lib/cache-versions";
import { createPublicDashboardSnapshotEtag } from "@/lib/dashboard-snapshot-cache";
import { loadPublicDashboardSnapshot, parseExportFootnote, toPublicModelPrice } from "@/lib/dashboard-snapshot";
import { getDashboardRows, getDashboardStats, getModelParamsRows, getSettings, getSourceOptions } from "@/lib/db/queries";
import { getModelPricingRows } from "@/lib/model-pricing";

vi.mock("@/lib/cache-versions", () => ({
  getCacheVersion: vi.fn()
}));

vi.mock("@/lib/db/queries", () => ({
  getDashboardRows: vi.fn(async () => []),
  getDashboardStats: vi.fn(async () => ({
    providerCount: 0,
    modelCount: 0,
    benchmarkCount: 0,
    totalRecords: 0
  })),
  getSourceOptions: vi.fn(async () => []),
  getModelParamsRows: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({}))
}));

vi.mock("@/lib/model-pricing", () => ({
  getModelPricingRows: vi.fn(async () => [])
}));

vi.mock("@/components/benchmark-matrix/map-row", () => ({
  toMatrixInputRow: vi.fn((row: unknown) => row)
}));

describe("parseExportFootnote", () => {
  test("字符串直接作为脚注文本", () => {
    expect(parseExportFootnote("来源：公开评测")).toEqual({
      exportFootnoteText: "来源：公开评测",
      exportFootnoteAlign: "center"
    });
  });

  test("对象可覆盖文本和对齐", () => {
    expect(parseExportFootnote({ text: "脚注", align: "left" })).toEqual({
      exportFootnoteText: "脚注",
      exportFootnoteAlign: "left"
    });
  });

  test("非法对齐回落到居中", () => {
    expect(parseExportFootnote({ text: "脚注", align: "justify" })).toEqual({
      exportFootnoteText: "脚注",
      exportFootnoteAlign: "center"
    });
  });
});

describe("toPublicModelPrice", () => {
  test("只投影矩阵和散点用到的价格字段", () => {
    expect(toPublicModelPrice({
      modelId: 7,
      modelName: "GPT-5",
      inputCost: 1.2,
      outputCost: 3.4,
      cacheReadCost: 0.1,
      lastSyncedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    })).toEqual({
      modelId: 7,
      modelName: "GPT-5",
      inputCost: 1.2,
      outputCost: 3.4,
      cacheReadCost: 0.1,
      lastSyncedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    });
  });

  test("投影 releaseDate 字段并 trim 空白，忽略空字符串和纯空格", () => {
    expect(toPublicModelPrice({
      modelId: 8,
      modelName: "Claude-3.5",
      inputCost: 3,
      outputCost: 15,
      cacheReadCost: 0.3,
      releaseDate: "  2024-06-20  ",
      lastSyncedAt: null,
      updatedAt: "2026-05-02T00:00:00.000Z"
    })).toEqual(expect.objectContaining({
      releaseDate: "2024-06-20"
    }));

    expect(toPublicModelPrice({
      modelId: 9,
      modelName: "Claude-Empty-Date",
      inputCost: 3,
      outputCost: 15,
      cacheReadCost: 0.3,
      releaseDate: "    ",
      lastSyncedAt: null,
      updatedAt: "2026-05-02T00:00:00.000Z"
    })).not.toHaveProperty("releaseDate");
  });
});

describe("loadPublicDashboardSnapshot", () => {
  beforeEach(() => {
    vi.mocked(getCacheVersion).mockReset();
    vi.mocked(getDashboardRows).mockClear();
    vi.mocked(getDashboardStats).mockClear();
    vi.mocked(getSourceOptions).mockClear();
    vi.mocked(getModelParamsRows).mockClear();
    vi.mocked(getModelPricingRows).mockClear();
    vi.mocked(getSettings).mockClear();
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => `${domain}-version`);
  });

  test("把各域版本作为 forceVersion 传给对应 loader，避免 probe TTL 返回旧 body", async () => {
    await loadPublicDashboardSnapshot();

    expect(getDashboardRows).toHaveBeenCalledWith(null, null, "dashboard-version");
    expect(getSourceOptions).toHaveBeenCalledWith("dashboard-version");
    expect(getDashboardStats).toHaveBeenCalledWith(null, "dashboard-version");
    expect(getModelPricingRows).toHaveBeenCalledWith("pricing-version");
    expect(getModelParamsRows).toHaveBeenCalledWith("dashboard-version");
    expect(getCacheVersion).toHaveBeenCalledWith("settings");
  });

  test("调用方传入 versions 时不再探测缓存版本", async () => {
    await loadPublicDashboardSnapshot({
      dashboard: "forced-dashboard",
      pricing: "forced-pricing",
      settings: "forced-settings"
    });

    expect(getCacheVersion).not.toHaveBeenCalled();
    expect(getDashboardRows).toHaveBeenCalledWith(null, null, "forced-dashboard");
    expect(getModelPricingRows).toHaveBeenCalledWith("forced-pricing");
  });

  test("快照 ETag 由三个版本域组成", () => {
    expect(createPublicDashboardSnapshotEtag({
      dashboard: "d1",
      pricing: "p1",
      settings: "s1"
    })).toBe('"dashboard:d1:p1:s1"');
  });

  test("公开快照丢掉三项费用全空的价格行", async () => {
    vi.mocked(getModelPricingRows).mockResolvedValueOnce([
      {
        modelId: 7,
        modelName: "GPT-5",
        inputCost: 1.2,
        outputCost: 3.4,
        cacheReadCost: 0.1,
        lastSyncedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z"
      },
      {
        modelId: 8,
        modelName: "Unmatched",
        inputCost: null,
        outputCost: null,
        cacheReadCost: null,
        lastSyncedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z"
      }
    ] as never);

    const snapshot = await loadPublicDashboardSnapshot();

    expect(snapshot.modelPrices).toEqual([
      {
        modelId: 7,
        modelName: "GPT-5",
        inputCost: 1.2,
        outputCost: 3.4,
        cacheReadCost: 0.1,
        lastSyncedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z"
      }
    ]);
  });

  test("公开快照保留仅有 releaseDate 但费用全空的价格行，过滤纯空或纯空格记录", async () => {
    vi.mocked(getModelPricingRows).mockResolvedValueOnce([
      {
        modelId: 10,
        modelName: "Date-Only-Model",
        inputCost: null,
        outputCost: null,
        cacheReadCost: null,
        releaseDate: "2024-05-13"
      },
      {
        modelId: 11,
        modelName: "Whitespace-Date-Model",
        inputCost: null,
        outputCost: null,
        cacheReadCost: null,
        releaseDate: "   "
      }
    ] as never);

    const snapshot = await loadPublicDashboardSnapshot();

    expect(snapshot.modelPrices).toEqual([
      {
        modelId: 10,
        modelName: "Date-Only-Model",
        inputCost: null,
        outputCost: null,
        cacheReadCost: null,
        releaseDate: "2024-05-13"
      }
    ]);
  });
});
