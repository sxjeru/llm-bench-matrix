export type TimedCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type TimedCacheStore<T> = {
  cache: Map<string, TimedCacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  generation: number;
};

export type VersionedCacheEntry<T> = {
  value: T;
  version: string;
  nextVersionCheckAt: number;
  staleUntil: number;
};

export type VersionedCacheStore<T> = {
  cache: Map<string, VersionedCacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  generation: number;
};

export function createTimedCacheStore<T>(): TimedCacheStore<T> {
  return {
    cache: new Map<string, TimedCacheEntry<T>>(),
    inFlight: new Map<string, Promise<T>>(),
    generation: 0
  };
}

export function createVersionedCacheStore<T>(): VersionedCacheStore<T> {
  return {
    cache: new Map<string, VersionedCacheEntry<T>>(),
    inFlight: new Map<string, Promise<T>>(),
    generation: 0
  };
}

export function invalidateTimedCacheStore(store: TimedCacheStore<unknown>) {
  store.generation += 1;
  store.cache.clear();
  store.inFlight.clear();
}

export function invalidateVersionedCacheStore(store: VersionedCacheStore<unknown>) {
  store.generation += 1;
  store.cache.clear();
  store.inFlight.clear();
}

export async function withTimedCache<T>(
  store: TimedCacheStore<T>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = store.cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pending = store.inFlight.get(key);
  if (pending) {
    return pending;
  }

  const generation = store.generation;
  const promise = loader()
    .then((value) => {
      if (store.generation === generation) {
        store.cache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs
        });
      }
      return value;
    })
    .finally(() => {
      if (store.inFlight.get(key) === promise) {
        store.inFlight.delete(key);
      }
    });

  store.inFlight.set(key, promise);
  return promise;
}

export async function withVersionedCache<T>(
  store: VersionedCacheStore<T>,
  key: string,
  options: {
    versionProbeTtlMs: number;
    staleIfErrorMs: number;
    getVersion: () => Promise<string>;
    loader: () => Promise<T>;
  }
): Promise<T> {
  const now = Date.now();
  const cached = store.cache.get(key);

  if (cached && cached.nextVersionCheckAt > now) {
    return cached.value;
  }

  const pending = store.inFlight.get(key);
  if (pending) {
    return pending;
  }

  const generation = store.generation;
  const promise = (async () => {
    try {
      const version = await options.getVersion();
      const latestCached = store.cache.get(key);

      if (latestCached && latestCached.version === version) {
        const nextEntry = {
          ...latestCached,
          nextVersionCheckAt: Date.now() + options.versionProbeTtlMs
        };
        if (store.generation === generation) {
          store.cache.set(key, nextEntry);
        }
        return latestCached.value;
      }

      const value = await options.loader();
      if (store.generation === generation) {
        store.cache.set(key, {
          value,
          version,
          nextVersionCheckAt: Date.now() + options.versionProbeTtlMs,
          staleUntil: Date.now() + options.staleIfErrorMs
        });
      }
      return value;
    } catch (error) {
      const latestCached = store.cache.get(key);
      if (latestCached && latestCached.staleUntil > Date.now()) {
        return latestCached.value;
      }
      throw error;
    }
  })().finally(() => {
    if (store.inFlight.get(key) === promise) {
      store.inFlight.delete(key);
    }
  });

  store.inFlight.set(key, promise);
  return promise;
}
