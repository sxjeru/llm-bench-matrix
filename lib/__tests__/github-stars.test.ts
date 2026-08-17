import { afterEach, describe, expect, test, vi } from "vitest";

import {
  fetchGithubStarCount,
  formatStarCount,
  GITHUB_REPO_API_URL,
  parseStargazersCount
} from "@/lib/github-stars";

describe("github-stars", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  test("格式化 star 数量", () => {
    expect(formatStarCount(0)).toBe("0");
    expect(formatStarCount(12)).toBe("12");
    expect(formatStarCount(999)).toBe("999");
    expect(formatStarCount(1000)).toBe("1k");
    expect(formatStarCount(1234)).toBe("1.2k");
    expect(formatStarCount(10500)).toBe("11k");
    expect(formatStarCount(1_200_000)).toBe("1.2M");
    expect(formatStarCount(-3)).toBe("0");
  });

  test("解析 GitHub 仓库 star 字段", () => {
    expect(parseStargazersCount({ stargazers_count: 18 })).toBe(18);
    expect(parseStargazersCount({ stargazers_count: 18.9 })).toBe(18);
    expect(parseStargazersCount({ stargazers_count: -1 })).toBeNull();
    expect(parseStargazersCount({ stargazers_count: "18" })).toBeNull();
    expect(parseStargazersCount(null)).toBeNull();
  });

  test("拉取仓库 star 数量并带上缓存选项", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 42 })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubStarCount()).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_REPO_API_URL,
      expect.objectContaining({
        next: { revalidate: 3600 },
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "User-Agent": "llm-bench-matrix"
        })
      })
    );
  });

  test("存在 token 时附加 Authorization", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 7 })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubStarCount()).resolves.toBe(7);
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_REPO_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  test("接口失败时返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchGithubStarCount()).resolves.toBeNull();
  });
});
