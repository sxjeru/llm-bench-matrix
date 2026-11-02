import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { createTimedCacheStore, invalidateTimedCacheStore, withTimedCache } from "@/lib/server-cache";

export type CacheVersionDomain = "dashboard" | "pricing" | "admin_entities" | "settings";

const CACHE_VERSION_KEY_PREFIX = "cache_version:";

/**
 * 版本号是「每次公开请求都要读一遍」的元数据：
 * `/api/public/dashboard` 一次要读 dashboard / pricing / settings 三个域，
 * 而它们只有在后台写入时才会变。给 5 s 的进程内 TTL 后，热请求的这条路径
 * 是零数据库往返（原本是 3 次串行远程查询，实测 60–100 ms）。
 *
 * 失效由 bumpCacheVersions 自己负责，写库成功后立刻清空，
 * 所以本进程内的「写后读」仍是强一致的；跨实例最多滞后一个 TTL，
 * 而下游拿到的始终是与其版本号自洽的旧快照，不会出现版本与数据错配。
 */
const CACHE_VERSION_TTL_MS = 5_000;
const cacheVersionStore = createTimedCacheStore<string>();

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

export async function getCacheVersion(domain: CacheVersionDomain): Promise<string> {
  return withTimedCache(
    cacheVersionStore,
    domain,
    CACHE_VERSION_TTL_MS,
    () => loadCacheVersion(domain)
  );
}

async function loadCacheVersion(domain: CacheVersionDomain): Promise<string> {
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

  // 写库之后清，顺序不能反：先清空再写，中间插进来的读会把旧值又缓存一遍。
  invalidateCacheVersions();
}

export function isCacheVersionSettingKey(key: string) {
  return key.startsWith(CACHE_VERSION_KEY_PREFIX);
}
