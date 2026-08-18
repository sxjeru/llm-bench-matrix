import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TopbarActions } from "@/components/topbar-actions";
import { HOME_PATH, SCATTER_PATH } from "@/lib/public-routes";

const linkPropsSpy = vi.hoisted(() => vi.fn());
const pathnameState = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    linkPropsSpy(props);
    const { children, prefetch: _prefetch, ...rest } = props as { children?: React.ReactNode; prefetch?: boolean };
    return <a {...rest}>{children}</a>;
  }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

describe("TopbarActions hydration safety", () => {
  beforeEach(() => {
    pathnameState.value = HOME_PATH;
    linkPropsSpy.mockClear();
  });

  test("公开页导航关闭自动预取", () => {
    render(<TopbarActions />);

    for (const href of [HOME_PATH, SCATTER_PATH]) {
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

  test("散点嵌套路径下散点入口仍高亮，矩阵入口不高亮", () => {
    pathnameState.value = `${SCATTER_PATH}/share`;
    render(<TopbarActions />);

    const activeOf = (href: string) => {
      const call = linkPropsSpy.mock.calls.find(([props]) => (props as { href?: string }).href === href);
      return call?.[0] as { className?: string; "aria-current"?: string } | undefined;
    };

    expect(activeOf(SCATTER_PATH)?.className).toContain("is-active");
    expect(activeOf(SCATTER_PATH)?.["aria-current"]).toBe("page");
    expect(activeOf(HOME_PATH)?.className).not.toContain("is-active");
    expect(activeOf(HOME_PATH)?.["aria-current"]).toBeUndefined();
  });
});
