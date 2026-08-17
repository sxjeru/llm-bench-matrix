"use client";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { useDashboardSnapshot } from "@/components/dashboard-provider";

export function HomeBenchmarkMatrix() {
  const { rows, sourceOptions, modelPrices, modelParams, exportFootnoteText, exportFootnoteAlign } =
    useDashboardSnapshot();

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
