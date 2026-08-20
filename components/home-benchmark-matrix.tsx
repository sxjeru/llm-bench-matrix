"use client";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { useDashboardSnapshot } from "@/components/dashboard-provider";

export function HomeBenchmarkMatrix({ urlSyncEnabled = true }: { urlSyncEnabled?: boolean }) {
  const { snapshot, derived, isLoading, error } = useDashboardSnapshot();

  if (!snapshot || !derived) {
    return (
      <div className="card" role="status">
        {error ?? (isLoading || snapshot ? "正在加载矩阵数据…" : "暂无矩阵数据")}
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
      urlSyncEnabled={urlSyncEnabled}
    />
  );
}
