import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { getDashboardRows, getDashboardStats, getSourceOptions } from "@/lib/db/queries";
import { Suspense } from "react";

export const revalidate = 60;

export default async function HomePage() {
  const rowsPromise = getDashboardRows(null, null);

  const [rows, sourceOptions, stats] = await Promise.all([
    rowsPromise,
    getSourceOptions(),
    getDashboardStats(null)
  ]);

  const toMatrixRow = (row: (typeof rows)[number]) => ({
    recordId: row.id,
    providerName: row.providerName,
    providerDisplayName: row.providerDisplayName,
    providerBrandColor: row.providerBrandColor,
    modelName: row.modelName,
    benchmarkName: row.benchmarkName,
    benchmarkType: row.benchmarkType,
    sourceBenchmarkType: row.sourceBenchmarkType,
    higherIsBetter: row.higherIsBetter,
    benchmarkCanonicalKey: row.benchmarkCanonicalKey,
    modalities: row.modalities,
    sourceModalities: row.sourceModalities,
    benchTime: row.benchTime,
    valueRaw: row.valueRaw,
    valueNum: row.valueNum,
    valueNum2: row.valueNum2,
    valueNote: row.valueNote,
    source: row.source
  });

  const mappedRows = rows.map(toMatrixRow);

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
          rows={mappedRows}
          allRows={mappedRows}
        />
      </Suspense>

    </>
  );
}
