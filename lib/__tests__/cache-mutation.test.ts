import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({ db: {} }));
import { bumpCacheVersions } from "@/lib/cache-versions";
import { withCacheMutation } from "@/lib/cache-mutation";
import { invalidateLocalCaches, registerCacheInvalidator } from "@/lib/cache-invalidation";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); });
beforeEach(() => { vi.mocked(bumpCacheVersions).mockReset().mockResolvedValue(undefined); });

describe("atomic mutation publication", () => {
  test("writes versions on the business transaction and invalidates only after commit", async () => {
    const order: string[] = [];
    const tx = { insert: vi.fn() };
    vi.mocked(bumpCacheVersions).mockImplementation(async (domains, writer) => {
      expect(writer).toBe(tx); expect(domains).toEqual(["dashboard"]); order.push("versions");
    });
    cleanups.push(registerCacheInvalidator(() => order.push("invalidate"), ["dashboard"]));
    const runner = { transaction: async <T,>(fn: (writer: typeof tx) => Promise<T>) => {
      const result = await fn(tx); order.push("commit"); return result;
    } };
    expect(await withCacheMutation(["dashboard", "dashboard"], async () => { order.push("data"); return 42; }, runner as never)).toBe(42);
    expect(order).toEqual(["data", "versions", "commit", "invalidate"]);
  });
  test("version failure rolls back business changes and leaves local caches intact", async () => {
    let committed = "old";
    const invalidate = vi.fn(); cleanups.push(registerCacheInvalidator(invalidate, ["dashboard"]));
    vi.mocked(bumpCacheVersions).mockRejectedValueOnce(new Error("version write failed"));
    const runner = { transaction: async <T,>(fn: (writer: { insert: ReturnType<typeof vi.fn> }) => Promise<T>) => {
      const result = await fn({ insert: vi.fn() }); committed = "new"; return result;
    } };
    await expect(withCacheMutation(["dashboard"], async () => "new", runner as never)).rejects.toThrow("version write failed");
    expect(committed).toBe("old"); expect(invalidate).not.toHaveBeenCalled();
  });
  test("commit failure cannot invalidate caches", async () => {
    const invalidate = vi.fn(); cleanups.push(registerCacheInvalidator(invalidate));
    const runner = { transaction: async <T,>(fn: (writer: { insert: ReturnType<typeof vi.fn> }) => Promise<T>): Promise<T> => {
      await fn({ insert: vi.fn() }); throw new Error("commit failed");
    } };
    await expect(withCacheMutation(["dashboard"], async () => 1, runner as never)).rejects.toThrow("commit failed");
    expect(invalidate).not.toHaveBeenCalled();
  });
  test("no-op skips version writes and invalidation", async () => {
    const invalidate = vi.fn(); cleanups.push(registerCacheInvalidator(invalidate));
    const runner = { transaction: async <T,>(fn: (writer: { insert: ReturnType<typeof vi.fn> }) => Promise<T>) => fn({ insert: vi.fn() }) };
    await withCacheMutation(() => [], async () => 0, runner as never);
    expect(bumpCacheVersions).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
  test("dependency sets invalidate only intersecting caches", () => {
    const dashboard = vi.fn(), pricing = vi.fn(), snapshot = vi.fn(), admin = vi.fn();
    cleanups.push(registerCacheInvalidator(dashboard, ["dashboard"]), registerCacheInvalidator(pricing, ["pricing"]), registerCacheInvalidator(snapshot, ["dashboard", "pricing", "settings"]), registerCacheInvalidator(admin, ["admin_entities"]));
    invalidateLocalCaches(["dashboard"]);
    expect(dashboard).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1);
    expect(pricing).not.toHaveBeenCalled(); expect(admin).not.toHaveBeenCalled();
  });
  test("concurrent mutations keep separate domain sets", async () => {
    const runner = { transaction: async <T,>(fn: (writer: { insert: ReturnType<typeof vi.fn> }) => Promise<T>) => fn({ insert: vi.fn() }) };
    await Promise.all([
      withCacheMutation(["dashboard"], async () => 1, runner as never),
      withCacheMutation(["pricing"], async () => 2, runner as never)
    ]);
    expect(vi.mocked(bumpCacheVersions).mock.calls.map(([domains]) => domains)).toEqual([["dashboard"], ["pricing"]]);
  });
});
