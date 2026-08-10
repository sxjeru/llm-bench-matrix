import type { DashboardRow } from "@/lib/db/queries";
import type { MatrixInputRow } from "./types";

/**
 * `DashboardRow` → `MatrixInputRow`。
 *
 * 矩阵页与散点图页都从同一份 `getDashboardRows` 结果出发，这里统一投影，
 * 避免两处各写一份字段清单后悄悄漂移。
 *
 * 只下发有信息量的字段：默认值 / null / 空串省略，减小 RSC 与公开 API 载荷。
 * 消费端已对缺失 optional 字段按默认语义处理（如 higherIsBetter 缺省为 true）。
 */
export function toMatrixInputRow(row: DashboardRow): MatrixInputRow {
  const mapped: MatrixInputRow = {
    providerName: row.providerName,
    modelName: row.modelName,
    benchmarkName: row.benchmarkName,
    benchmarkType: row.benchmarkType,
    benchTime: row.benchTime,
    valueRaw: row.valueRaw,
    // valueNum 的 null 表示「无可比数值」，必须保留，不能靠缺省推断
    valueNum: row.valueNum
  };

  if (typeof row.id === "number") {
    mapped.recordId = row.id;
  }

  const providerDisplayName = row.providerDisplayName?.trim();
  if (providerDisplayName && providerDisplayName !== row.providerName) {
    mapped.providerDisplayName = providerDisplayName;
  }

  if (row.providerBrandColor) {
    mapped.providerBrandColor = row.providerBrandColor;
  }

  const sourceBenchmarkType = row.sourceBenchmarkType?.trim();
  if (sourceBenchmarkType) {
    mapped.sourceBenchmarkType = sourceBenchmarkType;
  }

  // 默认 true；只在明确为 false 时下发，避免每行重复布尔字面量
  if (row.higherIsBetter === false) {
    mapped.higherIsBetter = false;
  }

  const benchmarkCanonicalKey = row.benchmarkCanonicalKey?.trim();
  if (benchmarkCanonicalKey) {
    mapped.benchmarkCanonicalKey = benchmarkCanonicalKey;
  }

  if (row.modalities && row.modalities.length > 0) {
    mapped.modalities = row.modalities;
  }

  if (row.sourceModalities && row.sourceModalities.length > 0) {
    mapped.sourceModalities = row.sourceModalities;
  }

  if (row.valueNum2 != null) {
    mapped.valueNum2 = row.valueNum2;
  }

  const valueNote = row.valueNote?.trim();
  if (valueNote) {
    mapped.valueNote = valueNote;
  }

  const source = row.source?.trim();
  if (source) {
    mapped.source = source;
  }

  if (row.updatedAt) {
    mapped.updatedAt = row.updatedAt;
  }

  return mapped;
}
