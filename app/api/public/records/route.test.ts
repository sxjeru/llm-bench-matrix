import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/public/records/route";
import { getDashboardRows } from "@/lib/db/queries";
import { getCacheVersion } from "@/lib/cache-versions";

vi.mock("@/lib/db/queries", () => ({
  getDashboardRows: vi.fn()
}));

vi.mock("@/lib/cache-versions", () => ({
  getCacheVersion: vi.fn()
}));

describe("GET /api/public/records", () => {
  beforeEach(() => {
    vi.mocked(getDashboardRows).mockReset();
    vi.mocked(getCacheVersion).mockReset();
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => `${domain}-version`);
  });

  test("默认 limit=300，并返回缓存头和版本号", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    const response = await GET(new Request("https://example.com/api/public/records"));

    expect(getCacheVersion).toHaveBeenCalledWith("dashboard");
    expect(getCacheVersion).toHaveBeenCalledWith("pricing");
    expect(getDashboardRows).toHaveBeenCalledWith(300, null, "dashboard-version");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(response.headers.get("X-Dashboard-Version")).toBe("dashboard-version");
    expect(response.headers.get("X-Pricing-Version")).toBe("pricing-version");
    expect(response.headers.get("ETag")).toBe('"records:dashboard-version:pricing-version:limit:300:f23a4e48f80ed64c"');
  });

  test("limit 会被限制到 1000", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    await GET(new Request("https://example.com/api/public/records?limit=99999"));

    expect(getDashboardRows).toHaveBeenCalledWith(1000, null, "dashboard-version");
  });

  test("limit 会收敛到固定缓存档位并按请求值裁剪", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([
      {
        id: 1,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        providerEntityId: 1,
        modelName: "GPT-5",
        benchmarkName: "MMLU-Pro",
        benchmarkType: "Knowledge",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "mmlu-pro:knowledge",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-05-01T00:00:00.000Z",
        valueRaw: "70.1",
        valueNum: 70.1,
        valueNum2: null,
        valueNote: null,
        source: "text:only",
        updatedAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: 2,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        providerEntityId: 1,
        modelName: "GPT-5",
        benchmarkName: "GPQA",
        benchmarkType: "Knowledge",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "gpqa:knowledge",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-05-02T00:00:00.000Z",
        valueRaw: "60.2",
        valueNum: 60.2,
        valueNum2: null,
        valueNote: null,
        source: "text:only",
        updatedAt: "2026-05-02T00:00:00.000Z"
      },
      {
        id: 3,
        providerName: "OpenAI",
        providerDisplayName: "OpenAI",
        providerBrandColor: null,
        providerEntityId: 1,
        modelName: "GPT-5",
        benchmarkName: "AIME",
        benchmarkType: "Math",
        sourceBenchmarkType: null,
        higherIsBetter: true,
        benchmarkCanonicalKey: "aime:math",
        modalities: ["Text"],
        sourceModalities: null,
        benchTime: "2026-05-03T00:00:00.000Z",
        valueRaw: "80.3",
        valueNum: 80.3,
        valueNum2: null,
        valueNote: null,
        source: "text:only",
        updatedAt: "2026-05-03T00:00:00.000Z"
      }
    ] as Awaited<ReturnType<typeof getDashboardRows>>);

    const response = await GET(new Request("https://example.com/api/public/records?limit=2"));
    const payload = await response.json();

    expect(getDashboardRows).toHaveBeenCalledWith(100, null, "dashboard-version");
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0]).toMatchObject({
      recordId: 1,
      providerName: "OpenAI",
      modelName: "GPT-5",
      benchmarkName: "MMLU-Pro",
      valueNum: 70.1,
      source: "text:only"
    });
    expect(payload.rows[0]).not.toHaveProperty("providerEntityId");
    expect(payload.rows[0]).not.toHaveProperty("valueNote");
    expect(payload.rows[0]).not.toHaveProperty("higherIsBetter");
    expect(payload.rows[0]).not.toHaveProperty("providerDisplayName");
    expect(response.headers.get("ETag")).toBe('"records:dashboard-version:pricing-version:limit:2:730ad87362fcc123"');
  });

  test("If-None-Match 命中时返回 304", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => domain === "dashboard" ? "v-test-1" : "p-test-1");

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "If-None-Match": '"records:v-test-1:p-test-1:limit:300:5294d236f1071417"' }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"records:v-test-1:p-test-1:limit:300:5294d236f1071417"');
  });

  test("If-None-Match 命中 304 时，完全不调用获取行数据的数据库方法", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => domain === "dashboard" ? "v-test-1" : "p-test-1");

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "If-None-Match": '"records:v-test-1:p-test-1:limit:300:5294d236f1071417"' }
    }));

    expect(response.status).toBe(304);
    expect(getCacheVersion).toHaveBeenCalledWith("dashboard");
    expect(getCacheVersion).toHaveBeenCalledWith("pricing");
    expect(getDashboardRows).not.toHaveBeenCalled();
  });

  test("If-None-Match 为弱 ETag（W/ 前缀）时同样返回 304 并避开行查询", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => domain === "dashboard" ? "v-test-1" : "p-test-1");

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "If-None-Match": 'W/"records:v-test-1:p-test-1:limit:300:5294d236f1071417"' }
    }));

    expect(response.status).toBe(304);
    expect(getDashboardRows).not.toHaveBeenCalled();
  });

  test("If-None-Match 为逗号分隔多个 ETag，命中任一值时返回 304", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => domain === "dashboard" ? "v-test-1" : "p-test-1");

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: {
        "If-None-Match": '"records:v-test-1:p-test-1:limit:300:deadbeefdeadbeef", W/"records:v-test-1:p-test-1:limit:300:5294d236f1071417"'
      }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"records:v-test-1:p-test-1:limit:300:5294d236f1071417"');
    expect(getDashboardRows).not.toHaveBeenCalled();
  });

  test("If-None-Match 为通配符 * 时返回 304", async () => {
    vi.mocked(getCacheVersion).mockImplementation(async (domain) => domain === "dashboard" ? "v-test-1" : "p-test-1");

    const response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "If-None-Match": "*" }
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"records:v-test-1:p-test-1:limit:300:5294d236f1071417"');
    expect(getDashboardRows).not.toHaveBeenCalled();
  });

  test("限流响应明确不进入公共缓存", async () => {
    vi.mocked(getDashboardRows).mockResolvedValue([]);

    let response = await GET(new Request("https://example.com/api/public/records", {
      headers: { "x-forwarded-for": "203.0.113.429" }
    }));

    for (let index = 1; index < 61; index += 1) {
      response = await GET(new Request("https://example.com/api/public/records", {
        headers: { "x-forwarded-for": "203.0.113.429" }
      }));
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate, max-age=0");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });
});
