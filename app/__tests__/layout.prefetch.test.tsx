import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";

import RootLayout from "@/app/layout";
import { GithubStarBadge } from "@/components/github-star-badge";

function findElementByClassName(node: ReactNode, className: string): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByClassName(child, className);
      if (match) return match;
    }
    return null;
  }

  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.props.className === className) return element;
  return findElementByClassName(element.props.children as ReactNode, className);
}

describe("RootLayout prefetch", () => {
  test("品牌链接不自动预取首页大型 RSC", () => {
    const layout = RootLayout({ children: <div>content</div> });
    const brandLink = findElementByClassName(layout, "brand");

    expect(brandLink).not.toBeNull();
    expect(brandLink?.props.href).toBe("/");
    expect(brandLink?.props.prefetch).toBe(false);
  });

  test("标题右侧挂载 GitHub star 徽标", () => {
    const layout = RootLayout({ children: <div>content</div> });
    const brandGroup = findElementByClassName(layout, "brand-group");
    const children = Array.isArray(brandGroup?.props.children)
      ? brandGroup.props.children
      : [];
    const badge = children.find((child) => isValidElement(child) && child.type === GithubStarBadge);

    expect(brandGroup).not.toBeNull();
    expect(badge).toEqual(<GithubStarBadge />);
  });
});