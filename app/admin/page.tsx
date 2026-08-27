import { AdminConsole } from "@/components/admin-console";
import type { TabKey } from "@/components/admin-console/types";
import { isAdminAuthorized } from "../../lib/admin-auth";
import { getActiveEntities, getMergedEntityRecords, getSettings, getSourceOptions } from "../../lib/db/queries";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const headerStore = await headers();
  const cookie = headerStore.get("cookie") ?? "";
  const authRequest = new Request("http://localhost/admin", {
    headers: cookie ? { cookie } : {}
  });

  const authorized = await isAdminAuthorized(authRequest);
  if (!authorized) {
    redirect("/admin/login?from=/admin");
  }

  const [{ providers, models, benchmarks }, settings, mergedRecords, sourceOptions] = await Promise.all([
    getActiveEntities(),
    getSettings(),
    getMergedEntityRecords(),
    getSourceOptions()
  ]);

  const resolvedSearchParams = await searchParams;
  const VALID_TABS: TabKey[] = ["import", "external", "providers", "pricing", "params", "rename", "merge", "records", "maintenance", "settings"];
  const rawTab = resolvedSearchParams.tab ?? "import";
  const initialTab: TabKey = VALID_TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : "import";

  return (
    <AdminConsole
      initialTab={initialTab}
      providers={providers.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        config: item.config
      }))}
      models={models.map((item) => ({
        id: item.id,
        providerId: item.providerId,
        modelName: item.modelName,
        canonicalKey: item.canonicalKey
      }))}
      benchmarks={benchmarks.map((item) => ({
        id: item.id,
        benchmarkName: item.benchmarkName,
        benchmarkType: item.benchmarkType,
        modalities: item.modalities,
        valueCount: item.valueCount,
        overHundredValueCount: item.overHundredValueCount
      }))}
      sourceOptions={sourceOptions ?? []}
      mergedRecords={mergedRecords}
      initialSettings={settings}
    />
  );
}
