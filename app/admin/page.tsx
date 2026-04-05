import { AdminConsole } from "../../components/admin-console";
import { isAdminAuthorized } from "../../lib/admin-auth";
import { getActiveEntities, getSettings } from "../../lib/db/queries";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const headerStore = await headers();
  const cookie = headerStore.get("cookie") ?? "";
  const authRequest = new Request("http://localhost/admin", {
    headers: cookie ? { cookie } : {}
  });

  const authorized = await isAdminAuthorized(authRequest);
  if (!authorized) {
    redirect("/admin/login?from=/admin");
  }

  const { providers, models, benchmarks } = await getActiveEntities();
  const settings = await getSettings();

  return (
    <>
      <section className="card">
        <h1>后台管理</h1>
        <p className="subtitle">新增数据、批量导入、实体合并、设置项维护。新增后如需看到最新下拉列表，请刷新页面。</p>
      </section>

      <AdminConsole
        providers={providers.map((item) => ({
          id: item.id,
          name: item.name,
          slug: item.slug
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
          modalities: item.modalities
        }))}
        initialSettings={settings}
      />
    </>
  );
}
