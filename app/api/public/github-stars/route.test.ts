import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  GET,
  GITHUB_STARS_CACHE_HEADERS,
  _resetLastKnownStarCountForTest
} from "@/app/api/public/github-stars/route";
import * as githubStarsModule from "@/lib/github-stars";

vi.mock("@/lib/github-stars", async (importOriginal) => {
  const actual = await importOriginal<typeof githubStarsModule>();
  return {
    ...actual,
    fetchGithubStarCount: vi.fn()
  };
});

describe("GET /api/public/github-stars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastKnownStarCountForTest();
  });

  test("GitHub 接口正常时返回 200 与正确的缓存响应头", async () => {
    vi.mocked(githubStarsModule.fetchGithubStarCount).mockResolvedValue(1234);

    const response = await GET(new Request("https://example.com/api/public/github-stars"));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      count: 1234,
      stargazers_count: 1234
    });

    expect(response.headers.get("Cache-Control")).toBe(GITHUB_STARS_CACHE_HEADERS["Cache-Control"]);
    expect(response.headers.get("CDN-Cache-Control")).toBe(GITHUB_STARS_CACHE_HEADERS["CDN-Cache-Control"]);
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe(GITHUB_STARS_CACHE_HEADERS["Vercel-CDN-Cache-Control"]);
  });

  test("GitHub 接口失败但有历史缓存值时降级返回 200 与历史值", async () => {
    // 第一次成功，记录 1234 到内存
    vi.mocked(githubStarsModule.fetchGithubStarCount).mockResolvedValueOnce(1234);
    await GET(new Request("https://example.com/api/public/github-stars"));

    // 第二次失败，返回 null
    vi.mocked(githubStarsModule.fetchGithubStarCount).mockResolvedValueOnce(null);
    const response = await GET(new Request("https://example.com/api/public/github-stars"));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      count: 1234,
      stargazers_count: 1234
    });
    expect(response.headers.get("CDN-Cache-Control")).toBe(GITHUB_STARS_CACHE_HEADERS["CDN-Cache-Control"]);
  });

  test("无历史缓存值且 GitHub 接口失败时返回 503 与短期重试头", async () => {
    vi.mocked(githubStarsModule.fetchGithubStarCount).mockResolvedValue(null);

    const response = await GET(new Request("https://example.com/api/public/github-stars"));

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data).toEqual({
      count: null,
      stargazers_count: null
    });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30, stale-while-revalidate=60");
  });
});

