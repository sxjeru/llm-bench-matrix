import { describe, expect, test, vi } from "vitest";
import { createTimedCacheStore, invalidateTimedCacheStore, withTimedCache } from "@/lib/server-cache";

describe("server timed cache", () => {
  test("dedupes concurrent loads", async () => {
    const store = createTimedCacheStore<string>();
    const loader = vi.fn(async () => "value");

    await Promise.all([
      withTimedCache(store, "key", 60_000, loader),
      withTimedCache(store, "key", 60_000, loader)
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("does not store stale in-flight result after invalidation", async () => {
    const store = createTimedCacheStore<string>();
    let resolveLoader: (value: string) => void = () => undefined;
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoader = resolve;
    }));

    const pending = withTimedCache(store, "key", 60_000, loader);
    invalidateTimedCacheStore(store);
    resolveLoader("stale");

    await expect(pending).resolves.toBe("stale");

    const freshLoader = vi.fn(async () => "fresh");
    await expect(withTimedCache(store, "key", 60_000, freshLoader)).resolves.toBe("fresh");

    expect(freshLoader).toHaveBeenCalledTimes(1);
  });
});
