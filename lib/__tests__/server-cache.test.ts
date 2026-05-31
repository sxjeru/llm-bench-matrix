import { describe, expect, test, vi } from "vitest";
import {
  createTimedCacheStore,
  createVersionedCacheStore,
  invalidateTimedCacheStore,
  invalidateVersionedCacheStore,
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

  test("versioned cache serves stale value when version probe fails within stale window", async () => {
    const store = createVersionedCacheStore<string>();
    const getVersion = vi.fn()
      .mockResolvedValueOnce("v1")
      .mockRejectedValueOnce(new Error("db unavailable"));
    const loader = vi.fn()
      .mockResolvedValueOnce("first");

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

    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("versioned cache does not serve stale value on loader failure if store is invalidated during execution", async () => {
    const store = createVersionedCacheStore<string>();
    
    // First, populate the cache with a valid versioned entry
    const getVersion1 = vi.fn().mockResolvedValue("v1");
    const loader1 = vi.fn().mockResolvedValue("first");
    await withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion: getVersion1,
      loader: loader1
    });

    // Verify it is cached
    expect(store.cache.get("key")?.value).toBe("first");

    // Second call: getVersion succeeds (with a new version), but loader fails.
    // During loader execution, we invalidate the store.
    const getVersion2 = vi.fn().mockResolvedValue("v2");
    let rejectLoaderPromise: (err: Error) => void = () => {};
    let signalLoaderStarted: () => void = () => {};
    const loaderStarted = new Promise<void>((resolve) => {
      signalLoaderStarted = resolve;
    });
    
    const loader2 = vi.fn(() => {
      signalLoaderStarted();
      return new Promise<string>((resolve, reject) => {
        rejectLoaderPromise = reject;
      });
    });

    const pending = withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion: getVersion2,
      loader: loader2
    });

    // Wait for loader to start
    await loaderStarted;

    // While loader2 is running, invalidate the store
    invalidateVersionedCacheStore(store);

    // Now fail loader2
    rejectLoaderPromise(new Error("loader error"));


    // We expect the pending call to throw the error, rather than fallback to "first" (which was invalidated)
    await expect(pending).rejects.toThrow("loader error");
  });

  test("versioned cache does not serve stale value on getVersion failure if store is invalidated during execution", async () => {
    const store = createVersionedCacheStore<string>();
    
    // First, populate the cache with a valid versioned entry
    const getVersion1 = vi.fn().mockResolvedValue("v1");
    const loader1 = vi.fn().mockResolvedValue("first");
    await withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion: getVersion1,
      loader: loader1
    });

    // Second call: getVersion fails.
    // During getVersion execution, we invalidate the store.
    let rejectVersionPromise: (err: Error) => void = () => {};
    
    const getVersion2 = vi.fn(() => new Promise<string>((resolve, reject) => {
      rejectVersionPromise = reject;
    }));

    const pending = withVersionedCache(store, "key", {
      versionProbeTtlMs: 0,
      staleIfErrorMs: 60_000,
      getVersion: getVersion2,
      loader: () => Promise.resolve("second")
    });

    // While getVersion2 is running, invalidate the store
    invalidateVersionedCacheStore(store);

    // Now fail getVersion2
    rejectVersionPromise(new Error("getVersion error"));

    // We expect the pending call to throw the error, rather than fallback to "first" (which was invalidated)
    await expect(pending).rejects.toThrow("getVersion error");
  });
});

