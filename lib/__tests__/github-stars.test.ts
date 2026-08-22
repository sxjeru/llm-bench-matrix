import { describe, expect, test, vi } from "vitest";

import {
  fetchGithubStarCount,
  formatStarCount,
  GITHUB_REPO_API_URL,
  parseStargazersCount
} from "@/lib/github-stars";

describe("github-stars", () => {
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

  test("拉取仓库 star 数量，不走 Next Data Cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 42 })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubStarCount()).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_REPO_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "User-Agent": "llm-bench-matrix"
        })
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("next");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("cache");
  });

  test("传入的 AbortSignal 会中止请求", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const pending = fetchGithubStarCount(controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });

  test("接口失败时返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchGithubStarCount()).resolves.toBeNull();
  });
});
