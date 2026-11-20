import { beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("@/lib/db/client", () => ({ db: { transaction: vi.fn(async (fn) => fn({ insert: vi.fn() })) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from "next/cache";
import { bumpCacheVersions } from "@/lib/cache-versions";
import { invalidateAllCaches } from "@/lib/db/queries";

describe("explicit full refresh", () => {
  beforeEach(() => vi.clearAllMocks());
  test("bumps all domains once in a transaction without triggering document ISR", async () => {
    await invalidateAllCaches();
    expect(bumpCacheVersions).toHaveBeenCalledTimes(1);
    expect(bumpCacheVersions).toHaveBeenCalledWith(["dashboard", "pricing", "admin_entities", "settings"], expect.objectContaining({ insert: expect.any(Function) }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
