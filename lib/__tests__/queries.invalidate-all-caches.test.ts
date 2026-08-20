import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/cache-versions", () => ({
  bumpCacheVersions: vi.fn(async () => undefined),
  getCacheVersion: vi.fn(async () => "v1")
}));

vi.mock("@/lib/model-pricing", () => ({
  invalidateModelPricingCaches: vi.fn()
}));

import { revalidatePath } from "next/cache";

import { bumpCacheVersions } from "@/lib/cache-versions";
import { invalidateAllCaches } from "@/lib/db/queries";

describe("invalidateAllCaches 不触发 ISR 页面重生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("不调用 revalidatePath，避免 Vercel 把静态首页打进按需重生锁", async () => {
    await invalidateAllCaches();

    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  test("跳过版本 bump 时也不触发页面重新验证", async () => {
    await invalidateAllCaches({ skipVersionBump: ["pricing"] });

    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });
});

describe("invalidateAllCaches 的缓存版本 bump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("默认 bump 全部版本域", async () => {
    await invalidateAllCaches();

    expect(vi.mocked(bumpCacheVersions)).toHaveBeenCalledWith(["dashboard", "pricing", "admin_entities", "settings"]);
  });

  test("skipVersionBump 只跳过指定域，其余照常 bump", async () => {
    await invalidateAllCaches({ skipVersionBump: ["pricing"] });

    expect(vi.mocked(bumpCacheVersions)).toHaveBeenCalledWith(["dashboard", "admin_entities", "settings"]);
  });
});
