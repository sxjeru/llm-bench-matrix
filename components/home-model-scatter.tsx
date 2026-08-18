"use client";

import { useDashboardSnapshot } from "@/components/dashboard-provider";
import { ModelScatter } from "@/components/model-scatter";

export function HomeModelScatter({ urlSyncEnabled = true }: { urlSyncEnabled?: boolean }) {
  const { snapshot, isLoading, error } = useDashboardSnapshot();

  if (!snapshot) {
    return (
      <div className="card" role="status">
        {error ?? (isLoading ? "正在加载散点图数据…" : "暂无散点图数据")}
      </div>
    );
  }

  const { rows, sourceOptions, modelPrices, modelParams } = snapshot;

  return (
    <ModelScatter
      rows={rows}
      sourceOptions={sourceOptions}
      modelPrices={modelPrices}
      modelParams={modelParams}
      urlSyncEnabled={urlSyncEnabled}
    />
  );
}
