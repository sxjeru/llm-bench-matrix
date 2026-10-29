import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import { hasPublicModelPriceData, type ModelPriceInfo } from "@/components/benchmark-matrix/types";
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
import {
  ARTIFICIAL_ANALYSIS_SETTINGS_KEY,
  normalizeImportConfig
} from "@/lib/external-providers/artificial-analysis";
import type { AaVersionCutoff } from "@/lib/aa-index-revisions";

type ParsedExportFootnote = {
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
> & {
  releaseDate?: string | null;
}): PublicDashboardSnapshot["modelPrices"][number] {
  const mapped: ModelPriceInfo = {
    modelName: row.modelName,
    inputCost: row.inputCost,
    outputCost: row.outputCost,
    cacheReadCost: row.cacheReadCost
  };

  if (typeof row.modelId === "number") {
    mapped.modelId = row.modelId;
  }

  const releaseDate = row.releaseDate?.trim();
  if (releaseDate) {
    mapped.releaseDate = releaseDate;
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

  const rawAaConfig = settings[ARTIFICIAL_ANALYSIS_SETTINGS_KEY];
  const aaConfig = normalizeImportConfig(rawAaConfig);
  const aaVersionCutoffs: AaVersionCutoff[] = [];

  if (aaConfig.intelligenceIndexVersionHistory && aaConfig.intelligenceIndexVersionHistory.length > 0) {
    aaConfig.intelligenceIndexVersionHistory.forEach((h) => {
      const timestampMs = new Date(h.effectiveFrom).getTime();
      if (!Number.isFinite(timestampMs)) return;
      aaVersionCutoffs.push({
        version: `v${h.version}`,
        timestampMs,
        benchmarkName: "AA Intelligence Index",
        note: h.note
      });
    });
  }

  return {
    versions: resolved,
    rows: rows.map(toMatrixInputRow),
    sourceOptions,
    stats,
    modelPrices: modelPrices.map(toPublicModelPrice).filter(hasPublicModelPriceData),
    modelParams,
    // settings 里没有 AA 配置时字段缺省 → 前端退回代码里的冷启动种子；
    // 有配置但历史为空 → 下发空数组，表示「明确不做版本切分」，不能又被种子接管。
    ...(rawAaConfig === undefined ? {} : { aaVersionCutoffs }),
    ...parseExportFootnote(settings.export_footnote_text)
  };
}
