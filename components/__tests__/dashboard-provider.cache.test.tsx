import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DashboardProvider } from "@/components/dashboard-provider";
import { HomeBenchmarkMatrix } from "@/components/home-benchmark-matrix";
import { getPublicDashboardSnapshotCacheKey, type PublicDashboardSnapshot } from "@/lib/dashboard-snapshot-cache";

vi.mock("@/components/benchmark-matrix", () => ({
  BenchmarkMatrix: () => <div data-testid="benchmark-matrix" />
}));

const SNAPSHOT: PublicDashboardSnapshot = {
  versions: {
    dashboard: "dashboard-version",
    pricing: "pricing-version",
    settings: "settings-version"
  },
  rows: [],
  sourceOptions: ["text:only"],
  stats: {
    providerCount: 1,
    modelCount: 2,
    benchmarkCount: 3,
    totalRecords: 4
  },
  modelPrices: [],
  modelParams: [],
  exportFootnoteAlign: "center"
};

describe("DashboardProvider local snapshot cache", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  test("本地缓存命中时先渲染矩阵，并用完整 ETag 复检", async () => {
    window.localStorage.setItem(getPublicDashboardSnapshotCacheKey(), JSON.stringify(SNAPSHOT));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/public/dashboard");
      expect(new Headers(init?.headers).get("If-None-Match")).toBe(
        '"dashboard:dashboard-version:pricing-version:settings-version"'
      );
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("无本地缓存时先显示加载态，再写入缓存", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SNAPSHOT), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DashboardProvider>
        <HomeBenchmarkMatrix />
      </DashboardProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载矩阵数据");
    await waitFor(() => {
      expect(screen.getByTestId("benchmark-matrix")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(getPublicDashboardSnapshotCacheKey())).toContain("dashboard-version");
  });
});
