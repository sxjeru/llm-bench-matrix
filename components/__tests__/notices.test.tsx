import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminConsoleNotices } from "../admin-console/views/notices";
import { useAdminNotices } from "../admin-console/hooks/use-notices";
import type { NoticeItem } from "../admin-console/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

describe("AdminConsoleNotices", () => {
  it("renders nothing when noticeList is empty", () => {
    const { container } = render(<AdminConsoleNotices noticeList={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders success and error notices with messages and details", () => {
    const notices: NoticeItem[] = [
      {
        id: 1,
        type: "success",
        message: "保存成功",
        details: ["详情第一行", "详情第二行"],
        visible: true,
        dismissing: false
      },
      {
        id: 2,
        type: "error",
        message: "发生错误",
        visible: true,
        dismissing: false
      }
    ];

    render(<AdminConsoleNotices noticeList={notices} />);

    expect(screen.getByText("保存成功")).toBeInTheDocument();
    expect(screen.getByText("详情第一行")).toBeInTheDocument();
    expect(screen.getByText("详情第二行")).toBeInTheDocument();
    expect(screen.getByText("发生错误")).toBeInTheDocument();
  });

  it("calls onDismiss with notice id when clicked on the toast card", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const notices: NoticeItem[] = [
      {
        id: 42,
        type: "success",
        message: "测试消息",
        visible: true,
        dismissing: false
      }
    ];

    render(<AdminConsoleNotices noticeList={notices} onDismiss={onDismiss} />);

    const alert = screen.getByRole("alert");
    await user.click(alert);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(42);
  });

  it("calls onPause on mouse enter and onResume on mouse leave", async () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const notices: NoticeItem[] = [
      {
        id: 99,
        type: "error",
        message: "错误消息",
        visible: true,
        dismissing: false
      }
    ];

    render(
      <AdminConsoleNotices
        noticeList={notices}
        onPause={onPause}
        onResume={onResume}
      />
    );

    const alert = screen.getByRole("alert");
    fireEvent.mouseEnter(alert);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledWith(99);

    fireEvent.mouseLeave(alert);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(99);
  });

  it("applies dismiss animation classes when dismissing is true", () => {
    const notices: NoticeItem[] = [
      {
        id: 10,
        type: "success",
        message: "正在退出",
        visible: false,
        dismissing: true
      }
    ];

    render(<AdminConsoleNotices noticeList={notices} />);

    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("translate-x-12");
    expect(alert.className).toContain("opacity-0");
    expect(alert.className).toContain("scale-90");
    expect(alert.className).toContain("pointer-events-none");
  });

  it("does not trigger card onDismiss if user has selected text", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const notices: NoticeItem[] = [
      {
        id: 1,
        type: "success",
        message: "高亮选择文本",
        visible: true,
        dismissing: false
      }
    ];

    const originalGetSelection = window.getSelection;
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => "高亮"
    } as unknown as Selection);

    try {
      render(<AdminConsoleNotices noticeList={notices} onDismiss={onDismiss} />);
      const alert = screen.getByRole("alert");
      await user.click(alert);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      window.getSelection = originalGetSelection;
    }
  });

  it("triggers card onDismiss if user has selected text outside the notice card", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const notices: NoticeItem[] = [
      {
        id: 1,
        type: "success",
        message: "外部文本被选",
        visible: true,
        dismissing: false
      }
    ];

    const outsideNode = document.createElement("div");
    outsideNode.textContent = "表格外部文字";
    document.body.appendChild(outsideNode);

    const originalGetSelection = window.getSelection;
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => "表格外部文字",
      anchorNode: outsideNode
    } as unknown as Selection);

    try {
      render(<AdminConsoleNotices noticeList={notices} onDismiss={onDismiss} />);
      const alert = screen.getByRole("alert");
      await user.click(alert);
      expect(onDismiss).toHaveBeenCalledWith(1);
    } finally {
      window.getSelection = originalGetSelection;
      document.body.removeChild(outsideNode);
    }
  });
});

describe("useAdminNotices", () => {
  it("allows dismissing a notice before timeout", () => {
    vi.useFakeTimers();

    let hookResult: ReturnType<typeof useAdminNotices>;
    function TestComponent() {
      hookResult = useAdminNotices();
      return null;
    }

    render(<TestComponent />);

    act(() => {
      hookResult.notifySuccess("操作成功");
    });

    expect(hookResult!.noticeList).toHaveLength(1);
    const noticeId = hookResult!.noticeList[0].id;

    act(() => {
      // Trigger requestAnimationFrame
      vi.advanceTimersByTime(16);
    });

    expect(hookResult!.noticeList[0].visible).toBe(true);
    expect(hookResult!.noticeList[0].dismissing).toBe(false);

    // Now click dismiss
    act(() => {
      hookResult.dismissNotice(noticeId);
    });

    expect(hookResult!.noticeList[0].dismissing).toBe(true);
    expect(hookResult!.noticeList[0].visible).toBe(false);

    // After animation duration (300ms)
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(hookResult!.noticeList).toHaveLength(0);

    vi.useRealTimers();
  });

  it("does not allow resumeNotice to cancel dismiss clearTimer after dismissNotice", () => {
    vi.useFakeTimers();

    let hookResult: ReturnType<typeof useAdminNotices>;
    function TestComponent() {
      hookResult = useAdminNotices();
      return null;
    }

    render(<TestComponent />);

    act(() => {
      hookResult.notifySuccess("操作成功");
    });

    const noticeId = hookResult!.noticeList[0].id;

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // User clicks dismiss -> element gets pointer-events-none -> browser dispatches mouseleave -> resumeNotice
    act(() => {
      hookResult.dismissNotice(noticeId);
      hookResult.resumeNotice(noticeId);
    });

    expect(hookResult!.noticeList[0].dismissing).toBe(true);

    // 350ms later, notice should be fully removed despite resumeNotice being called
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(hookResult!.noticeList).toHaveLength(0);

    vi.useRealTimers();
  });

  it("does not allow pauseNotice to revive a dismissing notice", () => {
    vi.useFakeTimers();

    let hookResult: ReturnType<typeof useAdminNotices>;
    function TestComponent() {
      hookResult = useAdminNotices();
      return null;
    }

    render(<TestComponent />);

    act(() => {
      hookResult.notifySuccess("操作成功");
    });

    const noticeId = hookResult!.noticeList[0].id;

    act(() => {
      vi.advanceTimersByTime(16);
    });

    act(() => {
      hookResult.dismissNotice(noticeId);
      hookResult.pauseNotice(noticeId);
    });

    // Should remain dismissing: true and visible: false
    expect(hookResult!.noticeList[0].dismissing).toBe(true);
    expect(hookResult!.noticeList[0].visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(hookResult!.noticeList).toHaveLength(0);

    vi.useRealTimers();
  });

  it("chains 300ms clear timer after hideDelay on auto dismiss", () => {
    vi.useFakeTimers();

    let hookResult: ReturnType<typeof useAdminNotices>;
    function TestComponent() {
      hookResult = useAdminNotices();
      return null;
    }

    render(<TestComponent />);

    act(() => {
      hookResult.notifySuccess("操作成功");
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // Advance 15000ms (hideDelay)
    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(hookResult!.noticeList).toHaveLength(1);
    expect(hookResult!.noticeList[0].dismissing).toBe(true);

    // After 350ms, chained clearTimer completes removal
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(hookResult!.noticeList).toHaveLength(0);

    vi.useRealTimers();
  });

  it("pauses auto-dismiss on pauseNotice and resumes on resumeNotice", () => {
    vi.useFakeTimers();

    let hookResult: ReturnType<typeof useAdminNotices>;
    function TestComponent() {
      hookResult = useAdminNotices();
      return null;
    }

    render(<TestComponent />);

    act(() => {
      hookResult.notifySuccess("操作成功");
    });

    expect(hookResult!.noticeList).toHaveLength(1);
    const noticeId = hookResult!.noticeList[0].id;

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // Advance 10s (total timeout is 15s)
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(hookResult!.noticeList).toHaveLength(1);

    // Mouse enter -> pause
    act(() => {
      hookResult.pauseNotice(noticeId);
    });

    // Advance 20s while paused -> should NOT dismiss
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(hookResult!.noticeList).toHaveLength(1);
    expect(hookResult!.noticeList[0].visible).toBe(true);

    // Mouse leave -> resume (restarts 15s timer)
    act(() => {
      hookResult.resumeNotice(noticeId);
    });

    // Advance 14s -> still visible
    act(() => {
      vi.advanceTimersByTime(14000);
    });
    expect(hookResult!.noticeList).toHaveLength(1);

    // Advance 2s (reaches 15s + 300ms) -> dismissed
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(hookResult!.noticeList).toHaveLength(0);

    vi.useRealTimers();
  });
});

describe("BenchmarkMatrix copyNotice click-to-dismiss", () => {
  it("dismisses copy toast notification when clicked", async () => {
    vi.useFakeTimers();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: writeTextMock
      },
      configurable: true
    });

    const { BenchmarkMatrix } = await import("../benchmark-matrix");
    const { renderReady } = await import("@/tests/flush-microtasks");

    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5",
            benchmarkName: "MMLU",
            benchmarkType: "Knowledge",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "90.0",
            valueNum: 90,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    const exportBtn = screen.getByRole("button", { name: "导出图片菜单" });
    await act(async () => {
      exportBtn.click();
    });

    const copyMarkdownBtn = screen.getByText("复制 Markdown 表格");
    await act(async () => {
      copyMarkdownBtn.click();
    });

    // Advance frame for visibility
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const toastNotice = screen.getByText("已复制 Markdown 表格到剪贴板");
    expect(toastNotice).toBeInTheDocument();

    const toastAlert = toastNotice.closest('[role="alert"]');
    expect(toastAlert).toBeInTheDocument();
    expect(toastAlert!.className).toContain("translate-y-0");
    expect(toastAlert!.className).toContain("opacity-100");

    // Click toast alert to dismiss
    await act(async () => {
      (toastAlert as HTMLElement).click();
    });

    // Verify dismiss animation classes
    expect(toastAlert!.className).toContain("translate-x-12");
    expect(toastAlert!.className).toContain("opacity-0");
    expect(toastAlert!.className).toContain("scale-90");

    // Advance past animation (300ms)
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.queryByText("已复制 Markdown 表格到剪贴板")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("pauses dismiss timer on mouse enter and resumes on mouse leave", async () => {
    vi.useFakeTimers();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: writeTextMock
      },
      configurable: true
    });

    const { BenchmarkMatrix } = await import("../benchmark-matrix");
    const { renderReady } = await import("@/tests/flush-microtasks");

    await renderReady(
      <BenchmarkMatrix
        rows={[
          {
            providerName: "OpenAI",
            modelName: "GPT-5",
            benchmarkName: "MMLU",
            benchmarkType: "Knowledge",
            benchTime: "2026-04-06T00:00:00.000Z",
            valueRaw: "90.0",
            valueNum: 90,
            valueNote: null,
            source: "text:demo"
          }
        ]}
      />
    );

    const exportBtn = screen.getByRole("button", { name: "导出图片菜单" });
    await act(async () => {
      exportBtn.click();
    });

    const copyMarkdownBtn = screen.getByText("复制 Markdown 表格");
    await act(async () => {
      copyMarkdownBtn.click();
    });

    // Advance frame for visibility
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const toastNotice = screen.getByText("已复制 Markdown 表格到剪贴板");
    expect(toastNotice).toBeInTheDocument();

    const toastAlert = toastNotice.closest('[role="alert"]');
    expect(toastAlert).toBeInTheDocument();

    // Advance 10s (normal dismiss is 15s)
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(toastNotice).toBeInTheDocument();

    // Mouse enter -> pause
    await act(async () => {
      fireEvent.mouseEnter(toastAlert!);
    });

    // Advance 20s while paused -> still in document!
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(toastNotice).toBeInTheDocument();

    // Mouse leave -> resume
    await act(async () => {
      fireEvent.mouseLeave(toastAlert!);
    });

    // Advance past leave delay (15300ms)
    await act(async () => {
      vi.advanceTimersByTime(15400);
    });

    expect(screen.queryByText("已复制 Markdown 表格到剪贴板")).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
