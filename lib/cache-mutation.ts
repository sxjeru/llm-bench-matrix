import { db } from "@/lib/db/client";
import { bumpCacheVersions, type CacheVersionDomain, type CacheVersionWriter } from "@/lib/cache-versions";
import { invalidateLocalCaches } from "@/lib/cache-invalidation";

export type MutationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TransactionRunner<Tx> = { transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> };
type ChangedDomains<T> = CacheVersionDomain[] | ((result: T) => CacheVersionDomain[]);

/**
 * The version upsert is the last statement of the business transaction. Failure
 * rolls back both. Each call owns its domain set; concurrent requests never share it.
 * Composition passes the transaction to lower-level writers instead of nesting
 * another mutation or publishing intermediate versions.
 */
export async function withCacheMutation<T, Tx extends CacheVersionWriter = MutationTransaction>(
  domains: ChangedDomains<T>,
  write: (tx: Tx) => Promise<T>,
  runner: TransactionRunner<Tx> = db as unknown as TransactionRunner<Tx>
): Promise<T> {
  let changed: CacheVersionDomain[] = [];
  const result = await runner.transaction(async (tx) => {
    const value = await write(tx);
    changed = [...new Set(typeof domains === "function" ? domains(value) : domains)];
    if (changed.length > 0) await bumpCacheVersions(changed, tx);
    return value;
  });
  invalidateLocalCaches(changed);
  return result;
}
