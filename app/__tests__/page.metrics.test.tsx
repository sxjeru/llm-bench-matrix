import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import HomePage, { revalidate } from "@/app/page";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";

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
  getSourceOptions: vi.fn(async () => ["text:only", "text:another"])
}));

describe("HomePage metrics", () => {
  test("首页使用 60 秒重新验证", () => {
    expect(revalidate).toBe(60);
  });

  test("统计卡片使用聚合统计结果而非 rows 子集", async () => {
    const page = await HomePage();
    render(page);

    expect(screen.getByText("Providers").parentElement).toHaveTextContent("9");
    expect(screen.getByText("Models").parentElement).toHaveTextContent("18");
    expect(screen.getByText("Benchmarks").parentElement).toHaveTextContent("27");
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("36");
  });

  test("首页读取全量矩阵数据，source 筛选交给客户端处理", async () => {
    await HomePage();

    expect(vi.mocked(getDashboardRows)).toHaveBeenCalledWith(null, null);
    expect(vi.mocked(getDashboardStats)).toHaveBeenCalledWith(null);
    expect(vi.mocked(getSourceOptions)).toHaveBeenCalled();
  });
});
