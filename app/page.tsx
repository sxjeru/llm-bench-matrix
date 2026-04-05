import { format } from "date-fns";
import { DashboardCharts } from "@/components/charts";
import { getDashboardRows } from "@/lib/db/queries";

export default async function HomePage() {
  const rows = await getDashboardRows(300);
  const totalNumeric = rows.filter((row) => row.valueNum !== null).length;

  return (
    <>
      <section className="card">
        <h1>模型 Benchmark 看板</h1>
        <p className="subtitle">
          轻量 5 表架构（providers / models / benchmarks / benchmark_values / settings），支持文本分值、复合分值（如
          31.5/30.1）和重复实体合并。
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="badge">总记录：{rows.length}</span>
          <span className="badge">可数值排序记录：{totalNumeric}</span>
          <span className="badge">后台：单密码门禁</span>
        </div>
      </section>

      <DashboardCharts
        rows={rows.map((row) => ({
          benchmarkName: row.benchmarkName,
          modelName: row.modelName,
          benchTime: row.benchTime,
          valueNum: row.valueNum
        }))}
      />

      <section className="card">
        <h2>最新数据表</h2>
        <p className="small">提示：展示优先使用 value_raw；排序或图表优先使用 value_num。</p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Benchmark</th>
                <th>Type</th>
                <th>Modalities</th>
                <th>Time</th>
                <th>Value Raw</th>
                <th>Value Num</th>
                <th>Value Num2</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.providerName}</td>
                  <td>{row.modelName}</td>
                  <td>{row.benchmarkName}</td>
                  <td>{row.benchmarkType}</td>
                  <td>{row.modalities.join(", ")}</td>
                  <td>{format(new Date(row.benchTime), "yyyy-MM-dd HH:mm")}</td>
                  <td>{row.valueRaw}</td>
                  <td>{row.valueNum ?? "-"}</td>
                  <td>{row.valueNum2 ?? "-"}</td>
                  <td>{row.source ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
