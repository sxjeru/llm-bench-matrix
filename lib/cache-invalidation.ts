import { invalidateCacheVersions, type CacheVersionDomain } from "@/lib/cache-versions";

export const ALL_CACHE_DOMAINS: CacheVersionDomain[] = ["dashboard", "pricing", "admin_entities", "settings"];
/** Duplicate detection uses record values as well as entity names. */
export const RECORD_CACHE_DOMAINS: CacheVersionDomain[] = ["dashboard", "admin_entities"];
/** Pricing queries join models and providers, so entity changes also invalidate pricing. */
export const ENTITY_CACHE_DOMAINS: CacheVersionDomain[] = ["dashboard", "pricing", "admin_entities"];

const invalidators: Array<{ domains: Set<CacheVersionDomain>; fn: () => void }> = [];

export function registerCacheInvalidator(fn: () => void, domains = ALL_CACHE_DOMAINS) {
  const registration = { fn, domains: new Set(domains) };
  invalidators.push(registration);
  return () => {
    const index = invalidators.indexOf(registration);
    if (index >= 0) invalidators.splice(index, 1);
  };
}

/** Only call after the transaction has committed. Never performs database writes. */
export function invalidateLocalCaches(domains: CacheVersionDomain[] = ALL_CACHE_DOMAINS) {
  if (domains.length === 0) return;
  invalidateCacheVersions();
  const changed = new Set(domains);
  for (const { fn, domains: dependencies } of invalidators) {
    if ([...changed].some((domain) => dependencies.has(domain))) fn();
  }
}
