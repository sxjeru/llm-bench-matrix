import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import HomePage from "@/app/page";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";

vi.mock("@/components/benchmark-matrix", () => ({
  BenchmarkMatrix: () => <div data-testid="benchmark-matrix" />
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
  test("统计卡片使用聚合统计结果而非 rows 子集", async () => {
    const page = await HomePage({ searchParams: {} });
    render(page);

    expect(screen.getByText("Providers").parentElement).toHaveTextContent("9");
    expect(screen.getByText("Models").parentElement).toHaveTextContent("18");
    expect(screen.getByText("Benchmarks").parentElement).toHaveTextContent("27");
    expect(screen.getByText("总记录").parentElement).toHaveTextContent("36");
  });

  test("source 参数透传 rows 查询，stats 固定全量查询", async () => {
    await HomePage({ searchParams: { source: "text:Qwen3.5-27B" } });

    expect(vi.mocked(getDashboardRows)).toHaveBeenCalledWith(null, "text:Qwen3.5-27B");
    expect(vi.mocked(getDashboardRows)).toHaveBeenCalledWith(null, null);
    expect(vi.mocked(getDashboardStats)).toHaveBeenCalledWith(null);
    expect(vi.mocked(getSourceOptions)).toHaveBeenCalled();
  });
});
