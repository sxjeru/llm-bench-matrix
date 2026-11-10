import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/dashboard/route";
import { GET as GET_PLAIN } from "@/app/api/public/dashboard/plain/route";
import {
  PUBLIC_CACHE_CONTROL_BROWSER,
  PUBLIC_CACHE_CONTROL_CDN,
  PUBLIC_CACHE_CONTROL_VERCEL
} from "@/app/api/public/cache-headers";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import {
  PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION,
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

const DASHBOARD_URL = "https://example.com/api/public/dashboard";
const PLAIN_URL = "https://example.com/api/public/dashboard/plain";
const IDENTITY_ETAG = `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}:dashboard-version:pricing-version:settings-version:identity"`;
// 线上旧副本用的 br 变体 ETag（无 :identity 后缀）
const LEGACY_BR_ETAG = `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}:dashboard-version:pricing-version:settings-version"`;

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
    // 只提供库里真正存的 payloadBr，明文通过惰性 getter 解压，
    // 与线上「数据库出站只有压缩字节」保持一致。
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockResolvedValue({
      key: `default:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION}`,
      etag: IDENTITY_ETAG,
      dashboardVersion: SNAPSHOT.versions.dashboard,
      pricingVersion: SNAPSHOT.versions.pricing,
      settingsVersion: SNAPSHOT.versions.settings,
      payloadBr: PAYLOAD_BR,
      get payloadJson() {
        return brotliDecompressSync(PAYLOAD_BR).toString("utf8");
      },
      updatedAt: new Date()
    });
  });

  test("返回完整快照、缓存头和版本号", async () => {
    const response = await GET(new Request(DASHBOARD_URL, {
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
    expect(response.headers.get("ETag")).toBe(IDENTITY_ETAG);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("X-Payload-Encoding")).toBe("identity");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  });

  test("客户端支持 br 时也只发明文，压缩交给平台做一次", async () => {
    const response = await GET(new Request(DASHBOARD_URL, {
      headers: { "Accept-Encoding": "gzip, deflate, br" }
    }));

    // 早先把 payload_br 直接当 body 并声明 Content-Encoding: br，
    // 被边缘又压一层后浏览器解一层仍是二进制，response.json() 直接抛错。
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("X-Payload-Encoding")).toBe("identity");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("ETag")).toBe(IDENTITY_ETAG);
    expect(await response.text()).toBe(PAYLOAD_JSON);
  });

  test("缺少 Accept-Encoding 时也返回可解析的明文 JSON", async () => {
    const response = await GET(new Request(DASHBOARD_URL));

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
  });

  test("Vercel 环境下同样只发明文并声明 Vary，不依赖入站 Accept-Encoding", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const response = await GET(new Request(DASHBOARD_URL, {
        headers: { "Accept-Encoding": "gzip, deflate" }
      }));

      expect(response.headers.get("Content-Encoding")).toBeNull();
      expect(response.headers.get("Vary")).toBe("Accept-Encoding");
      expect(response.headers.get("CDN-Cache-Control")).toBe(PUBLIC_CACHE_CONTROL_CDN);
      expect(response.headers.get("CDN-Cache-Control")).not.toContain("no-transform");
      expect(await response.text()).toBe(PAYLOAD_JSON);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("明文端点返回未压缩 JSON，且不进入公共缓存", async () => {
    const response = await GET_PLAIN(new Request(PLAIN_URL, {
      headers: { "Accept-Encoding": "br" }
    }));

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("X-Payload-Encoding")).toBe("identity");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vary")).toBeNull();
    expect(response.headers.get("ETag")).toBe(IDENTITY_ETAG);
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
  });

  test("旧的 br 变体 ETag 不会命中 304，避免复用压缩副本", async () => {
    const response = await GET(new Request(DASHBOARD_URL, {
      headers: { "If-None-Match": LEGACY_BR_ETAG }
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(IDENTITY_ETAG);
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
  });

  test("边缘允许缓存，并带 stale-while-revalidate 兜住源站慢/冷启动", async () => {
    const response = await GET(new Request(DASHBOARD_URL));
    const cdn = response.headers.get("CDN-Cache-Control") ?? "";

    // 回归保护：曾经是 s-maxage=0，等于每个访客都要打到函数（冷启动 1.4–2.4 s）
    expect(cdn).not.toMatch(/(?:^|[,;\s])s-maxage=0(?:[,;\s]|$)/);
    expect(cdn).toMatch(/s-maxage=\d+/);
    expect(cdn).toContain("stale-while-revalidate=");
    expect(response.headers.get("Cache-Control")).toContain("stale-while-revalidate=");
  });

  test("If-None-Match 命中时返回 304 且不加载快照", async () => {
    const first = await GET(new Request(DASHBOARD_URL));
    const etag = first.headers.get("ETag");
    vi.mocked(getOrBuildPublicDashboardSnapshotRecord).mockClear();

    const response = await GET(new Request(DASHBOARD_URL, {
      headers: { "If-None-Match": etag ?? "" }
    }));

    expect(response.status).toBe(304);
    expect(getOrBuildPublicDashboardSnapshotRecord).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("ETag")).toBe(IDENTITY_ETAG);
  });

  test.each([
    '"dashboard:dashboard-version:pricing-version:settings-version"',
    `"dashboard:v${PUBLIC_DASHBOARD_SNAPSHOT_FORMAT_VERSION - 1}:dashboard-version:pricing-version:settings-version"`
  ])("旧格式 ETag %s 不返回 304，即使业务数据版本未变", async (oldEtag) => {
    const response = await GET(new Request(DASHBOARD_URL, {
      headers: { "Accept-Encoding": "gzip", "If-None-Match": oldEtag }
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).not.toBe(oldEtag);
    expect(decodePublicDashboardSnapshot(await response.json())).toEqual(SNAPSHOT);
    expect(getOrBuildPublicDashboardSnapshotRecord).toHaveBeenCalledTimes(1);
  });

  test("限流响应明确不进入公共缓存", async () => {
    let response = await GET(new Request(DASHBOARD_URL, {
      headers: { "x-forwarded-for": "203.0.113.430" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request(DASHBOARD_URL, {
        headers: { "x-forwarded-for": "203.0.113.430" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });
});
