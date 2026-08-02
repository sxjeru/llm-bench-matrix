"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getJson, postJson } from "../api";
import type {
  ExternalImportConfig,
  ExternalImportSnapshot,
  ExternalImportSummary,
  ExternalMappingDraft,
  ExternalMappingRow,
  ExternalMetricOverride
} from "../types";

type NotifyFn = (message: string, details?: string[]) => void;

type UseExternalImportOptions = {
  notifySuccess: NotifyFn;
  notifyError: NotifyFn;
};

const SNAPSHOT_URL = "/api/admin/external-import/artificial-analysis/snapshot";
const MAPPINGS_URL = "/api/admin/external-import/artificial-analysis/mappings";
const CONFIG_URL = "/api/admin/external-import/artificial-analysis/config";
const IMPORT_URL = "/api/admin/external-import/artificial-analysis/import";

export function toMappingDraft(row: ExternalMappingRow): ExternalMappingDraft {
  return {
    externalModelId: row.externalModelId,
    reasoningEffort: row.reasoningEffort,
    ignored: row.matchStatus === "ignored",
    manualOverride: row.manualOverride
  };
}

export function isMappingDraftDirty(row: ExternalMappingRow, draft: ExternalMappingDraft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.externalModelId !== row.externalModelId ||
    draft.reasoningEffort !== row.reasoningEffort ||
    draft.ignored !== (row.matchStatus === "ignored") ||
    draft.manualOverride !== row.manualOverride
  );
}

export function useExternalImport({ notifySuccess, notifyError }: UseExternalImportOptions) {
  const [snapshot, setSnapshot] = useState<ExternalImportSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ExternalImportSummary | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<number, ExternalMappingDraft>>({});
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [metricOverrides, setMetricOverrides] = useState<Record<string, ExternalMetricOverride>>({});
  const [createExternalModelIds, setCreateExternalModelIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "matched" | "unmatched" | "manual" | "ignored">("all");
  const hasLoadedRef = useRef(false);

  const resetDraftsFromSnapshot = useCallback((next: ExternalImportSnapshot) => {
    setMappingDrafts(
      next.mappings.reduce<Record<number, ExternalMappingDraft>>((acc, row) => {
        acc[row.modelId] = toMappingDraft(row);
        return acc;
      }, {})
    );
    setSelectedMetrics(next.config.selectedMetrics);
    setMetricOverrides(next.config.metricOverrides);
    setCreateExternalModelIds([]);
  }, []);

  const loadSnapshot = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const data = (await getJson(
          forceRefresh ? `${SNAPSHOT_URL}?refresh=1` : SNAPSHOT_URL
        )) as ExternalImportSnapshot;
        setSnapshot(data);
        resetDraftsFromSnapshot(data);
        setSummary(null);
        hasLoadedRef.current = true;
      } catch (error) {
        notifyError(error instanceof Error ? error.message : "拉取 Artificial Analysis 数据失败");
      } finally {
        setLoading(false);
      }
    },
    [notifyError, resetDraftsFromSnapshot]
  );

  /** 切到页签时的懒加载，只触发一次 */
  const loadSnapshotOnce = useCallback(() => {
    if (hasLoadedRef.current || loading) return;
    void loadSnapshot(false);
  }, [loadSnapshot, loading]);

  const dirtyMappingCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.mappings.filter((row) => isMappingDraftDirty(row, mappingDrafts[row.modelId])).length;
  }, [snapshot, mappingDrafts]);

  const configDirty = useMemo(() => {
    if (!snapshot) return false;
    const sameMetrics =
      selectedMetrics.length === snapshot.config.selectedMetrics.length &&
      selectedMetrics.every((key) => snapshot.config.selectedMetrics.includes(key));
    return !sameMetrics || JSON.stringify(metricOverrides) !== JSON.stringify(snapshot.config.metricOverrides);
  }, [snapshot, selectedMetrics, metricOverrides]);

  function updateMappingDraft(modelId: number, updater: (draft: ExternalMappingDraft) => ExternalMappingDraft) {
    setMappingDrafts((prev) => {
      const current =
        prev[modelId] ?? { externalModelId: null, reasoningEffort: null, ignored: false, manualOverride: false };
      return { ...prev, [modelId]: updater(current) };
    });
  }

  function toggleMetric(key: string) {
    setSelectedMetrics((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  function setAllMetrics(keys: string[]) {
    setSelectedMetrics(keys);
  }

  function updateMetricOverride(key: string, patch: ExternalMetricOverride) {
    setMetricOverrides((prev) => {
      const next = { ...prev[key], ...patch };
      // 空对象没有保存价值，清掉可以让配置回到「跟随目录默认值」
      const cleaned = Object.fromEntries(
        Object.entries(next).filter(([, value]) => value !== undefined && value !== "")
      ) as ExternalMetricOverride;
      if (Object.keys(cleaned).length === 0) {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return { ...prev, [key]: cleaned };
    });
  }

  function toggleCreateModel(externalModelId: string) {
    setCreateExternalModelIds((prev) =>
      prev.includes(externalModelId)
        ? prev.filter((item) => item !== externalModelId)
        : [...prev, externalModelId]
    );
  }

  function discardMappingDrafts() {
    if (!snapshot) return;
    resetDraftsFromSnapshot(snapshot);
  }

  async function saveMappings() {
    if (!snapshot || savingMappings) return;

    const updates = snapshot.mappings
      .filter((row) => isMappingDraftDirty(row, mappingDrafts[row.modelId]))
      .map((row) => {
        const draft = mappingDrafts[row.modelId]!;
        // 勾了「忽略」、以及没勾忽略但选了「（不绑定）」，都是「这个模型不绑任何上游条目」，
        // 存成同一种状态。空绑定不能存成 manual + manualOverride：界面会显示成「手动」却什么都没绑，
        // 而且 buildExternalImportSnapshot 会把它当作 pin，自动匹配从此不再接管这个模型。
        const externalModelId = draft.ignored ? null : draft.externalModelId;
        if (!externalModelId) {
          return {
            modelId: row.modelId,
            externalModelId: null,
            reasoningEffort: draft.reasoningEffort,
            matchStatus: "ignored" as const,
            manualOverride: false
          };
        }

        return {
          modelId: row.modelId,
          externalModelId,
          reasoningEffort: draft.reasoningEffort,
          matchStatus: "manual" as const,
          manualOverride: true
        };
      });

    if (updates.length === 0) return;

    setSavingMappings(true);
    try {
      const result = await postJson(MAPPINGS_URL, { updates }, "PATCH");
      notifySuccess(`已保存 ${result.updatedCount ?? updates.length} 条模型匹配关系`);
      await loadSnapshot(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存模型匹配关系失败");
    } finally {
      setSavingMappings(false);
    }
  }

  async function saveConfig() {
    if (savingConfig) return;

    setSavingConfig(true);
    try {
      const config: ExternalImportConfig = { selectedMetrics, metricOverrides };
      await postJson(CONFIG_URL, { config }, "PATCH");
      notifySuccess(`已保存导入配置：勾选了 ${selectedMetrics.length} 个数据项`);
      await loadSnapshot(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存导入配置失败");
    } finally {
      setSavingConfig(false);
    }
  }

  async function previewImport() {
    if (previewing || importing) return;

    setPreviewing(true);
    try {
      const result = (await postJson(IMPORT_URL, { dryRun: true })) as ExternalImportSummary;
      setSummary(result);
      notifySuccess(
        `预览完成：新增 ${result.inserted}，值变化追加 ${result.appended}，值未变覆盖 ${result.unchanged}`
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "预览导入失败");
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (previewing || importing) return;

    // 刚做过 dry-run 预览时，用户已看过影响面，不再二次确认
    const hasPreviewed = summary?.dryRun === true;
    if (!hasPreviewed) {
      const createCount = createExternalModelIds.length;
      const confirmed = window.confirm(
        createCount > 0
          ? `即将导入 Artificial Analysis 数据，并新建 ${createCount} 个本地模型。是否继续？`
          : "即将把 Artificial Analysis 数据写入 benchmark_values。是否继续？"
      );
      if (!confirmed) return;
    }

    setImporting(true);
    try {
      const result = (await postJson(IMPORT_URL, {
        dryRun: false,
        createExternalModelIds
      })) as ExternalImportSummary;
      setSummary(result);
      notifySuccess(
        `导入完成：新增 ${result.inserted}，值变化追加 ${result.appended}，值未变覆盖 ${result.unchanged}`,
        [
          result.createdModels.length > 0 ? `新建模型：${result.createdModels.join("、")}` : "",
          result.createdBenchmarks.length > 0 ? `新建 benchmark：${result.createdBenchmarks.join("、")}` : ""
        ].filter(Boolean)
      );
      await loadSnapshot(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  return {
    snapshot,
    loading,
    savingMappings,
    savingConfig,
    previewing,
    importing,
    summary,
    mappingDrafts,
    selectedMetrics,
    metricOverrides,
    createExternalModelIds,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    dirtyMappingCount,
    configDirty,
    loadSnapshot,
    loadSnapshotOnce,
    updateMappingDraft,
    discardMappingDrafts,
    toggleMetric,
    setAllMetrics,
    updateMetricOverride,
    toggleCreateModel,
    saveMappings,
    saveConfig,
    previewImport,
    runImport
  };
}
