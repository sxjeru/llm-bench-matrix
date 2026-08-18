import { isValidElement, type ReactElement, type ReactNode } from "react";
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

  test("公开布局不再服务端读取矩阵数据", () => {
    const layout = PublicDashboardLayout({ children: <ScatterPage /> });

    expect(layout).toBeTruthy();
    expect(vi.mocked(getDashboardRows)).not.toHaveBeenCalled();
    expect(vi.mocked(getSourceOptions)).not.toHaveBeenCalled();
    expect(vi.mocked(getModelParamsRows)).not.toHaveBeenCalled();
  });

  test("散点页只保留 SEO 文案，图表由 layout keep-alive 挂载", () => {
    const page = ScatterPage();
    const layout = PublicDashboardLayout({ children: <ScatterPage /> }) as ReactElement<{ children?: ReactNode }>;

    expect(isValidElement(page)).toBe(true);
    expect((page as ReactElement).type).toBe("section");
    expect(layout.type).toBeDefined();
    expect((layout.props.children as ReactElement).type).toEqual(expect.any(Function));
    expect(((layout.props.children as ReactElement).type as { name?: string }).name).toBe("PublicDashboardKeepAlive");
  });
});
