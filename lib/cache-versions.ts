import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { createTimedCacheStore, invalidateTimedCacheStore, withTimedCache } from "@/lib/server-cache";

export type CacheVersionDomain = "dashboard" | "pricing" | "admin_entities" | "settings";

/** The small part of a Drizzle database/transaction client needed to write versions. */
export type CacheVersionWriter = Pick<typeof db, "insert">;

const CACHE_VERSION_KEY_PREFIX = "cache_version:";

/**
 * Cache one version vector for 5 seconds. Mutation callers expire it only after
 * commit; other instances converge on their next probe. Fresh reads are used to
 * validate a newly built response against a concurrent database commit.
 */
const CACHE_VERSION_TTL_MS = 5_000;
const cacheVersionStore = createTimedCacheStore<Record<CacheVersionDomain, string>>();
const DOMAINS: CacheVersionDomain[] = ["dashboard", "pricing", "admin_entities", "settings"];

export function invalidateCacheVersions(): void {
  invalidateTimedCacheStore(cacheVersionStore);
}

function getCacheVersionKey(domain: CacheVersionDomain) {
  return `${CACHE_VERSION_KEY_PREFIX}${domain}`;
}

function parseCacheVersion(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const version = (value as Record<string, unknown>).version;
    if (typeof version === "string") return version;
    if (typeof version === "number" && Number.isFinite(version)) return String(version);
  }
  return "0";
}

function createCacheVersionValue() {
  return `${Date.now()}:${crypto.randomUUID()}`;
}

/** Read all domains in one statement and cache one coherent version vector. */
export async function getCacheVersions(options?: { fresh?: boolean }): Promise<Record<CacheVersionDomain, string>> {
  const load = async () => {
    const rows = await db.select({ key: settings.key, valueJson: settings.valueJson })
      .from(settings).where(inArray(settings.key, DOMAINS.map(getCacheVersionKey)));
    const values = new Map(rows.map((row) => [row.key, row.valueJson]));
    return Object.fromEntries(DOMAINS.map((domain) => [
      domain, parseCacheVersion(values.get(getCacheVersionKey(domain)))
    ])) as Record<CacheVersionDomain, string>;
  };
  return withTimedCache(cacheVersionStore, "all", CACHE_VERSION_TTL_MS, load, {
    refresh: options?.fresh
  });
}

export async function getCacheVersion(domain: CacheVersionDomain): Promise<string> {
  return (await getCacheVersions())[domain];
}

/**
 * A single atomic SQL statement. With a transaction writer, the caller must clear
 * local caches AFTER commit; clearing here would expose uncommitted versions.
 */
export async function bumpCacheVersions(domains: CacheVersionDomain[], writer?: CacheVersionWriter) {
  const uniqueDomains = [...new Set(domains)].sort();
  if (uniqueDomains.length === 0) return;
  const now = new Date();
  await (writer ?? db).insert(settings).values(uniqueDomains.map((domain) => ({
    key: getCacheVersionKey(domain),
    valueJson: { version: createCacheVersionValue() },
    updatedAt: now,
    updatedBy: "cache-system",
    note: "Cache version"
  }))).onConflictDoUpdate({
    target: settings.key,
    set: {
      valueJson: sql`excluded.value_json`,
      updatedAt: sql`excluded.updated_at`,
      updatedBy: sql`excluded.updated_by`,
      note: sql`excluded.note`
    }
  });
  if (!writer) invalidateCacheVersions();
}

export function isCacheVersionSettingKey(key: string) {
  return key.startsWith(CACHE_VERSION_KEY_PREFIX);
}
