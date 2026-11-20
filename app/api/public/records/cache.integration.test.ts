import { beforeEach, describe, expect, test, vi } from "vitest";

vi.unmock("@/lib/cache-versions");
const state = vi.hoisted(() => ({
  version: "v1", versionReads: 0, rowLoads: 0,
  afterRowLoad: undefined as (() => void) | undefined
}));

vi.mock("@/lib/db/client", async () => {
  const { settings } = await import("@/lib/db/schema");
  return { db: {
    select: vi.fn(() => ({ from: (table: unknown) => {
      if (table === settings) return { where: async () => {
        state.versionReads++;
        return ["dashboard", "pricing", "admin_entities", "settings"].map((domain) => ({
          key: `cache_version:${domain}`, valueJson: { version: state.version }
        }));
      } };
      const query = {
        innerJoin: () => query, leftJoin: () => query, where: () => query, orderBy: () => query,
        limit: async () => { state.rowLoads++; state.afterRowLoad?.(); return []; }
      };
      return query;
    } }))
  } };
});

import { GET } from "@/app/api/public/records/route";
import { getCacheVersions, invalidateCacheVersions } from "@/lib/cache-versions";
import { invalidateLocalCaches } from "@/lib/cache-invalidation";

beforeEach(() => {
  invalidateLocalCaches(); invalidateCacheVersions();
  state.version = "v1"; state.versionReads = 0; state.rowLoads = 0; state.afterRowLoad = undefined;
});
const request = () => new Request("https://example.com/api/public/records");

describe("records cache with real version and row cache implementations", () => {
  test("subsequent 200 responses hit memory with no database round trips", async () => {
    await GET(request());
    expect(state.rowLoads).toBe(1); expect(state.versionReads).toBe(2);
    await GET(request()); await GET(request());
    expect(state.rowLoads).toBe(1); expect(state.versionReads).toBe(2);
  });
  test("another instance's commit is discovered once, without repeated v1/v2 reloads", async () => {
    await getCacheVersions();
    state.version = "v2";
    for (let index = 0; index < 3; index++) {
      const response = await GET(request());
      expect(response.headers.get("X-Dashboard-Version")).toBe("v2");
    }
    expect(state.rowLoads).toBe(2);
    expect(state.versionReads).toBe(3); // initial TTL probe and validation of two live row loads
    expect((await getCacheVersions()).dashboard).toBe("v2");
  });
  test("concurrent cold requests share a row load and its validation", async () => {
    const responses = await Promise.all([GET(request()), GET(request()), GET(request())]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(state.rowLoads).toBe(1); expect(state.versionReads).toBe(2);
  });
  test("a commit during SQL loading retries before caching or returning the body", async () => {
    state.afterRowLoad = () => { state.version = "v2"; state.afterRowLoad = undefined; };
    const response = await GET(request());
    expect(response.headers.get("X-Dashboard-Version")).toBe("v2");
    expect(state.rowLoads).toBe(2);
    await GET(request());
    expect(state.rowLoads).toBe(2); expect(state.versionReads).toBe(3);
  });
  test("an unchanged version probe after TTL expiration reuses already validated rows", async () => {
    vi.useFakeTimers();
    try {
      await GET(request());
      await vi.advanceTimersByTimeAsync(5_001);
      await GET(request());
      expect(state.rowLoads).toBe(1); expect(state.versionReads).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});
