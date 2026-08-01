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

  /**
   * 回归用例：/ 与 /scatter 都声明了 revalidate = false，会一直留在 Full Route Cache 里。
   * 单参数的 revalidatePath("/") 只失效首页，会把 /scatter 留在旧数据上直到重新部署。
   */
  test("使用 layout 级重新验证，一次覆盖 root layout 下的全部静态路由", async () => {
    await invalidateAllCaches();

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/", "layout");
  });

  test("revalidatePath 在非渲染上下文抛 static generation store missing 时静默吞掉", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath");
    });

    await expect(invalidateAllCaches()).resolves.toBeUndefined();
  });

  test("revalidatePath 抛其他错误时继续向上抛出", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await expect(invalidateAllCaches()).rejects.toThrow("boom");
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

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/", "layout");
  });
});
