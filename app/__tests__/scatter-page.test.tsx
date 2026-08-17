import { describe, expect, test, vi } from "vitest";

import PublicDashboardLayout from "@/app/(public)/layout";
import ScatterPage, { revalidate } from "@/app/(public)/scatter/page";
import { getDashboardRows, getModelParamsRows, getSourceOptions } from "@/lib/db/queries";

vi.mock("@/components/model-scatter", () => ({
  ModelScatter: () => <div data-testid="model-scatter" />
}));

vi.mock("@/components/benchmark-matrix/map-row", () => ({
  toMatrixInputRow: vi.fn((row: unknown) => row)
}));

vi.mock("@/lib/model-pricing", () => ({
  getModelPricingRows: vi.fn(async () => [])
}));

vi.mock("@/lib/db/queries", () => ({
  getDashboardRows: vi.fn(async () => []),
  getSourceOptions: vi.fn(async () => ["text:only"]),
  getModelParamsRows: vi.fn(async () => []),
  getDashboardStats: vi.fn(async () => ({
    providerCount: 0,
    modelCount: 0,
    benchmarkCount: 0,
    totalRecords: 0
  })),
  getSettings: vi.fn(async () => ({}))
}));

describe("ScatterPage", () => {
  test("使用按需重新验证", () => {
    expect(revalidate).toBe(false);
  });

  test("公开布局读取全量矩阵数据，source 筛选交给客户端处理", async () => {
    await PublicDashboardLayout({ children: <ScatterPage /> });

    expect(vi.mocked(getDashboardRows)).toHaveBeenCalledWith(null, null, undefined);
    expect(vi.mocked(getSourceOptions)).toHaveBeenCalled();
    expect(vi.mocked(getModelParamsRows)).toHaveBeenCalled();
  });
});
