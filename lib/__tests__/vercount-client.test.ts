import { afterEach, describe, expect, test, vi } from "vitest";

import {
  extractVercountCounterData,
  reportVercountPageview,
  resolveVercountApiUrl
} from "@/lib/vercount-client";

describe("vercount-client", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("从 script URL 推导自部署 API 地址", () => {
    expect(resolveVercountApiUrl("https://count.example.com/js")).toBe(
      "https://count.example.com/api/v2/log"
    );
    expect(resolveVercountApiUrl("https://count.example.com/js/client.min.js")).toBe(
      "https://count.example.com/api/v2/log"
    );
    expect(resolveVercountApiUrl("not-a-url")).toBeNull();
    expect(resolveVercountApiUrl("/vercount.js", "https://bench.example.com/")).toBe(
      "https://bench.example.com/api/v2/log"
    );
  });

  test("解析 success/error 响应中的计数", () => {
    expect(
      extractVercountCounterData({
        status: "success",
        data: { site_pv: 10, page_pv: 3, site_uv: 2 }
      })
    ).toEqual({ site_pv: 10, page_pv: 3, site_uv: 2 });

    expect(
      extractVercountCounterData({
        status: "error",
        message: "rate limited",
        data: { site_pv: 1, page_pv: 1, site_uv: 1 }
      })
    ).toEqual({ site_pv: 1, page_pv: 1, site_uv: 1 });
  });

  test("客户端上报后返回该页面的访问量", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: { site_pv: 900, page_pv: 883, site_uv: 100 }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const data = await reportVercountPageview({
      apiUrl: "https://count.example.com/api/v2/log",
      pageUrl: "https://bench.example.com/scatter"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://count.example.com/api/v2/log",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://bench.example.com/scatter" })
      })
    );
    expect(data).toEqual({ site_pv: 900, page_pv: 883, site_uv: 100 });
  });

  test("缺失或无效的 page_pv 不会被误认为总量归零", () => {
    for (const page_pv of [undefined, null, "", false, "abc", -1, 12.5]) {
      expect(extractVercountCounterData({ status: "success", data: { page_pv } })).toBeNull();
    }
    expect(extractVercountCounterData({ page_pv: "883" })?.page_pv).toBe(883);
  });
});
