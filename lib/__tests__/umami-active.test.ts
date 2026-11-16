import { describe, expect, test, vi } from "vitest";

import {
  fetchClientActiveVisitors,
  parseActiveVisitorsCount,
  PUBLIC_ACTIVE_VISITORS_API_URL,
  resolveUmamiActiveApiUrl,
  withActiveFetchTimeout
} from "@/lib/umami-active";
import { fetchUmamiActiveVisitors } from "@/lib/umami-active-server";

describe("umami-active", () => {
  describe("resolveUmamiActiveApiUrl", () => {
    test("缺少 websiteId 时返回 null", () => {
      expect(resolveUmamiActiveApiUrl({ scriptUrl: "https://cloud.umami.is/script.js" })).toBeNull();
      expect(resolveUmamiActiveApiUrl({ websiteId: "   " })).toBeNull();
    });

    test("基于 scriptUrl 解析同源 /api/websites/:id/active", () => {
      const url = resolveUmamiActiveApiUrl({
        scriptUrl: "https://umami.example.com/script.js",
        websiteId: "web-123"
      });
      expect(url).toBe("https://umami.example.com/api/websites/web-123/active");
    });

    test("优先使用 customApiUrl，自动处理路径后缀", () => {
      expect(
        resolveUmamiActiveApiUrl({
          customApiUrl: "https://api.umami.is/v1",
          websiteId: "web-123"
        })
      ).toBe("https://api.umami.is/v1/websites/web-123/active");

      expect(
        resolveUmamiActiveApiUrl({
          customApiUrl: "https://umami.example.com/api/",
          websiteId: "web-123"
        })
      ).toBe("https://umami.example.com/api/websites/web-123/active");

      expect(
        resolveUmamiActiveApiUrl({
          customApiUrl: "https://custom.endpoint.com/direct/active",
          websiteId: "web-123"
        })
      ).toBe("https://custom.endpoint.com/direct/active");
    });

    test("scriptUrl 格式不合法时返回 null", () => {
      expect(
        resolveUmamiActiveApiUrl({
          scriptUrl: "invalid-url",
          websiteId: "web-123"
        })
      ).toBeNull();
    });
  });

  describe("parseActiveVisitorsCount", () => {
    test("解析各种常见 payload 格式", () => {
      expect(parseActiveVisitorsCount({ visitors: 8 })).toBe(8);
      expect(parseActiveVisitorsCount({ x: 12 })).toBe(12);
      expect(parseActiveVisitorsCount({ active: 5 })).toBe(5);
      expect(parseActiveVisitorsCount({ value: 15 })).toBe(15);
      expect(parseActiveVisitorsCount({ visitors: { value: 20 } })).toBe(20);
      expect(parseActiveVisitorsCount({ visitors: "25" })).toBe(25);
    });

    test("异常或非法数值返回 null", () => {
      expect(parseActiveVisitorsCount(null)).toBeNull();
      expect(parseActiveVisitorsCount({})).toBeNull();
      expect(parseActiveVisitorsCount({ visitors: -5 })).toBeNull();
      expect(parseActiveVisitorsCount({ visitors: "not-a-number" })).toBeNull();
      expect(parseActiveVisitorsCount("string")).toBeNull();
    });
  });

  describe("fetchUmamiActiveVisitors", () => {
    test("缺少环境变量时不发起请求并返回 null", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
      vi.stubEnv("UMAMI_API_TOKEN", "");

      const result = await fetchUmamiActiveVisitors();
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("配置有效环境变量时携带 Authorization 请求头请求 Umami", async () => {
      vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-web-id");
      vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://umami.example.com/script.js");
      vi.stubEnv("UMAMI_API_TOKEN", "test-token");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ visitors: 16 })
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchUmamiActiveVisitors();
      expect(result).toBe(16);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://umami.example.com/api/websites/test-web-id/active",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "x-umami-api-key": "test-token"
          }),
          signal: expect.any(AbortSignal)
        })
      );
    });

    test("接口异常或网络错误时返回 null", async () => {
      vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-web-id");
      vi.stubEnv("NEXT_PUBLIC_UMAMI_SCRIPT_URL", "https://umami.example.com/script.js");
      vi.stubEnv("UMAMI_API_TOKEN", "test-token");

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      await expect(fetchUmamiActiveVisitors()).resolves.toBeNull();
    });
  });

  describe("withActiveFetchTimeout", () => {
    test("组合后的 signal 随调用方 signal 一起中止", () => {
      const controller = new AbortController();
      const combined = withActiveFetchTimeout(controller.signal);

      expect(combined.aborted).toBe(false);
      controller.abort();
      expect(combined.aborted).toBe(true);
    });

    test("未传入 signal 时仅使用超时 signal", () => {
      expect(withActiveFetchTimeout(undefined).aborted).toBe(false);
    });
  });

  describe("fetchClientActiveVisitors", () => {
    test("成功请求站内代理接口并解析 active 与 enabled", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ active: 9, enabled: true })
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchClientActiveVisitors();
      expect(result).toEqual({ count: 9, enabled: true });
      expect(fetchMock).toHaveBeenCalledWith(
        PUBLIC_ACTIVE_VISITORS_API_URL,
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
    });

    test("服务端未配置凭据时透传 enabled: false", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ active: null, enabled: false })
        })
      );

      await expect(fetchClientActiveVisitors()).resolves.toEqual({ count: null, enabled: false });
    });

    test("接口失败时返回空计数并保持轮询", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      await expect(fetchClientActiveVisitors()).resolves.toEqual({ count: null, enabled: true });
    });
  });
});
