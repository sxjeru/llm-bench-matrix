import { withCacheMutation } from "@/lib/cache-mutation";
import { ENTITY_CACHE_DOMAINS } from "@/lib/cache-invalidation";
import { rebuildBenchmarkCanonicalKeysByRule, rebuildModelCanonicalKeysByRule } from "@/lib/admin-service";
import { saveSetting } from "@/lib/db/queries";

export async function updateAdminSetting(input: Parameters<typeof saveSetting>[0]) {
  if (input.key.startsWith("cache_version:")) throw new Error("缓存版本号由系统管理");
  return withCacheMutation(
    input.key === "model_dedupe_rule" ? [...ENTITY_CACHE_DOMAINS, "settings"] : ["settings"],
    async (tx) => {
      await saveSetting(input, tx);
      if (input.key !== "model_dedupe_rule") return { ok: true };

      // Both rebuilds share the setting transaction, so a failure rolls back all three.
      const model = await rebuildModelCanonicalKeysByRule(input.valueJson, tx);
      const benchmark = await rebuildBenchmarkCanonicalKeysByRule(input.valueJson, tx);
      return {
        ok: true,
        rebuildResult: {
          model,
          benchmark,
          mergedCount: model.mergedCount,
          benchmarkMergedCount: benchmark.mergedCount
        }
      };
    }
  );
}
