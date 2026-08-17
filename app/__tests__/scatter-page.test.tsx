import { describe, expect, test, vi } from "vitest";

import ScatterPage, { revalidate } from "@/app/scatter/page";
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
  getModelParamsRows: vi.fn(async () => [])
}));

describe("ScatterPage", () => {
  test("使用按需重新验证", () => {
    expect(revalidate).toBe(false);
  });

  test("读取全量矩阵数据，source 筛选交给客户端处理", async () => {
    await ScatterPage();

    expect(vi.mocked(getDashboardRows)).toHaveBeenCalledWith(null, null);
    expect(vi.mocked(getSourceOptions)).toHaveBeenCalled();
    expect(vi.mocked(getModelParamsRows)).toHaveBeenCalled();
  });
});
