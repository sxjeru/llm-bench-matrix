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

describe("invalidateAllCaches 的页面重新验证", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("仅重新验证依赖公开数据的两个静态页面", async () => {
    await invalidateAllCaches();

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(revalidatePath)).toHaveBeenNthCalledWith(1, "/", "page");
    expect(vi.mocked(revalidatePath)).toHaveBeenNthCalledWith(2, "/scatter", "page");
  });

  test("可忽略异常不会阻断后续公开页面重新验证", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath");
    });

    await expect(invalidateAllCaches()).resolves.toBeUndefined();
    expect(vi.mocked(revalidatePath)).toHaveBeenNthCalledWith(2, "/scatter", "page");
  });

  test("revalidatePath 抛其他错误时继续向上抛出", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await expect(invalidateAllCaches()).rejects.toThrow("boom");
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateAllCaches 的缓存版本 bump", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("默认 bump 全部版本域", async () => {
    await invalidateAllCaches();

    expect(vi.mocked(bumpCacheVersions)).toHaveBeenCalledWith(["dashboard", "pricing", "admin_entities"]);
  });

  test("skipVersionBump 只跳过指定域，其余照常 bump", async () => {
    await invalidateAllCaches({ skipVersionBump: ["pricing"] });

    expect(vi.mocked(bumpCacheVersions)).toHaveBeenCalledWith(["dashboard", "admin_entities"]);
  });

  test("跳过版本 bump 时仍然重新验证页面", async () => {
    await invalidateAllCaches({ skipVersionBump: ["pricing"] });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/", "page");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/scatter", "page");
  });
});
