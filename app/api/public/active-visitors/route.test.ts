import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACTIVE_VISITORS_CACHE_HEADERS,
  DISABLED_CACHE_HEADERS,
  GET,
  _resetLastKnownActiveCountForTest
} from "@/app/api/public/active-visitors/route";
import * as umamiActiveModule from "@/lib/umami-active-server";

vi.mock("@/lib/umami-active-server", async (importOriginal) => {
  const actual = await importOriginal<typeof umamiActiveModule>();
  return {
    ...actual,
    fetchUmamiActiveVisitors: vi.fn()
  };
});

describe("GET /api/public/active-visitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastKnownActiveCountForTest();
    vi.unstubAllEnvs();
  });

  test("环境变量未提供时返回 200 与 enabled: false，不展示", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    vi.stubEnv("UMAMI_API_TOKEN", "");
    vi.stubEnv("UMAMI_API_KEY", "");

    const response = await GET(new Request("https://example.com/api/public/active-visitors"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      active: null,
      enabled: false
    });
    expect(response.headers.get("Cache-Control")).toBe(DISABLED_CACHE_HEADERS["Cache-Control"]);
  });

  test("环境变量提供且上游返回成功时，返回活跃人数与缓存头", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "web-456");
    vi.stubEnv("UMAMI_API_TOKEN", "token-xyz");

    vi.mocked(umamiActiveModule.fetchUmamiActiveVisitors).mockResolvedValue(15);

    const response = await GET(new Request("https://example.com/api/public/active-visitors"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      active: 15,
      enabled: true
    });
    expect(response.headers.get("Cache-Control")).toBe(ACTIVE_VISITORS_CACHE_HEADERS["Cache-Control"]);
  });

  test("上游接口偶发失败时，降级使用上次已知的有效数值", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "web-456");
    vi.stubEnv("UMAMI_API_TOKEN", "token-xyz");

    // 第一次成功：记录 20
    vi.mocked(umamiActiveModule.fetchUmamiActiveVisitors).mockResolvedValueOnce(20);
    await GET(new Request("https://example.com/api/public/active-visitors"));

    // 第二次失败：返回 null
    vi.mocked(umamiActiveModule.fetchUmamiActiveVisitors).mockResolvedValueOnce(null);
    const response = await GET(new Request("https://example.com/api/public/active-visitors"));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      active: 20,
      enabled: true
    });
  });

  test("无历史值且上游失败时，安全返回 active: null", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "web-456");
    vi.stubEnv("UMAMI_API_TOKEN", "token-xyz");

    vi.mocked(umamiActiveModule.fetchUmamiActiveVisitors).mockResolvedValue(null);

    const response = await GET(new Request("https://example.com/api/public/active-visitors"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      active: null,
      enabled: true
    });
  });
});
