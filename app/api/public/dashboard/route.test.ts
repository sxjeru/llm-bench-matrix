import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/route";
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

const PAYLOAD_JSON = JSON.stringify(encodePublicDashboardSnapshot(SNAPSHOT));
const PAYLOAD_BR = brotliCompressSync(Buffer.from(PAYLOAD_JSON, "utf8"));

describe("GET /api/public/dashboard", () => {
  beforeEach(() => {
    vi.mocked(getPublicDashboardSnapshotVersions).mockReset();
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockReset();
    vi.mocked(getPublicDashboardSnapshotVersions).mockResolvedValue({
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    });
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockResolvedValue({
      key: `default:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}`,
      etag: createPublicDashboardSnapshotEtag(SNAPSHOT.versions),
      dashboardVersion: SNAPSHOT.versions.dashboard,
      pricingVersion: SNAPSHOT.versions.pricing,
      settingsVersion: SNAPSHOT.versions.settings,
      payloadBr: PAYLOAD_BR,
      payloadJson: PAYLOAD_JSON,
      updatedAt: new Date()
    });
  });

  test("返回完整快照、缓存头和版本号", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "Accept-Encoding": "gzip" }
    }));
    const payload = await response.json();

    expect(getPublicDashboardSnapshotVersions).toHaveBeenCalledTimes(1);
    expect(getOrBuildPublicDashboardSnapshotRecord).toHaveBeenCalledWith({
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
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_BROWSER);
    expect(response.headers.get("CDN-Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_CDN);
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_VERCEL);
    expect(response.headers.get("X-Dashboard-Version")).toBe("dashboard-version");
    expect(response.headers.get("X-Pricing-Version")).toBe("pricing-version");
    expect(response.headers.get("X-Settings-Version")).toBe("settings-version");
    expect(response.headers.get("ETag")).toBe(
      `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}:dashboard-version:pricing-version:settings-version"`
    );
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  test("客户端支持 br 时下发预压缩字节，避免源站重复压缩", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "Accept-Encoding": "gzip, deflate, br" }
    }));

    expect(response.headers.get("Content-Encoding")).toBe("br");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("X-Payload-Encoding")).toBe("br");
    expect(response.headers.get("Content-Length")).toBe(String(PAYLOAD_BR.byteLength));
    expect(response.headers.get("ETag")).toBe(
      `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}:dashboard-version:pricing-version:settings-version"`
    );

    const body = brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    expect(decodePublicDashboardSnapshot(JSON.parse(body))).toEqual(SNAPSHOT);
  });

  test("缺少 Accept-Encoding 时仍下发预压缩字节（Vercel 边缘会剥离该头）", async () => {
    // 回归保护：按「缺失 = 不支持」处理会让预压缩分支永远不命中，
    // 线上退回平台动态压缩（485 KB 而非 400 KB）。
    const response = await GET(new Request("https://example.com/api/public/dashboard"));

    expect(response.headers.get("Content-Encoding")).toBe("br");
    expect(response.headers.get("X-Payload-Encoding")).toBe("br");
    expect(response.headers.get("Content-Length")).toBe(String(PAYLOAD_BR.byteLength));
    expect(decodePublicDashboardSnapshot(
      JSON.parse(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString("utf8"))
    )).toEqual(SNAPSHOT);
  });

  test("明确拒绝 br（q=0）时退回未压缩 JSON", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "Accept-Encoding": "br;q=0, gzip" }
    }));

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("X-Payload-Encoding")).toBe("identity");
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
  });

  test("边缘允许缓存，并带 stale-while-revalidate 兜住源站慢/冷启动", async () => {
    const response = await GET(new Request("https://example.com/api/public/dashboard"));
    const cdn = response.headers.get("CDN-Cache-Control") ?? "";

    // 回归保护：曾经是 s-maxage=0，等于每个访客都要打到函数（冷启动 1.4–2.4 s）
    expect(cdn).not.toMatch(/(?:^|[,;\s])s-maxage=0(?:[,;\s]|$)/);
    expect(cdn).toMatch(/s-maxage=\d+/);
    expect(cdn).toContain("stale-while-revalidate=");
    expect(response.headers.get("Cache-Control")).toContain("stale-while-revalidate=");
  });

  test("If-None-Match 命中时返回 304 且不加载快照", async () => {
    const first = await GET(new Request("https://example.com/api/public/dashboard"));
    const etag = first.headers.get("ETag");
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockClear();

    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(getOrBuildPublicDashboardSnapshotRecord).not.toHaveBeenCalled();
  });

  test.each([
    '"dashboard:dashboard-version:pricing-version:settings-version"',
    `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION - 1}:dashboard-version:pricing-version:settings-version"`
  ])("旧格式 ETag %s 不返回 304，即使业务数据版本未变", async (oldEtag) => {
    const response = await GET(new Request("https://example.com/api/public/dashboard", {
      headers: { "Accept-Encoding": "gzip", "If-None-Match": oldEtag }
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).not.toBe(oldEtag);
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
    expect(getOrBuildPublicDashboardSnapshotRecord).toHaveBeenCalledTimes(1);
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
