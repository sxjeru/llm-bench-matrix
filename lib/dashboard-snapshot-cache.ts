import type { MatrixInputRow, ModelParamsInfo, ModelPriceInfo } from "@/components/benchmark-matrix/types";

export const EXPORT_FOOTNOTE_ALIGNS = ["left", "center", "right"] as const;

export type ExportFootnoteAlign = (typeof EXPORT_FOOTNOTE_ALIGNS)[number];

export type PublicDashboardSnapshotVersions = {
  dashboard: string;
  pricing: string;
  settings: string;
};

export type PublicDashboardStats = {
  providerCount: number;
  modelCount: number;
  benchmarkCount: number;
  totalRecords: number;
};

export type PublicDashboardSnapshot = {
  versions: PublicDashboardSnapshotVersions;
  rows: MatrixInputRow[];
  sourceOptions: string[];
  stats: PublicDashboardStats;
  modelPrices: ModelPriceInfo[];
  modelParams: ModelParamsInfo[];
  exportFootnoteText?: string;
  exportFootnoteAlign: ExportFootnoteAlign;
};

export function createPublicDashboardSnapshotEtag(versions: PublicDashboardSnapshotVersions) {
  return `"dashboard:${versions.dashboard}:${versions.pricing}:${versions.settings}"`;
}

/** 统计只由 dashboard 版本域决定，价格与设置的变动不该让这 4 个数字失效。 */
export function createPublicDashboardStatsEtag(dashboardVersion: string) {
  return `"dashboard-stats:${dashboardVersion}"`;
}

/**
 * 行数据的线上编码：列式 + 字典。
 *
 * 两万余行的行式 JSON 里，字段名与高重复字符串（benchmarkCanonicalKey、benchTime、
 * updatedAt 等）占了绝大部分体积。转成「每列一个字典 + 一串下标」后原始体积约降 80%，
 * 压缩后仍降约 57%，同时把客户端 JSON.parse 的工作量按同比例砍掉。
 *
 * - `{ d, c }`：字典列，`c[i]` 是该行在字典 `d` 中的下标，`-1` 表示该行没有这个字段。
 * - `{ v }`：原始列，用于 recordId 这类几乎不重复、建字典反而更大的字段。
 */
type EncodedColumn =
  | { d: unknown[]; c: number[] }
  | { v: unknown[] };

export type PublicDashboardSnapshotWire = Omit<PublicDashboardSnapshot, "rows"> & {
  rowCount: number;
  columns: Record<string, EncodedColumn>;
};

/**
 * valueNum 的 null 表示「无可比数值」，必须原样保留；
 * 其余字段的 null 与「缺省」等价，解码时直接省略以复原 toMatrixInputRow 的紧凑形状。
 */
const NULLABLE_ROW_FIELDS = new Set(["valueNum"]);

function dictKey(value: unknown): string {
  switch (typeof value) {
    case "string":
      return `s${value}`;
    case "number":
      return `n${value}`;
    case "boolean":
      return value ? "b1" : "b0";
    default:
      return value === null ? "z" : `j${JSON.stringify(value)}`;
  }
}

function encodeColumn(values: unknown[]): EncodedColumn {
  const dict: unknown[] = [];
  const index = new Map<string, number>();
  const codes: number[] = new Array<number>(values.length);

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const value = values[rowIndex];
    if (value === undefined) {
      codes[rowIndex] = -1;
      continue;
    }

    const key = dictKey(value);
    let code = index.get(key);
    if (code === undefined) {
      code = dict.length;
      dict.push(value);
      index.set(key, code);
    }
    codes[rowIndex] = code;
  }

  // 去重率不足一半时字典是净负收益（多存一份下标数组），退回原始列。
  if (dict.length * 2 > values.length) {
    return { v: values.map((value) => (value === undefined ? null : value)) };
  }

  return { d: dict, c: codes };
}

export function encodePublicDashboardSnapshot(
  snapshot: PublicDashboardSnapshot
): PublicDashboardSnapshotWire {
  const { rows, ...rest } = snapshot;

  // 字段清单按实际出现的键推导，这样 toMatrixInputRow 新增字段时无需同步改编码器。
  const fields = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      fields.add(field);
    }
  }

  const columns: Record<string, EncodedColumn> = {};
  for (const field of fields) {
    columns[field] = encodeColumn(rows.map((row) => (row as Record<string, unknown>)[field]));
  }

  return { ...rest, rowCount: rows.length, columns };
}

function readColumn(column: EncodedColumn, rowIndex: number): unknown {
  if ("v" in column) return column.v[rowIndex];

  const code = column.c[rowIndex];
  return code === undefined || code < 0 ? undefined : column.d[code];
}

export function decodePublicDashboardSnapshot(
  wire: PublicDashboardSnapshotWire
): PublicDashboardSnapshot {
  const { rowCount, columns, ...rest } = wire;
  const entries = Object.entries(columns);
  const rows: MatrixInputRow[] = new Array<MatrixInputRow>(rowCount);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: Record<string, unknown> = {};

    for (const [field, column] of entries) {
      const value = readColumn(column, rowIndex);
      if (value === undefined) continue;
      if (value === null && !NULLABLE_ROW_FIELDS.has(field)) continue;
      row[field] = value;
    }

    rows[rowIndex] = row as MatrixInputRow;
  }

  return { ...rest, rows };
}
