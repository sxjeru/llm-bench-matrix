import { beforeEach, describe, expect, test, vi } from "vitest";

// tests/setup.ts 默认把这个模块整体 mock 掉（避免用例碰库），这里要测真实实现。
vi.unmock("@/lib/cache-versions");

const state = vi.hoisted(() => ({
  version: "v1",
  selectCalls: 0,
  insertCalls: 0
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            state.selectCalls += 1;
            return [{ valueJson: { version: state.version } }];
          }
        })
      })
    })),
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoUpdate: async () => {
          state.insertCalls += 1;
        }
      })
    }))
  }
}));

import { bumpCacheVersions, getCacheVersion, invalidateCacheVersions } from "@/lib/cache-versions";

describe("缓存版本号的进程内 TTL 缓存", () => {
  beforeEach(() => {
    invalidateCacheVersions();
    state.version = "v1";
    state.selectCalls = 0;
    state.insertCalls = 0;
  });

  test("TTL 内重复读取只查一次库", async () => {
    expect(await getCacheVersion("dashboard")).toBe("v1");
    expect(await getCacheVersion("dashboard")).toBe("v1");
    expect(await getCacheVersion("dashboard")).toBe("v1");

    expect(state.selectCalls).toBe(1);
  });

  test("并发读取共用同一个查询", async () => {
    const values = await Promise.all([
      getCacheVersion("dashboard"),
      getCacheVersion("dashboard"),
      getCacheVersion("dashboard")
    ]);

    expect(values).toEqual(["v1", "v1", "v1"]);
    expect(state.selectCalls).toBe(1);
  });

  test("不同版本域各查各的", async () => {
    await getCacheVersion("dashboard");
    await getCacheVersion("pricing");

    expect(state.selectCalls).toBe(2);
  });

  test("bump 后立刻失效，写后读拿到新版本", async () => {
    await getCacheVersion("dashboard");

    state.version = "v2";
    await bumpCacheVersions(["dashboard"]);

    expect(state.insertCalls).toBe(1);
    expect(await getCacheVersion("dashboard")).toBe("v2");
    expect(state.selectCalls).toBe(2);
  });
});
