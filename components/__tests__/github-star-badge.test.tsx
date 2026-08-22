import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { GithubStarBadge, GithubStarBadgeView } from "@/components/github-star-badge";
import { GITHUB_REPO_API_URL, GITHUB_REPO_URL } from "@/lib/github-stars";

describe("GithubStarBadgeView", () => {
  test("展示压缩后的 star 数量并指向仓库", () => {
    render(<GithubStarBadgeView count={1234} />);

    const badge = screen.getByRole("link", { name: "在 GitHub 上查看项目，当前 1234 个 star" });
    expect(badge).toHaveAttribute("href", GITHUB_REPO_URL);
    expect(badge).toHaveAttribute("target", "_blank");
    expect(badge).toHaveTextContent("1.2k");
  });
});

describe("GithubStarBadge", () => {
  test("挂载后在客户端拉取 star 数量", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GithubStarBadge />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    expect(await screen.findByRole("link", { name: "在 GitHub 上查看项目，当前 1234 个 star" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_REPO_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json"
        })
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("next");
  });

  test("卸载时中止未完成的请求", () => {
    const abortSpy = vi.fn();
    const fetchMock = vi.fn().mockImplementation((_url, init: { signal?: AbortSignal }) => {
      init.signal?.addEventListener("abort", abortSpy);
      return new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<GithubStarBadge />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });
});
