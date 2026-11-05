"use client";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { useDashboardSnapshot } from "@/components/dashboard-provider";
import { MatrixLoadingStatus } from "@/components/matrix-loading-status";

export function HomeBenchmarkMatrix({ urlSyncEnabled = true }: { urlSyncEnabled?: boolean }) {
  const { snapshot, derived, isLoading, error, stage } = useDashboardSnapshot();

  if (!snapshot || !derived) {
    if (error) {
      return <MatrixLoadingStatus error={error} />;
    }

    if (!isLoading && !snapshot) {
      return (
        <div className="card" role="status">
          暂无矩阵数据
        </div>
      );
    }

    return <MatrixLoadingStatus stage={stage} />;
  }

  const {
    rows,
    sourceOptions,
    modelPrices,
    modelParams,
    exportFootnoteText,
    exportFootnoteAlign,
    aaVersionCutoffs
  } = snapshot;

  return (
    <BenchmarkMatrix
      sourceOptions={sourceOptions}
      rows={rows}
      modelPrices={modelPrices}
      modelParams={modelParams}
      exportFootnoteText={exportFootnoteText}
      exportFootnoteAlign={exportFootnoteAlign}
      aaVersionCutoffs={aaVersionCutoffs}
      urlSyncEnabled={urlSyncEnabled}
    />
  );
}
