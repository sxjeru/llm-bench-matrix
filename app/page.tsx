import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";
import { Suspense } from "react";

type SearchParamsShape = Record<string, string | string[] | undefined>;

type HomePageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams
    ? (typeof (searchParams as Promise<SearchParamsShape>).then === "function"
        ? await (searchParams as Promise<SearchParamsShape>)
        : (searchParams as SearchParamsShape))
    : {};

  const sourceParamRaw = resolvedSearchParams.source;
  const sourceParam = Array.isArray(sourceParamRaw) ? sourceParamRaw[0] : sourceParamRaw;

  const [rows, sourceOptions, stats] = await Promise.all([
    getDashboardRows(null, sourceParam),
    getSourceOptions(),
    getDashboardStats(sourceParam)
  ]);

  return (
    <>
      <section className="home-metrics-grid">
        <article className="home-metric-card tone-gold">
          <div className="home-metric-title">Providers</div>
          <div className="home-metric-value">{stats.providerCount}</div>
        </article>

        <article className="home-metric-card tone-emerald">
          <div className="home-metric-title">Models</div>
          <div className="home-metric-value">{stats.modelCount}</div>
        </article>

        <article className="home-metric-card tone-blue">
          <div className="home-metric-title">Benchmarks</div>
          <div className="home-metric-value">{stats.benchmarkCount}</div>
        </article>

        <article className="home-metric-card tone-purple">
          <div className="home-metric-title">总记录</div>
          <div className="home-metric-value">{stats.totalRecords}</div>
        </article>
      </section>

      <Suspense fallback={null}>
        <BenchmarkMatrix
          sourceOptions={sourceOptions}
          rows={rows.map((row) => ({
            providerName: row.providerName,
            modelName: row.modelName,
            benchmarkName: row.benchmarkName,
            benchmarkType: row.benchmarkType,
            modalities: row.modalities,
            benchTime: row.benchTime,
            valueRaw: row.valueRaw,
            valueNum: row.valueNum,
            valueNote: row.valueNote,
            source: row.source
          }))}
        />
      </Suspense>

    </>
  );
}
