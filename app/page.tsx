import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { DashboardCharts } from "@/components/charts";
import { getDashboardRows } from "@/lib/db/queries";

export default async function HomePage() {
  const rows = await getDashboardRows(800);
  const totalNumeric = rows.filter((row) => row.valueNum !== null).length;

  return (
    <>
      <section className="card">
        <h1>模型 Benchmark 看板</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="badge">总记录：{rows.length}</span>
          <span className="badge">可数值排序记录：{totalNumeric}</span>
        </div>
      </section>

      <BenchmarkMatrix
        rows={rows.map((row) => ({
          providerName: row.providerName,
          modelName: row.modelName,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          valueRaw: row.valueRaw,
          valueNum: row.valueNum,
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
