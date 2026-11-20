import type { CacheVersionDomain } from "@/lib/cache-versions";

/** A live loader crossed a committed write; its result must never be cached. */
export class CacheVersionChangedError extends Error {
  constructor(readonly versions: Record<CacheVersionDomain, string>) {
    super("Cache version changed while loading data");
    this.name = "CacheVersionChangedError";
  }
}
