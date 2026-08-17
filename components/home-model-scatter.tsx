"use client";

import { useDashboardSnapshot } from "@/components/dashboard-provider";
import { ModelScatter } from "@/components/model-scatter";

export function HomeModelScatter() {
  const { rows, sourceOptions, modelPrices, modelParams } = useDashboardSnapshot();

  return (
    <ModelScatter
      rows={rows}
      sourceOptions={sourceOptions}
      modelPrices={modelPrices}
      modelParams={modelParams}
    />
  );
}
