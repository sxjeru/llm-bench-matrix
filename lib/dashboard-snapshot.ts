import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import type { MatrixInputRow, ModelParamsInfo, ModelPriceInfo } from "@/components/benchmark-matrix/types";
import { getCacheVersion } from "@/lib/cache-versions";
import {
  getDashboardRows,
  getDashboardStats,
  getModelParamsRows,
  getSettings,
  getSourceOptions,
  type DashboardStats
} from "@/lib/db/queries";
import { getModelPricingRows, type ModelPricingRow } from "@/lib/model-pricing";

export const EXPORT_FOOTNOTE_ALIGNS = ["left", "center", "right"] as const;

export type ExportFootnoteAlign = (typeof EXPORT_FOOTNOTE_ALIGNS)[number];

export type PublicDashboardSnapshot = {
  rows: MatrixInputRow[];
  sourceOptions: string[];
  stats: DashboardStats;
  modelPrices: ModelPriceInfo[];
  modelParams: ModelParamsInfo[];
  exportFootnoteText?: string;
  exportFootnoteAlign: ExportFootnoteAlign;
};

export type PublicDashboardSnapshotVersions = {
  dashboard: string;
  pricing: string;
};

export type ParsedExportFootnote = {
  exportFootnoteText?: string;
  exportFootnoteAlign: ExportFootnoteAlign;
};

function isExportFootnoteAlign(value: unknown): value is ExportFootnoteAlign {
  return typeof value === "string" && (EXPORT_FOOTNOTE_ALIGNS as readonly string[]).includes(value);
}

export function parseExportFootnote(rawFootnote: unknown): ParsedExportFootnote {
  if (typeof rawFootnote === "string") {
    return {
      exportFootnoteText: rawFootnote,
      exportFootnoteAlign: "center"
    };
  }

  if (rawFootnote && typeof rawFootnote === "object") {
    const config = rawFootnote as Record<string, unknown>;
    return {
      exportFootnoteText: typeof config.text === "string" ? config.text : undefined,
      exportFootnoteAlign: isExportFootnoteAlign(config.align) ? config.align : "center"
    };
  }

  return { exportFootnoteAlign: "center" };
}

export function toPublicModelPrice(row: Pick<
  ModelPricingRow,
  "modelId" | "modelName" | "inputCost" | "outputCost" | "cacheReadCost" | "lastSyncedAt" | "updatedAt"
>): ModelPriceInfo {
  const mapped: ModelPriceInfo = {
    modelName: row.modelName,
    inputCost: row.inputCost,
    outputCost: row.outputCost,
    cacheReadCost: row.cacheReadCost
  };

  if (typeof row.modelId === "number") {
    mapped.modelId = row.modelId;
  }

  if (row.lastSyncedAt) {
    mapped.lastSyncedAt = row.lastSyncedAt;
  }

  if (row.updatedAt) {
    mapped.updatedAt = row.updatedAt;
  }

  return mapped;
}

export async function getPublicDashboardSnapshotVersions(): Promise<PublicDashboardSnapshotVersions> {
  const [dashboard, pricing] = await Promise.all([
    getCacheVersion("dashboard"),
    getCacheVersion("pricing")
  ]);

  return { dashboard, pricing };
}

export async function loadPublicDashboardSnapshot(
  versions?: PublicDashboardSnapshotVersions
): Promise<PublicDashboardSnapshot> {
  const resolved = versions ?? await getPublicDashboardSnapshotVersions();
  const [rows, sourceOptions, stats, modelPrices, modelParams, settings] = await Promise.all([
    getDashboardRows(null, null, resolved.dashboard),
    getSourceOptions(resolved.dashboard),
    getDashboardStats(null, resolved.dashboard),
    getModelPricingRows(resolved.pricing),
    getModelParamsRows(resolved.dashboard),
    getSettings()
  ]);

  return {
    rows: rows.map(toMatrixInputRow),
    sourceOptions,
    stats,
    modelPrices: modelPrices.map(toPublicModelPrice),
    modelParams,
    ...parseExportFootnote(settings.export_footnote_text)
  };
}
