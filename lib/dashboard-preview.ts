import {
  buildAaIndexRevisionsByRow,
  buildAllModelNames,
  buildAllRowsIndex,
  buildBaseBenchmarkKeySet,
  buildBaseModelNameSet,
  buildCoverageMetaByModel,
  buildCoveragePrunedRows,
  buildDefaultAllSourceModels,
  buildDefaultSelectedModels,
  buildFilteredRows,
  buildProviderGroups
} from "@/components/benchmark-matrix/selectors";
import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import { serializeAaRevisions } from "@/lib/aa-revision-serialization";
import {
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
  type PublicDashboardSnapshotVersions,
  type PublicDashboardSnapshotWire
} from "@/lib/dashboard-snapshot-cache";

/**
 * 首屏预览快照。
 *
 * 完整快照是 5 万行（3.3 MB JSON），但「All + 默认模型集 + 默认排序」这一屏
 * 实际只用到覆盖率裁剪后的 1 万行（0.7 MB），最终渲染 38 行 × 217 列。
 * 于是把同一套裁剪算法搬到服务端，先发一份「默认视图输入集」让首屏立即出图，
 * 完整快照随后接管交互（模型筛选面板、切换 source、搜索等）。
 *
 * 客户端拿到预览后必须跳过二次裁剪（`prePruned`）：这万行已经是裁剪结果，
 * 再裁一次会因为候选模型从 331 缩到 217 而丢掉 69 个模型列。
 *
 * AA 指标另有一个坑：最新版本判定要把该指标的全量历史行聚类后取自适应阈值，
 * 只喂裁剪后的行会得出不同的「最新主要变动」，表现为几十个单元格先显示数值、
 * 全量到达后又变回 --。所以服务端顺带把用完整行集算好的划分一起下发。
 */
export const DASHBOARD_PREVIEW_FORMAT_VERSION = 2;

/** 默认视图（All / 默认模型集 / 不显示低覆盖）实际消费的行集 */
export function buildDefaultViewRows(rows: MatrixInputRow[]): MatrixInputRow[] {
  const allRowsIndex = buildAllRowsIndex(rows, false);
  const baseBenchmarkKeySet = buildBaseBenchmarkKeySet(rows, false);
  const baseModelNameSet = buildBaseModelNameSet(rows);
  const coverageMetaByModel = buildCoverageMetaByModel(allRowsIndex, baseBenchmarkKeySet, baseModelNameSet);
  const providerGroups = buildProviderGroups(coverageMetaByModel, "");
  const allModelNames = buildAllModelNames(providerGroups);
  const selectedModels = buildDefaultAllSourceModels(
    allModelNames,
    buildDefaultSelectedModels(allModelNames, baseModelNameSet),
    baseModelNameSet
  );

  const filteredRows = buildFilteredRows(
    allRowsIndex,
    new Set(selectedModels),
    selectedModels,
    baseBenchmarkKeySet,
    ""
  );

  const prunedRows = buildCoveragePrunedRows(SOURCE_ALL, filteredRows, false, false);
  if (prunedRows.length === 0) {
    return prunedRows;
  }

  // 按原始行顺序过滤回来而不是直接用裁剪结果：buildCoveragePrunedRows 的输出是
  // 按模型分组排序的，直接下发会让预览行序与完整快照（benchTime 倒序）不一致，
  // 而 firstSeenIndex 参与默认排序的并列决胜，切换时行序会有细微抖动。
  const keptRowSet = new Set(prunedRows);
  return rows.filter((row) => keptRowSet.has(row));
}

export function buildPublicDashboardPreviewWire(
  snapshot: PublicDashboardSnapshot
): PublicDashboardSnapshotWire {
  return encodePublicDashboardSnapshot({
    ...snapshot,
    rows: buildDefaultViewRows(snapshot.rows),
    // 用完整行集算 AA 划分，客户端不再自己算
    previewAaRevisions: serializeAaRevisions(
      buildAaIndexRevisionsByRow(snapshot.rows, false, { versionCutoffs: snapshot.aaVersionCutoffs })
    )
  });
}

export function createPublicDashboardPreviewEtag(versions: PublicDashboardSnapshotVersions): string {
  return `"dashboard-preview:v${DASHBOARD_PREVIEW_FORMAT_VERSION}:${versions.dashboard}:${versions.pricing}:${versions.settings}"`;
}
