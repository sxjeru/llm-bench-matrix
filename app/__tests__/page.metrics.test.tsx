import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import PublicDashboardLayout from "@/app/(public)/layout";
import HomePage, { revalidate } from "@/app/(public)/page";
import { DashboardProvider } from "@/components/dashboard-provider";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";
import { getPublicDashboardSnapshotCacheKey, type PublicDashboardSnapshot } from "@/lib/dashboard-snapshot-cache";

vi.mock("@/components/benchmark-matrix", () => ({
  BenchmarkMatrix: () => <div data-testid="benchmark-matrix" />
}));

vi.mock("@/lib/model-pricing", () => ({
  getModelPricingRows: vi.fn(async () => [])
}));

vi.mock("@/lib/db/queries", () => ({
  getDashboardRows: vi.fn(async () => [
    {
      id: 1,
      providerName: "OnlyOneProviderInRows",
      modelName: "OnlyOneModelInRows",
      benchmarkName: "OnlyOneBenchmarkInRows",
      benchmarkType: "General",
      higherIsBetter: true,
      benchmarkCanonicalKey: "only-one-benchmark-in-rows:general",
      modalities: ["Text"],
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "70.1",
      valueNum: 70.1,
      valueNum2: null,
      valueNote: null,
      source: "text:only"
    }
  ]),
  getDashboardStats: vi.fn(async () => ({
    providerCount: 9,
    modelCount: 18,
    benchmarkCount: 27,
    totalRecords: 36
  })),
  getSourceOptions: vi.fn(async () => ["text:only", "text:another"]),
  getModelParamsRows: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({}))
}));

const SNAPSHOT_STATS: PublicDashboardSnapshot["stats"] = {
  providerCount: 9,
  modelCount: 18,
  benchmarkCount: 27,
  totalRecords: 36
};

function createSnapshot(overrides: Partial<PublicDashboardSnapshot> = {}): PublicDashboardSnapshot {
  return {
    versions: {
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    },
    rows: [],
    sourceOptions: ["text:only", "text:another"],
    stats: SNAPSHOT_STATS,
    modelPrices: [],
    modelParams: [],
    exportFootnoteAlign: "center",
    ...overrides
  };
}

describe("HomePage metrics", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  test("首页使用按需重新验证", () => {
    expect(revalidate).toBe(false);
  });

  test("统计卡片使用本地缓存的聚合统计结果而非 rows 子集", async () => {
    window.localStorage.setItem(getPublicDashboardSnapshotCacheKey(), JSON.stringify(createSnapshot()));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));

    render(
      <DashboardProvider>
        <HomePage />
      </DashboardProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Providers").parentElement).toHaveTextContent("9");
    });
    expect(screen.getByText("Models").parentElement).toHaveTextContent("18");
    expect(screen.getByText("Benchmarks").parentElement).toHaveTextContent("27");
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("36");
  });

  test("公开布局不再服务端读取矩阵数据", () => {
    const layout = PublicDashboardLayout({ children: <div /> });

    expect(layout).toBeTruthy();
    expect(vi.mocked(getDashboardRows)).not.toHaveBeenCalled();
    expect(vi.mocked(getDashboardStats)).not.toHaveBeenCalled();
    expect(vi.mocked(getSourceOptions)).not.toHaveBeenCalled();
  });
});
