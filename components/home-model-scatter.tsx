"use client";

import { useOptionalDashboardSnapshot } from "@/components/dashboard-provider";
import { ModelScatter } from "@/components/model-scatter";

export function HomeModelScatter() {
  const { snapshot, isLoading, error } = useOptionalDashboardSnapshot();

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
    />
  );
}
