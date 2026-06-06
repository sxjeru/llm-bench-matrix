import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { getDashboardRows, getDashboardStats, getSourceOptions, getSettings } from "@/lib/db/queries";
import { getModelPricingRows } from "@/lib/model-pricing";
import { Suspense } from "react";

export const revalidate = 60;

export default async function HomePage() {
  const rowsPromise = getDashboardRows(null, null);

  const [rows, sourceOptions, stats, modelPrices, settings] = await Promise.all([
    rowsPromise,
    getSourceOptions(),
    getDashboardStats(null),
    getModelPricingRows(),
    getSettings()
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
    source: row.source,
    updatedAt: row.updatedAt
  });

  const mappedRows = rows.map(toMatrixRow);
  
  const rawFootnote = settings.export_footnote_text;
  let exportFootnoteText: string | undefined = undefined;
  let exportFootnoteAlign: "left" | "center" | "right" = "center";

  if (typeof rawFootnote === "string") {
    exportFootnoteText = rawFootnote;
  } else if (rawFootnote && typeof rawFootnote === "object") {
    const config = rawFootnote as Record<string, unknown>;
    exportFootnoteText = typeof config.text === "string" ? config.text : undefined;
    exportFootnoteAlign = ["left", "center", "right"].includes(config.align as string) 
      ? (config.align as "left" | "center" | "right") 
      : "center";
  }

  return (
    <>
      <section className="sr-only">
        <h1>LLM Bench Matrix</h1>
        <p>
          LLM 多源评测汇总矩阵，支持热力图可视化、模型对比与图片导出。
          聚合多个主流大模型评测基准数据，便捷直观比较各模型客观表现。
        </p>
      </section>

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
          modelPrices={modelPrices}
          exportFootnoteText={exportFootnoteText}
          exportFootnoteAlign={exportFootnoteAlign}
        />
      </Suspense>

    </>
  );
}
