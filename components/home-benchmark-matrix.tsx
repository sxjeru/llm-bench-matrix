"use client";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { useDashboardSnapshot } from "@/components/dashboard-provider";

export function HomeBenchmarkMatrix() {
  const { snapshot, isLoading, error } = useDashboardSnapshot();

  if (!snapshot) {
    return (
      <div className="card" role="status">
        {error ?? (isLoading ? "正在加载矩阵数据…" : "暂无矩阵数据")}
      </div>
    );
  }

  const { rows, sourceOptions, modelPrices, modelParams, exportFootnoteText, exportFootnoteAlign } = snapshot;

  return (
    <BenchmarkMatrix
      sourceOptions={sourceOptions}
      rows={rows}
      modelPrices={modelPrices}
      modelParams={modelParams}
      exportFootnoteText={exportFootnoteText}
      exportFootnoteAlign={exportFootnoteAlign}
    />
  );
}
