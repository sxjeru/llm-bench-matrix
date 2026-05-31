import { describe, expect, test, vi } from "vitest";
import {
  createTimedCacheStore,
  createVersionedCacheStore,
  invalidateTimedCacheStore,
  withTimedCache,
  withVersionedCache
} from "@/lib/server-cache";

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

  test("versioned cache only reloads when probed version changes", async () => {
    const store = createVersionedCacheStore<string>();
    const getVersion = vi.fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await expect(withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion,
      loader
    })).resolves.toBe("first");

    await expect(withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion,
      loader
    })).resolves.toBe("first");

    await expect(withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion,
      loader
    })).resolves.toBe("second");

    expect(getVersion).toHaveBeenCalledTimes(3);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("versioned cache serves stale value when reload fails within stale window", async () => {
    const store = createVersionedCacheStore<string>();
    const getVersion = vi.fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("db unavailable"));

    await withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion,
      loader
    });

    await expect(withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion,
      loader
    })).resolves.toBe("first");
  });
});
