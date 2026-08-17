import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TopbarActions } from "@/components/topbar-actions";

const linkPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    linkPropsSpy(props);
    const { children, prefetch: _prefetch, ...rest } = props as { children?: React.ReactNode; prefetch?: boolean };
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
  test("公开页导航关闭自动预取", () => {
    render(<TopbarActions />);

    for (const href of ["/", "/scatter"]) {
      const linkCall = linkPropsSpy.mock.calls.find(
        ([props]) => (props as { href?: string }).href === href
      );

      expect(linkCall).toBeDefined();
      expect((linkCall?.[0] as { prefetch?: boolean }).prefetch).toBe(false);
    }
  });

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
