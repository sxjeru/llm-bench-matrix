import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ActiveVisitors, ActiveVisitorsBadgeView } from "@/components/active-visitors";
import * as umamiActiveModule from "@/lib/umami-active";

vi.mock("@/lib/umami-active", async (importOriginal) => {
  const actual = await importOriginal<typeof umamiActiveModule>();
  return {
    ...actual,
    fetchClientActiveVisitors: vi.fn()
  };
});

describe("ActiveVisitorsBadgeView", () => {
  test("正确展示当前在看人数，样式与本页总访问量一致", () => {
    render(<ActiveVisitorsBadgeView count={7} />);

    expect(screen.getByText("当前")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/人在看/)).toBeInTheDocument();
  });

  test("数值小于等于 0 时至少展示 1 人", () => {
    render(<ActiveVisitorsBadgeView count={0} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("ActiveVisitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("NEXT_PUBLIC_UMAMI_WEBSITE_ID 未配置时不发起请求且不渲染任何内容", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "");
    const { container } = render(<ActiveVisitors />);

    expect(container.firstChild).toBeNull();
    expect(umamiActiveModule.fetchClientActiveVisitors).not.toHaveBeenCalled();
  });

  test("配置环境变量且接口返回成功时，渲染当前在看人数", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-id");
    vi.mocked(umamiActiveModule.fetchClientActiveVisitors).mockResolvedValue({
      count: 12,
      enabled: true
    });

    render(<ActiveVisitors />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("当前")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/人在看/)).toBeInTheDocument();
  });

  test("接口返回 null 时不渲染内容", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-id");
    vi.mocked(umamiActiveModule.fetchClientActiveVisitors).mockResolvedValue({
      count: null,
      enabled: true
    });

    const { container } = render(<ActiveVisitors />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.firstChild).toBeNull();
  });

  test("服务端未配置 Umami 凭据时停止轮询且不渲染内容", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-id");
    vi.mocked(umamiActiveModule.fetchClientActiveVisitors).mockResolvedValue({
      count: null,
      enabled: false
    });

    const { container } = render(<ActiveVisitors />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.firstChild).toBeNull();

    // 时钟前进两个轮询周期后不应再发起请求
    await act(async () => {
      vi.advanceTimersByTime(90000);
      await Promise.resolve();
    });
    expect(umamiActiveModule.fetchClientActiveVisitors).toHaveBeenCalledTimes(1);
  });

  test("页面处于后台时不执行定时轮询，切回前台时立即更新", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "test-id");
    vi.mocked(umamiActiveModule.fetchClientActiveVisitors).mockResolvedValue({
      count: 5,
      enabled: true
    });

    render(<ActiveVisitors />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(umamiActiveModule.fetchClientActiveVisitors).toHaveBeenCalledTimes(1);

    // 切换到后台
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });

    // 快进定时器
    await act(async () => {
      vi.advanceTimersByTime(45000);
      await Promise.resolve();
    });
    // 依然只调用过初次那 1 次
    expect(umamiActiveModule.fetchClientActiveVisitors).toHaveBeenCalledTimes(1);

    // 切回前台
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // 立即触发了第 2 次拉取
    expect(umamiActiveModule.fetchClientActiveVisitors).toHaveBeenCalledTimes(2);
  });
});
