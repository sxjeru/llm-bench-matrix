"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ClipboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTimeLocalInputValue } from "@/components/benchmark-matrix/formatters";
import { getJson, postFormData, postJson } from "./admin-console/api";
import { useEntityLookups } from "./admin-console/hooks/use-entity-lookups";
import { useImportPreviewState } from "./admin-console/hooks/use-import-preview-state";
import { useAdminNotices } from "./admin-console/hooks/use-notices";
import { useProviderConfig } from "./admin-console/hooks/use-provider-config";
import {
  PAIR_NOTE_HISTORY_STORAGE_KEY,
  RENAME_LIST_OVERSCAN,
  RENAME_LIST_ROW_HEIGHT,
  RENAME_LIST_VIEWPORT_HEIGHT,
  STAR_NOTE_HISTORY_STORAGE_KEY
} from "./admin-console/constants";
import type {
  BenchmarkPreviewValueOverlapStats,
  BenchmarkValueOverlapStats,
  DuplicateBenchmarkCandidate,
  DuplicateConfidence,
  DuplicateDetectionResult,
  DuplicateModelCandidate,
  ImportWarning,
  MergeSubmitState,
  MergedRecord,
  ModelDedupeRule,
  ModelOption,
  ModelPricingRow,
  ModelPricingSyncResult,
  PreviewRow,
  Props,
  RenameSubmitState,
  ScaleConsistencyCheckResult,
  ScaleConsistencyIssue,
  TabKey,
  TextImportPreviewRow
} from "./admin-console/types";
import {
  getTextImportBenchmarkKey,
  isLowerBetterPreviewBenchmark
} from "./admin-console/utils/benchmark";
import { buildStructuredCsvText } from "./admin-console/utils/csv";
import {
  parseSingleRawValue,
  parsePairRawValue,
  parseStarSingleRawValue
} from "./admin-console/utils/import-values";
import { parseMergeEntityId } from "./admin-console/utils/merge";
import {
  normalizeModelDedupeRule,
  normalizeModelNameByDedupeRule
} from "./admin-console/utils/model";
import { normalizeModalityList } from "./admin-console/utils/modality";
import {
  getProviderDisplayNameById,
  getProviderOptionLabel,
  inferProviderNameFromModelName,
  resolveProviderFromConfig,
} from "./admin-console/utils/provider";
import { extractTextImportWarningDetails } from "./admin-console/utils/warnings";
import {
  ClearDatabaseConfirmDialog,
  ConfirmImportWithoutPreviewDialog,
  ConfirmImportWithoutSourceDialog,
  DeleteSourceConfirmDialog,
  ProviderDeleteConfirmDialog,
  SheetPickerDialog
} from "./admin-console/views/confirm-dialogs";
import { EntryTab } from "./admin-console/views/entry-tab";
import { ImportTab } from "./admin-console/views/import-tab";
import { MaintenanceTab } from "./admin-console/views/maintenance-tab";
import { MergeTab } from "./admin-console/views/merge-tab";
import { AdminConsoleNotices } from "./admin-console/views/notices";
import { ProvidersTab } from "./admin-console/views/providers-tab";
import { PricingTab, type ModelPricingDraft } from "./admin-console/views/pricing-tab";
import { RenameTab } from "./admin-console/views/rename-tab";
import { SettingsTab } from "./admin-console/views/settings-tab";
import { AdminConsoleTabNav } from "./admin-console/views/tab-nav";

function getBenchmarkPreviewValueOverlapStatsKey(previewBenchmarkKey: string, candidateBenchmarkId: number) {
  return JSON.stringify([previewBenchmarkKey, candidateBenchmarkId]);
}

function parseImportDraftNumericToken(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/[$¥€£,#＃\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBenchmarkPreviewValueOverlapStats(stats: BenchmarkPreviewValueOverlapStats) {
  const duplicateRatePercent = Math.round(stats.duplicateRate * 100);
  const parts = [
    `重复 ${stats.exactDuplicateCount}/${stats.previewTotal} (${duplicateRatePercent}%)`
  ];

  if (stats.modelOverlapCount !== stats.exactDuplicateCount || stats.conflictCount > 0) {
    parts.push(`重叠 ${stats.modelOverlapCount}`);
  }
  if (stats.conflictCount > 0) {
    parts.push(`冲突 ${stats.conflictCount}`);
  }

  return parts.join(" · ");
}

function getBenchmarkPreviewValueOverlapBadgeClass(stats: BenchmarkPreviewValueOverlapStats) {
  if (stats.conflictCount > 0) {
    return "text-warning";
  }
  if (stats.previewTotal > 0 && stats.duplicateRate >= 0.8) {
    return "text-success";
  }
  if (stats.exactDuplicateCount > 0) {
    return "text-info";
  }

  return "text-base-content/60";
}

export function AdminConsole({
  initialTab,
  providers,
  models,
  benchmarks,
  sourceOptions = [],
  mergedRecords,
  initialSettings
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || "import");
  const { noticeList, notifySuccess, notifyError } = useAdminNotices();
  const {
    providerConfigDrafts,
    savingProviderConfigId,
    deletingProviderId,
    providerDeleteConfirmOpen,
    providerDeleteTargetId,
    providerDeleteTransferTargetId,
    setProviderDeleteTransferTargetId,
    selectedProviderConfigId,
    setSelectedProviderConfigId,
    providerSearchQuery,
    setProviderSearchQuery,
    providerSearchOpen,
    setProviderSearchOpen,
    providerSearchRef,
    providerDropdownRef,
    filteredProviderOptions,
    selectedProviderForConfig,
    availableDisplayTargetProviders,
    updateProviderDraft,
    onSaveProviderConfig,
    openDeleteProviderConfirm,
    closeDeleteProviderConfirm,
    onConfirmDeleteProvider,
    onCreateProviderFromSearch
  } = useProviderConfig({ providers, notifySuccess, notifyError });

  const [providerName, setProviderName] = useState("");
  const [providerId, setProviderId] = useState<number | "">(providers[0]?.id ?? "");

  const [modelName, setModelName] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [sourceModelId, setSourceModelId] = useState("");

  const [benchmarkName, setBenchmarkName] = useState("");
  const [benchmarkType, setBenchmarkType] = useState("general");
  const [benchmarkUnit, setBenchmarkUnit] = useState("score");
  const [modalities, setModalities] = useState("Text");
  const [higherIsBetter, setHigherIsBetter] = useState(true);

  const [valueModelId, setValueModelId] = useState<number | "">(models[0]?.id ?? "");
  const [valueBenchmarkId, setValueBenchmarkId] = useState<number | "">(benchmarks[0]?.id ?? "");
  const [valueRaw, setValueRaw] = useState("");
  const [valueSource, setValueSource] = useState("");
  const [benchTime, setBenchTime] = useState(() => formatDateTimeLocalInputValue(new Date()));

  const [csvText, setCsvText] = useState(
    ""
  );
  const [csvHtmlText, setCsvHtmlText] = useState("");
  const [hasParsedHtmlTable, setHasParsedHtmlTable] = useState(false);
  const [csvSource, setCsvSource] = useState("");
  const [confirmImportWithoutPreviewOpen, setConfirmImportWithoutPreviewOpen] = useState(false);
  const [confirmImportWithoutSourceOpen, setConfirmImportWithoutSourceOpen] = useState(false);
  const [clearDatabaseConfirmOpen, setClearDatabaseConfirmOpen] = useState(false);
  const [isClearingDatabase, setIsClearingDatabase] = useState(false);
  const [isPreviewingTextImport, setIsPreviewingTextImport] = useState(false);
  const [textImportPreviewRows, setTextImportPreviewRows] = useState<TextImportPreviewRow[]>([]);
  const [textImportDraftRows, setTextImportDraftRows] = useState<TextImportPreviewRow[]>([]);
  const [pairNoteHistory, setPairNoteHistory] = useState<string[]>([]);
  const [starNoteHistory, setStarNoteHistory] = useState<string[]>([]);
  const [matrixBenchmarkNameDrafts, setMatrixBenchmarkNameDrafts] = useState<Record<string, string>>({});
  const [matrixBenchmarkTypeDrafts, setMatrixBenchmarkTypeDrafts] = useState<Record<string, string>>({});
  const [matrixModelNameDrafts, setMatrixModelNameDrafts] = useState<Record<string, string>>({});
  const [openMatrixModelCandidateFor, setOpenMatrixModelCandidateFor] = useState<string | null>(null);
  const [openMatrixBenchmarkCandidateFor, setOpenMatrixBenchmarkCandidateFor] = useState<string | null>(null);
  const [globalStarSupplement, setGlobalStarSupplement] = useState("");
  const [benchmarkMergeTargets, setBenchmarkMergeTargets] = useState<Record<string, string>>({});
  const [benchmarkMergeFilters, setBenchmarkMergeFilters] = useState<Record<string, string>>({});
  const [ignoredBenchmarkKeys, setIgnoredBenchmarkKeys] = useState<Record<string, boolean>>({});
  const [parenthesesModes, setParenthesesModes] = useState<Record<string, "keep" | "remove" | "custom">>({});
  const [parenthesesCustomNames, setParenthesesCustomNames] = useState<Record<string, string>>({});
  const [modelMergeTargets, setModelMergeTargets] = useState<Record<string, string>>({});
  const [modelMergeFilters, setModelMergeFilters] = useState<Record<string, string>>({});
  const [modelParenthesesModes, setModelParenthesesModes] = useState<Record<string, "keep" | "remove" | "custom">>({});
  const [modelParenthesesCustomNames, setModelParenthesesCustomNames] = useState<Record<string, string>>({});
  const [pairNoteAutoFillAppliedByBenchmark, setPairNoteAutoFillAppliedByBenchmark] = useState<Record<string, boolean>>({});
  const [textImportPreviewMeta, setTextImportPreviewMeta] = useState<{
    format: string;
    total: number;
    skipped: number;
  } | null>(null);
  const [textImportPreviewVisibleCount, setTextImportPreviewVisibleCount] = useState(200);

  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetPickerOpen, setSheetPickerOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<ImportWarning[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{
    benchmarkColumn: string;
    categoryColumn: string | null;
    parsedCount: number;
    warningCount: number;
  } | null>(null);
  const [allowWarningsImport, setAllowWarningsImport] = useState(false);
  const [isImportingWorkbook, setIsImportingWorkbook] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [importStatusText, setImportStatusText] = useState("等待导入");
  const [isImportingTextCsv, setIsImportingTextCsv] = useState(false);
  const [textImportProgress, setTextImportProgress] = useState(0);
  const [textImportStatus, setTextImportStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [textImportStatusText, setTextImportStatusText] = useState("等待导入");
  const importProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textImportProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [mergeType, setMergeType] = useState<"model" | "benchmark">("model");
  const [mergeSourceInput, setMergeSourceInput] = useState("");
  const [mergeTargetInput, setMergeTargetInput] = useState("");
  const [mergeTargetBenchmarkNameInput, setMergeTargetBenchmarkNameInput] = useState("");
  const [mergeSubmitState, setMergeSubmitState] = useState<MergeSubmitState>("idle");
  const [benchmarkValueOverlapState, setBenchmarkValueOverlapState] = useState<{
    key: string;
    status: "idle" | "loading" | "success" | "error";
    stats: BenchmarkValueOverlapStats | null;
  }>({ key: "", status: "idle", stats: null });
  const [benchmarkPreviewValueOverlapState, setBenchmarkPreviewValueOverlapState] = useState<{
    key: string;
    status: "idle" | "loading" | "success" | "error";
    stats: BenchmarkPreviewValueOverlapStats[];
  }>({ key: "", status: "idle", stats: [] });
  const [benchmarkPreviewValueOverlapDebouncedTriggerKey, setBenchmarkPreviewValueOverlapDebouncedTriggerKey] = useState("");
  const benchmarkPreviewValueOverlapLastTriggerKeyRef = useRef("");
  const mergeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const [mergedRecordList, setMergedRecordList] = useState<MergedRecord[]>(mergedRecords);
  const [mergedRecordTargetInputs, setMergedRecordTargetInputs] = useState<Record<string, string>>(() =>
    mergedRecords.reduce<Record<string, string>>((acc, record) => {
      acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
      return acc;
    }, {})
  );
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [duplicateDetectionResult, setDuplicateDetectionResult] = useState<DuplicateDetectionResult | null>(null);
  const [duplicateDetectionEntityType, setDuplicateDetectionEntityType] = useState<"model" | "benchmark">("model");
  const [duplicateConfidenceFilter, setDuplicateConfidenceFilter] = useState<"high-medium" | "all">("high-medium");
  const [selectedDuplicateCandidateKeys, setSelectedDuplicateCandidateKeys] = useState<Record<string, boolean>>({});
  const [isBatchMergingDuplicates, setIsBatchMergingDuplicates] = useState(false);
  const [isCheckingScaleConsistency, setIsCheckingScaleConsistency] = useState(false);
  const [scaleConsistencyIssues, setScaleConsistencyIssues] = useState<ScaleConsistencyIssue[]>([]);
  const [scaleConsistencyCheckedAt, setScaleConsistencyCheckedAt] = useState<string | null>(null);
  const [normalizingScaleBenchmarkId, setNormalizingScaleBenchmarkId] = useState<number | null>(null);
  const [splittingScaleBenchmarkId, setSplittingScaleBenchmarkId] = useState<number | null>(null);
  const [scaleSplitNameDrafts, setScaleSplitNameDrafts] = useState<Record<number, { baseName: string; eloName: string }>>({});

  const [renameEntityType, setRenameEntityType] = useState<"model" | "benchmark">("model");
  const [renameSearchKeyword, setRenameSearchKeyword] = useState("");
  const [renameSelectedEntityId, setRenameSelectedEntityId] = useState<number | null>(null);
  const [renameNextName, setRenameNextName] = useState("");
  const [renameNextProviderInput, setRenameNextProviderInput] = useState("");
  const [renameNextBenchmarkType, setRenameNextBenchmarkType] = useState("");
  const [renameMergeOnConflict, setRenameMergeOnConflict] = useState(true);
  const [renameSubmitState, setRenameSubmitState] = useState<RenameSubmitState>("idle");
  const [renameListScrollTop, setRenameListScrollTop] = useState(0);
  const renameListViewportRef = useRef<HTMLDivElement | null>(null);
  const renameSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("{}");
  const [settingNote, setSettingNote] = useState("");
  const [deleteModelInput, setDeleteModelInput] = useState("");
  const [deleteSourceInput, setDeleteSourceInput] = useState("");
  const [confirmDeleteSourceOpen, setConfirmDeleteSourceOpen] = useState(false);
  const [isDeletingSourceData, setIsDeletingSourceData] = useState(false);
  const [modelDedupeRule, setModelDedupeRule] = useState<ModelDedupeRule>(() =>
    normalizeModelDedupeRule(initialSettings.model_dedupe_rule)
  );
  const [modelPriceRows, setModelPriceRows] = useState<ModelPricingRow[]>([]);
  const [pricingDrafts, setPricingDrafts] = useState<Record<number, ModelPricingDraft>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [hasLoadedPrices, setHasLoadedPrices] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [savingPriceModelId, setSavingPriceModelId] = useState<number | null>(null);
  const [pricingSearchQuery, setPricingSearchQuery] = useState("");
  const [pricingStatusFilter, setPricingStatusFilter] = useState<"all" | "matched" | "unmatched" | "manual" | "missing">("all");
  const [pricingSyncResult, setPricingSyncResult] = useState<ModelPricingSyncResult | null>(null);

  const sortedSettings = useMemo(() => {
    return Object.entries(initialSettings).sort(([a], [b]) => a.localeCompare(b));
  }, [initialSettings]);

  const {
    benchmarkById,
    providerById,
    existingBenchmarkExactMap,
    existingBenchmarkByNameMap,
    existingBenchmarkModalitiesMap,
    deleteSourceOptions,
    modelById,
    existingModelExactMap,
    existingModelByCanonicalKey,
    existingModelByNameMap,
    existingModelByCompareKey,
    modelEntityOptions,
    providerEntityOptions,
    benchmarkEntityOptions
  } = useEntityLookups({ providers, models, benchmarks, sourceOptions });

  const {
    modelWarnings,
    modelsWithParentheses,
    modelWarningSet,
    modelWarningMap,
    benchmarkWarnings,
    benchmarkWarningMap,
    benchmarkMergeCandidateMap,
    benchmarksWithParentheses,
    benchmarkParenthesesSet,
    matrixPreview,
    matrixPreviewHeaderCounts,
    benchmarkPreviewValueOverlapPayload,
    benchmarkPreviewValueOverlapTriggerKey,
    pairValueRows,
    pairRowsMissingNoteCount,
    starValueRows,
    starRowsMissingSupplementCount,
    finalizedTextImportRows,
    ignoredTextImportCount,
    textImportPreviewTableRows,
    visibleResolvedTextImportPreviewRows
  } = useImportPreviewState({
    benchmarks,
    textImportDraftRows,
    textImportPreviewRows,
    textImportPreviewVisibleCount,
    csvSource,
    ignoredBenchmarkKeys,
    parenthesesModes,
    parenthesesCustomNames,
    modelParenthesesModes,
    modelParenthesesCustomNames,
    modelMergeTargets,
    benchmarkMergeTargets,
    modelById,
    providerById,
    benchmarkById,
    modelDedupeRule,
    existingModelExactMap,
    existingModelByCanonicalKey,
    existingModelByNameMap,
    existingModelByCompareKey,
    existingBenchmarkExactMap,
    existingBenchmarkByNameMap,
    existingBenchmarkModalitiesMap
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setBenchmarkPreviewValueOverlapDebouncedTriggerKey(benchmarkPreviewValueOverlapTriggerKey);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [benchmarkPreviewValueOverlapTriggerKey]);

  function hasBenchmarkEloSuffix(benchmarkName: string): boolean {
    return /\s*[（(]\s*elo\s*[)）]\s*$/i.test(benchmarkName.trim());
  }

  function toBenchmarkEloName(benchmarkName: string): string {
    const cleanName = benchmarkName.trim();
    return hasBenchmarkEloSuffix(cleanName) ? cleanName : `${cleanName} (Elo)`;
  }

  function resolveExistingEloBenchmark(row: TextImportPreviewRow) {
    if (hasBenchmarkEloSuffix(row.benchmarkName)) return null;
    if (!((row.valueNum !== null && row.valueNum > 100) || (row.valueNum2 !== null && row.valueNum2 > 100))) return null;

    const eloBenchmarkName = toBenchmarkEloName(row.benchmarkName);
    const sameNameBenchmarks = existingBenchmarkByNameMap.get(eloBenchmarkName.trim().toLowerCase()) ?? [];
    return sameNameBenchmarks.find((item) => item.benchmarkType === row.benchmarkType) ?? sameNameBenchmarks[0] ?? null;
  }

  function applyExistingEloBenchmarkToPreviewRows(rows: TextImportPreviewRow[]) {
    return rows.map((row) => {
      const eloBenchmark = resolveExistingEloBenchmark(row);
      if (!eloBenchmark) return row;

      return {
        ...row,
        benchmarkName: eloBenchmark.benchmarkName,
        benchmarkType: eloBenchmark.benchmarkType,
        modalities: eloBenchmark.modalities?.length ? eloBenchmark.modalities : row.modalities
      };
    });
  }

  useEffect(() => {
    if (!benchmarkPreviewValueOverlapPayload.key) {
      benchmarkPreviewValueOverlapLastTriggerKeyRef.current = "";
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setBenchmarkPreviewValueOverlapState({ key: "", status: "idle", stats: [] });
        }
      });

      return () => {
        cancelled = true;
      };
    }

    if (!benchmarkPreviewValueOverlapDebouncedTriggerKey) {
      return;
    }

    if (benchmarkPreviewValueOverlapDebouncedTriggerKey === benchmarkPreviewValueOverlapLastTriggerKeyRef.current) {
      return;
    }

    benchmarkPreviewValueOverlapLastTriggerKeyRef.current = benchmarkPreviewValueOverlapDebouncedTriggerKey;

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setBenchmarkPreviewValueOverlapState({
          key: benchmarkPreviewValueOverlapPayload.key,
          status: "loading",
          stats: []
        });
      }
    });

    fetch("/api/admin/benchmarks/preview-value-overlap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: benchmarkPreviewValueOverlapPayload.items }),
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const reason = typeof data?.error === "string" ? data.error : "benchmark 预览重复率统计失败";
          throw new Error(reason);
        }

        setBenchmarkPreviewValueOverlapState({
          key: benchmarkPreviewValueOverlapPayload.key,
          status: "success",
          stats: Array.isArray(data?.stats) ? data.stats : []
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setBenchmarkPreviewValueOverlapState({
          key: benchmarkPreviewValueOverlapPayload.key,
          status: "error",
          stats: []
        });
      });

    return () => controller.abort();
  }, [benchmarkPreviewValueOverlapPayload, benchmarkPreviewValueOverlapDebouncedTriggerKey]);

  const benchmarkPreviewValueOverlapStatsMap = useMemo(() => {
    const map = new Map<string, BenchmarkPreviewValueOverlapStats>();
    if (
      benchmarkPreviewValueOverlapState.key !== benchmarkPreviewValueOverlapPayload.key
      || benchmarkPreviewValueOverlapState.status !== "success"
    ) {
      return map;
    }

    benchmarkPreviewValueOverlapState.stats.forEach((stats) => {
      map.set(
        getBenchmarkPreviewValueOverlapStatsKey(stats.previewBenchmarkKey, stats.candidateBenchmarkId),
        stats
      );
    });

    return map;
  }, [benchmarkPreviewValueOverlapPayload.key, benchmarkPreviewValueOverlapState]);

  const mergeEntityOptions = useMemo(() => {
    if (mergeType === "model") {
      return modelEntityOptions;
    }

    return benchmarkEntityOptions;
  }, [mergeType, modelEntityOptions, benchmarkEntityOptions]);

  const renameEntityOptions = useMemo(() => {
    if (renameEntityType === "model") {
      return modelEntityOptions;
    }

    return benchmarkEntityOptions;
  }, [renameEntityType, modelEntityOptions, benchmarkEntityOptions]);

  const filteredRenameEntityOptions = useMemo(() => {
    const keyword = renameSearchKeyword.trim().toLowerCase();

    return renameEntityOptions.filter((item) => {
      if (!keyword) return true;

      return (
        item.label.toLowerCase().includes(keyword)
        || String(item.id).includes(keyword)
      );
    });
  }, [renameEntityOptions, renameSearchKeyword]);

  const renameVirtualWindow = useMemo(() => {
    const total = filteredRenameEntityOptions.length;
    if (total === 0) {
      return { start: 0, end: 0 };
    }

    const visibleCount = Math.ceil(RENAME_LIST_VIEWPORT_HEIGHT / RENAME_LIST_ROW_HEIGHT);
    const start = Math.max(
      0,
      Math.floor(renameListScrollTop / RENAME_LIST_ROW_HEIGHT) - RENAME_LIST_OVERSCAN
    );
    const end = Math.min(
      total,
      start + visibleCount + RENAME_LIST_OVERSCAN * 2
    );

    return { start, end };
  }, [filteredRenameEntityOptions.length, renameListScrollTop]);

  const visibleRenameEntityOptions = useMemo(
    () => filteredRenameEntityOptions.slice(renameVirtualWindow.start, renameVirtualWindow.end),
    [filteredRenameEntityOptions, renameVirtualWindow.start, renameVirtualWindow.end]
  );

  const renameListSpacerHeight = useMemo(
    () => filteredRenameEntityOptions.length * RENAME_LIST_ROW_HEIGHT,
    [filteredRenameEntityOptions.length]
  );

  const renameSelectedEntityLabel = useMemo(() => {
    if (renameSelectedEntityId === null) return "";

    const selected = renameEntityOptions.find((item) => item.id === renameSelectedEntityId);
    if (!selected) return `#${renameSelectedEntityId}`;
    return `${selected.label} [${selected.id}]`;
  }, [renameEntityOptions, renameSelectedEntityId]);

  const resolvedMergeSourceId = useMemo(
    () => parseMergeEntityId(mergeSourceInput, mergeEntityOptions),
    [mergeSourceInput, mergeEntityOptions]
  );

  const resolvedMergeTargetId = useMemo(
    () => parseMergeEntityId(mergeTargetInput, mergeEntityOptions),
    [mergeTargetInput, mergeEntityOptions]
  );

  const benchmarkValueOverlapKey =
    mergeType === "benchmark"
    && resolvedMergeSourceId !== null
    && resolvedMergeTargetId !== null
    && resolvedMergeSourceId !== resolvedMergeTargetId
      ? `${resolvedMergeSourceId}:${resolvedMergeTargetId}`
      : "";
  const shouldShowBenchmarkValueOverlap = benchmarkValueOverlapKey.length > 0;

  useEffect(() => {
    if (!benchmarkValueOverlapKey) {
      return;
    }

    const controller = new AbortController();
    const [sourceId, targetId] = benchmarkValueOverlapKey.split(":");

    getJson(
      `/api/admin/benchmarks/value-overlap?sourceId=${sourceId}&targetId=${targetId}`,
      { signal: controller.signal }
    )
      .then((result) => {
        setBenchmarkValueOverlapState({
          key: benchmarkValueOverlapKey,
          status: "success",
          stats: result as BenchmarkValueOverlapStats
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setBenchmarkValueOverlapState({
          key: benchmarkValueOverlapKey,
          status: "error",
          stats: null
        });
      });

    return () => controller.abort();
  }, [benchmarkValueOverlapKey]);

  const benchmarkValueOverlapStats =
    benchmarkValueOverlapState.key === benchmarkValueOverlapKey && benchmarkValueOverlapState.status === "success"
      ? benchmarkValueOverlapState.stats
      : null;
  const isLoadingBenchmarkValueOverlap =
    shouldShowBenchmarkValueOverlap && benchmarkValueOverlapState.key !== benchmarkValueOverlapKey;

  const benchmarkValueOverlapBadgeClass = useMemo(() => {
    if (isLoadingBenchmarkValueOverlap) {
      return "badge-outline";
    }

    const sameCount = benchmarkValueOverlapStats?.sameCount ?? 0;
    const overlapCount = benchmarkValueOverlapStats?.overlapCount ?? 0;
    if (sameCount <= 0 || overlapCount <= 0) {
      return "badge-error";
    }

    return sameCount / overlapCount < 0.1 ? "badge-warning" : "badge-success";
  }, [benchmarkValueOverlapStats, isLoadingBenchmarkValueOverlap]);

  const shouldRenderBenchmarkValueOverlapBadge =
    shouldShowBenchmarkValueOverlap
    && (isLoadingBenchmarkValueOverlap || (benchmarkValueOverlapStats?.overlapCount ?? 0) > 0);

  const visibleModelDuplicateCandidates = useMemo(() => {
    if (!duplicateDetectionResult) return [];
    return duplicateDetectionResult.modelCandidates.filter((candidate) =>
      duplicateConfidenceFilter === "all" || candidate.confidence !== "low"
    );
  }, [duplicateDetectionResult, duplicateConfidenceFilter]);

  const visibleBenchmarkDuplicateCandidates = useMemo(() => {
    if (!duplicateDetectionResult) return [];
    return duplicateDetectionResult.benchmarkCandidates.filter((candidate) =>
      duplicateConfidenceFilter === "all" || candidate.confidence !== "low"
    );
  }, [duplicateDetectionResult, duplicateConfidenceFilter]);

  const selectedVisibleModelDuplicateCandidates = useMemo(
    () => visibleModelDuplicateCandidates.filter((candidate) => selectedDuplicateCandidateKeys[getDuplicateCandidateKey("model", candidate)]),
    [visibleModelDuplicateCandidates, selectedDuplicateCandidateKeys]
  );

  const selectedVisibleBenchmarkDuplicateCandidates = useMemo(
    () => visibleBenchmarkDuplicateCandidates.filter((candidate) => selectedDuplicateCandidateKeys[getDuplicateCandidateKey("benchmark", candidate)]),
    [visibleBenchmarkDuplicateCandidates, selectedDuplicateCandidateKeys]
  );

  const activeDuplicateCandidateCount =
    duplicateDetectionEntityType === "model"
      ? visibleModelDuplicateCandidates.length
      : visibleBenchmarkDuplicateCandidates.length;
  const selectedActiveDuplicateCandidateCount =
    duplicateDetectionEntityType === "model"
      ? selectedVisibleModelDuplicateCandidates.length
      : selectedVisibleBenchmarkDuplicateCandidates.length;
  const isAllActiveDuplicateCandidatesSelected =
    activeDuplicateCandidateCount > 0 && selectedActiveDuplicateCandidateCount === activeDuplicateCandidateCount;

  const scaleConsistencyAffectedValueCount = useMemo(
    () => scaleConsistencyIssues.reduce((sum, item) => sum + item.smallValueCount + item.largeValueCount, 0),
    [scaleConsistencyIssues]
  );

  useEffect(() => {
    return () => {
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }

      if (textImportProgressTimerRef.current) {
        clearInterval(textImportProgressTimerRef.current);
        textImportProgressTimerRef.current = null;
      }

      if (mergeSubmitResetTimerRef.current) {
        clearTimeout(mergeSubmitResetTimerRef.current);
        mergeSubmitResetTimerRef.current = null;
      }

      if (renameSubmitResetTimerRef.current) {
        clearTimeout(renameSubmitResetTimerRef.current);
        renameSubmitResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setMergedRecordList(mergedRecords);
      setMergedRecordTargetInputs(
        mergedRecords.reduce<Record<string, string>>((acc, record) => {
          acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
          return acc;
        }, {})
      );
    });
  }, [mergedRecords]);

  useEffect(() => {
    if (renameListViewportRef.current) {
      renameListViewportRef.current.scrollTop = 0;
    }

    if (renameSubmitResetTimerRef.current) {
      clearTimeout(renameSubmitResetTimerRef.current);
      renameSubmitResetTimerRef.current = null;
    }
  }, [renameEntityType, renameSearchKeyword]);

  function resetRenameStateForEntityType(nextEntityType: "model" | "benchmark") {
    setRenameEntityType(nextEntityType);
    setRenameSearchKeyword("");
    setRenameSelectedEntityId(null);
    setRenameNextName("");
    setRenameNextProviderInput("");
    setRenameNextBenchmarkType("");
    setRenameSubmitState("idle");
    setRenameListScrollTop(0);
  }

  function updateRenameSearchKeyword(nextKeyword: string) {
    setRenameSearchKeyword(nextKeyword);
    setRenameListScrollTop(0);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PAIR_NOTE_HISTORY_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30);

      queueMicrotask(() => setPairNoteHistory(normalized));
    } catch {
      // ignore storage read errors gracefully
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STAR_NOTE_HISTORY_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30);

      queueMicrotask(() => setStarNoteHistory(normalized));
    } catch {
      // ignore storage read errors gracefully
    }
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const openedDropdowns = document.querySelectorAll<HTMLDetailsElement>(
        'details[data-modality-dropdown="true"][open]'
      );

      openedDropdowns.forEach((dropdown) => {
        if (!dropdown.contains(target)) {
          dropdown.removeAttribute("open");
        }
      });

      const targetElement = target instanceof Element ? target : null;
      if (!targetElement || !targetElement.closest('[data-matrix-model-candidate-container="true"]')) {
        setOpenMatrixModelCandidateFor(null);
      }

      if (!targetElement || !targetElement.closest('[data-matrix-benchmark-candidate-container="true"]')) {
        setOpenMatrixBenchmarkCandidateFor(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function buildWorkbookFormData(sheetName?: string, allowWarnings?: boolean) {
    if (!workbookFile) {
      throw new Error("请先选择 xlsm/xlsx 文件");
    }

    const formData = new FormData();
    formData.append("file", workbookFile);

    if (sheetName) {
      formData.append("sheetName", sheetName);
    }

    if (allowWarnings !== undefined) {
      formData.append("allowWarnings", String(allowWarnings));
    }

    return formData;
  }

  async function requestWorkbookPreview(sheetName?: string) {
    const payload = buildWorkbookFormData(sheetName || selectedSheet || undefined);
    const result = await postFormData("/api/admin/import-xlsm/preview", payload);

    const workbookPreviewRows = (result.previewRows ?? []) as PreviewRow[];
    const warningRows = (result.warnings ?? []) as ImportWarning[];
    const normalizedSelectedSheet =
      typeof result.selectedSheet === "string" && result.selectedSheet.trim().length > 0
        ? result.selectedSheet.trim()
        : (sheetName || selectedSheet || "Sheet1");

    let currentBenchmarkType = "General";
    let currentBenchmarkTypeProvided = false;
    const unifiedPreviewRows: TextImportPreviewRow[] = workbookPreviewRows.map((row) => {
      const rowCategory = typeof row.category === "string" ? row.category.trim() : "";
      if (rowCategory) {
        currentBenchmarkType = rowCategory;
        currentBenchmarkTypeProvided = true;
      }

      const benchmarkType = currentBenchmarkType || "General";
      const normalizedModelName = row.modelName.trim();
      const existingModel = existingModelExactMap.get(normalizedModelName.toLowerCase());
      const resolvedProvider = existingModel ? null : resolveProviderFromConfig(normalizedModelName, providers);
      const providerName = existingModel
        ? (providerById.get(existingModel.providerId)?.name || inferProviderNameFromModelName(normalizedModelName))
        : (resolvedProvider?.providerName ?? inferProviderNameFromModelName(normalizedModelName));
      const providerDisplayName = existingModel
        ? (getProviderDisplayNameById(existingModel.providerId, providerById) || providerName)
        : (resolvedProvider?.providerDisplayName ?? providerName);
      const inferredHigherIsBetter = !isLowerBetterPreviewBenchmark(row.benchmarkName, benchmarkType);

      return {
        rowNumber: row.rowNumber,
        providerName,
        providerDisplayName,
        modelName: normalizedModelName,
        benchmarkName: row.benchmarkName,
        benchmarkType,
        benchmarkTypeProvided: currentBenchmarkTypeProvided,
        higherIsBetter: inferredHigherIsBetter,
        modalities: normalizeModalityList([benchmarkType]),
        rawValue: row.rawValue,
        valueNum: row.valueNum,
        valueNum2: row.valueNum2,
        valueNote: row.valueNote,
        source: `xlsm:${normalizedSelectedSheet}`,
        valid: row.valid
      };
    });

    const resolvedPreviewRows = applyExistingEloBenchmarkToPreviewRows(unifiedPreviewRows);
    const parsedCount = Number(result.parsedCount ?? resolvedPreviewRows.length);
    const warningCount = Number(result.warningCount ?? warningRows.length);
    const skippedCount = Math.max(0, parsedCount - resolvedPreviewRows.length);

    setSheetNames(result.sheetNames ?? []);
    setSelectedSheet(normalizedSelectedSheet);
    setPreviewRows(workbookPreviewRows);
    setPreviewWarnings(warningRows);
    setPreviewMeta({
      benchmarkColumn: result.benchmarkColumn ?? "Benchmark",
      categoryColumn: result.categoryColumn ?? null,
      parsedCount,
      warningCount
    });

    setTextImportPreviewRows(resolvedPreviewRows);
    setTextImportDraftRows(resolvedPreviewRows.map((row) => ({ ...row })));
    setGlobalStarSupplement("");
    setBenchmarkMergeTargets({});
    setBenchmarkMergeFilters({});
    setIgnoredBenchmarkKeys({});
    setParenthesesModes({});
    setParenthesesCustomNames({});
    setModelMergeTargets({});
    setModelMergeFilters({});
    setModelParenthesesModes({});
    setModelParenthesesCustomNames({});
    setPairNoteAutoFillAppliedByBenchmark({});
    setMatrixBenchmarkNameDrafts({});
    setMatrixBenchmarkTypeDrafts({});
    setMatrixModelNameDrafts({});
    setOpenMatrixModelCandidateFor(null);
    setOpenMatrixBenchmarkCandidateFor(null);
    setTextImportPreviewMeta({
      format: "workbook-table",
      total: resolvedPreviewRows.length,
      skipped: skippedCount
    });
    setTextImportPreviewVisibleCount(200);

    notifySuccess(`预览完成：解析 ${parsedCount} 条，警告 ${warningCount} 条；已同步到下方统一预览表`);

    return result;
  }

  async function onPreviewWorkbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await requestWorkbookPreview();
      if ((result.sheetNames ?? []).length > 1) {
        setSheetPickerOpen(true);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "预览失败");
    }
  }

  async function onSelectSheet(sheetName: string) {
    try {
      setSelectedSheet(sheetName);
      await requestWorkbookPreview(sheetName);
      setSheetPickerOpen(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "切换工作表失败");
    }
  }

  async function onImportWorkbook() {
    if (isImportingWorkbook) {
      return;
    }

    if (importProgressTimerRef.current) {
      clearInterval(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }

    setIsImportingWorkbook(true);
    setImportStatus("running");
    setImportStatusText("正在导入工作表...");
    setImportProgress(8);

    let finalStatus: "success" | "error" = "error";
    let finalStatusText = "导入失败";
    let finalProgress = 6;

    importProgressTimerRef.current = setInterval(() => {
      setImportProgress((prev) => {
        if (prev >= 90) return prev;
        const next = prev + Math.floor(Math.random() * 7) + 2;
        return next > 90 ? 90 : next;
      });
    }, 280);

    try {
      if (textImportDraftRows.length === 0) {
        throw new Error("请先解析并预览工作表，再执行导入");
      }

      if (previewWarnings.length > 0 && !allowWarningsImport) {
        throw new Error("存在不合规值，请先处理或勾选“忽略警告继续导入”");
      }

      if (finalizedTextImportRows.length === 0) {
        throw new Error("处理后无可导入数据，请检查忽略项或编辑值");
      }

      const generatedCsvText = buildStructuredCsvText(finalizedTextImportRows);
      const result = await postJson("/api/admin/import-csv", {
        csvText: generatedCsvText,
        rows: finalizedTextImportRows,
        source: csvSource || undefined
      });

      const directionWarningCount = Number(result.warningCount ?? 0);
      const warningDetails = extractTextImportWarningDetails(result.warnings);

      if (directionWarningCount > 0) {
        notifyError(
          `工作簿导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）；已自动处理 ${directionWarningCount} 条解析警告`,
          warningDetails
        );
      } else {
        notifySuccess(
          `工作簿导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）`
        );
      }

      finalStatus = "success";
      finalProgress = 100;
      finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
    } catch (error) {
      const payload = (error as Error & { payload?: unknown }).payload as { warnings?: ImportWarning[] } | undefined;
      if (payload?.warnings) {
        setPreviewWarnings(payload.warnings);
      }
      notifyError(error instanceof Error ? error.message : "导入失败");
      finalStatus = "error";
      finalProgress = 6;
      finalStatusText = error instanceof Error ? `导入失败：${error.message}` : "导入失败";
    } finally {
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      setImportStatus(finalStatus);
      setImportStatusText(finalStatusText);
      setImportProgress(finalProgress);
      setIsImportingWorkbook(false);
    }
  }

  async function onCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/providers", { name: providerName });
      setProviderName("");
      notifySuccess("Provider 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 provider 失败");
    }
  }

  async function onCreateModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (providerId === "") {
      notifyError("请先选择 provider");
      return;
    }

    try {
      await postJson("/api/admin/models", {
        providerId,
        modelName,
        modelAlias: modelAlias || undefined,
        sourceModelId: sourceModelId || undefined
      });
      setModelName("");
      setModelAlias("");
      setSourceModelId("");
      notifySuccess("Model 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 model 失败");
    }
  }

  async function onCreateBenchmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/admin/benchmarks", {
        benchmarkName,
        benchmarkType,
        unit: benchmarkUnit,
        higherIsBetter,
        modalities: modalities
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean)
      });
      setBenchmarkName("");
      notifySuccess("Benchmark 已保存，刷新页面可看到下拉选项更新。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 失败");
    }
  }

  async function onCreateValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valueModelId === "" || valueBenchmarkId === "") {
      notifyError("请先选择 model 和 benchmark");
      return;
    }

    try {
      await postJson("/api/admin/values", {
        modelId: valueModelId,
        benchmarkId: valueBenchmarkId,
        benchTime: new Date(benchTime).toISOString(),
        valueRaw,
        source: valueSource || undefined
      });
      setValueRaw("");
      notifySuccess("Benchmark 值已保存。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 benchmark 值失败");
    }
  }

  function onUpdateTextImportDraftValue(rowIndex: number, rawValue: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? (() => {
              const pair = parsePairRawValue(rawValue);
              const starSingle = parseStarSingleRawValue(rawValue);
              const single = parseSingleRawValue(rawValue);

              let nextValueNote: string | null;
              if (pair) {
                nextValueNote = pair.note ?? row.valueNote ?? null;
              } else if (starSingle) {
                nextValueNote = starSingle.note ?? row.valueNote ?? null;
              } else {
                nextValueNote = null;
              }

              return {
                ...row,
                rawValue,
                valueNum: pair
                  ? parseImportDraftNumericToken(pair.first)
                  : single
                    ? parseImportDraftNumericToken(single.value)
                    : null,
                valueNum2: pair ? parseImportDraftNumericToken(pair.second) : null,
                valueNote: nextValueNote
              };
            })()
          : row
      )
    );
  }

  function onUpdateTextImportDraftNote(rowIndex: number, valueNote: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: valueNote.length > 0 ? valueNote : null
            }
          : row
      )
    );
  }

  function onUpdateTextImportDraftStarSupplement(rowIndex: number, supplement: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: supplement.length > 0 ? supplement : null
            }
          : row
      )
    );
  }

  function recordStarNoteHistory(valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    setStarNoteHistory((prev) => {
      const next = [normalizedNote, ...prev.filter((item) => item !== normalizedNote)].slice(0, 30);
      try {
        window.localStorage.setItem(STAR_NOTE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write errors gracefully
      }
      return next;
    });
  }

  function onStarSupplementInputBlur(rowIndex: number, supplement: string) {
    const normalized = supplement.trim();

    setTextImportDraftRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              valueNote: normalized.length > 0 ? normalized : null
            }
          : row
      )
    );

    if (normalized.length > 0) {
      recordStarNoteHistory(normalized);
    }
  }

  function onApplyGlobalStarSupplement() {
    const trimmedSupplement = globalStarSupplement.trim();

    setTextImportDraftRows((prev) =>
      prev.map((row) => {
        if (!parseStarSingleRawValue(row.rawValue)) {
          return row;
        }

        return {
          ...row,
          valueNote: trimmedSupplement.length > 0 ? trimmedSupplement : null
        };
      })
    );

    if (trimmedSupplement.length > 0) {
      recordStarNoteHistory(trimmedSupplement);
      notifySuccess(`已为全部 * 数值设置统一注释：${trimmedSupplement}`);
    } else {
      notifySuccess("已清空全部 * 数值注释");
    }
  }

  function recordPairNoteHistory(valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    setPairNoteHistory((prev) => {
      const next = [normalizedNote, ...prev.filter((item) => item !== normalizedNote)].slice(0, 30);
      try {
        window.localStorage.setItem(PAIR_NOTE_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write errors gracefully
      }
      return next;
    });
  }

  function onPairNoteInputBlur(rowIndex: number, benchmarkKey: string, valueNote: string) {
    const normalizedNote = valueNote.trim();
    if (!normalizedNote) return;

    recordPairNoteHistory(normalizedNote);

    if (pairNoteAutoFillAppliedByBenchmark[benchmarkKey]) return;

    setTextImportDraftRows((prev) =>
      prev.map((row, idx) => {
        if (idx === rowIndex) return row;

        const rowBenchmarkKey = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
        if (rowBenchmarkKey !== benchmarkKey) return row;
        if (!parsePairRawValue(row.rawValue)) return row;

        const currentNote = row.valueNote?.trim() ?? "";
        if (currentNote.length > 0) return row;

        return {
          ...row,
          valueNote: normalizedNote
        };
      })
    );

    setPairNoteAutoFillAppliedByBenchmark((prev) => ({
      ...prev,
      [benchmarkKey]: true
    }));
  }

  function onToggleMatrixBenchmarkModality(benchmarkKey: string, modality: string, checked: boolean) {
    setTextImportDraftRows((prev) => {
      const matchedRows = prev.filter(
        (row) => getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
      );

      if (matchedRows.length === 0) {
        return prev;
      }

      const currentModalities = normalizeModalityList(
        matchedRows[0].modalities?.length ? matchedRows[0].modalities : [matchedRows[0].benchmarkType]
      );

      let nextRawModalities = checked
        ? [...currentModalities, modality]
        : currentModalities.filter((item) => item !== modality);

      if (checked && modality === "Vision") {
        nextRawModalities = nextRawModalities.filter((item) => item !== "Video");
      }

      if (checked && modality === "Video") {
        nextRawModalities = nextRawModalities.filter((item) => item !== "Vision");
      }

      const nextModalities = normalizeModalityList(
        nextRawModalities.length > 0 ? nextRawModalities : ["Text"]
      );

      return prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              modalities: nextModalities
            }
          : row
      );
    });
  }

  function onToggleMatrixBenchmarkLowerIsBetter(benchmarkKey: string, checkedLowerIsBetter: boolean) {
    const nextHigherIsBetter = !checkedLowerIsBetter;

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              higherIsBetter: nextHigherIsBetter
            }
          : row
      )
    );
  }

  function onRenameTextImportBenchmark(benchmarkKey: string, nextBenchmarkName: string) {
    const splitIndex = benchmarkKey.lastIndexOf("@@");
    if (splitIndex < 0) return;
    const benchmarkType = benchmarkKey.slice(splitIndex + 2);
    const nextKey = getTextImportBenchmarkKey(nextBenchmarkName, benchmarkType);

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              benchmarkName: nextBenchmarkName
            }
          : row
      )
    );

    if (nextKey === benchmarkKey) return;

    setBenchmarkMergeTargets((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setBenchmarkMergeFilters((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setIgnoredBenchmarkKeys((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesModes((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesCustomNames((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setPairNoteAutoFillAppliedByBenchmark((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });
  }

  function onRenameTextImportBenchmarkType(benchmarkKey: string, nextBenchmarkType: string) {
    const splitIndex = benchmarkKey.lastIndexOf("@@");
    if (splitIndex < 0) return;

    const benchmarkName = benchmarkKey.slice(0, splitIndex);
    const nextKey = getTextImportBenchmarkKey(benchmarkName, nextBenchmarkType);

    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType) === benchmarkKey
          ? {
              ...row,
              benchmarkType: nextBenchmarkType
            }
          : row
      )
    );

    if (nextKey === benchmarkKey) return;

    setBenchmarkMergeTargets((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setBenchmarkMergeFilters((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setIgnoredBenchmarkKeys((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesModes((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setParenthesesCustomNames((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });

    setPairNoteAutoFillAppliedByBenchmark((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      next[nextKey] = prev[benchmarkKey];
      delete next[benchmarkKey];
      return next;
    });
  }

  function onRenameTextImportModel(modelName: string, nextModelName: string) {
    setTextImportDraftRows((prev) =>
      prev.map((row) =>
        row.modelName === modelName
          ? (() => {
              const resolvedProvider = resolveProviderFromConfig(nextModelName, providers);
              const inferredProviderName = inferProviderNameFromModelName(nextModelName);

              return {
                ...row,
                modelName: nextModelName,
                providerName: resolvedProvider?.providerName ?? inferredProviderName,
                providerDisplayName: resolvedProvider?.providerDisplayName ?? inferredProviderName
              };
            })()
          : row
      )
    );

    if (nextModelName === modelName) return;

    setModelMergeTargets((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelMergeFilters((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelParenthesesModes((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });

    setModelParenthesesCustomNames((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      next[nextModelName] = prev[modelName];
      delete next[modelName];
      return next;
    });
  }

  function applyBenchmarkOverwriteByTargetId(benchmarkKey: string, targetId: number): boolean {
    const target = benchmarkById.get(targetId)
      ?? benchmarks.find((item) => String(item.id) === String(targetId));
    if (!target) {
      return false;
    }

    onRenameTextImportBenchmark(benchmarkKey, target.benchmarkName);
    onRenameTextImportBenchmarkType(benchmarkKey, target.benchmarkType);
    return true;
  }

  function applyModelOverwriteByTargetId(modelName: string, targetId: number): boolean {
    const target = modelById.get(targetId)
      ?? models.find((item) => String(item.id) === String(targetId));
    if (!target) {
      return false;
    }

    onRenameTextImportModel(modelName, target.modelName);
    return true;
  }

  function resolveExistingTextImportModel(modelNameInput: string): ModelOption | null {
    const normalizedModelName = modelNameInput.trim();
    if (!normalizedModelName) return null;

    const exactModel = existingModelExactMap.get(normalizedModelName.toLowerCase());
    if (exactModel) return exactModel;

    const canonicalKey = normalizeModelNameByDedupeRule(normalizedModelName, modelDedupeRule);
    const canonicalMatchedModel = existingModelByCanonicalKey.get(canonicalKey);
    if (canonicalMatchedModel) return canonicalMatchedModel;

    const sameNameModels = existingModelByNameMap.get(normalizedModelName.toLowerCase()) ?? [];
    return sameNameModels[0] ?? null;
  }

  function onMatrixBenchmarkNameInputChange(benchmarkKey: string, nextBenchmarkName: string) {
    setMatrixBenchmarkNameDrafts((prev) => ({
      ...prev,
      [benchmarkKey]: nextBenchmarkName
    }));
  }

  function onMatrixBenchmarkNameInputBlur(
    benchmarkKey: string,
    currentBenchmarkName: string,
    inputValue: string
  ) {
    const normalized = inputValue.trim();
    const committedName = normalized.length > 0 ? normalized : currentBenchmarkName;

    setMatrixBenchmarkNameDrafts((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      delete next[benchmarkKey];
      return next;
    });

    if (committedName !== currentBenchmarkName) {
      onRenameTextImportBenchmark(benchmarkKey, committedName);
    }
  }

  function onMatrixBenchmarkTypeInputChange(benchmarkKey: string, nextBenchmarkType: string) {
    setMatrixBenchmarkTypeDrafts((prev) => ({
      ...prev,
      [benchmarkKey]: nextBenchmarkType
    }));
  }

  function onMatrixBenchmarkTypeInputBlur(
    benchmarkKey: string,
    currentBenchmarkType: string,
    inputValue: string
  ) {
    const normalized = inputValue.trim();
    const committedType = normalized.length > 0 ? normalized : currentBenchmarkType;

    setMatrixBenchmarkTypeDrafts((prev) => {
      if (!(benchmarkKey in prev)) return prev;
      const next = { ...prev };
      delete next[benchmarkKey];
      return next;
    });

    if (committedType !== currentBenchmarkType) {
      onRenameTextImportBenchmarkType(benchmarkKey, committedType);
    }
  }

  function onMatrixModelNameInputChange(modelName: string, nextModelName: string) {
    setMatrixModelNameDrafts((prev) => ({
      ...prev,
      [modelName]: nextModelName
    }));
  }

  function onMatrixModelNameInputBlur(modelName: string, inputValue: string) {
    const normalized = inputValue.trim();
    const committedModelName = normalized.length > 0 ? normalized : modelName;
    const matchedExistingModel = resolveExistingTextImportModel(committedModelName);
    const resolvedModelName = matchedExistingModel?.modelName ?? committedModelName;

    setMatrixModelNameDrafts((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      delete next[modelName];
      return next;
    });

    if (resolvedModelName !== modelName) {
      onRenameTextImportModel(modelName, resolvedModelName);
    }
  }

  async function onPreviewCsvImport() {
    setIsPreviewingTextImport(true);
    try {
      const result = await postJson("/api/admin/import-csv/preview", {
        csvText,
        htmlText: csvHtmlText || undefined,
        source: csvSource || undefined
      });
      setHasParsedHtmlTable(result.parseSource === "html");
      const previewRows = applyExistingEloBenchmarkToPreviewRows((result.previewRows ?? []) as TextImportPreviewRow[]);
      setTextImportPreviewRows(previewRows);
      setTextImportDraftRows(previewRows.map((row) => ({ ...row })));
      setGlobalStarSupplement("");
      setBenchmarkMergeTargets({});
      setBenchmarkMergeFilters({});
      setIgnoredBenchmarkKeys({});
      setParenthesesModes({});
      setParenthesesCustomNames({});
      setModelMergeTargets({});
      setModelMergeFilters({});
      setModelParenthesesModes({});
      setModelParenthesesCustomNames({});
      setPairNoteAutoFillAppliedByBenchmark({});
      setMatrixBenchmarkNameDrafts({});
      setMatrixBenchmarkTypeDrafts({});
      setMatrixModelNameDrafts({});
      setOpenMatrixModelCandidateFor(null);
      setOpenMatrixBenchmarkCandidateFor(null);
      setTextImportPreviewMeta({
        format: result.format ?? "matrix-table",
        total: result.total ?? 0,
        skipped: result.skipped ?? 0
      });
      setTextImportPreviewVisibleCount(200);

      const directionWarningCount = Number(result.warningCount ?? 0);
      const warningDetails = extractTextImportWarningDetails(result.warnings);
      if (directionWarningCount > 0) {
        notifyError(
          `文本预览完成：可导入 ${result.total ?? 0} 条，跳过 ${result.skipped ?? 0} 条；检测到 ${directionWarningCount} 条解析警告（导入时会自动清洗/修正）`,
          warningDetails
        );
      } else {
        notifySuccess(`文本预览完成：可导入 ${result.total ?? 0} 条，跳过 ${result.skipped ?? 0} 条`);
      }
    } catch (error) {
      setHasParsedHtmlTable(false);
      notifyError(error instanceof Error ? error.message : "文本预览失败");
    } finally {
      setIsPreviewingTextImport(false);
    }
  }

  function onCsvTextPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const htmlText = event.clipboardData.getData("text/html").trim();
    if (!/<table[\s>]/i.test(htmlText)) {
      setCsvHtmlText("");
      setHasParsedHtmlTable(false);
      return;
    }

    event.preventDefault();

    const plainText = event.clipboardData.getData("text/plain");
    setCsvHtmlText(htmlText);
    setHasParsedHtmlTable(false);
    if (plainText.length > 0) {
      setCsvText(plainText);
    }
  }

  async function executeImportCsv() {
    if (isImportingTextCsv) {
      return;
    }

    if (textImportDraftRows.length > 0 && finalizedTextImportRows.length === 0) {
      notifyError("处理后无可导入数据，请检查忽略项或编辑值");
      return;
    }

    if (textImportProgressTimerRef.current) {
      clearInterval(textImportProgressTimerRef.current);
      textImportProgressTimerRef.current = null;
    }

    setIsImportingTextCsv(true);
    setTextImportStatus("running");
    setTextImportStatusText("正在导入文本...");
    setTextImportProgress(8);

    let finalStatus: "success" | "error" = "error";
    let finalStatusText = "导入失败";
    let finalProgress = 6;

    textImportProgressTimerRef.current = setInterval(() => {
      setTextImportProgress((prev) => {
        if (prev >= 90) return prev;
        const next = prev + Math.floor(Math.random() * 7) + 2;
        return next > 90 ? 90 : next;
      });
    }, 260);

    try {
      if (textImportDraftRows.length > 0) {
        const generatedCsvText = buildStructuredCsvText(finalizedTextImportRows);
        const result = await postJson("/api/admin/import-csv", {
          csvText: generatedCsvText,
          rows: finalizedTextImportRows,
          source: csvSource || undefined
        });

        const directionWarningCount = Number(result.warningCount ?? 0);
        const warningDetails = extractTextImportWarningDetails(result.warnings);
        if (directionWarningCount > 0) {
          notifyError(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）；已自动处理 ${directionWarningCount} 条解析警告`,
            warningDetails
          );
        } else {
          notifySuccess(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（忽略 ${ignoredTextImportCount}，格式 ${result.format ?? "structured-csv"}）`
          );
        }
        finalStatus = "success";
        finalProgress = 100;
        finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
      } else {
        const result = await postJson("/api/admin/import-csv", {
          csvText,
          htmlText: csvHtmlText || undefined,
          source: csvSource || undefined
        });

        const directionWarningCount = Number(result.warningCount ?? 0);
        const warningDetails = extractTextImportWarningDetails(result.warnings);
        if (directionWarningCount > 0) {
          notifyError(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（跳过 ${result.skipped ?? 0}，格式 ${result.format ?? "auto"}）；已自动处理 ${directionWarningCount} 条解析警告`,
            warningDetails
          );
        } else {
          notifySuccess(
            `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（跳过 ${result.skipped ?? 0}，格式 ${result.format ?? "auto"}）`
          );
        }
        finalStatus = "success";
        finalProgress = 100;
        finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "文本导入失败");
      finalStatus = "error";
      finalProgress = 6;
      finalStatusText = error instanceof Error ? `导入失败：${error.message}` : "导入失败";
    } finally {
      if (textImportProgressTimerRef.current) {
        clearInterval(textImportProgressTimerRef.current);
        textImportProgressTimerRef.current = null;
      }
      setTextImportStatus(finalStatus);
      setTextImportStatusText(finalStatusText);
      setTextImportProgress(finalProgress);
      setIsImportingTextCsv(false);
    }
  }

  async function onImportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isImportingTextCsv) {
      return;
    }

    const latestSourceInput = csvSource.trim();
    const hasAnySource = latestSourceInput.length > 0
      || (textImportDraftRows.length > 0
        ? finalizedTextImportRows.some((row) => (row.source ?? "").trim().length > 0)
        : false);

    if (!hasAnySource) {
      setConfirmImportWithoutSourceOpen(true);
      return;
    }

    await continueImportCsvFlow();
  }

  async function continueImportCsvFlow() {
    if (isImportingTextCsv) {
      return;
    }

    if (!textImportPreviewMeta) {
      setConfirmImportWithoutPreviewOpen(true);
      return;
    }

    await executeImportCsv();
  }

  async function onConfirmImportWithoutSource() {
    setConfirmImportWithoutSourceOpen(false);
    await continueImportCsvFlow();
  }

  async function onConfirmImportWithoutPreview() {
    setConfirmImportWithoutPreviewOpen(false);
    await executeImportCsv();
  }

  function duplicateConfidenceBadgeClass(confidence: DuplicateConfidence): string {
    if (confidence === "high") {
      return "border border-emerald-300/70 bg-emerald-500/25 text-emerald-100";
    }
    if (confidence === "medium") {
      return "border border-amber-300/70 bg-amber-500/25 text-amber-100";
    }
    return "border border-slate-300/50 bg-slate-500/20 text-slate-100";
  }

  function duplicateConfidenceLabel(confidence: DuplicateConfidence): string {
    if (confidence === "high") return "高置信";
    if (confidence === "medium") return "中置信";
    return "低置信";
  }

  function duplicateCandidateCardClass(confidence: DuplicateConfidence): string {
    if (confidence === "high") {
      return "border-success/45 bg-success/5";
    }
    if (confidence === "medium") {
      return "border-warning/45 bg-warning/5";
    }
    return "border-base-300/70 bg-base-100/70";
  }

  function duplicateReasonLabel(reason: string): string {
    if (reason === "strict-normalized-equal") return "严格归一化一致";
    if (reason === "ignore-high-reasoning-tokens-equal") return "去噪词后名称一致";
    if (reason === "normalized-name-equal") return "名称归一化一致";
    if (reason === "variant-noise-normalized-name-equal") return "去变体后缀后名称一致";
    if (reason === "same-type") return "类型一致";
    if (reason === "general-type-gap") return "General 可覆盖";
    if (reason === "type-mismatch") return "类型不一致";
    if (reason === "numeric-token-mismatch") return "数字片段不一致（降为低置信）";
    if (reason === "variant-conflict-hint") return "疑似变体冲突";
    if (reason === "version-gap-hint") return "版本差异（已降级）";
    if (reason === "trailing-variant-mismatch") return "末尾变体差异（降为低置信）";
    if (reason.startsWith("char-similarity-")) {
      const value = Number.parseFloat(reason.replace("char-similarity-", ""));
      if (Number.isFinite(value)) {
        return `字符相似 ${(value * 100).toFixed(1)}%`;
      }
      return "字符相似";
    }
    return reason;
  }

  function getDuplicateCandidateKey(
    entityType: "model" | "benchmark",
    candidate: { sourceId: number; targetId: number }
  ) {
    return `${entityType}:${candidate.sourceId}:${candidate.targetId}`;
  }

  function setDuplicateCandidateSelected(
    entityType: "model" | "benchmark",
    candidate: { sourceId: number; targetId: number },
    selected: boolean
  ) {
    const key = getDuplicateCandidateKey(entityType, candidate);
    setSelectedDuplicateCandidateKeys((prev) => ({
      ...prev,
      [key]: selected
    }));
  }

  function toggleAllVisibleDuplicateCandidates(selected: boolean) {
    const candidates = duplicateDetectionEntityType === "model"
      ? visibleModelDuplicateCandidates
      : visibleBenchmarkDuplicateCandidates;

    setSelectedDuplicateCandidateKeys((prev) => {
      const next = { ...prev };
      candidates.forEach((candidate) => {
        next[getDuplicateCandidateKey(duplicateDetectionEntityType, candidate)] = selected;
      });
      return next;
    });
  }

  function applyModelDuplicateCandidate(candidate: DuplicateModelCandidate) {
    setMergeType("model");
    setMergeSourceInput(`${candidate.sourceName} [${candidate.sourceId}]`);
    setMergeTargetInput(`${candidate.targetName} [${candidate.targetId}]`);
    setMergeTargetBenchmarkNameInput("");
    window.requestAnimationFrame(() => {
      mergeSubmitButtonRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest"
      });
    });
  }

  function applyBenchmarkDuplicateCandidate(candidate: DuplicateBenchmarkCandidate) {
    setMergeType("benchmark");
    setMergeSourceInput(`${candidate.sourceName} [${candidate.sourceType}] [${candidate.sourceId}]`);
    setMergeTargetInput(`${candidate.targetName} [${candidate.targetType}] [${candidate.targetId}]`);
    setMergeTargetBenchmarkNameInput(candidate.targetName);
    window.requestAnimationFrame(() => {
      mergeSubmitButtonRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest"
      });
    });
  }

  function resolveMergeEntityLabel(
    entityType: "model" | "benchmark",
    entityId: number,
    targetBenchmarkNameOverride?: string
  ): string {
    if (entityType === "model") {
      return modelById.get(entityId)?.modelName ?? `#${entityId}`;
    }

    const benchmark = benchmarkById.get(entityId);
    if (targetBenchmarkNameOverride && targetBenchmarkNameOverride.trim().length > 0) {
      return benchmark
        ? `${targetBenchmarkNameOverride.trim()} [${benchmark.benchmarkType}]`
        : targetBenchmarkNameOverride.trim();
    }

    return benchmark ? `${benchmark.benchmarkName} [${benchmark.benchmarkType}]` : `#${entityId}`;
  }

  function removeDuplicateCandidateByMerge(entityType: "model" | "benchmark", sourceId: number, targetId: number) {
    setDuplicateDetectionResult((prev) => {
      if (!prev) return prev;

      const shouldKeepCandidate = (candidate: { sourceId: number; targetId: number }) => {
        const isExactPair = candidate.sourceId === sourceId && candidate.targetId === targetId;
        const isReversePair = candidate.sourceId === targetId && candidate.targetId === sourceId;
        return !isExactPair && !isReversePair;
      };

      if (entityType === "model") {
        return {
          ...prev,
          modelCandidates: prev.modelCandidates.filter(shouldKeepCandidate)
        };
      }

      return {
        ...prev,
        benchmarkCandidates: prev.benchmarkCandidates.filter(shouldKeepCandidate)
      };
    });

    setSelectedDuplicateCandidateKeys((prev) => {
      const next = { ...prev };
      delete next[`${entityType}:${sourceId}:${targetId}`];
      delete next[`${entityType}:${targetId}:${sourceId}`];
      return next;
    });
  }

  function upsertMergedRecordAfterMerge(
    entityType: "model" | "benchmark",
    sourceId: number,
    targetId: number,
    targetBenchmarkNameOverride?: string
  ) {
    const sourceName = resolveMergeEntityLabel(entityType, sourceId);
    const targetName = resolveMergeEntityLabel(entityType, targetId, targetBenchmarkNameOverride);

    setMergedRecordList((prev) => {
      const nextRecord: MergedRecord = {
        entityType,
        sourceId,
        sourceName,
        targetId,
        targetName
      };

      const existingIndex = prev.findIndex(
        (item) => item.entityType === entityType && item.sourceId === sourceId
      );

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextRecord;
        return next;
      }

      return [nextRecord, ...prev];
    });

    setMergedRecordTargetInputs((prev) => ({
      ...prev,
      [`${entityType}:${sourceId}`]: `${targetName} [${targetId}]`
    }));
  }

  async function onDetectDuplicateCandidates() {
    if (isDetectingDuplicates) return;

    setIsDetectingDuplicates(true);
    try {
      const result = await postJson("/api/admin/detect-duplicates", {});
      const typedResult = result as DuplicateDetectionResult;
      setDuplicateDetectionResult(typedResult);
      setSelectedDuplicateCandidateKeys({});

      if ((typedResult.modelCandidates?.length ?? 0) > 0) {
        setDuplicateDetectionEntityType("model");
      } else {
        setDuplicateDetectionEntityType("benchmark");
      }

      notifySuccess(
        `重复检测完成：model 候选 ${typedResult.modelCandidates?.length ?? 0} 条，benchmark 候选 ${typedResult.benchmarkCandidates?.length ?? 0} 条`
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "重复检测失败");
    } finally {
      setIsDetectingDuplicates(false);
    }
  }

  async function onCheckScaleConsistency() {
    if (isCheckingScaleConsistency) return;

    setIsCheckingScaleConsistency(true);
    try {
      const result = await postJson("/api/admin/data-maintenance/consistency-check", {});
      const typedResult = result as ScaleConsistencyCheckResult;
      const issues = (Array.isArray(typedResult.issues) ? typedResult.issues : []).map((item) => ({
        ...item,
        valueDetails: Array.isArray(item.valueDetails) ? item.valueDetails : []
      }));

      setScaleConsistencyIssues(issues);
      setScaleSplitNameDrafts((prev) => {
        const next = { ...prev };

        issues.forEach((item) => {
          if (item.issueType !== "mixed-scale-100-vs-elo") {
            return;
          }

          next[item.benchmarkId] = next[item.benchmarkId] ?? {
            baseName: item.benchmarkName,
            eloName: `${item.benchmarkName} (Elo)`
          };
        });

        return next;
      });
      setScaleConsistencyCheckedAt(
        typeof typedResult.generatedAt === "string"
          ? typedResult.generatedAt
          : new Date().toISOString()
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "数据一致性检测失败");
    } finally {
      setIsCheckingScaleConsistency(false);
    }
  }

  async function onNormalizeBenchmarkScale(issue: ScaleConsistencyIssue, targetScale: 1 | 100) {
    if (normalizingScaleBenchmarkId !== null) {
      return;
    }

    setNormalizingScaleBenchmarkId(issue.benchmarkId);
    try {
      const result = await postJson("/api/admin/data-maintenance/normalize-scale", {
        benchmarkId: issue.benchmarkId,
        targetScale
      });

      notifySuccess(
        `已将 ${issue.benchmarkName} [${issue.benchmarkType}] 同化为 ${targetScale} 量纲（更新 ${result.updatedRows ?? 0} 行 / ${result.updatedCells ?? 0} 个值）`
      );

      await onCheckScaleConsistency();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "量纲同化失败");
    } finally {
      setNormalizingScaleBenchmarkId(null);
    }
  }

  async function onSplitBenchmarkScale(issue: ScaleConsistencyIssue) {
    if (splittingScaleBenchmarkId !== null) {
      return;
    }

    const draft = scaleSplitNameDrafts[issue.benchmarkId] ?? {
      baseName: issue.benchmarkName,
      eloName: `${issue.benchmarkName} (Elo)`
    };

    const baseBenchmarkName = draft.baseName.trim();
    const eloBenchmarkName = draft.eloName.trim();

    if (!baseBenchmarkName || !eloBenchmarkName) {
      notifyError("拆分后的 benchmark 名称不能为空");
      return;
    }

    setSplittingScaleBenchmarkId(issue.benchmarkId);
    try {
      const result = await postJson("/api/admin/data-maintenance/split-benchmark-scale", {
        benchmarkId: issue.benchmarkId,
        splitMode: "hundred-vs-elo",
        baseBenchmarkName,
        eloBenchmarkName
      });

      notifySuccess(
        `已拆分 ${baseBenchmarkName} / ${eloBenchmarkName}（整行迁移 ${result.movedRows ?? 0}，跨组拆分 ${result.splitRows ?? 0}，新增 ${result.createdRows ?? 0} 行）`
      );

      await onCheckScaleConsistency();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "benchmark 拆分失败");
    } finally {
      setSplittingScaleBenchmarkId(null);
    }
  }

  async function onMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mergeSubmitState === "submitting") return;

    if (resolvedMergeSourceId === null || resolvedMergeTargetId === null) {
      notifyError("请从下拉候选中选择 source/target，或直接输入合法 ID");
      return;
    }

    if (resolvedMergeSourceId === resolvedMergeTargetId) {
      notifyError("source 和 target 不能相同");
      return;
    }

    if (mergeSubmitResetTimerRef.current) {
      clearTimeout(mergeSubmitResetTimerRef.current);
      mergeSubmitResetTimerRef.current = null;
    }

    const normalizedTargetBenchmarkName =
      mergeType === "benchmark"
        ? mergeTargetBenchmarkNameInput.trim()
        : "";

    setMergeSubmitState("submitting");

    try {
      await postJson("/api/admin/merge", {
        entityType: mergeType,
        sourceId: resolvedMergeSourceId,
        targetId: resolvedMergeTargetId,
        targetBenchmarkName:
          mergeType === "benchmark" && normalizedTargetBenchmarkName.length > 0
            ? normalizedTargetBenchmarkName
            : undefined
      });

      upsertMergedRecordAfterMerge(
        mergeType,
        resolvedMergeSourceId,
        resolvedMergeTargetId,
        mergeType === "benchmark" ? normalizedTargetBenchmarkName : undefined
      );
      removeDuplicateCandidateByMerge(mergeType, resolvedMergeSourceId, resolvedMergeTargetId);

      setMergeTargetBenchmarkNameInput("");
      setMergeSubmitState("success");

      mergeSubmitResetTimerRef.current = setTimeout(() => {
        setMergeSubmitState("idle");
        mergeSubmitResetTimerRef.current = null;
      }, 1200);

      notifySuccess("合并完成。");
      router.refresh();
    } catch (error) {
      setMergeSubmitState("idle");
      notifyError(error instanceof Error ? error.message : "合并失败");
    }
  }

  async function onBatchMergeDuplicateCandidates() {
    if (isBatchMergingDuplicates || selectedActiveDuplicateCandidateCount === 0) return;

    const entityType = duplicateDetectionEntityType;
    const candidates = entityType === "model"
      ? selectedVisibleModelDuplicateCandidates
      : selectedVisibleBenchmarkDuplicateCandidates;

    setIsBatchMergingDuplicates(true);

    let mergedCount = 0;
    try {
      for (const candidate of candidates) {
        await postJson("/api/admin/merge", {
          entityType,
          sourceId: candidate.sourceId,
          targetId: candidate.targetId,
          targetBenchmarkName: entityType === "benchmark"
            ? (candidate as DuplicateBenchmarkCandidate).targetName
            : undefined
        });

        upsertMergedRecordAfterMerge(
          entityType,
          candidate.sourceId,
          candidate.targetId,
          entityType === "benchmark" ? (candidate as DuplicateBenchmarkCandidate).targetName : undefined
        );
        removeDuplicateCandidateByMerge(entityType, candidate.sourceId, candidate.targetId);
        mergedCount += 1;
      }

      notifySuccess(`批量合并完成：${mergedCount} 条。`);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? `批量合并中断：已完成 ${mergedCount} 条；${error.message}`
          : `批量合并中断：已完成 ${mergedCount} 条`
      );
    } finally {
      setIsBatchMergingDuplicates(false);
    }
  }

  async function onUpdateMergedRecord(record: MergedRecord) {
    const key = `${record.entityType}:${record.sourceId}`;
    const input = mergedRecordTargetInputs[key] ?? "";
    const options = record.entityType === "model" ? modelEntityOptions : benchmarkEntityOptions;
    const targetId = parseMergeEntityId(input, options);

    if (targetId === null) {
      notifyError("请从候选中选择有效 target，或输入合法 ID");
      return;
    }

    if (targetId === record.sourceId) {
      notifyError("source 和 target 不能相同");
      return;
    }

    try {
      await postJson(
        "/api/admin/merge-record",
        {
          entityType: record.entityType,
          sourceId: record.sourceId,
          targetId
        },
        "PATCH"
      );

      const targetName = options.find((item) => item.id === targetId)?.label ?? `#${targetId}`;

      setMergedRecordList((prev) =>
        prev.map((item) =>
          item.entityType === record.entityType && item.sourceId === record.sourceId
            ? { ...item, targetId, targetName }
            : item
        )
      );

      setMergedRecordTargetInputs((prev) => ({
        ...prev,
        [key]: `${targetName} [${targetId}]`
      }));

      notifySuccess("已更新合并目标。注意：此操作仅更新合并映射，不会回滚历史值迁移。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "更新合并记录失败");
    }
  }

  async function onDeleteMergedRecord(record: MergedRecord) {
    const confirmed = window.confirm("确认删除该合并记录吗？此操作不会回滚历史值迁移。继续？");
    if (!confirmed) return;

    try {
      await postJson(
        "/api/admin/merge-record",
        {
          entityType: record.entityType,
          sourceId: record.sourceId
        },
        "DELETE"
      );

      setMergedRecordList((prev) =>
        prev.filter((item) => !(item.entityType === record.entityType && item.sourceId === record.sourceId))
      );
      setMergedRecordTargetInputs((prev) => {
        const next = { ...prev };
        delete next[`${record.entityType}:${record.sourceId}`];
        return next;
      });

      notifySuccess("已删除合并映射。若需刷新下拉数据可手动刷新页面。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除合并记录失败");
    }
  }

  function onPickRenameEntity(entityId: number) {
    setRenameSelectedEntityId(entityId);
    setRenameSubmitState("idle");

    if (renameEntityType === "model") {
      const matchedModel = modelById.get(entityId);
      setRenameNextName(matchedModel?.modelName ?? "");
      setRenameNextProviderInput(matchedModel ? getProviderInputValue(matchedModel.providerId) : "");
      setRenameNextBenchmarkType("");
      return;
    }

    const matchedBenchmark = benchmarkById.get(entityId);
    setRenameNextName(matchedBenchmark?.benchmarkName ?? "");
    setRenameNextProviderInput("");
    setRenameNextBenchmarkType(matchedBenchmark?.benchmarkType ?? "");
  }

  function getProviderInputValue(providerId: number) {
    const provider = providerById.get(providerId);
    return provider ? `${getProviderOptionLabel(provider)} [${provider.id}]` : "";
  }

  function parseRenameProviderId(rawInput: string): number | null {
    const parsedId = parseMergeEntityId(rawInput, providerEntityOptions);
    if (parsedId !== null && providerById.has(parsedId)) {
      return parsedId;
    }

    const normalized = rawInput.trim().toLowerCase();
    if (!normalized) return null;

    const matchedProvider = providers.find((provider) => {
      const displayName = provider.config?.displayName?.trim().toLowerCase() ?? "";
      return provider.name.toLowerCase() === normalized
        || provider.slug.toLowerCase() === normalized
        || displayName === normalized;
    });

    return matchedProvider?.id ?? null;
  }

  async function onRenameEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (renameSubmitState === "submitting") {
      return;
    }

    if (renameSelectedEntityId === null) {
      notifyError("请先在上方搜索结果中选择一个实体");
      return;
    }

    const normalizedNextName = renameNextName.trim();
    if (!normalizedNextName) {
      notifyError("新名称不能为空");
      return;
    }

    const normalizedNextBenchmarkType = renameEntityType === "benchmark"
      ? renameNextBenchmarkType.trim()
      : "";

    if (renameEntityType === "benchmark" && !normalizedNextBenchmarkType) {
      notifyError("benchmark 的新 type 不能为空");
      return;
    }

    const normalizedNextProviderId = renameEntityType === "model"
      ? parseRenameProviderId(renameNextProviderInput)
      : null;

    if (renameEntityType === "model" && normalizedNextProviderId === null) {
      notifyError("model provider 不能为空，请从下拉候选选择或输入 provider 名称/ID");
      return;
    }

    if (renameSubmitResetTimerRef.current) {
      clearTimeout(renameSubmitResetTimerRef.current);
      renameSubmitResetTimerRef.current = null;
    }

    setRenameSubmitState("submitting");

    try {
      const result = await postJson("/api/admin/rename-entity", {
        entityType: renameEntityType,
        entityId: renameSelectedEntityId,
        nextName: normalizedNextName,
        nextProviderId: renameEntityType === "model" ? normalizedNextProviderId : undefined,
        nextBenchmarkType: renameEntityType === "benchmark" ? normalizedNextBenchmarkType : undefined,
        mergeOnConflict: renameMergeOnConflict
      });

      const action = typeof result?.action === "string" ? result.action : "renamed";
      const persistedNextName = typeof result?.nextName === "string" ? result.nextName : normalizedNextName;
      const persistedNextBenchmarkType = renameEntityType === "benchmark"
        ? (typeof result?.nextBenchmarkType === "string" ? result.nextBenchmarkType : normalizedNextBenchmarkType)
        : "";
      const persistedNextProviderId = renameEntityType === "model" && typeof result?.nextProviderId === "number"
        ? result.nextProviderId
        : normalizedNextProviderId;

      setRenameNextName(persistedNextName);
      if (renameEntityType === "benchmark") {
        setRenameNextBenchmarkType(persistedNextBenchmarkType);
      } else if (persistedNextProviderId !== null) {
        setRenameNextProviderInput(getProviderInputValue(persistedNextProviderId) || String(persistedNextProviderId));
      }
      setRenameSubmitState("success");

      renameSubmitResetTimerRef.current = setTimeout(() => {
        setRenameSubmitState("idle");
        renameSubmitResetTimerRef.current = null;
      }, 1200);

      if (action === "unchanged") {
        notifySuccess("名称未变化，无需更新", ["实体当前名称与目标名称一致"]);
        return;
      }

      if (action === "merged-and-renamed") {
        const mergedSourceId = Number(result?.mergedSourceId);
        const mergedSourceName = typeof result?.mergedSourceName === "string"
          ? result.mergedSourceName
          : undefined;

        if (Number.isFinite(mergedSourceId) && mergedSourceId > 0 && mergedSourceId !== renameSelectedEntityId) {
          const fallbackSourceName = renameEntityType === "model"
            ? (modelById.get(mergedSourceId)?.modelName ?? `#${mergedSourceId}`)
            : (benchmarkById.get(mergedSourceId)?.benchmarkName ?? `#${mergedSourceId}`);

          upsertMergedRecordAfterMerge(
            renameEntityType,
            mergedSourceId,
            renameSelectedEntityId,
            renameEntityType === "benchmark" ? persistedNextName : undefined
          );

          notifySuccess("改名完成，并已自动合并重名实体", [
            `合并来源：${mergedSourceName ?? fallbackSourceName} [${mergedSourceId}]`
          ]);
          router.refresh();
          return;
        }

        notifySuccess("改名完成，并已处理重名冲突");
        router.refresh();
        return;
      }

      notifySuccess("名称已更新并写入数据库");
      router.refresh();
    } catch (error) {
      setRenameSubmitState("idle");
      notifyError(error instanceof Error ? error.message : "实体改名失败");
    }
  }

  async function onSaveSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const valueJson = JSON.parse(settingValue);
      await postJson("/api/admin/settings", {
        key: settingKey,
        valueJson,
        note: settingNote || undefined,
        updatedBy: "admin"
      });
      notifySuccess("设置项已保存。刷新页面可看到最新 settings。");
    } catch (error) {
      if (error instanceof SyntaxError) {
        notifyError("setting value 必须是合法 JSON");
        return;
      }
      notifyError(error instanceof Error ? error.message : "设置项保存失败");
    }
  }

  function onClearDatabase() {
    setClearDatabaseConfirmOpen(true);
  }

  function closeClearDatabaseConfirm() {
    if (isClearingDatabase) return;
    setClearDatabaseConfirmOpen(false);
  }

  async function onConfirmClearDatabase() {
    if (isClearingDatabase) return;

    setIsClearingDatabase(true);
    try {
      await postJson("/api/admin/debug/clear-data", {
        confirm: "CLEAR_NON_SETTINGS_DATA"
      });

      setClearDatabaseConfirmOpen(false);
      notifySuccess("已清空除 settings 外的所有表。若下拉项未更新，请刷新页面。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "清空数据库失败");
    } finally {
      setIsClearingDatabase(false);
    }
  }

  async function onDeleteModelData() {
    const modelId = parseMergeEntityId(deleteModelInput, modelEntityOptions);
    if (modelId === null) {
      notifyError("请先选择有效模型（可输入名称后从下拉候选选择）");
      return;
    }

    const selectedModelName = models.find((item) => item.id === modelId)?.modelName ?? `#${modelId}`;
    const confirmed = window.confirm(
      `确认删除模型 ${selectedModelName} 的所有数据吗？\n将删除该模型及其全部 benchmark_values。`
    );
    if (!confirmed) return;

    try {
      const result = await postJson("/api/admin/debug/delete-model", { modelId });
      notifySuccess(`已删除模型：${result.modelName ?? selectedModelName}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除模型失败");
    }
  }

  async function onDeleteSourceData() {
    if (isDeletingSourceData) {
      return;
    }

    setConfirmDeleteSourceOpen(true);
  }

  function getDeleteSourceDisplayLabel(sourceInput: string): string {
    const source = sourceInput.trim();
    if (!source) {
      return "空 source（NULL/空字符串）";
    }

    return source.toLowerCase().startsWith("text:")
      ? `text:${source.slice(5).trim()}`
      : `text:${source}`;
  }

  async function onConfirmDeleteSourceData() {
    if (isDeletingSourceData) {
      return;
    }

    const source = deleteSourceInput.trim();
    const normalizedSourceLabel = getDeleteSourceDisplayLabel(source);

    setIsDeletingSourceData(true);

    try {
      const result = await postJson("/api/admin/debug/delete-source", { source });
      setDeleteSourceInput("");
      setConfirmDeleteSourceOpen(false);

      const deletedSourceLabel = result.deletedEmptySource
        ? "空 source（NULL/空字符串）"
        : (result.normalizedSource ?? normalizedSourceLabel);

      notifySuccess(`已删除 source=${deletedSourceLabel} 的 ${result.deleted ?? 0} 条记录`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除 source 数据失败");
    } finally {
      setIsDeletingSourceData(false);
    }
  }

  async function onSaveModelDedupeRule() {
    try {
      const result = await postJson("/api/admin/settings", {
        key: "model_dedupe_rule",
        valueJson: modelDedupeRule,
        note: "模型重复识别规则",
        updatedBy: "admin"
      });

      const mergedCount =
        typeof result?.rebuildResult?.mergedCount === "number" ? result.rebuildResult.mergedCount : null;
      const benchmarkMergedCount =
        typeof result?.rebuildResult?.benchmarkMergedCount === "number"
          ? result.rebuildResult.benchmarkMergedCount
          : null;

      notifySuccess(
        mergedCount !== null || benchmarkMergedCount !== null
          ? `模型重复识别规则已保存，并已重算 canonical_key（模型合并 ${mergedCount ?? 0} 条，benchmark 合并 ${benchmarkMergedCount ?? 0} 条）。`
          : "模型重复识别规则已保存。新导入与新增实体会按此规则判重。"
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存模型规则失败");
    }
  }

  const canSubmitMerge =
    mergeSubmitState !== "submitting"
    && resolvedMergeSourceId !== null
    && resolvedMergeTargetId !== null
    && resolvedMergeSourceId !== resolvedMergeTargetId;

  function toPricingDraft(row: ModelPricingRow): ModelPricingDraft {
    const costToString = (value: number | null) => value === null ? "" : String(value);
    return {
      inputCost: costToString(row.inputCost),
      outputCost: costToString(row.outputCost),
      cacheReadCost: costToString(row.cacheReadCost),
      reasoningCost: costToString(row.reasoningCost),
      cacheWriteCost: costToString(row.cacheWriteCost),
      inputAudioCost: costToString(row.inputAudioCost),
      outputAudioCost: costToString(row.outputAudioCost),
      sourceProviderId: row.sourceProviderId ?? "",
      sourceProviderName: row.sourceProviderName ?? "",
      sourceModelId: row.sourceModelId ?? "",
      sourceModelName: row.sourceModelName ?? "",
      manualOverride: row.manualOverride,
      note: row.note ?? ""
    };
  }

  function resetPricingDrafts(rows: ModelPricingRow[]) {
    setPricingDrafts(
      rows.reduce<Record<number, ModelPricingDraft>>((acc, row) => {
        acc[row.modelId] = toPricingDraft(row);
        return acc;
      }, {})
    );
  }

  async function loadModelPrices() {
    setLoadingPrices(true);
    try {
      const result = await getJson("/api/admin/model-prices");
      const prices = Array.isArray(result?.prices) ? result.prices as ModelPricingRow[] : [];
      setModelPriceRows(prices);
      resetPricingDrafts(prices);
      setHasLoadedPrices(true);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "加载模型价格失败");
    } finally {
      setLoadingPrices(false);
    }
  }

  // Load pricing data on mount if the initial tab is pricing
  useEffect(() => {
    if (initialTab === "pricing") {
      const timer = setTimeout(() => {
        void loadModelPrices();
      }, 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/admin?${params.toString()}`, { scroll: false });

    if (tab === "pricing" && !hasLoadedPrices && !loadingPrices) {
      void loadModelPrices();
    }
  }

  function updatePricingDraft(modelId: number, updater: (draft: ModelPricingDraft) => ModelPricingDraft) {
    const sourceRow = modelPriceRows.find((row) => row.modelId === modelId);
    if (!sourceRow) return;

    setPricingDrafts((prev) => ({
      ...prev,
      [modelId]: updater(prev[modelId] ?? toPricingDraft(sourceRow))
    }));
  }

  function parseOptionalCost(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
      throw new Error("价格必须是非负数字");
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("价格必须是非负数字");
    }
    return parsed;
  }

  async function syncModelPrices() {
    if (syncingPrices) return;
    setSyncingPrices(true);
    try {
      const result = await postJson("/api/admin/model-prices/sync", {});
      setPricingSyncResult(result as ModelPricingSyncResult);
      notifySuccess(`价格同步完成：匹配 ${result.matchedCount ?? 0} 个，未匹配 ${result.unmatchedCount ?? 0} 个`);
      await loadModelPrices();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "同步模型价格失败");
    } finally {
      setSyncingPrices(false);
    }
  }

  async function saveModelPrice(modelId: number) {
    const draft = pricingDrafts[modelId];
    if (!draft || savingPriceModelId !== null) return;

    const sourceRow = modelPriceRows.find((row) => row.modelId === modelId);

    setSavingPriceModelId(modelId);
    try {
      const parsedCosts = {
        inputCost: parseOptionalCost(draft.inputCost),
        outputCost: parseOptionalCost(draft.outputCost),
        cacheReadCost: parseOptionalCost(draft.cacheReadCost),
        reasoningCost: parseOptionalCost(draft.reasoningCost),
        cacheWriteCost: parseOptionalCost(draft.cacheWriteCost),
        inputAudioCost: parseOptionalCost(draft.inputAudioCost),
        outputAudioCost: parseOptionalCost(draft.outputAudioCost)
      };
      const priceChanged = sourceRow
        ? parsedCosts.inputCost !== sourceRow.inputCost
          || parsedCosts.outputCost !== sourceRow.outputCost
          || parsedCosts.cacheReadCost !== sourceRow.cacheReadCost
          || parsedCosts.reasoningCost !== sourceRow.reasoningCost
          || parsedCosts.cacheWriteCost !== sourceRow.cacheWriteCost
          || parsedCosts.inputAudioCost !== sourceRow.inputAudioCost
          || parsedCosts.outputAudioCost !== sourceRow.outputAudioCost
        : false;
      const manualOverride = draft.manualOverride || priceChanged;

      await postJson(
        "/api/admin/model-prices",
        {
          modelId,
          ...parsedCosts,
          sourceProviderId: draft.sourceProviderId.trim() || null,
          sourceProviderName: draft.sourceProviderName.trim() || null,
          sourceModelId: draft.sourceModelId.trim() || null,
          sourceModelName: draft.sourceModelName.trim() || null,
          manualOverride,
          matchStatus: manualOverride ? "manual" : "matched",
          note: draft.note.trim() || null
        },
        "PATCH"
      );
      notifySuccess("模型价格已保存");
      await loadModelPrices();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存模型价格失败");
    } finally {
      setSavingPriceModelId(null);
    }
  }

  return (
    <>
      <AdminConsoleNotices noticeList={noticeList} />

      <SheetPickerDialog
        open={sheetPickerOpen}
        sheetNames={sheetNames}
        onSelectSheet={onSelectSheet}
        onClose={() => setSheetPickerOpen(false)}
      />

      <ConfirmImportWithoutPreviewDialog
        open={confirmImportWithoutPreviewOpen}
        isImportingTextCsv={isImportingTextCsv}
        onClose={() => setConfirmImportWithoutPreviewOpen(false)}
        onConfirm={onConfirmImportWithoutPreview}
      />

      <ConfirmImportWithoutSourceDialog
        open={confirmImportWithoutSourceOpen}
        isImportingTextCsv={isImportingTextCsv}
        onClose={() => setConfirmImportWithoutSourceOpen(false)}
        onConfirm={onConfirmImportWithoutSource}
      />

      <ClearDatabaseConfirmDialog
        open={clearDatabaseConfirmOpen}
        isClearingDatabase={isClearingDatabase}
        onClose={closeClearDatabaseConfirm}
        onConfirm={onConfirmClearDatabase}
      />

      <DeleteSourceConfirmDialog
        open={confirmDeleteSourceOpen}
        isDeletingSourceData={isDeletingSourceData}
        deleteSourceInput={deleteSourceInput}
        getDeleteSourceDisplayLabel={getDeleteSourceDisplayLabel}
        onClose={() => setConfirmDeleteSourceOpen(false)}
        onConfirm={onConfirmDeleteSourceData}
      />

      <ProviderDeleteConfirmDialog
        open={providerDeleteConfirmOpen}
        providers={providers}
        models={models}
        providerDeleteTargetId={providerDeleteTargetId}
        providerDeleteTransferTargetId={providerDeleteTransferTargetId}
        deletingProviderId={deletingProviderId}
        onClose={closeDeleteProviderConfirm}
        onTransferTargetChange={setProviderDeleteTransferTargetId}
        onConfirm={onConfirmDeleteProvider}
      />

      <div className="space-y-4">
        <AdminConsoleTabNav activeTab={activeTab} onTabChange={handleTabChange} />

        {activeTab === "import" ? (
          <ImportTab
            onPreviewWorkbook={onPreviewWorkbook}
            setWorkbookFile={setWorkbookFile}
            setSheetPickerOpen={setSheetPickerOpen}
            sheetNames={sheetNames}
            previewMeta={previewMeta}
            selectedSheet={selectedSheet}
            allowWarningsImport={allowWarningsImport}
            setAllowWarningsImport={setAllowWarningsImport}
            onImportWorkbook={onImportWorkbook}
            isImportingWorkbook={isImportingWorkbook}
            importStatus={importStatus}
            importProgress={importProgress}
            importStatusText={importStatusText}
            previewWarnings={previewWarnings}
            previewRows={previewRows}
            onImportCsv={onImportCsv}
            csvSource={csvSource}
            setCsvSource={setCsvSource}
            csvText={csvText}
            setCsvText={setCsvText}
            setCsvHtmlText={setCsvHtmlText}
            setHasParsedHtmlTable={setHasParsedHtmlTable}
            onCsvTextPaste={onCsvTextPaste}
            onPreviewCsvImport={onPreviewCsvImport}
            isPreviewingTextImport={isPreviewingTextImport}
            isImportingTextCsv={isImportingTextCsv}
            hasParsedHtmlTable={hasParsedHtmlTable}
            textImportStatus={textImportStatus}
            textImportProgress={textImportProgress}
            textImportStatusText={textImportStatusText}
            textImportPreviewMeta={textImportPreviewMeta}
            textImportDraftRows={textImportDraftRows}
            finalizedTextImportRows={finalizedTextImportRows}
            ignoredTextImportCount={ignoredTextImportCount}
            pairValueRows={pairValueRows}
            pairRowsMissingNoteCount={pairRowsMissingNoteCount}
            onUpdateTextImportDraftNote={onUpdateTextImportDraftNote}
            onPairNoteInputBlur={onPairNoteInputBlur}
            pairNoteHistory={pairNoteHistory}
            starValueRows={starValueRows}
            starRowsMissingSupplementCount={starRowsMissingSupplementCount}
            globalStarSupplement={globalStarSupplement}
            setGlobalStarSupplement={setGlobalStarSupplement}
            onApplyGlobalStarSupplement={onApplyGlobalStarSupplement}
            onUpdateTextImportDraftStarSupplement={onUpdateTextImportDraftStarSupplement}
            onStarSupplementInputBlur={onStarSupplementInputBlur}
            starNoteHistory={starNoteHistory}
            matrixPreview={matrixPreview}
            matrixPreviewHeaderCounts={matrixPreviewHeaderCounts}
            modelWarningMap={modelWarningMap}
            modelWarningSet={modelWarningSet}
            matrixModelNameDrafts={matrixModelNameDrafts}
            setOpenMatrixModelCandidateFor={setOpenMatrixModelCandidateFor}
            openMatrixModelCandidateFor={openMatrixModelCandidateFor}
            applyModelOverwriteByTargetId={applyModelOverwriteByTargetId}
            onMatrixModelNameInputChange={onMatrixModelNameInputChange}
            onMatrixModelNameInputBlur={onMatrixModelNameInputBlur}
            modelEntityOptions={modelEntityOptions}
            benchmarkWarningMap={benchmarkWarningMap}
            benchmarkMergeCandidateMap={benchmarkMergeCandidateMap}
            benchmarkParenthesesSet={benchmarkParenthesesSet}
            benchmarkEntityOptions={benchmarkEntityOptions}
            matrixBenchmarkNameDrafts={matrixBenchmarkNameDrafts}
            setOpenMatrixBenchmarkCandidateFor={setOpenMatrixBenchmarkCandidateFor}
            openMatrixBenchmarkCandidateFor={openMatrixBenchmarkCandidateFor}
            applyBenchmarkOverwriteByTargetId={applyBenchmarkOverwriteByTargetId}
            onMatrixBenchmarkNameInputChange={onMatrixBenchmarkNameInputChange}
            onMatrixBenchmarkNameInputBlur={onMatrixBenchmarkNameInputBlur}
            benchmarkPreviewValueOverlapStatsMap={benchmarkPreviewValueOverlapStatsMap}
            getBenchmarkPreviewValueOverlapStatsKey={getBenchmarkPreviewValueOverlapStatsKey}
            benchmarkPreviewValueOverlapState={benchmarkPreviewValueOverlapState}
            benchmarkPreviewValueOverlapPayload={benchmarkPreviewValueOverlapPayload}
            getBenchmarkPreviewValueOverlapBadgeClass={getBenchmarkPreviewValueOverlapBadgeClass}
            formatBenchmarkPreviewValueOverlapStats={formatBenchmarkPreviewValueOverlapStats}
            matrixBenchmarkTypeDrafts={matrixBenchmarkTypeDrafts}
            onMatrixBenchmarkTypeInputChange={onMatrixBenchmarkTypeInputChange}
            onMatrixBenchmarkTypeInputBlur={onMatrixBenchmarkTypeInputBlur}
            onToggleMatrixBenchmarkLowerIsBetter={onToggleMatrixBenchmarkLowerIsBetter}
            onToggleMatrixBenchmarkModality={onToggleMatrixBenchmarkModality}
            onUpdateTextImportDraftValue={onUpdateTextImportDraftValue}
            benchmarkWarnings={benchmarkWarnings}
            benchmarkMergeFilters={benchmarkMergeFilters}
            setBenchmarkMergeFilters={setBenchmarkMergeFilters}
            setBenchmarkMergeTargets={setBenchmarkMergeTargets}
            ignoredBenchmarkKeys={ignoredBenchmarkKeys}
            setIgnoredBenchmarkKeys={setIgnoredBenchmarkKeys}
            benchmarksWithParentheses={benchmarksWithParentheses}
            parenthesesModes={parenthesesModes}
            setParenthesesModes={setParenthesesModes}
            parenthesesCustomNames={parenthesesCustomNames}
            setParenthesesCustomNames={setParenthesesCustomNames}
            modelWarnings={modelWarnings}
            modelMergeFilters={modelMergeFilters}
            setModelMergeFilters={setModelMergeFilters}
            setModelMergeTargets={setModelMergeTargets}
            modelsWithParentheses={modelsWithParentheses}
            modelParenthesesModes={modelParenthesesModes}
            setModelParenthesesModes={setModelParenthesesModes}
            modelParenthesesCustomNames={modelParenthesesCustomNames}
            setModelParenthesesCustomNames={setModelParenthesesCustomNames}
            textImportPreviewTableRows={textImportPreviewTableRows}
            visibleResolvedTextImportPreviewRows={visibleResolvedTextImportPreviewRows}
            setTextImportPreviewVisibleCount={setTextImportPreviewVisibleCount}
            textImportPreviewVisibleCount={textImportPreviewVisibleCount}
            benchmarks={benchmarks}
          />
        ) : null}

        {activeTab === "entry" ? (
          <EntryTab
            providers={providers}
            models={models}
            benchmarks={benchmarks}
            providerName={providerName}
            setProviderName={setProviderName}
            providerId={providerId}
            setProviderId={setProviderId}
            modelName={modelName}
            setModelName={setModelName}
            modelAlias={modelAlias}
            setModelAlias={setModelAlias}
            sourceModelId={sourceModelId}
            setSourceModelId={setSourceModelId}
            benchmarkName={benchmarkName}
            setBenchmarkName={setBenchmarkName}
            benchmarkType={benchmarkType}
            setBenchmarkType={setBenchmarkType}
            benchmarkUnit={benchmarkUnit}
            setBenchmarkUnit={setBenchmarkUnit}
            modalities={modalities}
            setModalities={setModalities}
            higherIsBetter={higherIsBetter}
            setHigherIsBetter={setHigherIsBetter}
            valueModelId={valueModelId}
            setValueModelId={setValueModelId}
            valueBenchmarkId={valueBenchmarkId}
            setValueBenchmarkId={setValueBenchmarkId}
            benchTime={benchTime}
            setBenchTime={setBenchTime}
            valueRaw={valueRaw}
            setValueRaw={setValueRaw}
            valueSource={valueSource}
            setValueSource={setValueSource}
            onCreateProvider={onCreateProvider}
            onCreateModel={onCreateModel}
            onCreateBenchmark={onCreateBenchmark}
            onCreateValue={onCreateValue}
          />
        ) : null}

        {activeTab === "providers" ? (
          <ProvidersTab
            providerSearchRef={providerSearchRef}
            providerSearchOpen={providerSearchOpen}
            setProviderSearchOpen={setProviderSearchOpen}
            providerSearchQuery={providerSearchQuery}
            setProviderSearchQuery={setProviderSearchQuery}
            selectedProviderForConfig={selectedProviderForConfig}
            selectedProviderConfigId={selectedProviderConfigId}
            setSelectedProviderConfigId={setSelectedProviderConfigId}
            providers={providers}
            filteredProviderOptions={filteredProviderOptions}
            onCreateProviderFromSearch={onCreateProviderFromSearch}
            providerDropdownRef={providerDropdownRef}
            providerConfigDrafts={providerConfigDrafts}
            savingProviderConfigId={savingProviderConfigId}
            deletingProviderId={deletingProviderId}
            models={models}
            updateProviderDraft={updateProviderDraft}
            openDeleteProviderConfirm={openDeleteProviderConfirm}
            onSaveProviderConfig={onSaveProviderConfig}
            availableDisplayTargetProviders={availableDisplayTargetProviders}
          />
        ) : null}

        {activeTab === "pricing" ? (
          <PricingTab
            prices={modelPriceRows}
            loadingPrices={loadingPrices}
            syncingPrices={syncingPrices}
            savingPriceModelId={savingPriceModelId}
            pricingSearchQuery={pricingSearchQuery}
            setPricingSearchQuery={setPricingSearchQuery}
            pricingStatusFilter={pricingStatusFilter}
            setPricingStatusFilter={setPricingStatusFilter}
            pricingDrafts={pricingDrafts}
            updatePricingDraft={updatePricingDraft}
            onLoadPrices={loadModelPrices}
            onSyncPrices={syncModelPrices}
            onSavePrice={saveModelPrice}
            syncResult={pricingSyncResult}
          />
        ) : null}

        {activeTab === "rename" ? (
          <RenameTab
            renameEntityType={renameEntityType}
            resetRenameStateForEntityType={resetRenameStateForEntityType}
            renameSearchKeyword={renameSearchKeyword}
            updateRenameSearchKeyword={updateRenameSearchKeyword}
            filteredRenameEntityOptions={filteredRenameEntityOptions}
            renameListViewportRef={renameListViewportRef}
            setRenameListScrollTop={setRenameListScrollTop}
            renameListSpacerHeight={renameListSpacerHeight}
            visibleRenameEntityOptions={visibleRenameEntityOptions}
            renameVirtualWindow={renameVirtualWindow}
            renameSelectedEntityId={renameSelectedEntityId}
            modelById={modelById}
            providerById={providerById}
            benchmarkById={benchmarkById}
            onPickRenameEntity={onPickRenameEntity}
            onRenameEntity={onRenameEntity}
            renameSelectedEntityLabel={renameSelectedEntityLabel}
            renameNextName={renameNextName}
            setRenameNextName={setRenameNextName}
            renameNextBenchmarkType={renameNextBenchmarkType}
            setRenameNextBenchmarkType={setRenameNextBenchmarkType}
            renameNextProviderInput={renameNextProviderInput}
            setRenameNextProviderInput={setRenameNextProviderInput}
            providerEntityOptions={providerEntityOptions}
            renameMergeOnConflict={renameMergeOnConflict}
            setRenameMergeOnConflict={setRenameMergeOnConflict}
            renameSubmitState={renameSubmitState}
          />
        ) : null}

        {activeTab === "merge" ? (
          <MergeTab
            isDetectingDuplicates={isDetectingDuplicates}
            onDetectDuplicateCandidates={onDetectDuplicateCandidates}
            duplicateDetectionResult={duplicateDetectionResult}
            duplicateDetectionEntityType={duplicateDetectionEntityType}
            setDuplicateDetectionEntityType={setDuplicateDetectionEntityType}
            duplicateConfidenceFilter={duplicateConfidenceFilter}
            setDuplicateConfidenceFilter={setDuplicateConfidenceFilter}
            isAllActiveDuplicateCandidatesSelected={isAllActiveDuplicateCandidatesSelected}
            activeDuplicateCandidateCount={activeDuplicateCandidateCount}
            selectedActiveDuplicateCandidateCount={selectedActiveDuplicateCandidateCount}
            isBatchMergingDuplicates={isBatchMergingDuplicates}
            toggleAllVisibleDuplicateCandidates={toggleAllVisibleDuplicateCandidates}
            onBatchMergeDuplicateCandidates={onBatchMergeDuplicateCandidates}
            visibleModelDuplicateCandidates={visibleModelDuplicateCandidates}
            visibleBenchmarkDuplicateCandidates={visibleBenchmarkDuplicateCandidates}
            duplicateCandidateCardClass={duplicateCandidateCardClass}
            selectedDuplicateCandidateKeys={selectedDuplicateCandidateKeys}
            getDuplicateCandidateKey={getDuplicateCandidateKey}
            setDuplicateCandidateSelected={setDuplicateCandidateSelected}
            duplicateConfidenceBadgeClass={duplicateConfidenceBadgeClass}
            duplicateConfidenceLabel={duplicateConfidenceLabel}
            applyModelDuplicateCandidate={applyModelDuplicateCandidate}
            duplicateReasonLabel={duplicateReasonLabel}
            applyBenchmarkDuplicateCandidate={applyBenchmarkDuplicateCandidate}
            onMerge={onMerge}
            mergeType={mergeType}
            setMergeType={setMergeType}
            setMergeSourceInput={setMergeSourceInput}
            setMergeTargetInput={setMergeTargetInput}
            setMergeTargetBenchmarkNameInput={setMergeTargetBenchmarkNameInput}
            mergeSourceInput={mergeSourceInput}
            mergeTargetInput={mergeTargetInput}
            mergeEntityOptions={mergeEntityOptions}
            resolvedMergeSourceId={resolvedMergeSourceId}
            resolvedMergeTargetId={resolvedMergeTargetId}
            shouldRenderBenchmarkValueOverlapBadge={shouldRenderBenchmarkValueOverlapBadge}
            benchmarkValueOverlapBadgeClass={benchmarkValueOverlapBadgeClass}
            isLoadingBenchmarkValueOverlap={isLoadingBenchmarkValueOverlap}
            benchmarkValueOverlapStats={benchmarkValueOverlapStats}
            mergeTargetBenchmarkNameInput={mergeTargetBenchmarkNameInput}
            mergeSubmitButtonRef={mergeSubmitButtonRef}
            mergeSubmitState={mergeSubmitState}
            canSubmitMerge={canSubmitMerge}
            mergedRecordList={mergedRecordList}
            mergedRecordTargetInputs={mergedRecordTargetInputs}
            setMergedRecordTargetInputs={setMergedRecordTargetInputs}
            onUpdateMergedRecord={onUpdateMergedRecord}
            onDeleteMergedRecord={onDeleteMergedRecord}
            modelEntityOptions={modelEntityOptions}
            benchmarkEntityOptions={benchmarkEntityOptions}
          />
        ) : null}

        {activeTab === "maintenance" ? (
          <MaintenanceTab
            scaleConsistencyCheckedAt={scaleConsistencyCheckedAt}
            scaleConsistencyIssues={scaleConsistencyIssues}
            scaleConsistencyAffectedValueCount={scaleConsistencyAffectedValueCount}
            isCheckingScaleConsistency={isCheckingScaleConsistency}
            normalizingScaleBenchmarkId={normalizingScaleBenchmarkId}
            splittingScaleBenchmarkId={splittingScaleBenchmarkId}
            scaleSplitNameDrafts={scaleSplitNameDrafts}
            setScaleSplitNameDrafts={setScaleSplitNameDrafts}
            onCheckScaleConsistency={onCheckScaleConsistency}
            onNormalizeBenchmarkScale={onNormalizeBenchmarkScale}
            onSplitBenchmarkScale={onSplitBenchmarkScale}
          />
        ) : null}

        {activeTab === "settings" ? (
          <SettingsTab
            modelDedupeRule={modelDedupeRule}
            setModelDedupeRule={setModelDedupeRule}
            onSaveModelDedupeRule={onSaveModelDedupeRule}
            deleteModelInput={deleteModelInput}
            setDeleteModelInput={setDeleteModelInput}
            modelEntityOptions={modelEntityOptions}
            onDeleteModelData={onDeleteModelData}
            deleteSourceInput={deleteSourceInput}
            setDeleteSourceInput={setDeleteSourceInput}
            deleteSourceOptions={deleteSourceOptions}
            onDeleteSourceData={onDeleteSourceData}
            settingKey={settingKey}
            setSettingKey={setSettingKey}
            settingValue={settingValue}
            setSettingValue={setSettingValue}
            settingNote={settingNote}
            setSettingNote={setSettingNote}
            onSaveSetting={onSaveSetting}
            onClearDatabase={onClearDatabase}
            sortedSettings={sortedSettings}
            notifySuccess={notifySuccess}
            notifyError={notifyError}
          />
        ) : null}
      </div>
    </>
  );
}
