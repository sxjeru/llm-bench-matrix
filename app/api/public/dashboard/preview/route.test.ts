import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/preview/route";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL
} from "@/app/api/public/cache-headers";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import {
  PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION,
  createPublicDashboardSnapshotEtag,
  decodePublicDashboardSnapshot,
  encodePublicDashboardSnapshot
} from "@/lib/dashboard-snapshot-cache";
import { DASHBOARD_PREVIEW_FORMAT_VERSION } from "@/lib/dashboard-preview";
import { getPublicDashboardSnapshotVersions } from "@/lib/dashboard-snapshot";
import { getOrBuildPublicDashboardSnapshotRecord } from "@/lib/dashboard-snapshot-store";

vi.mock("@/lib/dashboard-snapshot", () => ({
  getPublicDashboardSnapshotVersions: vi.fn(async () => ({
    dashboard: "dashboard-version",
    pricing: "pricing-version",
    settings: "settings-version"
  }))
}));

vi.mock("@/lib/dashboard-snapshot-store", () => ({
  getOrBuildPublicDashboardSnapshotRecord: vi.fn()
}));

const VERSIONS = {
  dashboard: "dashboard-version",
  pricing: "pricing-version",
  settings: "settings-version"
};

function makeRows(): MatrixInputRow[] {
  const rows: MatrixInputRow[] = [];
  for (let modelIndex = 0; modelIndex < 4; modelIndex += 1) {
    for (let benchmarkIndex = 0; benchmarkIndex < 3; benchmarkIndex += 1) {
      rows.push({
        recordId: modelIndex * 10 + benchmarkIndex + 1,
        providerName: "openai",
        modelName: `Model ${modelIndex}`,
        benchmarkName: `Bench ${benchmarkIndex}`,
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: String(80 + benchmarkIndex),
        valueNum: 80 + benchmarkIndex
      });
    }
  }
  return rows;
}

const SNAPSHOT = {
  versions: VERSIONS,
  rows: makeRows(),
  sourceOptions: [],
  stats: { providerCount: 1, modelCount: 4, benchmarkCount: 3, totalRecords: 12 },
  modelPrices: [],
  modelParams: [],
  exportFootnoteAlign: "center" as const
};

describe("GET /api/public/dashboard/preview", () => {
  beforeEach(() => {
    vi.mocked(getPublicDashboardSnapshotVersions).mockReset();
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockReset();
    vi.mocked(getPublicDashboardSnapshotVersions).mockResolvedValue(VERSIONS);
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockResolvedValue({
      key: `default:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}`,
      etag: createPublicDashboardSnapshotEtag(VERSIONS),
      dashboardVersion: VERSIONS.dashboard,
      pricingVersion: VERSIONS.pricing,
      settingsVersion: VERSIONS.settings,
      payloadJson: JSON.stringify(encodePublicDashboardSnapshot(SNAPSHOT)),
      updatedAt: new Date()
    });
  });

  test("返回可缓存、带预览标记的裁剪快照", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard/preview"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_BROWSER);
    expect(response.headers.get("CDN-Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_CDN);
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_VERCEL);
    expect(response.headers.get("X-Dashboard-Preview")).toBe("1");
    expect(response.headers.get("ETag")).toContain(`dashboard-preview:v${DASHBOARD_PREVIEW_FORMAT_VERSION}:`);

    // 载荷仍是列式编码，且能还原成快照形状（客户端走同一条 decode 路径）
    expect(payload).not.toHaveProperty("rows");
    const decoded = decodePublicDashboardSnapshot(payload);
    expect(decoded.rows.length).toBeLessThanOrEqual(SNAPSHOT.rows.length);
    expect(decoded.versions).toEqual(VERSIONS);
    expect(decoded.stats).toEqual(SNAPSHOT.stats);
  });

  test("ETag 命中时返回 304 且不重建预览", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard/preview"));
    const etag = first.headers.get("ETag");
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockClear();

    const response = await GET(new Request("https://example.com/api/public/dashboard/preview", {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(getOrBuildPublicDashboardSnapshotRecord).not.toHaveBeenCalled();
  });

  test("限流响应不进入公共缓存", async () => {
    let response = await GET(new Request("https://example.com/api/public/dashboard/preview", {
      headers: { "x-forwarded-for": "203.0.113.499" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request("https://example.com/api/public/dashboard/preview", {
        headers: { "x-forwarded-for": "203.0.113.499" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
  });
});
