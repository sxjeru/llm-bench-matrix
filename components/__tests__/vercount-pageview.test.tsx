import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const reportMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const resolveMock = vi.hoisted(() =>
  vi.fn((scriptUrl: string) => `${new URL(scriptUrl).origin}/api/v2/log`)
);
const pathnameState = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value
}));

vi.mock("@/lib/vercount-client", () => ({
  reportVercountPageview: reportMock,
  resolveVercountApiUrl: resolveMock
}));

import { VercountPageview } from "@/components/vercount-pageview";

describe("VercountPageview", () => {
  afterEach(() => {
    pathnameState.value = "/";
    reportMock.mockClear();
    resolveMock.mockClear();
    vi.unstubAllEnvs();
  });

  test("首屏不重复上报，路径变化时再上报", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCOUNT_SCRIPT_URL", "https://count.example.com/js");

    const { rerender } = render(<VercountPageview />);
    expect(reportMock).not.toHaveBeenCalled();

    pathnameState.value = "/scatter";
    rerender(<VercountPageview />);

    expect(resolveMock).toHaveBeenCalledWith("https://count.example.com/js");
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "https://count.example.com/api/v2/log",
        pageUrl: window.location.href
      })
    );
  });

  test("未配置 script 时不处理", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCOUNT_SCRIPT_URL", "");
    render(<VercountPageview />);
    expect(reportMock).not.toHaveBeenCalled();
  });
});
