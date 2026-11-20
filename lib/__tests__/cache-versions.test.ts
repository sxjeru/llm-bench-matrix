import { beforeEach, describe, expect, test, vi } from "vitest";
vi.unmock("@/lib/cache-versions");
type VersionRow = { key: string; valueJson: { version: string } };
const state = vi.hoisted(() => ({ version: "v1", reads: 0, writes: vi.fn(), pendingReads: [] as Promise<VersionRow[]>[] }));
vi.mock("@/lib/db/client", () => ({ db: {
  select: () => ({ from: () => ({ where: async () => {
    state.reads++;
    const pending = state.pendingReads.shift();
    if (pending) return pending;
    return ["dashboard", "pricing", "admin_entities", "settings"].map(domain => ({
      key: `cache_version:${domain}`, valueJson: { version: `${domain}-${state.version}` }
    }));
  } }) }),
  insert: () => ({ values: (rows: unknown) => ({ onConflictDoUpdate: async () => state.writes(rows) }) })
} }));
import { bumpCacheVersions, getCacheVersion, getCacheVersions, invalidateCacheVersions } from "@/lib/cache-versions";

describe("coherent cache versions", () => {
  beforeEach(() => { invalidateCacheVersions(); state.version = "v1"; state.reads = 0; state.writes.mockReset(); state.pendingReads = []; });
  test("concurrent domains share one query and one TTL entry", async () => {
    expect(await Promise.all([getCacheVersion("dashboard"), getCacheVersion("pricing"), getCacheVersions()]))
      .toEqual(["dashboard-v1", "pricing-v1", {
        dashboard: "dashboard-v1", pricing: "pricing-v1", admin_entities: "admin_entities-v1", settings: "settings-v1"
      }]);
    expect(state.reads).toBe(1);
  });
  test("all changed domains use one upsert, with duplicates removed and stable lock order", async () => {
    await bumpCacheVersions(["settings", "dashboard", "settings"]);
    expect(state.writes).toHaveBeenCalledTimes(1);
    expect(state.writes.mock.calls[0][0].map((row: { key: string }) => row.key))
      .toEqual(["cache_version:dashboard", "cache_version:settings"]);
  });
  test("standalone bump expires the vector after the write", async () => {
    await getCacheVersions(); state.version = "v2";
    await bumpCacheVersions(["dashboard"]);
    expect(await getCacheVersion("dashboard")).toBe("dashboard-v2");
    expect(state.reads).toBe(2);
  });
  test("transaction bump does not expose uncommitted versions through local invalidation", async () => {
    await getCacheVersions(); state.version = "v2";
    const writer = { insert: vi.fn(() => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) })) };
    await bumpCacheVersions(["dashboard"], writer as never);
    expect(await getCacheVersion("dashboard")).toBe("dashboard-v1");
    invalidateCacheVersions();
    expect(await getCacheVersion("dashboard")).toBe("dashboard-v2");
  });
  test("fresh read publishes a coherent vector for subsequent TTL hits", async () => {
    await getCacheVersions(); state.version = "v2";
    expect((await getCacheVersions({ fresh: true })).dashboard).toBe("dashboard-v2");
    expect((await getCacheVersions()).dashboard).toBe("dashboard-v2");
    expect(state.reads).toBe(2);
  });
  test("a late normal probe cannot overwrite a fresh result", async () => {
    const old = pendingRead(); state.pendingReads.push(old.promise);
    const first = getCacheVersions();
    state.version = "v2";
    expect((await getCacheVersions({ fresh: true })).dashboard).toBe("dashboard-v2");
    old.resolve(rowsFor("v1"));
    expect((await first).dashboard).toBe("dashboard-v1");
    expect((await getCacheVersions()).dashboard).toBe("dashboard-v2");
    expect(state.reads).toBe(2);
  });
  test("overlapping fresh probes do not join an older validation or publish it late", async () => {
    const old = pendingRead(); state.pendingReads.push(old.promise);
    const first = getCacheVersions({ fresh: true });
    state.version = "v2";
    await getCacheVersions({ fresh: true });
    old.resolve(rowsFor("v1"));
    await first;
    expect((await getCacheVersions()).dashboard).toBe("dashboard-v2");
    expect(state.reads).toBe(2);
  });
  test("post-commit invalidation fences a fresh query that began before the commit", async () => {
    const old = pendingRead(); state.pendingReads.push(old.promise);
    const first = getCacheVersions({ fresh: true });
    invalidateCacheVersions(); state.version = "v2";
    await getCacheVersions();
    old.resolve(rowsFor("v1")); await first;
    expect((await getCacheVersions()).dashboard).toBe("dashboard-v2");
    expect(state.reads).toBe(2);
  });
  test("failed refresh retains an unexpired previously published vector", async () => {
    await getCacheVersions();
    const failed = pendingRead(); state.pendingReads.push(failed.promise);
    const refresh = getCacheVersions({ fresh: true });
    failed.reject(new Error("database unavailable"));
    await expect(refresh).rejects.toThrow("database unavailable");
    expect((await getCacheVersions()).dashboard).toBe("dashboard-v1");
    expect(state.reads).toBe(2);
  });
  test("expired TTL reloads all domains together", async () => {
    vi.useFakeTimers();
    try {
      await getCacheVersions(); state.version = "v2";
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await getCacheVersions()).pricing).toBe("pricing-v2");
      expect(state.reads).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});

function rowsFor(version: string): VersionRow[] {
  return ["dashboard", "pricing", "admin_entities", "settings"].map((domain) => ({
    key: `cache_version:${domain}`, valueJson: { version: `${domain}-${version}` }
  }));
}
function pendingRead() {
  let resolve!: (rows: VersionRow[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<VersionRow[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
