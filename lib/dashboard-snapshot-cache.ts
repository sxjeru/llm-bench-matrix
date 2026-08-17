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

export function getPublicDashboardSnapshotCacheKey() {
  return "llm-bench-matrix:public-dashboard-snapshot:v1";
}
