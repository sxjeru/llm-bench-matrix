import { describe, expect, test, vi } from "vitest";
import { withCacheVersionTransaction } from "@/scripts/cache-mutation.mjs";

function fixture(failVersion = false) {
  const connection = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (failVersion && sql.includes("INSERT INTO settings")) throw new Error("version failed");
    }),
    release: vi.fn()
  };
  return { connection, pool: { connect: vi.fn(async () => connection) } };
}
describe("standalone script cache publication", () => {
  test("business writes and one deduplicated version upsert use the pinned connection", async () => {
    const { connection, pool } = fixture();
    await withCacheVersionTransaction(pool, ["settings", "dashboard", "dashboard"], async (tx) => {
      expect(tx).toBe(connection); await tx.query("UPDATE models");
    });
    const calls = connection.query.mock.calls;
    expect(calls.map(([sql]) => sql.includes("INSERT INTO settings") ? "versions" : sql))
      .toEqual(["BEGIN", "UPDATE models", "versions", "COMMIT"]);
    expect(calls[2][1]?.[0]).toEqual(["cache_version:dashboard", "cache_version:settings"]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
  test("version failure rolls back before releasing the connection", async () => {
    const { connection, pool } = fixture(true);
    await expect(withCacheVersionTransaction(pool, ["dashboard"], async (tx) => tx.query("UPDATE models")))
      .rejects.toThrow("version failed");
    expect(connection.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(connection.query).not.toHaveBeenCalledWith("COMMIT");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
  test("no-op commits without bumping versions", async () => {
    const { connection, pool } = fixture();
    await withCacheVersionTransaction(pool, () => [], async () => 0);
    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
  });
});
