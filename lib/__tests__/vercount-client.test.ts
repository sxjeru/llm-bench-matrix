import { afterEach, describe, expect, test, vi } from "vitest";

import {
  applyVercountCounterData,
  extractVercountCounterData,
  reportVercountPageview,
  resolveVercountApiUrl
} from "@/lib/vercount-client";

describe("vercount-client", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  test("从 script URL 推导自部署 API 地址", () => {
    expect(resolveVercountApiUrl("https://count.example.com/js")).toBe(
      "https://count.example.com/api/v2/log"
    );
    expect(resolveVercountApiUrl("https://count.example.com/js/client.min.js")).toBe(
      "https://count.example.com/api/v2/log"
    );
    expect(resolveVercountApiUrl("not-a-url")).toBeNull();
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

  test("客户端上报后更新底部 page_pv 节点", async () => {
    document.body.innerHTML = `<span id="vercount_value_page_pv">882</span>`;

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
    expect(document.getElementById("vercount_value_page_pv")?.textContent).toBe("883");
  });

  test("直接写入 DOM 计数节点", () => {
    document.body.innerHTML = `
      <span id="vercount_value_page_pv">1</span>
      <span id="busuanzi_value_site_pv">2</span>
    `;

    applyVercountCounterData({ site_pv: 12, page_pv: 34, site_uv: 5 });

    expect(document.getElementById("vercount_value_page_pv")?.textContent).toBe("34");
    expect(document.getElementById("busuanzi_value_site_pv")?.textContent).toBe("12");
  });
});
