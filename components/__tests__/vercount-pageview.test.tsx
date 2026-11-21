import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VercountPageview } from "@/components/vercount-pageview";

const pathnameState = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameState.value }));

function scrollPageTo(scrollY: number) {
  vi.stubGlobal("scrollY", scrollY);
  fireEvent.scroll(window);
}

function counterResponse(count: number) {
  return { ok: true, json: async () => ({ status: "success", data: { page_pv: count } }) };
}

const fetchMock = vi.fn();
let visibility: DocumentVisibilityState;
let pageHeight: number;
let trafficBounds: DOMRect;

describe("VercountPageview", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_VERCOUNT_SCRIPT_URL", "https://count.example.com/js");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("scrollY", 0);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1200);
    pageHeight = 2000;
    trafficBounds = new DOMRect(200, 750, 100, 20);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(() => pageHeight);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => trafficBounds);
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    pathnameState.value = "/";
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  test("提前渲染累计增量，直到向下滚动到页底后才更新基线", async () => {
    fetchMock.mockResolvedValueOnce(counterResponse(2496));
    const first = render(<VercountPageview />);
    await screen.findByText("2496");
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("2496");
    expect(screen.queryByText(/^\(\+/)).not.toBeInTheDocument();
    first.unmount();

    fetchMock.mockResolvedValueOnce(counterResponse(2501));
    const second = render(<VercountPageview />);
    await screen.findByText("(+5)");
    scrollPageTo(100);
    scrollPageTo(800);
    second.unmount();

    fetchMock.mockResolvedValueOnce(counterResponse(2508));
    const third = render(<VercountPageview />);
    await screen.findByText("(+12)");
    scrollPageTo(1200);
    expect(screen.getByText("(+12)")).toBeInTheDocument();
    third.unmount();

    fetchMock.mockResolvedValueOnce(counterResponse(2510));
    render(<VercountPageview />);
    await screen.findByText("(+2)");
  });

  test("加载时脚注进入首屏和后续布局变化都不会清零增量", async () => {
    localStorage.setItem("bench-matrix:home-pageview-baseline", "100");
    pageHeight = 800;
    fetchMock.mockResolvedValueOnce(counterResponse(105));
    render(<VercountPageview />);
    await screen.findByText("(+5)");

    scrollPageTo(0);
    fireEvent.resize(window);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");

    pageHeight = 2000;
    scrollPageTo(600);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");

    scrollPageTo(1200);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("105");
    expect(screen.getByText("(+5)")).toBeInTheDocument();
  });

  test("停留在页底或向上滚动不会重置，需再次向下滚动到页底", async () => {
    localStorage.setItem("bench-matrix:home-pageview-baseline", "100");
    vi.stubGlobal("scrollY", 1200);
    fetchMock.mockResolvedValueOnce(counterResponse(105));
    render(<VercountPageview />);
    await screen.findByText("(+5)");

    scrollPageTo(1200);
    scrollPageTo(1199);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");

    scrollPageTo(1200);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("105");
  });

  test("滚动到页底但计数未完整可见时仍保留增量", async () => {
    localStorage.setItem("bench-matrix:home-pageview-baseline", "100");
    fetchMock.mockResolvedValueOnce(counterResponse(105));
    render(<VercountPageview />);
    await screen.findByText("(+5)");

    trafficBounds = new DOMRect(200, 790, 100, 20);
    scrollPageTo(1200);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");

    trafficBounds = new DOMRect(200, 750, 100, 20);
    scrollPageTo(1100);
    scrollPageTo(1200);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("105");
  });

  test("后台标签页不会把增量标记为已读", async () => {
    fetchMock.mockResolvedValueOnce(counterResponse(100));
    const first = render(<VercountPageview />);
    await screen.findByText("100");
    first.unmount();

    fetchMock.mockResolvedValueOnce(counterResponse(105));
    const second = render(<VercountPageview />);
    await screen.findByText("(+5)");
    visibility = "hidden";
    scrollPageTo(1200);
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");
    second.unmount();

    fetchMock.mockResolvedValueOnce(counterResponse(106));
    render(<VercountPageview />);
    await screen.findByText("(+6)");
  });

  test("请求失败时显示该页面缓存总量，但不把未展示的增量清零", async () => {
    localStorage.setItem("bench-matrix:home-pageview-baseline", "100");
    localStorage.setItem("bench-matrix:pageview:https://count.example.com/api/v2/log:/", "104");
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));

    render(<VercountPageview />);
    await screen.findByText("104");
    expect(screen.queryByText(/^\(\+/)).not.toBeInTheDocument();
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBe("100");
  });

  test("首屏只上报一次，切换页面不会把散点图的访问量用于首页", async () => {
    fetchMock.mockResolvedValueOnce(counterResponse(100));
    const page = <StrictMode><VercountPageview /></StrictMode>;
    const { rerender } = render(page);
    await screen.findByText("100");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pathnameState.value = "/scatter";
    fetchMock.mockResolvedValueOnce(counterResponse(500));
    rerender(<StrictMode><VercountPageview /></StrictMode>);
    await screen.findByText("500");
    expect(screen.queryByText(/^\(\+/)).not.toBeInTheDocument();

    pathnameState.value = "/";
    fetchMock.mockResolvedValueOnce(counterResponse(105));
    rerender(<StrictMode><VercountPageview /></StrictMode>);
    expect(screen.queryByText("500")).not.toBeInTheDocument();
    await screen.findByText("(+5)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("卸载后不取消已经发出的页面访问上报，也不写入过期响应", async () => {
    let resolveRequest!: (response: ReturnType<typeof counterResponse>) => void;
    const request = new Promise<ReturnType<typeof counterResponse>>((resolve) => {
      resolveRequest = resolve;
    });
    fetchMock.mockReturnValueOnce(request);

    const page = render(<VercountPageview />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    page.unmount();

    expect(signal.aborted).toBe(false);
    await act(async () => {
      resolveRequest(counterResponse(250));
      await request;
    });

    expect(signal.aborted).toBe(false);
    expect(localStorage.getItem("bench-matrix:home-pageview-baseline")).toBeNull();
    expect(localStorage.getItem("bench-matrix:pageview:https://count.example.com/api/v2/log:/")).toBeNull();
  });

  test("等待接口返回时展示 Loading", async () => {
    fetchMock.mockResolvedValueOnce(counterResponse(1));
    render(<VercountPageview />);

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  test("请求失败且无缓存时不会一直停在 Loading", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
    render(<VercountPageview />);

    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  test("未配置 Vercount 时隐藏访问量", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCOUNT_SCRIPT_URL", "");
    render(<VercountPageview />);
    expect(screen.queryByText("本页总访问量")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
