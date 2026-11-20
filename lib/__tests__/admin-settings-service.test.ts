import { beforeEach, describe, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ tx: { insert: vi.fn() }, committed: false }));
vi.mock("@/lib/db/client", () => ({ db: {
  transaction: vi.fn(async (write) => { const result = await write(state.tx); state.committed = true; return result; })
} }));
vi.mock("@/lib/db/queries", () => ({ saveSetting: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-service", () => ({
  rebuildModelCanonicalKeysByRule: vi.fn(async () => ({ mergedCount: 2 })),
  rebuildBenchmarkCanonicalKeysByRule: vi.fn(async () => ({ mergedCount: 3 }))
}));
import { bumpCacheVersions } from "@/lib/cache-versions";
import { updateAdminSetting } from "@/lib/admin-settings-service";
import { saveSetting } from "@/lib/db/queries";
import { rebuildBenchmarkCanonicalKeysByRule, rebuildModelCanonicalKeysByRule } from "@/lib/admin-service";
import { db } from "@/lib/db/client";

beforeEach(() => { vi.clearAllMocks(); state.committed = false; });
describe("settings mutation composition", () => {
  test("setting and both canonical rebuilds share one transaction and one bump", async () => {
    const input = { key: "model_dedupe_rule", valueJson: { lowercase: true } };
    const result = await updateAdminSetting(input);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(saveSetting).toHaveBeenCalledWith(input, state.tx);
    expect(rebuildModelCanonicalKeysByRule).toHaveBeenCalledWith(input.valueJson, state.tx);
    expect(rebuildBenchmarkCanonicalKeysByRule).toHaveBeenCalledWith(input.valueJson, state.tx);
    expect(bumpCacheVersions).toHaveBeenCalledTimes(1);
    expect(bumpCacheVersions).toHaveBeenCalledWith(["dashboard", "pricing", "admin_entities", "settings"], state.tx);
    expect(result.rebuildResult?.benchmarkMergedCount).toBe(3);
    expect(state.committed).toBe(true);
  });
  test("rebuild failure aborts the setting change before publishing a version", async () => {
    vi.mocked(rebuildBenchmarkCanonicalKeysByRule).mockRejectedValueOnce(new Error("rebuild failed"));
    await expect(updateAdminSetting({ key: "model_dedupe_rule", valueJson: {} })).rejects.toThrow("rebuild failed");
    expect(state.committed).toBe(false); expect(bumpCacheVersions).not.toHaveBeenCalled();
  });
  test("ordinary setting only updates settings domain", async () => {
    await updateAdminSetting({ key: "export_footnote_text", valueJson: "Source" });
    expect(bumpCacheVersions).toHaveBeenCalledWith(["settings"], state.tx);
    expect(rebuildModelCanonicalKeysByRule).not.toHaveBeenCalled();
  });
  test("system versions cannot be overwritten through ordinary settings", async () => {
    await expect(updateAdminSetting({ key: "cache_version:dashboard", valueJson: "0" })).rejects.toThrow("系统管理");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
