import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { GithubStarBadgeView } from "@/components/github-star-badge";
import { GITHUB_REPO_URL } from "@/lib/github-stars";

describe("GithubStarBadgeView", () => {
  test("展示压缩后的 star 数量并指向仓库", () => {
    render(<GithubStarBadgeView count={1234} />);

    const badge = screen.getByRole("link", { name: "在 GitHub 上查看项目，当前 1234 个 star" });
    expect(badge).toHaveAttribute("href", GITHUB_REPO_URL);
    expect(badge).toHaveAttribute("target", "_blank");
    expect(badge).toHaveTextContent("1.2k");
  });
});
