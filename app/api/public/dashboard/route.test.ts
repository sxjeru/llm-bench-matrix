import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/route";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import { decodePublicDashboardSnapshot } from "@/lib/dashboard-snapshot-cache";
import { getPublicDashboardSnapshotVersions, loadPublicDashboardSnapshot } from "@/lib/dashboard-snapshot";

vi.mock("@/lib/dashboard-snapshot", () => ({
  getPublicDashboardSnapshotVersions: vi.fn(async () => ({
    dashboard: "dashboard-version",
    pricing: "pricing-version",
    settings: "settings-version"
  })),
  loadPublicDashboardSnapshot: vi.fn()
}));

const ROWS: MatrixInputRow[] = [
  {
    recordId: 1,
    providerName: "openai",
    modelName: "GPT-5",
    benchmarkName: "MMLU",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "88.1",
    valueNum: 88.1
  },
  {
    recordId: 2,
    providerName: "anthropic",
    modelName: "Claude",
    benchmarkName: "MMLU",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "N/A",
    valueNum: null
  }
];

const SNAPSHOT = {
  versions: {
    dashboard: "dashboard-version",
    pricing: "pricing-version",
    settings: "settings-version"
  },
  rows: ROWS,
  sourceOptions: [],
  stats: {
    providerCount: 1,
    modelCount: 2,
    benchmarkCount: 3,
    totalRecords: 4
  },
  modelPrices: [],
  modelParams: [],
  exportFootnoteAlign: "center" as const
};

describe("GET /api/public/dashboard", () => {
  beforeEach(() => {
    vi.mocked(getPublicDashboardSnapshotVersions).mockReset();
    vi.mocked(loadPublicDashboardSnapshot).mockReset();
    vi.mocked(getPublicDashboardSnapshotVersions).mockResolvedValue({
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    });
    vi.mocked(loadPublicDashboardSnapshot).mockResolvedValue(SNAPSHOT);
  });

  test("返回完整快照、缓存头和版本号", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard"));
    const payload = await response.json();

    expect(getPublicDashboardSnapshotVersions).toHaveBeenCalledTimes(1);
    expect(loadPublicDashboardSnapshot).toHaveBeenCalledWith({
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    });
    // 载荷必须是列式编码而非行式：rows 被拆成 rowCount + columns
    expect(payload).not.toHaveProperty("rows");
    expect(payload.rowCount).toBe(2);
    expect(Object.keys(payload.columns).sort()).toEqual([
      "benchTime",
      "benchmarkName",
      "benchmarkType",
      "modelName",
      "providerName",
      "recordId",
      "valueNum",
      "valueRaw"
    ]);
    expect(decodePublicDashboardSnapshot(payload)).toEqual(SNAPSHOT);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(response.headers.get("X-Dashboard-Version")).toBe("dashboard-version");
    expect(response.headers.get("X-Pricing-Version")).toBe("pricing-version");
    expect(response.headers.get("X-Settings-Version")).toBe("settings-version");
    expect(response.headers.get("ETag")).toBe(
      '"dashboard:dashboard-version:pricing-version:settings-version"'
    );
  });

  test("If-None-Match 命中时返回 304 且不加载快照", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard"));
    const etag = first.headers.get("ETag");
    vi.mocked(loadPublicDashboardSnapshot).mockClear();

    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(loadPublicDashboardSnapshot).not.toHaveBeenCalled();
  });

  test("限流响应明确不进入公共缓存", async () => {
    let response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "x-forwarded-for": "203.0.113.430" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request("https://example.com/api/public/dashboard", {
        headers: { "x-forwarded-for": "203.0.113.430" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });
});
