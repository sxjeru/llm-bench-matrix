import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import type { ModelPriceInfo } from "@/components/benchmark-matrix/types";
import { getCacheVersion } from "@/lib/cache-versions";
import {
  getDashboardRows,
  getDashboardStats,
  getModelParamsRows,
  getSettings,
  getSourceOptions
} from "@/lib/db/queries";
import { getModelPricingRows, type ModelPricingRow } from "@/lib/model-pricing";
import {
  EXPORT_FOOTNOTE_ALIGNS,
  type ExportFootnoteAlign,
  type PublicDashboardSnapshot,
  type PublicDashboardSnapshotVersions
} from "@/lib/dashboard-snapshot-cache";

export { EXPORT_FOOTNOTE_ALIGNS };
export type { ExportFootnoteAlign, PublicDashboardSnapshot, PublicDashboardSnapshotVersions };
export {
  createPublicDashboardSnapshotEtag,
  getPublicDashboardSnapshotCacheKey
} from "@/lib/dashboard-snapshot-cache";

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
>): PublicDashboardSnapshot["modelPrices"][number] {
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
  const [dashboard, pricing, settings] = await Promise.all([
    getCacheVersion("dashboard"),
    getCacheVersion("pricing"),
    getCacheVersion("settings")
  ]);

  return { dashboard, pricing, settings };
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
    versions: resolved,
    rows: rows.map(toMatrixInputRow),
    sourceOptions,
    stats,
    modelPrices: modelPrices.map(toPublicModelPrice),
    modelParams,
    ...parseExportFootnote(settings.export_footnote_text)
  };
}
