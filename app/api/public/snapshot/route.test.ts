import { createHash } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/snapshot/route";
import { getCacheVersion } from "@/lib/cache-versions";
import { loadPublicDashboardSnapshot } from "@/lib/dashboard-snapshot";

vi.mock("@/lib/cache-versions", () => ({
  getCacheVersion: vi.fn()
}));

vi.mock("@/lib/dashboard-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dashboard-snapshot")>("@/lib/dashboard-snapshot");
  return {
    ...actual,
    loadPublicDashboardSnapshot: vi.fn()
  };
});

function createSnapshotEtag(dashboardVersion: string, pricingVersion: string, settingsVersion: string) {
  const hash = createHash("sha1")
    .update(`snapshot:${dashboardVersion}:${pricingVersion}:${settingsVersion}`)
    .digest("hex")
    .slice(0, 16);

  return `"snapshot:${dashboardVersion}:${pricingVersion}:${settingsVersion}:${hash}"`;
}

const EMPTY_SNAPSHOT = {
  rows: [],
  sourceOptions: [],
  stats: {
    providerCount: 9,
    modelCount: 18,
    benchmarkCount: 27,
    totalRecords: 36
  },
  modelPrices: [],
  modelParams: [],
  exportFootnoteAlign: "center" as const
};

describe("GET /api/public/snapshot", () => {
  beforeEach(() => {
    vi.mocked(getCacheVersion).mockReset();
    vi.mocked(loadPublicDashboardSnapshot).mockReset();
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => `${domain}-version`);
    vi.mocked(loadPublicDashboardSnapshot).mockResolvedValue(EMPTY_SNAPSHOT);
  });

  test("返回缓存头、版本号和独立于 rows 的聚合统计", async () => {
    const response = await GET(new Request("https://example.com/api/public/snapshot"));
    const payload = await response.json();

    expect(getCacheVersion).toHaveBeenCalledWith("dashboard");
    expect(getCacheVersion).toHaveBeenCalledWith("pricing");
    expect(getCacheVersion).toHaveBeenCalledWith("settings");
    expect(loadPublicDashboardSnapshot).toHaveBeenCalledWith({
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(response.headers.get("X-Dashboard-Version")).toBe("dashboard-version");
    expect(response.headers.get("X-Pricing-Version")).toBe("pricing-version");
    expect(response.headers.get("X-Settings-Version")).toBe("settings-version");
    expect(response.headers.get("ETag")).toBe(createSnapshotEtag("dashboard-version", "pricing-version", "settings-version"));
    expect(payload.stats).toEqual(EMPTY_SNAPSHOT.stats);
    expect(payload.rows).toEqual([]);
  });

  test("If-None-Match 命中时返回 304 且不加载快照", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => {
      if (domain === "dashboard") return "v-test-1";
      if (domain === "pricing") return "p-test-1";
      return "s-test-1";
    });
    const etag = createSnapshotEtag("v-test-1", "p-test-1", "s-test-1");

    const response = await GET(new Request("https://example.com/api/public/snapshot", {
      headers: { "If-None-Match": etag }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
    expect(loadPublicDashboardSnapshot).not.toHaveBeenCalled();
  });

  test("限流响应明确不进入公共缓存", async () => {
    let response = await GET(new Request("https://example.com/api/public/snapshot", {
      headers: { "x-forwarded-for": "203.0.113.430" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request("https://example.com/api/public/snapshot", {
        headers: { "x-forwarded-for": "203.0.113.430" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
  });
});
