import type { DashboardRow } from "@/lib/db/queries";
import type { MatrixInputRow } from "./types";

/**
 * `DashboardRow` → `MatrixInputRow`。
 *
 * 矩阵页与散点图页都从同一份 `getDashboardRows` 结果出发，这里统一投影，
 * 避免两处各写一份字段清单后悄悄漂移。
 */
export function toMatrixInputRow(row: DashboardRow): MatrixInputRow {
  return {
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
  };
}
