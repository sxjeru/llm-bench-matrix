import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { isValidElement, type ReactElement, type ReactNode } from "react";

import PublicDashboardLayout from "@/app/(public)/layout";
import HomePage, { revalidate } from "@/app/(public)/page";
import { DashboardProvider } from "@/components/dashboard-provider";
import { HomeMetrics } from "@/components/home-metrics";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";
import {
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshot
} from "@/lib/dashboard-snapshot-cache";

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

/**
 * 指标卡与矩阵各走一个端点，mock 必须按 URL 分派，
 * 否则统计那一路会误命中完整快照的载荷。
 */
function stubFetchByRoute(snapshot: PublicDashboardSnapshot) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "/api/public/dashboard/stats") {
      return Response.json({ stats: snapshot.stats });
    }

    if (url === "/api/public/dashboard") {
      return Response.json(encodePublicDashboardSnapshot(snapshot));
    }

    throw new Error(`unexpected fetch: ${url}`);
  }));
}

describe("HomePage metrics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("首页使用按需重新验证", () => {
    expect(revalidate).toBe(false);
  });

  test("统计卡片使用聚合统计结果而非 rows 子集", async () => {
    stubFetchByRoute(createSnapshot());

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

  test("首页不再内嵌矩阵，改由公开布局 keep-alive 挂载", () => {
    const page = HomePage() as ReactElement<{ children?: ReactNode }>;
    const children = Array.isArray(page.props.children) ? page.props.children : [page.props.children];
    const layout = PublicDashboardLayout({ children: <div /> }) as ReactElement<{ children?: ReactNode }>;

    expect(children.some((child) => isValidElement(child) && child.type === HomeMetrics)).toBe(true);
    expect(children.every((child) => !isValidElement(child) || child.type === HomeMetrics || child.type === "section")).toBe(true);
    expect((layout.props.children as ReactElement).type).toEqual(expect.any(Function));
    expect(((layout.props.children as ReactElement).type as { name?: string }).name).toBe("PublicDashboardKeepAlive");
  });
});
