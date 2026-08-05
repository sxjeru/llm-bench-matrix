import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TopbarActions } from "@/components/topbar-actions";

const linkPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    linkPropsSpy(props);
    const { children, ...rest } = props as { children?: React.ReactNode };
    return <a {...rest}>{children}</a>;
  }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

describe("TopbarActions hydration safety", () => {
  test("后台入口链接启用 suppressHydrationWarning 并在新标签页打开", () => {
    render(<TopbarActions />);

    const adminLinkCall = linkPropsSpy.mock.calls.find(
      ([props]) => (props as { href?: string }).href === "/admin"
    );

    expect(adminLinkCall).toBeDefined();
    expect(
      (adminLinkCall?.[0] as { suppressHydrationWarning?: boolean }).suppressHydrationWarning
    ).toBe(true);
    expect((adminLinkCall?.[0] as { target?: string }).target).toBe("_blank");
    expect((adminLinkCall?.[0] as { rel?: string }).rel).toBe("noopener noreferrer");
  });
});
