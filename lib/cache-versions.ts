import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

export type CacheVersionDomain = "dashboard" | "pricing" | "admin_entities" | "settings";

const CACHE_VERSION_KEY_PREFIX = "cache_version:";

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

export async function getCacheVersion(domain: CacheVersionDomain): Promise<string> {
  const [row] = await db
    .select({ valueJson: settings.valueJson })
    .from(settings)
    .where(eq(settings.key, getCacheVersionKey(domain)))
    .limit(1);

  return parseCacheVersion(row?.valueJson);
}

export async function bumpCacheVersions(domains: CacheVersionDomain[]) {
  const uniqueDomains = Array.from(new Set(domains));
  if (uniqueDomains.length === 0) return;

  const now = new Date();
  await Promise.all(uniqueDomains.map((domain) => {
    const valueJson = { version: createCacheVersionValue() };
    return db
      .insert(settings)
      .values({
        key: getCacheVersionKey(domain),
        valueJson,
        updatedAt: now,
        updatedBy: "cache-system",
        note: "Cache version"
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          valueJson,
          updatedAt: now,
          updatedBy: "cache-system",
          note: "Cache version"
        }
      });
  }));
}

export function isCacheVersionSettingKey(key: string) {
  return key.startsWith(CACHE_VERSION_KEY_PREFIX);
}
