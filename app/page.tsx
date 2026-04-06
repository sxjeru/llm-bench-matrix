import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { DashboardCharts } from "@/components/charts";
import { getDashboardRows } from "@/lib/db/queries";

export default async function HomePage() {
  const rows = await getDashboardRows(800);
  const totalNumeric = rows.filter((row) => row.valueNum !== null).length;
  const providerCount = new Set(rows.map((row) => row.providerName)).size;
  const modelCount = new Set(rows.map((row) => row.modelName)).size;
  const benchmarkCount = new Set(rows.map((row) => `${row.benchmarkName}::${row.benchmarkType}`)).size;

  return (
    <>
      <section className="home-metrics-grid">
        <article className="home-metric-card tone-gold">
          <div className="home-metric-title">Providers</div>
          <div className="home-metric-value">{providerCount}</div>
        </article>

        <article className="home-metric-card tone-emerald">
          <div className="home-metric-title">Models</div>
          <div className="home-metric-value">{modelCount}</div>
        </article>

        <article className="home-metric-card tone-blue">
          <div className="home-metric-title">Benchmarks</div>
          <div className="home-metric-value">{benchmarkCount}</div>
        </article>

        <article className="home-metric-card tone-purple">
          <div className="home-metric-title">总记录</div>
          <div className="home-metric-value">{rows.length}</div>
        </article>
      </section>

      <BenchmarkMatrix
        rows={rows.map((row) => ({
          providerName: row.providerName,
          modelName: row.modelName,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          benchTime: row.benchTime,
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
          valueNote: row.valueNote,
          source: row.source
        }))}
      />

      <DashboardCharts
        rows={rows.map((row) => ({
          benchmarkName: row.benchmarkName,
          modelName: row.modelName,
          benchTime: row.benchTime,
          valueNum: row.valueNum
        }))}
      />
    </>
  );
}
