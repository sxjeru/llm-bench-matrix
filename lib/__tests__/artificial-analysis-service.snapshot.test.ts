import { beforeEach, describe, expect, test, vi } from "vitest";

import { getArtificialAnalysisAdminSnapshot } from "@/lib/external-providers/artificial-analysis-service";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/db/queries";
import { getArtificialAnalysisSnapshot } from "@/lib/external-providers/artificial-analysis";

vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock("@/lib/db/queries", () => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
  invalidateAllCaches: vi.fn()
}));

vi.mock("@/lib/admin-service", () => ({
  ensureModelByProviderId: vi.fn(),
  ensureProvider: vi.fn(),
  importExternalBenchmarkRows: vi.fn(),
  // 快照测试只关心单跳解析，多跳与环路由 admin-service 的测试覆盖
  resolveMergedModelTargets: (rows: Array<{ id: number; mergedIntoModelId: number | null }>) =>
    new Map(
      rows
        .filter((row) => row.mergedIntoModelId !== null)
        .map((row) => [row.id, row.mergedIntoModelId as number])
    )
}));

vi.mock("@/lib/external-providers/artificial-analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/external-providers/artificial-analysis")>();
  return {
    ...actual,
    hasArtificialAnalysisApiKey: () => true,
    getArtificialAnalysisSnapshot: vi.fn()
  };
});

const upstreamModel = {
  id: "aa-fable",
  name: "Claude Fable 5",
  slug: "claude-fable-5",
  creatorName: "Anthropic",
  releaseDate: null,
  metrics: {},
  legacyMetricKeys: []
};

const storedMapping = {
  id: 150,
  source: "artificial-analysis",
  modelId: 184,
  externalModelId: "aa-fable",
  externalModelName: "Claude Fable 5",
  externalModelSlug: "claude-fable-5",
  externalCreator: "Anthropic",
  reasoningEffort: null,
  matchStatus: "manual",
  matchConfidence: 100,
  matchReason: "manual",
  manualOverride: true,
  rawJson: {},
  lastSyncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

function mockSelect(localRows: unknown[], storedRows: unknown[], mergedRows: unknown[]) {
  const ordered = vi.mocked(db.select);

  ordered
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue(localRows) }))
        }))
      }))
    } as never)
    .mockReturnValueOnce({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(storedRows) }))
    } as never)
    .mockReturnValueOnce({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(mergedRows) }))
    } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSettings).mockResolvedValue({});
  vi.mocked(getArtificialAnalysisSnapshot).mockResolvedValue({
    fetchedAt: "2026-11-10T00:00:00.000Z",
    models: [upstreamModel],
    catalog: [],
    intelligenceIndexVersion: null,
    freePageCount: 1,
    legacyWarning: null
  });
});

describe("getArtificialAnalysisAdminSnapshot 与已合并模型残留映射", () => {
  test("旧映射归一化到合并目标，且上游条目不再被列为上游独有模型", async () => {
    mockSelect(
      [
        {
          id: 414,
          modelName: "Claude Fable 5",
          sourceModelId: null,
          providerName: "Anthropic",
          providerSlug: "anthropic",
          providerConfig: {}
        }
      ],
      [storedMapping],
      [{ id: 184, mergedIntoModelId: 414 }]
    );

    const snapshot = await getArtificialAnalysisAdminSnapshot();

    expect(snapshot.mappings).toHaveLength(1);
    expect(snapshot.mappings[0]).toEqual(
      expect.objectContaining({
        modelId: 414,
        externalModelId: "aa-fable",
        manualOverride: true,
        isNewMatch: false
      })
    );
    expect(snapshot.upstreamOnly).toEqual([]);
  });

  test("残留映射未命中自动匹配时，上游条目也不会被误列为上游独有模型", async () => {
    mockSelect(
      [
        {
          id: 414,
          modelName: "Local Model Z",
          sourceModelId: null,
          providerName: "Anthropic",
          providerSlug: "anthropic",
          providerConfig: {}
        }
      ],
      [{ ...storedMapping, matchStatus: "matched", manualOverride: false }],
      [{ id: 184, mergedIntoModelId: 414 }]
    );

    const snapshot = await getArtificialAnalysisAdminSnapshot();

    expect(snapshot.mappings[0]?.externalModelId).toBeNull();
    expect(snapshot.upstreamOnly).toEqual([]);
  });
});
