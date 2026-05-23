"use client";

import { useRouter } from "next/navigation";
import { type ClipboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Database,
  FileSpreadsheet,
  Layers,
  Merge as MergeIcon,
  Palette,
  PlusCircle,
  Search,
  Settings2,
  Sparkles,
  ShieldAlert,
  Table2,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { formatDateTimeLocalInputValue } from "@/components/benchmark-matrix/formatters";
import { isValidHexColor, resolveProviderBrandColor } from "@/lib/provider-config";
import { getJson, postFormData, postJson } from "./admin-console/api";
import {
  BENCHMARK_SUSPECT_KEYWORDS,
  MODALITY_OPTIONS,
  PAIR_NOTE_HISTORY_STORAGE_KEY,
  RENAME_LIST_OVERSCAN,
  RENAME_LIST_ROW_HEIGHT,
  RENAME_LIST_VIEWPORT_HEIGHT,
  STAR_NOTE_HISTORY_STORAGE_KEY
} from "./admin-console/constants";
import type {
  BenchmarkOption,
  BenchmarkPreviewValueOverlapStats,
  BenchmarkValueOverlapStats,
  BenchmarkWarningItem,
  BenchmarkWarningLevel,
  DuplicateBenchmarkCandidate,
  DuplicateConfidence,
  DuplicateDetectionResult,
  DuplicateModelCandidate,
  ImportWarning,
  MatrixPreviewRow,
  MergeSubmitState,
  MergedRecord,
  ModelDedupeRule,
  ModelOption,
  ModelWarningItem,
  NoticeItem,
  NoticeState,
  PreviewRow,
  Props,
  ProviderConfigDraft,
  ProviderOption,
  RenameSubmitState,
  ScaleConsistencyCheckResult,
  ScaleConsistencyIssue,
  StructuredCsvImportRow,
  TabKey,
  TextImportPreviewRow
} from "./admin-console/types";
import {
  buildBenchmarkCompareKey,
  getBenchmarkExactLookupKey,
  getOmniDocBenchNormalizeHint,
  getTextImportBenchmarkKey,
  isLowerBetterPreviewBenchmark,
  removeParenthesesContent,
  resolveHardcodedBenchmarkAliasTarget
} from "./admin-console/utils/benchmark";
import { buildStructuredCsvText } from "./admin-console/utils/csv";
import { toDomSafeId } from "./admin-console/utils/dom";
import {
  composePairRawValue,
  composeStarRawValue,
  formatPreviewNumericValue,
  parsePairRawValue,
  parseSingleRawValue,
  parseStarSingleRawValue
} from "./admin-console/utils/import-values";
import { parseExplicitMergeEntityId, parseMergeEntityId } from "./admin-console/utils/merge";
import {
  buildModelCompareKey,
  normalizeModelDedupeRule,
  normalizeModelNameByDedupeRule
} from "./admin-console/utils/model";
import { normalizeModalityList, normalizeModalityName } from "./admin-console/utils/modality";
import {
  createProviderPrefixRuleDraft,
  getProviderDisplayNameById,
  inferProviderNameFromModelName,
  isProviderOption,
  resolveProviderFromConfig,
  toProviderConfigDraft
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
import { AdminConsoleNotices } from "./admin-console/views/notices";
import { ModalityBadge } from "./admin-console/views/shared/modality-badge";
import { AdminConsoleTabNav } from "./admin-console/views/tab-nav";

function getProviderOptionLabel(provider: ProviderOption) {
  const displayName = provider.config?.displayName?.trim();
  if (displayName && displayName.toLowerCase() !== provider.name.toLowerCase()) {
    return `${displayName} (${provider.name})`;
  }

  return provider.name;
}

function getBenchmarkPreviewValueOverlapStatsKey(previewBenchmarkKey: string, candidateBenchmarkId: number) {
  return JSON.stringify([previewBenchmarkKey, candidateBenchmarkId]);
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
  providers,
  models,
  benchmarks,
  sourceOptions = [],
  mergedRecords,
  initialSettings
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("import");
  const [noticeList, setNoticeList] = useState<NoticeItem[]>([]);

  const [providerName, setProviderName] = useState("");
  const [providerId, setProviderId] = useState<number | "">(providers[0]?.id ?? "");
  const [providerConfigDrafts, setProviderConfigDrafts] = useState<Record<number, ProviderConfigDraft>>(() =>
    providers.reduce<Record<number, ProviderConfigDraft>>((acc, provider) => {
      acc[provider.id] = toProviderConfigDraft(provider);
      return acc;
    }, {})
  );
  const [savingProviderConfigId, setSavingProviderConfigId] = useState<number | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<number | null>(null);
  const [providerDeleteConfirmOpen, setProviderDeleteConfirmOpen] = useState(false);
  const [providerDeleteTargetId, setProviderDeleteTargetId] = useState<number | null>(null);
  const [providerDeleteTransferTargetId, setProviderDeleteTransferTargetId] = useState<number | null>(null);
  const [selectedProviderConfigId, setSelectedProviderConfigId] = useState<number | null>(null);
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [providerSearchOpen, setProviderSearchOpen] = useState(false);
  const providerSearchRef = useRef<HTMLDivElement>(null);
  const providerDropdownRef = useRef<HTMLDivElement>(null);

  const filteredProviderOptions = useMemo(() => {
    const query = providerSearchQuery.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((p) => {
      const displayName = p.config?.displayName?.toLowerCase() ?? "";
      return p.name.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query) || displayName.includes(query);
    });
  }, [providers, providerSearchQuery]);

  // Auto-scroll dropdown to selected provider when opened
  useEffect(() => {
    if (!providerSearchOpen || selectedProviderConfigId === null) return;
    requestAnimationFrame(() => {
      const container = providerDropdownRef.current;
      if (!container) return;
      const activeElement = container.querySelector<HTMLElement>('[data-provider-active="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    });
  }, [providerSearchOpen, selectedProviderConfigId]);

  const selectedProviderForConfig = useMemo(
    () => (selectedProviderConfigId !== null ? providers.find((p) => p.id === selectedProviderConfigId) ?? null : null),
    [providers, selectedProviderConfigId]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (providerSearchRef.current && !providerSearchRef.current.contains(event.target as Node)) {
        setProviderSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const availableDisplayTargetProviders = useMemo(() => {
    if (!selectedProviderForConfig) return [];
    return providers.filter(
      (provider) => provider.id !== selectedProviderForConfig.id && typeof provider.config?.displayTargetProviderId !== "number"
    );
  }, [providers, selectedProviderForConfig]);

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
  const noticeTimersRef = useRef<
    Map<number, { hideTimer: ReturnType<typeof setTimeout>; clearTimer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const nextNoticeIdRef = useRef(1);

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

  const sortedSettings = useMemo(() => {
    return Object.entries(initialSettings).sort(([a], [b]) => a.localeCompare(b));
  }, [initialSettings]);

  const benchmarkById = useMemo(() => {
    return new Map(benchmarks.map((item) => [item.id, item]));
  }, [benchmarks]);

  const providerById = useMemo(() => {
    return new Map(providers.map((item) => [item.id, item]));
  }, [providers]);

  function updateProviderDraft(providerId: number, updater: (draft: ProviderConfigDraft) => ProviderConfigDraft) {
    setProviderConfigDrafts((prev) => ({
      ...prev,
      [providerId]: updater(prev[providerId] ?? {
        displayName: "",
        displayTargetProviderId: null,
        prefixRules: [],
        brandingColor: ""
      })
    }));
  }

  function validateProviderDraft(providerId: number, draft: ProviderConfigDraft) {
    const normalizedPrefixes = draft.prefixRules
      .map((rule) => rule.prefix.trim().toLowerCase())
      .filter(Boolean);

    if (normalizedPrefixes.length !== new Set(normalizedPrefixes).size) {
      throw new Error("当前 provider 存在重复 prefix");
    }

    if (draft.brandingColor.trim() && !isValidHexColor(draft.brandingColor)) {
      throw new Error("颜色必须是合法的 #RRGGBB");
    }

    const duplicatePrefixOwner = new Map<string, number>();
    providers.forEach((provider) => {
      const sourceDraft = provider.id === providerId ? draft : (providerConfigDrafts[provider.id] ?? toProviderConfigDraft(provider));
      sourceDraft.prefixRules.forEach((rule) => {
        const normalized = rule.prefix.trim().toLowerCase();
        if (!normalized || !rule.enabled) return;

        const existingOwner = duplicatePrefixOwner.get(normalized);
        if (existingOwner !== undefined && existingOwner !== provider.id) {
          throw new Error(`prefix 已被其他 provider 使用: ${rule.prefix}`);
        }

        duplicatePrefixOwner.set(normalized, provider.id);
      });
    });
  }

  async function onSaveProviderConfig(providerId: number) {
    const draft = providerConfigDrafts[providerId] ?? { displayName: "", displayTargetProviderId: null, prefixRules: [], brandingColor: "" };
    const normalizedDisplayName = draft.displayName.trim();
    const normalizedBrandingColor = draft.brandingColor.trim().toLowerCase();

    try {
      validateProviderDraft(providerId, draft);
      setSavingProviderConfigId(providerId);

      const result = await postJson(
        "/api/admin/providers",
        {
          providerId,
          config: {
            displayName: normalizedDisplayName.length > 0 ? normalizedDisplayName : null,
            displayTargetProviderId: draft.displayTargetProviderId,
            prefixRules: draft.prefixRules
              .map((rule) => ({
                prefix: rule.prefix.trim(),
                enabled: rule.enabled,
                ...(typeof rule.priority === "number" && Number.isFinite(rule.priority)
                  ? { priority: Math.trunc(rule.priority) }
                  : {}),
                ...(typeof rule.note === "string" && rule.note.trim().length > 0
                  ? { note: rule.note.trim() }
                  : {})
              }))
              .filter((rule) => rule.prefix.length > 0),
            branding: {
              color: normalizedBrandingColor.length > 0 ? normalizedBrandingColor : null
            }
          }
        },
        "PATCH"
      );

      if (isProviderOption(result?.provider) && result.provider.id === providerId) {
        setProviderConfigDrafts((prev) => ({
          ...prev,
          [providerId]: toProviderConfigDraft(result.provider)
        }));
      }

      router.refresh();
      notifySuccess("Provider 配置已保存", ["展示名、展示归并、前缀规则、配色均已提交，页面已自动刷新。"]); 
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存 provider 配置失败");
    } finally {
      setSavingProviderConfigId(null);
    }
  }

  function openDeleteProviderConfirm(providerId: number) {
    const candidateProviders = providers.filter((provider) => provider.id !== providerId);
    setProviderDeleteTargetId(providerId);
    setProviderDeleteTransferTargetId(candidateProviders[0]?.id ?? null);
    setProviderDeleteConfirmOpen(true);
  }

  function closeDeleteProviderConfirm() {
    if (deletingProviderId !== null) return;
    setProviderDeleteConfirmOpen(false);
    setProviderDeleteTargetId(null);
    setProviderDeleteTransferTargetId(null);
  }

  async function onConfirmDeleteProvider() {
    if (providerDeleteTargetId === null) {
      notifyError("未选择待删除 provider");
      return;
    }

    if (providerDeleteTransferTargetId === null) {
      notifyError("请先选择模型迁移目标 provider");
      return;
    }

    try {
      setDeletingProviderId(providerDeleteTargetId);

      await postJson(
        "/api/admin/providers",
        {
          providerId: providerDeleteTargetId,
          transferTargetProviderId: providerDeleteTransferTargetId
        },
        "DELETE"
      );

      setProviderDeleteConfirmOpen(false);
      setProviderDeleteTargetId(null);
      setProviderDeleteTransferTargetId(null);
      setSelectedProviderConfigId(null);

      router.refresh();
      notifySuccess("Provider 已删除", ["该 provider 旗下 models 已迁移到新 provider，原 provider 已删除，页面已自动刷新。"]);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除 provider 失败");
    } finally {
      setDeletingProviderId(null);
    }
  }

  const existingBenchmarkExactMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption>();
    benchmarks.forEach((item) => {
      map.set(getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType), item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkByNameMap = useMemo(() => {
    const map = new Map<string, BenchmarkOption[]>();
    benchmarks.forEach((item) => {
      const key = item.benchmarkName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [benchmarks]);

  const existingBenchmarkModalitiesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    benchmarks.forEach((item) => {
      map.set(
        getBenchmarkExactLookupKey(item.benchmarkName, item.benchmarkType),
        (item.modalities?.length ? item.modalities : ["Text"]).map((modality) => normalizeModalityName(modality))
      );
    });
    return map;
  }, [benchmarks]);

  const deleteSourceOptions = useMemo(
    () => Array.from(new Set(sourceOptions.map((item) => item.trim()).filter(Boolean))),
    [sourceOptions]
  );

  const modelById = useMemo(() => {
    return new Map(models.map((item) => [item.id, item]));
  }, [models]);

  const existingModelExactMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      map.set(item.modelName.trim().toLowerCase(), item);
    });
    return map;
  }, [models]);

  const existingModelByCanonicalKey = useMemo(() => {
    const map = new Map<string, ModelOption>();
    models.forEach((item) => {
      if (!map.has(item.canonicalKey)) {
        map.set(item.canonicalKey, item);
      }
    });
    return map;
  }, [models]);

  const existingModelByNameMap = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const key = item.modelName.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(item);
    });
    return map;
  }, [models]);

  const existingModelByCompareKey = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    models.forEach((item) => {
      const compareKey = buildModelCompareKey(item.modelName);
      if (!compareKey) return;

      if (!map.has(compareKey)) {
        map.set(compareKey, []);
      }
      map.get(compareKey)?.push(item);
    });
    return map;
  }, [models]);

  const modelWarnings = useMemo(() => {
    const importedModels = Array.from(new Set(textImportDraftRows.map((item) => item.modelName.trim()).filter(Boolean)));
    const warnings: ModelWarningItem[] = [];

    importedModels.forEach((modelName) => {
      const exactExisting = existingModelExactMap.get(modelName.toLowerCase());
      if (exactExisting) {
        return;
      }

      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(modelName);

      const compareKey = buildModelCompareKey(modelName);
      const candidates = compareKey ? (existingModelByCompareKey.get(compareKey) ?? []) : [];

      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => item.modelName)
          .join("、");

        reasons.push(`与库内 model 相似：${candidateLabels}`);
        level = "warn";
        suggestedTargetId = candidates[0]?.id ?? null;
      }

      if (reasons.length === 0) return;

      warnings.push({
        key: modelName,
        modelName,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: Array.from(new Set(candidates.map((item) => item.id))),
        hasParentheses
      });
    });

    return warnings;
  }, [textImportDraftRows, existingModelByCompareKey, existingModelExactMap]);

  const modelsWithParentheses = useMemo(() => {
    return Array.from(
      new Set(textImportDraftRows.map((item) => item.modelName).filter((name) => /[（(][^()（）]+[)）]/.test(name)))
    ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [textImportDraftRows]);

  const modelWarningSet = useMemo(
    () => new Set([...modelWarnings.map((item) => item.modelName), ...modelsWithParentheses]),
    [modelWarnings, modelsWithParentheses]
  );

  const modelWarningMap = useMemo(
    () => new Map(modelWarnings.map((item) => [item.key, item])),
    [modelWarnings]
  );

  const benchmarkWarnings = useMemo(() => {
    const existingByCompareKey = new Map<string, BenchmarkOption[]>();

    benchmarks.forEach((item) => {
      const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
      if (!compareKey) return;

      if (!existingByCompareKey.has(compareKey)) {
        existingByCompareKey.set(compareKey, []);
      }

      existingByCompareKey.get(compareKey)?.push(item);
    });

    const importedBenchmarks = new Map<string, { benchmarkName: string; benchmarkType: string }>();
    textImportDraftRows.forEach((item) => {
      const key = getTextImportBenchmarkKey(item.benchmarkName, item.benchmarkType);
      if (!importedBenchmarks.has(key)) {
        importedBenchmarks.set(key, {
          benchmarkName: item.benchmarkName,
          benchmarkType: item.benchmarkType
        });
      }
    });

    const warnings: BenchmarkWarningItem[] = [];

    importedBenchmarks.forEach(({ benchmarkName, benchmarkType }, key) => {
      const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
      if (exactExisting) {
        return;
      }

      const sameNameExisting = existingBenchmarkByNameMap.get(benchmarkName.trim().toLowerCase()) ?? [];
      if (sameNameExisting.length > 0) {
        return;
      }

      const reasons: string[] = [];
      let level: BenchmarkWarningLevel = "info";
      let suggestedTargetId: number | null = null;

      const hasParentheses = /[（(][^()（）]+[)）]/.test(benchmarkName);

      const matchedKeyword = BENCHMARK_SUSPECT_KEYWORDS.find((keyword) =>
        benchmarkName.toLowerCase().includes(keyword)
      );
      if (matchedKeyword) {
        reasons.push(`命中高亮词：${matchedKeyword}`);
      }

      const aliasTargetName = resolveHardcodedBenchmarkAliasTarget(benchmarkName);
      if (aliasTargetName) {
        const aliasTarget = benchmarks.find((item) => item.benchmarkName.toLowerCase() === aliasTargetName.toLowerCase());
        if (aliasTarget) {
          reasons.push(`命中硬编码别名，建议合并到 ${aliasTarget.benchmarkName} [${aliasTarget.benchmarkType}]`);
          suggestedTargetId = aliasTarget.id;
          level = "danger";
        } else {
          reasons.push(`命中硬编码别名：${aliasTargetName}`);
          level = "warn";
        }
      }

      const compareKey = buildBenchmarkCompareKey(benchmarkName);
      const candidates = compareKey ? (existingByCompareKey.get(compareKey) ?? []) : [];
      if (candidates.length > 0) {
        const candidateLabels = candidates
          .slice(0, 3)
          .map((item) => `${item.benchmarkName} [${item.benchmarkType}]`)
          .join("、");

        reasons.push(`与库内 benchmark 相似：${candidateLabels}`);

        if (level !== "danger") {
          level = "warn";
        }

        if (!suggestedTargetId) {
          suggestedTargetId = candidates[0]?.id ?? null;
        }
      }

      if (reasons.length === 0) return;

      warnings.push({
        key,
        benchmarkName,
        benchmarkType,
        level,
        reasons,
        suggestedTargetId,
        candidateTargetIds: Array.from(new Set(candidates.map((item) => item.id))),
        hasParentheses
      });
    });

    return warnings;
  }, [benchmarks, textImportDraftRows, existingBenchmarkExactMap, existingBenchmarkByNameMap]);

  const benchmarkWarningMap = useMemo(
    () => new Map(benchmarkWarnings.map((item) => [item.key, item])),
    [benchmarkWarnings]
  );

  const benchmarksWithParentheses = useMemo(() => {
    const found = new Map<string, { key: string; benchmarkName: string; benchmarkType: string }>();

    textImportDraftRows.forEach((row) => {
      if (!/[（(][^()（）]+[)）]/.test(row.benchmarkName)) return;

      const hasExactExisting = existingBenchmarkExactMap.has(
        getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType)
      );
      if (hasExactExisting) return;

      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!found.has(key)) {
        found.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType
        });
      }
    });

    return Array.from(found.values()).sort((a, b) => a.benchmarkName.localeCompare(b.benchmarkName, "zh-Hans-CN"));
  }, [textImportDraftRows, existingBenchmarkExactMap]);

  const benchmarkParenthesesSet = useMemo(
    () => new Set(benchmarksWithParentheses.map((item) => item.key)),
    [benchmarksWithParentheses]
  );

  const matrixPreview = useMemo(() => {
    const modelNames: string[] = [];
    const seenModelNames = new Set<string>();
    textImportDraftRows.forEach((row) => {
      const modelName = row.modelName;
      if (!modelName || seenModelNames.has(modelName)) return;
      seenModelNames.add(modelName);
      modelNames.push(modelName);
    });
    const rowMap = new Map<string, MatrixPreviewRow>();

    textImportDraftRows.forEach((row, rowIndex) => {
      const key = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
      if (!rowMap.has(key)) {
        const modalities = row.modalities?.length
          ? normalizeModalityList(row.modalities)
          : (
            existingBenchmarkModalitiesMap.get(getBenchmarkExactLookupKey(row.benchmarkName, row.benchmarkType))
            ?? [normalizeModalityName(row.benchmarkType)]
          );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(row.benchmarkName, row.benchmarkType);

        rowMap.set(key, {
          key,
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          higherIsBetter: inferredHigherIsBetter,
          modalities,
          cellRowIndexByModel: {}
        });
      }

      const entry = rowMap.get(key);
      if (!entry) return;

      if (typeof row.higherIsBetter === "boolean") {
        entry.higherIsBetter = row.higherIsBetter;
      }

      if (entry.cellRowIndexByModel[row.modelName] === undefined) {
        entry.cellRowIndexByModel[row.modelName] = rowIndex;
      }
    });

    const rows = Array.from(rowMap.values());

    return {
      modelNames,
      rows
    };
  }, [textImportDraftRows, existingBenchmarkModalitiesMap]);

  const matrixPreviewHeaderCounts = useMemo(() => {
    const rowCount = matrixPreview.rows.length;
    const benchmarkUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkName)).size;
    const typeUniqueCount = new Set(matrixPreview.rows.map((row) => row.benchmarkType)).size;

    return {
      benchmarkCount: rowCount,
      benchmarkUniqueCount,
      typeUniqueCount
    };
  }, [matrixPreview.rows]);

  const benchmarkPreviewValueOverlapPayload = useMemo(() => {
    const items = benchmarkWarnings
      .map((warning) => {
        const candidateBenchmarkIds = Array.from(new Set([
          ...warning.candidateTargetIds,
          ...(warning.suggestedTargetId ? [warning.suggestedTargetId] : [])
        ]));
        if (candidateBenchmarkIds.length === 0) return null;

        const matrixRow = matrixPreview.rows.find((row) => row.key === warning.key);
        if (!matrixRow) return null;

        const cells = Object.values(matrixRow.cellRowIndexByModel)
          .map((rowIndex) => textImportDraftRows[rowIndex])
          .filter((row): row is TextImportPreviewRow => Boolean(row) && row.rawValue.trim().length > 0)
          .map((row) => ({
            modelName: row.modelName,
            rawValue: row.rawValue
          }));

        if (cells.length === 0) return null;

        return {
          previewBenchmarkKey: warning.key,
          candidateBenchmarkIds,
          cells
        };
      })
      .filter((item): item is {
        previewBenchmarkKey: string;
        candidateBenchmarkIds: number[];
        cells: Array<{ modelName: string; rawValue: string }>;
      } => item !== null);

    return {
      key: items.length > 0 ? JSON.stringify(items) : "",
      items
    };
  }, [benchmarkWarnings, matrixPreview.rows, textImportDraftRows]);

  useEffect(() => {
    if (!benchmarkPreviewValueOverlapPayload.key) {
      setBenchmarkPreviewValueOverlapState({ key: "", status: "idle", stats: [] });
      return;
    }

    const controller = new AbortController();
    setBenchmarkPreviewValueOverlapState({
      key: benchmarkPreviewValueOverlapPayload.key,
      status: "loading",
      stats: []
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
  }, [benchmarkPreviewValueOverlapPayload]);

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

  const pairValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedPair = parsePairRawValue(row.rawValue);
        if (!parsedPair) return null;

        return {
          rowIndex,
          benchmarkKey: getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType),
          benchmarkName: row.benchmarkName,
          benchmarkType: row.benchmarkType,
          modelName: row.modelName,
          first: parsedPair.first,
          second: parsedPair.second,
          note: row.valueNote ?? parsedPair.note
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkKey: string;
          benchmarkName: string;
          benchmarkType: string;
          modelName: string;
          first: string;
          second: string;
          note: string | null;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const pairRowsMissingNoteCount = useMemo(
    () => pairValueRows.filter((item) => !(item.note && item.note.trim().length > 0)).length,
    [pairValueRows]
  );

  const starValueRows = useMemo(() => {
    return textImportDraftRows
      .map((row, rowIndex) => {
        const parsedStar = parseStarSingleRawValue(row.rawValue);
        if (!parsedStar) return null;

        const supplement = (row.valueNote ?? parsedStar.note ?? "").trim();

        return {
          rowIndex,
          benchmarkName: row.benchmarkName,
          modelName: row.modelName,
          value: parsedStar.value,
          supplement
        };
      })
      .filter(
        (
          item
        ): item is {
          rowIndex: number;
          benchmarkName: string;
          modelName: string;
          value: string;
          supplement: string;
        } => item !== null
      );
  }, [textImportDraftRows]);

  const starRowsMissingSupplementCount = useMemo(
    () => starValueRows.filter((item) => item.supplement.length === 0).length,
    [starValueRows]
  );

  const finalizedTextImportRows = useMemo(() => {
    const latestSourceInput = csvSource.trim();

    return textImportDraftRows
      .map<StructuredCsvImportRow | null>((row) => {
        const benchmarkKey = getTextImportBenchmarkKey(row.benchmarkName, row.benchmarkType);
        const originalModelKey = row.modelName;
        if (ignoredBenchmarkKeys[benchmarkKey]) {
          return null;
        }

        const rawValueInput = row.rawValue.trim();
        if (!rawValueInput) {
          return null;
        }

        const pairValue = parsePairRawValue(rawValueInput);
        const starSingleValue = pairValue ? null : parseStarSingleRawValue(rawValueInput);

        let rawValue = rawValueInput;
        let valueNote: string | null = row.valueNote?.trim() || null;

        if (pairValue) {
          const normalizedNote = row.valueNote?.trim() || pairValue.note || null;
          rawValue = composePairRawValue(pairValue.first, pairValue.second, normalizedNote);
          valueNote = normalizedNote;
        } else if (starSingleValue) {
          const starNote = row.valueNote?.trim() || starSingleValue.note || null;
          rawValue = composeStarRawValue(starSingleValue.value, starNote);
          valueNote = starNote;
        } else {
          const singleValue = parseSingleRawValue(rawValueInput);
          if (singleValue) {
            const singleTail = singleValue.tail.trim();
            if (singleTail.length > 0 && !singleTail.startsWith("*")) {
              rawValue = singleValue.value;
              valueNote = row.valueNote?.trim() || singleTail || null;
            }
          }
        }

        let benchmarkName = row.benchmarkName;
        let benchmarkType = row.benchmarkType;
        let modelName = row.modelName;
        let providerName = row.providerName.trim() || "Unknown";
        let providerDisplayName = row.providerDisplayName?.trim() || providerName;

        const modelParenthesesMode = modelParenthesesModes[originalModelKey] ?? "keep";
        if (modelParenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(modelName);
          if (noParentheses) {
            modelName = noParentheses;
          }
        } else if (modelParenthesesMode === "custom") {
          const customName = (modelParenthesesCustomNames[originalModelKey] ?? "").trim();
          if (customName) {
            modelName = customName;
          }
        }

        const modelMergeTargetId = Number(modelMergeTargets[originalModelKey]);
        if (Number.isFinite(modelMergeTargetId) && modelMergeTargetId > 0) {
          const target = modelById.get(modelMergeTargetId);
          if (target) {
            modelName = target.modelName;
          }
        }

        modelName = modelName.trim();

        const exactModel = existingModelExactMap.get(modelName.toLowerCase());
        if (exactModel) {
          modelName = exactModel.modelName;
          providerName = providerById.get(exactModel.providerId)?.name || providerName;
          providerDisplayName = getProviderDisplayNameById(exactModel.providerId, providerById) || providerName;
        } else {
          const canonicalKey = normalizeModelNameByDedupeRule(modelName, modelDedupeRule);
          const canonicalMatchedModel = existingModelByCanonicalKey.get(canonicalKey);

          if (canonicalMatchedModel) {
            modelName = canonicalMatchedModel.modelName;
            providerName = providerById.get(canonicalMatchedModel.providerId)?.name || providerName;
            providerDisplayName = getProviderDisplayNameById(canonicalMatchedModel.providerId, providerById) || providerName;
          } else {
            const sameNameModels = existingModelByNameMap.get(modelName.toLowerCase()) ?? [];
            if (sameNameModels.length > 0) {
              modelName = sameNameModels[0].modelName;
              providerName = providerById.get(sameNameModels[0].providerId)?.name || providerName;
              providerDisplayName = getProviderDisplayNameById(sameNameModels[0].providerId, providerById) || providerName;
            }
          }
        }

        if (!modelName) {
          return null;
        }

        const parenthesesMode = parenthesesModes[benchmarkKey] ?? "keep";
        if (parenthesesMode === "remove") {
          const noParentheses = removeParenthesesContent(benchmarkName);
          if (noParentheses) {
            benchmarkName = noParentheses;
          }
        } else if (parenthesesMode === "custom") {
          const customName = (parenthesesCustomNames[benchmarkKey] ?? "").trim();
          if (customName) {
            benchmarkName = customName;
          }
        }

        benchmarkName = benchmarkName.trim();
        benchmarkType = benchmarkType.trim() || "general";

        if (!benchmarkName) {
          return null;
        }

        const exactExisting = existingBenchmarkExactMap.get(getBenchmarkExactLookupKey(benchmarkName, benchmarkType));
        if (exactExisting) {
          benchmarkName = exactExisting.benchmarkName;
          benchmarkType = exactExisting.benchmarkType;
        }

        const mergeTargetId = Number(benchmarkMergeTargets[benchmarkKey]);
        if (Number.isFinite(mergeTargetId) && mergeTargetId > 0) {
          const target = benchmarkById.get(mergeTargetId);
          if (target) {
            benchmarkName = target.benchmarkName;
          }
        }

        const normalizedModalities = normalizeModalityList(
          row.modalities?.length ? row.modalities : [benchmarkType]
        );
        const inferredHigherIsBetter = typeof row.higherIsBetter === "boolean"
          ? row.higherIsBetter
          : !isLowerBetterPreviewBenchmark(benchmarkName, benchmarkType);

        return {
          providerName,
          providerDisplayName,
          modelName,
          benchmarkName,
          benchmarkType,
          benchmarkTypeProvided: row.benchmarkTypeProvided ?? true,
          higherIsBetter: inferredHigherIsBetter,
          modalities: normalizedModalities,
          rawValue,
          valueNote,
          source: latestSourceInput.length > 0 ? latestSourceInput : (row.source?.trim() || null)
        };
      })
      .filter((item): item is StructuredCsvImportRow => item !== null);
  }, [
    csvSource,
    textImportDraftRows,
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
    existingBenchmarkExactMap
  ]);

  const ignoredTextImportCount = useMemo(() => {
    if (textImportDraftRows.length === 0) return 0;
    return Math.max(0, textImportDraftRows.length - finalizedTextImportRows.length);
  }, [textImportDraftRows.length, finalizedTextImportRows.length]);

  const textImportPreviewTableRows = useMemo<TextImportPreviewRow[]>(() => {
    if (textImportDraftRows.length === 0) {
      return textImportPreviewRows;
    }

    return finalizedTextImportRows.map((row, index) => ({
      rowNumber: index + 1,
      providerName: row.providerDisplayName || row.providerName,
      modelName: row.modelName,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      benchmarkTypeProvided: row.benchmarkTypeProvided,
      higherIsBetter: row.higherIsBetter,
      modalities: row.modalities,
      rawValue: row.rawValue,
      valueNum: null,
      valueNum2: null,
      valueNote: row.valueNote,
      source: row.source,
      valid: row.rawValue.trim().length > 0
    }));
  }, [textImportDraftRows.length, textImportPreviewRows, finalizedTextImportRows]);

  const visibleResolvedTextImportPreviewRows = useMemo(
    () => textImportPreviewTableRows.slice(0, textImportPreviewVisibleCount),
    [textImportPreviewTableRows, textImportPreviewVisibleCount]
  );

  const modelEntityOptions = useMemo(
    () =>
      models.map((item) => ({
        id: item.id,
        label: item.modelName
      })),
    [models]
  );

  const providerEntityOptions = useMemo(
    () =>
      providers.map((item) => ({
        id: item.id,
        label: getProviderOptionLabel(item)
      })),
    [providers]
  );

  const benchmarkEntityOptions = useMemo(
    () =>
      benchmarks.map((item) => ({
        id: item.id,
        label: `${item.benchmarkName} [${item.benchmarkType}]`
      })),
    [benchmarks]
  );

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
    const noticeTimers = noticeTimersRef.current;

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

      noticeTimers.forEach(({ hideTimer, clearTimer }) => {
        clearTimeout(hideTimer);
        clearTimeout(clearTimer);
      });
      noticeTimers.clear();
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
      if (!targetElement || !targetElement.closest('[data-matrix-benchmark-candidate-container="true"]')) {
        setOpenMatrixBenchmarkCandidateFor(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function clearNoticeTimers(noticeId: number) {
    const timers = noticeTimersRef.current.get(noticeId);
    if (!timers) return;

    clearTimeout(timers.hideTimer);
    clearTimeout(timers.clearTimer);
    noticeTimersRef.current.delete(noticeId);
  }

  function enqueueNotice(type: NoticeState["type"], message: string, details?: string[]) {
    const noticeId = nextNoticeIdRef.current;
    nextNoticeIdRef.current += 1;

    const normalizedDetails = details && details.length > 0 ? details : undefined;

    setNoticeList((prev) => [
      ...prev,
      {
        id: noticeId,
        type,
        message,
        details: normalizedDetails,
        visible: false
      }
    ]);

    window.requestAnimationFrame(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: true
              }
            : item
        )
      );
    });

    const hideDelay = type === "error" ? 30000 : 15000;
    const clearDelay = hideDelay + 500;

    const hideTimer = setTimeout(() => {
      setNoticeList((prev) =>
        prev.map((item) =>
          item.id === noticeId
            ? {
                ...item,
                visible: false
              }
            : item
        )
      );
    }, hideDelay);

    const clearTimer = setTimeout(() => {
      setNoticeList((prev) => prev.filter((item) => item.id !== noticeId));
      clearNoticeTimers(noticeId);
    }, clearDelay);

    noticeTimersRef.current.set(noticeId, { hideTimer, clearTimer });
  }

  function notifySuccess(message: string, details?: string[]) {
    enqueueNotice("success", message, details);
  }

  function notifyError(message: string, details?: string[]) {
    enqueueNotice("error", message, details);
  }

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

    const parsedCount = Number(result.parsedCount ?? unifiedPreviewRows.length);
    const warningCount = Number(result.warningCount ?? warningRows.length);
    const skippedCount = Math.max(0, parsedCount - unifiedPreviewRows.length);

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

    setTextImportPreviewRows(unifiedPreviewRows);
    setTextImportDraftRows(unifiedPreviewRows.map((row) => ({ ...row })));
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
    setOpenMatrixBenchmarkCandidateFor(null);
    setTextImportPreviewMeta({
      format: "workbook-table",
      total: unifiedPreviewRows.length,
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

  async function onCreateProviderFromSearch() {
    const name = providerSearchQuery.trim();
    if (!name) return;

    try {
      await postJson("/api/admin/providers", { name });
      setProviderSearchQuery("");
      setProviderSearchOpen(false);
      router.refresh();
      notifySuccess(`Provider "${name}" 已创建，页面刷新后可在列表中选择。`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "创建 Provider 失败");
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

  function renderModalityBadge(modalityInput: string, key: string) {
    return <ModalityBadge key={key} modalityInput={modalityInput} />;
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
      const previewRows = (result.previewRows ?? []) as TextImportPreviewRow[];
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
            `合并来源：${mergedSourceName ?? fallbackSourceName} [${mergedSourceId}]`,
            "建议刷新页面以同步最新实体下拉数据"
          ]);
          return;
        }

        notifySuccess("改名完成，并已处理重名冲突", ["建议刷新页面以同步最新实体下拉数据"]);
        return;
      }

      notifySuccess("名称已更新并写入数据库", ["建议刷新页面以同步最新实体下拉数据"]);
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
        <AdminConsoleTabNav activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "import" ? (
          <div className="grid grid-cols-1 gap-4">
            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <FileSpreadsheet size={18} />
                XLSM / XLSX 导入
              </h3>
              <p className="mb-4 text-sm opacity-80">
                导入前会提示不合规值
              </p>

              <form onSubmit={onPreviewWorkbook} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <input
                    type="file"
                    className="file-input file-input-bordered w-full"
                    accept=".xlsm,.xlsx,.xls"
                    onChange={(e) => setWorkbookFile(e.target.files?.[0] ?? null)}
                    required
                  />
                </div>
                <div className="md:col-span-3">
                  <button type="submit" className="btn btn-primary w-full">
                    <FileSpreadsheet size={16} />
                    解析并预览
                  </button>
                </div>
                <div className="md:col-span-3">
                  <button
                    type="button"
                    className="btn btn-outline w-full"
                    onClick={() => setSheetPickerOpen(true)}
                    disabled={sheetNames.length <= 1}
                  >
                    选择工作表
                  </button>
                </div>
              </form>

              {previewMeta ? (
                <div className="alert alert-info mt-4">
                  <div>
                    <div>当前工作表：{selectedSheet || "-"}</div>
                    <div>
                      列识别：Benchmark = {previewMeta.benchmarkColumn}
                      {previewMeta.categoryColumn ? `，Category = ${previewMeta.categoryColumn}` : "，未检测到 Category"}
                    </div>
                    <div>
                      解析记录：{previewMeta.parsedCount}，警告：{previewMeta.warningCount}
                    </div>
                  </div>
                </div>
              ) : null}

              {previewMeta ? (
                <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[auto_auto_minmax(320px,1fr)] xl:items-center">
                  <label className="label cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={allowWarningsImport}
                      onChange={(e) => setAllowWarningsImport(e.target.checked)}
                    />
                    <span className="label-text">忽略警告继续导入</span>
                  </label>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onImportWorkbook}
                    disabled={isImportingWorkbook}
                  >
                    <Upload size={16} />
                    {isImportingWorkbook ? "导入中..." : "导入当前工作表"}
                  </button>

                  {importStatus !== "idle" ? (
                    <div className="w-full xl:justify-self-end">
                      <progress
                        className={`progress w-full ${
                          importStatus === "error"
                            ? "progress-error"
                            : importStatus === "success"
                              ? "progress-success"
                              : "progress-primary"
                        }`}
                        value={importProgress}
                        max={100}
                      />
                      <div className="mt-1 text-xs opacity-80 xl:text-right">{importStatusText}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {previewWarnings.length > 0 ? (
                <div className="mt-4">
                  <h4 className="mb-2 flex items-center gap-2 font-semibold">
                    <ShieldAlert size={16} />
                    告警（最多 200 条）
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Benchmark</th>
                          <th>Model</th>
                          <th>Raw</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewWarnings.map((warning, idx) => (
                          <tr key={`${warning.rowNumber}-${warning.modelName}-${idx}`}>
                            <td>{warning.rowNumber}</td>
                            <td>{warning.benchmarkName}</td>
                            <td>{warning.modelName}</td>
                            <td>{warning.rawValue}</td>
                            <td>{warning.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {previewRows.length > 0 ? (
                <div className="mt-4">
                  <h4 className="mb-2 flex items-center gap-2 font-semibold">
                    <Table2 size={16} />
                    预览数据
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Category</th>
                          <th>Benchmark</th>
                          <th>Model</th>
                          <th>Raw</th>
                          <th>Num</th>
                          <th>Num2</th>
                          <th>Note</th>
                          <th>Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.benchmarkName}-${row.modelName}-${row.rawValue}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.category || "-"}</td>
                            <td>{row.benchmarkName}</td>
                            <td>{row.modelName}</td>
                            <td>{row.rawValue}</td>
                            <td>{formatPreviewNumericValue(row.rawValue, row.valueNum, "first")}</td>
                            <td>{formatPreviewNumericValue(row.rawValue, row.valueNum2, "second")}</td>
                            <td>{row.valueNote ?? "-"}</td>
                            <td>{row.valid ? "✅" : "⚠️"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Upload size={18} />
                表格文本导入（CSV / TSV / 粘贴文本）
              </h3>
              <p className="mb-3 text-sm opacity-80">
                支持两种格式：
                ① 结构化 CSV（provider/model/benchmark/value...）；
                ② 矩阵文本（首行模型，首列 benchmark，如从表格直接复制粘贴）。
              </p>
              <form onSubmit={onImportCsv} className="space-y-3">
                <div className="space-y-1">
                  <input
                    className="input input-bordered w-full"
                    value={csvSource}
                    onChange={(e) => setCsvSource(e.target.value)}
                    placeholder="source（可选，指明该 benchmark 数据来源）"
                  />
                </div>
                <textarea
                  id="csv-text-import-input"
                  aria-label="粘贴 CSV / 文本"
                  className="textarea textarea-bordered min-h-[180px] w-full"
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setCsvHtmlText("");
                    setHasParsedHtmlTable(false);
                  }}
                  onPaste={onCsvTextPaste}
                  required
                />
                <div className="mt-1 grid grid-cols-1 gap-3 xl:grid-cols-[auto_auto_minmax(320px,1fr)] xl:items-center">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={onPreviewCsvImport}
                    disabled={isPreviewingTextImport || isImportingTextCsv}
                  >
                    {isPreviewingTextImport ? "预览中..." : "预览导入结果"}
                  </button>
                  <div className="inline-flex items-center gap-2">
                    <button type="submit" className="btn btn-primary" disabled={isImportingTextCsv}>
                      {isImportingTextCsv ? "导入中..." : "执行导入"}
                    </button>
                    {hasParsedHtmlTable ? (
                      <span className="text-xs font-medium text-success">已成功解析 HTML 表格</span>
                    ) : null}
                  </div>
                  {textImportStatus !== "idle" ? (
                    <div className="w-full xl:justify-self-end">
                      <progress
                        className={`progress w-full ${
                          textImportStatus === "error"
                            ? "progress-error"
                            : textImportStatus === "success"
                              ? "progress-success"
                              : "progress-primary"
                        }`}
                        value={textImportProgress}
                        max={100}
                      />
                      <div className="mt-1 text-xs opacity-80 xl:text-right">{textImportStatusText}</div>
                    </div>
                  ) : null}
                </div>
              </form>

              {textImportPreviewMeta ? (
                <div className="alert alert-info mt-4">
                  <div>
                    <div>识别格式：{textImportPreviewMeta.format}</div>
                    <div>可导入：{textImportPreviewMeta.total} 条，跳过：{textImportPreviewMeta.skipped} 条</div>
                    {textImportDraftRows.length > 0 ? (
                      <div>
                        当前草稿：{finalizedTextImportRows.length} 条可提交，忽略/空值 {ignoredTextImportCount} 条
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {pairValueRows.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-warning/40 bg-warning/5 p-3">
                  <h4 className="font-semibold">成对数值注释</h4>
                  {pairRowsMissingNoteCount > 0 ? (
                    <div className="text-sm text-warning">
                      检测到 {pairRowsMissingNoteCount} 条成对值暂未注释，可补充（允许留空）
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {pairValueRows.map((item) => (
                      <div
                        key={`pair-note-${item.rowIndex}-${item.modelName}-${item.benchmarkName}`}
                        className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,1fr)] lg:items-center"
                      >
                        <div className="text-xs opacity-80">
                          {item.benchmarkName} / {item.modelName} ：{item.first} / {item.second}
                        </div>
                        <input
                          className="input input-bordered input-sm"
                          list="pair-note-history-options"
                          value={item.note ?? ""}
                          onChange={(e) => onUpdateTextImportDraftNote(item.rowIndex, e.target.value)}
                          onBlur={(e) => onPairNoteInputBlur(item.rowIndex, item.benchmarkKey, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  <datalist id="pair-note-history-options">
                    {pairNoteHistory.map((note) => (
                      <option key={`pair-note-history-${note}`} value={note} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              {starValueRows.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-warning/40 bg-warning/5 p-3">
                  <h4 className="font-semibold">星号数值注释补充</h4>
                  {starRowsMissingSupplementCount > 0 ? (
                    <div className="text-sm text-warning">
                      检测到 {starRowsMissingSupplementCount} 条含 `*` 数值建议补充注释（可留空）
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <input
                      className="input input-bordered input-sm w-full md:max-w-md"
                      value={globalStarSupplement}
                      onChange={(e) => setGlobalStarSupplement(e.target.value)}
                      placeholder="为全部 * 数值设置同一注释"
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm md:shrink-0"
                      onClick={onApplyGlobalStarSupplement}
                    >
                      应用到全部 *
                    </button>
                  </div>

                  <div className="space-y-2">
                    {starValueRows.map((item) => (
                      <div
                        key={`star-note-${item.rowIndex}-${item.modelName}-${item.benchmarkName}`}
                        className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,1fr)] lg:items-center"
                      >
                        <div className="text-xs opacity-80">
                          {item.benchmarkName} / {item.modelName} ：{item.value}*
                        </div>
                        <input
                          className="input input-bordered input-sm"
                          value={item.supplement}
                          list="star-note-history-options"
                          onChange={(e) => onUpdateTextImportDraftStarSupplement(item.rowIndex, e.target.value)}
                          onBlur={(e) => onStarSupplementInputBlur(item.rowIndex, e.target.value)}
                          placeholder="可选补充注释"
                        />
                      </div>
                    ))}
                  </div>
                  <datalist id="star-note-history-options">
                    {starNoteHistory.map((note) => (
                      <option key={`star-note-history-${note}`} value={note} />
                    ))}
                  </datalist>
                </div>
              ) : null}

              {matrixPreview.rows.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <h4 className="font-semibold">矩阵预览（可编辑）</h4>
                  <div className="overflow-x-auto rounded-box border border-base-300 max-h-[420px]">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th className="w-[56px]">模态</th>
                          <th className="min-w-[240px]">
                            Benchmark
                            <span className="ml-1 text-[11px] opacity-70">
                              ({matrixPreviewHeaderCounts.benchmarkUniqueCount})
                            </span>
                          </th>
                          <th className="min-w-[120px]">
                            Type
                            <span className="ml-1 text-[11px] opacity-70">
                              ({matrixPreviewHeaderCounts.typeUniqueCount})
                            </span>
                          </th>
                          {matrixPreview.modelNames.map((modelName) => {
                            const modelWarning = modelWarningMap.get(modelName);
                            const modelCandidateTargetIds = Array.from(new Set([
                              ...(modelWarning?.candidateTargetIds ?? []),
                              ...(modelWarning?.suggestedTargetId ? [modelWarning.suggestedTargetId] : [])
                            ]));
                            const modelInputListId = `matrix-model-override-${toDomSafeId(modelName)}`;

                            return (
                              <th
                                key={`matrix-model-${modelName}`}
                                className={modelWarningSet.has(modelName) ? "bg-warning/20 text-warning-content" : ""}
                              >
                                <input
                                  className="input input-bordered input-xs w-full min-w-[120px]"
                                  list={modelCandidateTargetIds.length > 0 ? modelInputListId : undefined}
                                  value={matrixModelNameDrafts[modelName] ?? modelName}
                                  onChange={(e) => {
                                    const nextInput = e.target.value;
                                    const parsedTargetId = parseExplicitMergeEntityId(nextInput);
                                    if (parsedTargetId !== null && applyModelOverwriteByTargetId(modelName, parsedTargetId)) {
                                      return;
                                    }
                                    onMatrixModelNameInputChange(modelName, nextInput);
                                  }}
                                  onBlur={(e) => onMatrixModelNameInputBlur(modelName, e.target.value)}
                                />
                                {modelCandidateTargetIds.length > 0 ? (
                                  <datalist id={modelInputListId}>
                                    {modelCandidateTargetIds.map((targetId) => {
                                      const target = modelEntityOptions.find((item) => String(item.id) === String(targetId));
                                      if (!target) {
                                        return (
                                          <option
                                            key={`matrix-model-override-option-${modelName}-${targetId}`}
                                            value={`#${targetId} [${targetId}]`}
                                          />
                                        );
                                      }

                                      return (
                                        <option
                                          key={`matrix-model-override-option-${modelName}-${targetId}`}
                                          value={`${target.label} [${targetId}]`}
                                        />
                                      );
                                    })}
                                  </datalist>
                                ) : null}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixPreview.rows.map((matrixRow) => {
                          const warning = benchmarkWarningMap.get(matrixRow.key);
                          const hasParenthesesHighlight = benchmarkParenthesesSet.has(matrixRow.key);
                          const rowModalities = normalizeModalityList(matrixRow.modalities);
                          const hasVisibleModality = rowModalities.some(
                            (modality) => normalizeModalityName(modality) !== "Text"
                          );
                          const isLowerBetter = !matrixRow.higherIsBetter;

                          return (
                            <tr key={matrixRow.key}>
                              <td>
                                <details className="dropdown dropdown-bottom" data-modality-dropdown="true">
                                  <summary className="btn btn-ghost btn-xs h-7 min-h-0 px-1">
                                    <div className="flex flex-wrap items-center gap-1">
                                      {hasVisibleModality
                                        ? rowModalities.map((modality, idx) =>
                                            renderModalityBadge(modality, `${matrixRow.key}-mod-${modality}-${idx}`)
                                          )
                                        : <span className="text-xs opacity-60">Text</span>}
                                    </div>
                                  </summary>
                                  <div className="dropdown-content z-[90] mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
                                    <div className="mb-1 text-[11px] opacity-75">选择模态</div>
                                    <div className="space-y-1">
                                      {MODALITY_OPTIONS.map((modality) => (
                                        <label
                                          key={`${matrixRow.key}-modality-option-${modality}`}
                                          className="label cursor-pointer justify-start gap-2 py-0.5"
                                        >
                                          <input
                                            type="checkbox"
                                            className="checkbox checkbox-xs"
                                            checked={rowModalities.includes(modality)}
                                            onChange={(e) =>
                                              onToggleMatrixBenchmarkModality(matrixRow.key, modality, e.target.checked)
                                            }
                                          />
                                          <span className="label-text text-xs">{modality}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </details>
                              </td>
                              <th
                                className={`min-w-[240px] ${
                                  warning?.level === "danger"
                                    ? "bg-error/15 text-error"
                                    : warning?.level === "warn"
                                      ? "bg-warning/15 text-warning-content"
                                      : warning?.level === "info" || hasParenthesesHighlight
                                        ? "bg-info/15 text-info-content"
                                        : ""
                                }`}
                              >
                                <div className="space-y-1">
                                  {(() => {
                                    const benchmarkCandidateTargetIds = Array.from(new Set([
                                      ...(warning?.candidateTargetIds ?? []),
                                      ...(warning?.suggestedTargetId ? [warning.suggestedTargetId] : [])
                                    ]));
                                    const benchmarkCandidateOptions = benchmarkCandidateTargetIds.map((targetId) => {
                                      const target = benchmarkEntityOptions.find((item) => String(item.id) === String(targetId));
                                      return {
                                        targetId,
                                        label: target?.label ?? `#${targetId}`
                                      };
                                    });

                                    return (
                                      <>
                                        <div className="relative" data-matrix-benchmark-candidate-container="true">
                                          <input
                                            className="input input-bordered input-xs w-full"
                                            value={matrixBenchmarkNameDrafts[matrixRow.key] ?? matrixRow.benchmarkName}
                                            onFocus={() => {
                                              if (benchmarkCandidateOptions.length > 0) {
                                                setOpenMatrixBenchmarkCandidateFor(matrixRow.key);
                                              }
                                            }}
                                            onChange={(e) => {
                                              const nextInput = e.target.value;
                                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);
                                              if (parsedTargetId !== null && applyBenchmarkOverwriteByTargetId(matrixRow.key, parsedTargetId)) {
                                                setOpenMatrixBenchmarkCandidateFor(null);
                                                return;
                                              }
                                              onMatrixBenchmarkNameInputChange(matrixRow.key, nextInput);
                                            }}
                                            onBlur={(e) => {
                                              onMatrixBenchmarkNameInputBlur(
                                                matrixRow.key,
                                                matrixRow.benchmarkName,
                                                e.target.value
                                              );
                                              setOpenMatrixBenchmarkCandidateFor((current) =>
                                                current === matrixRow.key ? null : current
                                              );
                                            }}
                                          />
                                          {benchmarkCandidateOptions.length > 0 && openMatrixBenchmarkCandidateFor === matrixRow.key ? (
                                            <div
                                              role="listbox"
                                              className="absolute left-0 right-0 top-full z-[95] mt-1 max-h-60 overflow-auto rounded-md border border-base-300 bg-base-100/95 p-1 shadow-xl backdrop-blur"
                                            >
                                              {benchmarkCandidateOptions.map((option) => {
                                                const overlapStats = benchmarkPreviewValueOverlapStatsMap.get(
                                                  getBenchmarkPreviewValueOverlapStatsKey(matrixRow.key, option.targetId)
                                                );
                                                const isLoadingOverlapStats =
                                                  benchmarkPreviewValueOverlapState.key === benchmarkPreviewValueOverlapPayload.key
                                                  && benchmarkPreviewValueOverlapState.status === "loading";

                                                return (
                                                  <div
                                                    key={`matrix-benchmark-override-option-${matrixRow.key}-${option.targetId}`}
                                                    role="option"
                                                    aria-selected={false}
                                                    tabIndex={0}
                                                    className="cursor-pointer rounded-sm px-2 py-1 text-left text-xs leading-5 text-base-content hover:bg-base-200/90"
                                                    onMouseDown={(event) => {
                                                      event.preventDefault();
                                                      applyBenchmarkOverwriteByTargetId(matrixRow.key, option.targetId);
                                                      setOpenMatrixBenchmarkCandidateFor(null);
                                                    }}
                                                    onKeyDown={(event) => {
                                                      if (event.key !== "Enter" && event.key !== " ") {
                                                        return;
                                                      }
                                                      event.preventDefault();
                                                      applyBenchmarkOverwriteByTargetId(matrixRow.key, option.targetId);
                                                      setOpenMatrixBenchmarkCandidateFor(null);
                                                    }}
                                                  >
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                      <span className="font-medium">{`${option.label} [${option.targetId}]`}</span>
                                                      {overlapStats ? (
                                                        <span
                                                          className={`inline-flex shrink-0 whitespace-nowrap text-[11px] font-medium ${getBenchmarkPreviewValueOverlapBadgeClass(overlapStats)}`}
                                                        >
                                                          {formatBenchmarkPreviewValueOverlapStats(overlapStats)}
                                                        </span>
                                                      ) : isLoadingOverlapStats ? (
                                                        <span className="inline-flex shrink-0 whitespace-nowrap text-[11px] font-medium text-base-content/60">重复率计算中...</span>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ) : null}
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              </th>
                              <td className="whitespace-nowrap text-sm">
                                <div className="flex min-w-0 items-center gap-1">
                                  <input
                                    className="input input-bordered input-xs min-w-[90px] flex-1"
                                    value={matrixBenchmarkTypeDrafts[matrixRow.key] ?? matrixRow.benchmarkType}
                                    onChange={(e) => onMatrixBenchmarkTypeInputChange(matrixRow.key, e.target.value)}
                                    onBlur={(e) =>
                                      onMatrixBenchmarkTypeInputBlur(
                                        matrixRow.key,
                                        matrixRow.benchmarkType,
                                        e.target.value
                                      )
                                    }
                                  />
                                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-0.5" title="以小为好">
                                    <input
                                      type="checkbox"
                                      className="checkbox checkbox-xs"
                                      checked={isLowerBetter}
                                      onChange={(e) =>
                                        onToggleMatrixBenchmarkLowerIsBetter(matrixRow.key, e.target.checked)
                                      }
                                    />
                                    {isLowerBetter ? <span className="text-xs opacity-80">↓</span> : null}
                                  </label>
                                </div>
                              </td>
                              {matrixPreview.modelNames.map((modelName) => {
                                const rowIndex = matrixRow.cellRowIndexByModel[modelName];
                                const normalizedHint =
                                  rowIndex === undefined
                                    ? null
                                    : getOmniDocBenchNormalizeHint(
                                        matrixRow.benchmarkName,
                                        textImportDraftRows[rowIndex]?.rawValue ?? ""
                                      );
                                const noteText =
                                  rowIndex === undefined
                                    ? ""
                                    : (textImportDraftRows[rowIndex]?.valueNote?.trim() ?? "");

                                return (
                                  <td key={`${matrixRow.key}-${modelName}`}>
                                    {rowIndex === undefined ? (
                                      <span className="opacity-40">-</span>
                                    ) : (
                                      <div className="space-y-1">
                                        <div className="relative">
                                          <input
                                            className="input input-bordered input-xs w-full min-w-[90px] pr-7"
                                            value={textImportDraftRows[rowIndex]?.rawValue ?? ""}
                                            onChange={(e) => onUpdateTextImportDraftValue(rowIndex, e.target.value)}
                                          />
                                          {noteText ? (
                                            <span
                                              className="pointer-events-auto absolute right-2 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                                              title={noteText}
                                            >
                                              ?
                                            </span>
                                          ) : null}
                                        </div>
                                        {normalizedHint ? (
                                          <div className="text-[10px] text-warning">入库校对 → {normalizedHint}</div>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {benchmarkWarnings.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <h4 className="font-semibold">重复嫌疑与快捷合并</h4>
                  <div className="space-y-3">
                    {benchmarkWarnings.map((warning) => {
                      const benchmarkCandidateTargetIds = Array.from(new Set([
                        ...warning.candidateTargetIds,
                        ...(warning.suggestedTargetId ? [warning.suggestedTargetId] : [])
                      ]));
                      const benchmarkMergeListId = `benchmark-merge-options-${toDomSafeId(warning.key)}`;

                      return (
                        <div
                          key={`warning-${warning.key}`}
                          className={`rounded-box border p-3 ${
                            warning.level === "danger"
                              ? "border-error/40 bg-error/5"
                              : warning.level === "warn"
                                ? "border-warning/40 bg-warning/5"
                                : "border-info/40 bg-info/5"
                          }`}
                        >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{warning.benchmarkName}</span>
                          <span className="text-xs opacity-70">[{warning.benchmarkType}]</span>
                          <span className="badge badge-sm">{warning.level}</span>
                        </div>
                        <ul className="mb-2 list-disc pl-5 text-sm opacity-85">
                          {warning.reasons.map((reason, idx) => (
                            <li key={`${warning.key}-reason-${idx}`}>{reason}</li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(320px,1fr)_auto] lg:items-center">
                          <input
                            className="input input-bordered input-sm"
                            value={benchmarkMergeFilters[warning.key] ?? ""}
                            list={benchmarkMergeListId}
                            onChange={(e) => {
                              const nextInput = e.target.value;
                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);

                              if (parsedTargetId !== null && applyBenchmarkOverwriteByTargetId(warning.key, parsedTargetId)) {
                                return;
                              }

                              setBenchmarkMergeFilters((prev) => ({
                                ...prev,
                                [warning.key]: nextInput
                              }));

                              setBenchmarkMergeTargets((prev) => ({
                                ...prev,
                                [warning.key]: parsedTargetId !== null ? String(parsedTargetId) : ""
                              }));
                            }}
                            placeholder="输入 benchmark 名称并选择候选（即时覆盖预览）"
                          />
                          <datalist id={benchmarkMergeListId}>
                            {benchmarkCandidateTargetIds.map((targetId) => {
                              const target = benchmarkEntityOptions.find((item) => item.id === targetId);
                              if (!target) return null;
                              return (
                                <option
                                  key={`warning-target-${warning.key}-${target.id}`}
                                  value={`${target.label} [${target.id}]`}
                                />
                              );
                            })}
                          </datalist>

                          <label className="label cursor-pointer justify-start gap-2">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-xs"
                              checked={Boolean(ignoredBenchmarkKeys[warning.key])}
                              onChange={(e) =>
                                setIgnoredBenchmarkKeys((prev) => ({
                                  ...prev,
                                  [warning.key]: e.target.checked
                                }))
                              }
                            />
                            <span className="label-text text-xs">忽略该 benchmark</span>
                          </label>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {benchmarksWithParentheses.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-base-300 p-3">
                  <h4 className="font-semibold">Benchmark 括号处理（默认保留）</h4>
                  <div className="space-y-2">
                    {benchmarksWithParentheses.map((item) => {
                      const mode = parenthesesModes[item.key] ?? "keep";

                      return (
                        <div key={`paren-${item.key}`} className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(260px,1fr)_200px_minmax(220px,1fr)] lg:items-center">
                          <div className="text-sm">
                            <span className="font-medium">{item.benchmarkName}</span>
                            <span className="ml-1 opacity-70">({item.benchmarkType})</span>
                          </div>
                          <select
                            className="select select-bordered select-sm"
                            value={mode}
                            onChange={(e) =>
                              setParenthesesModes((prev) => ({
                                ...prev,
                                [item.key]: e.target.value as "keep" | "remove" | "custom"
                              }))
                            }
                          >
                            <option value="keep">保留括号（默认）</option>
                            <option value="remove">去掉括号内容</option>
                            <option value="custom">自定义名称</option>
                          </select>
                          {mode === "custom" ? (
                            <input
                              className="input input-bordered input-sm"
                              value={parenthesesCustomNames[item.key] ?? ""}
                              onChange={(e) =>
                                setParenthesesCustomNames((prev) => ({
                                  ...prev,
                                  [item.key]: e.target.value
                                }))
                              }
                              placeholder="输入自定义 benchmark 名称"
                            />
                          ) : (
                            <div className="text-xs opacity-70">当前模式：{mode === "remove" ? "去括号" : "保留"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {modelWarnings.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <h4 className="font-semibold">模型重名嫌疑与快捷合并</h4>
                  <div className="space-y-3">
                    {modelWarnings.map((warning) => {
                      const modelMergeListId = `model-merge-options-${toDomSafeId(warning.key)}`;

                      return (
                        <div
                          key={`model-warning-${warning.key}`}
                          className={`rounded-box border p-3 ${
                            warning.level === "danger"
                              ? "border-error/40 bg-error/5"
                              : warning.level === "warn"
                                ? "border-warning/40 bg-warning/5"
                                : "border-info/40 bg-info/5"
                          }`}
                        >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{warning.modelName}</span>
                          <span className="badge badge-sm">{warning.level}</span>
                        </div>
                        <ul className="mb-2 list-disc pl-5 text-sm opacity-85">
                          {warning.reasons.map((reason, idx) => (
                            <li key={`${warning.key}-model-reason-${idx}`}>{reason}</li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-1 lg:items-center">
                          <input
                            className="input input-bordered input-sm"
                            value={modelMergeFilters[warning.key] ?? ""}
                            list={modelMergeListId}
                            onChange={(e) => {
                              const nextInput = e.target.value;
                              const parsedTargetId = parseExplicitMergeEntityId(nextInput);

                              if (parsedTargetId !== null && applyModelOverwriteByTargetId(warning.key, parsedTargetId)) {
                                return;
                              }

                              setModelMergeFilters((prev) => ({
                                ...prev,
                                [warning.key]: nextInput
                              }));

                              setModelMergeTargets((prev) => ({
                                ...prev,
                                [warning.key]: parsedTargetId !== null ? String(parsedTargetId) : ""
                              }));
                            }}
                            placeholder="输入 model 名称并选择候选（即时覆盖预览）"
                          />
                          <datalist id={modelMergeListId}>
                            {modelEntityOptions.map((option) => (
                              <option key={`model-warning-target-${warning.key}-${option.id}`} value={`${option.label} [${option.id}]`} />
                            ))}
                          </datalist>

                        </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {modelsWithParentheses.length > 0 ? (
                <div className="mt-4 space-y-2 rounded-box border border-base-300 p-3">
                  <h4 className="font-semibold">模型括号处理（默认保留）</h4>
                  <div className="space-y-2">
                    {modelsWithParentheses.map((modelName) => {
                      const mode = modelParenthesesModes[modelName] ?? "keep";

                      return (
                        <div key={`model-paren-${modelName}`} className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(260px,1fr)_200px_minmax(220px,1fr)] lg:items-center">
                          <div className="text-sm font-medium">{modelName}</div>
                          <select
                            className="select select-bordered select-sm"
                            value={mode}
                            onChange={(e) =>
                              setModelParenthesesModes((prev) => ({
                                ...prev,
                                [modelName]: e.target.value as "keep" | "remove" | "custom"
                              }))
                            }
                          >
                            <option value="keep">保留括号（默认）</option>
                            <option value="remove">去掉括号内容</option>
                            <option value="custom">自定义名称</option>
                          </select>
                          {mode === "custom" ? (
                            <input
                              className="input input-bordered input-sm"
                              value={modelParenthesesCustomNames[modelName] ?? ""}
                              onChange={(e) =>
                                setModelParenthesesCustomNames((prev) => ({
                                  ...prev,
                                  [modelName]: e.target.value
                                }))
                              }
                              placeholder="输入自定义 model 名称"
                            />
                          ) : (
                            <div className="text-xs opacity-70">当前模式：{mode === "remove" ? "去括号" : "保留"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {textImportPreviewTableRows.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <h4 className="flex items-center justify-between gap-3 font-semibold">
                    <span>文本导入预览</span>
                    <span className="text-xs opacity-70">
                      已显示 {visibleResolvedTextImportPreviewRows.length} / {textImportPreviewTableRows.length}
                    </span>
                  </h4>
                  <div className="overflow-x-auto rounded-box border border-base-300 max-h-[420px]">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Provider</th>
                          <th>Model</th>
                          <th>Benchmark</th>
                          <th>Type</th>
                          <th>Raw</th>
                          <th>Num</th>
                          <th>Num2</th>
                          <th>Note</th>
                          <th>Source</th>
                          <th>Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleResolvedTextImportPreviewRows.map((row, idx) => {
                          const noteText = row.valueNote?.trim() ?? "";
                          const omniHint = getOmniDocBenchNormalizeHint(row.benchmarkName, row.rawValue);

                          return (
                            <tr key={`${row.rowNumber}-${row.modelName}-${row.benchmarkName}-${idx}`}>
                              <td>{row.rowNumber}</td>
                              <td>{row.providerName}</td>
                              <td>{row.modelName}</td>
                              <td>{row.benchmarkName}</td>
                              <td>{row.benchmarkType}</td>
                              <td>
                                <span className="inline-flex items-center gap-1">
                                  <span>{row.rawValue}</span>
                                  {noteText ? (
                                    <span
                                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-base-content/30 text-[10px] font-bold leading-none opacity-85"
                                      title={noteText}
                                    >
                                      ?
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td>{formatPreviewNumericValue(row.rawValue, row.valueNum, "first")}</td>
                              <td>{formatPreviewNumericValue(row.rawValue, row.valueNum2, "second")}</td>
                              <td>{omniHint ? `入库校对 → ${omniHint}` : noteText || "-"}</td>
                              <td>{row.source ?? "-"}</td>
                              <td>{row.valid ? "✅" : "⚠️"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {visibleResolvedTextImportPreviewRows.length < textImportPreviewTableRows.length ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setTextImportPreviewVisibleCount((prev) => prev + 200)}
                    >
                      加载更多（+200）
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {activeTab === "entry" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <PlusCircle size={18} />
                新增 Provider
              </h3>
              <form onSubmit={onCreateProvider} className="space-y-3">
                <input
                  className="input input-bordered w-full"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="例如 OpenAI"
                  required
                />
                <button type="submit" className="btn btn-primary">保存 Provider</button>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Database size={18} />
                新增 Model
              </h3>
              <form onSubmit={onCreateModel} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-4">
                  <select
                    className="select select-bordered w-full"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}
                    required
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <input
                    className="input input-bordered w-full"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="model name"
                    required
                  />
                </div>
                <div className="md:col-span-4">
                  <input
                    className="input input-bordered w-full"
                    value={modelAlias}
                    onChange={(e) => setModelAlias(e.target.value)}
                    placeholder="model alias (可选)"
                  />
                </div>
                <div className="md:col-span-12">
                  <input
                    className="input input-bordered w-full"
                    value={sourceModelId}
                    onChange={(e) => setSourceModelId(e.target.value)}
                    placeholder="source model id (可选)"
                  />
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存 Model</button>
                </div>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Upload size={18} />
                新增 Benchmark
              </h3>
              <form onSubmit={onCreateBenchmark} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkName} onChange={(e) => setBenchmarkName(e.target.value)} placeholder="benchmark name" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkType} onChange={(e) => setBenchmarkType(e.target.value)} placeholder="benchmark type" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={benchmarkUnit} onChange={(e) => setBenchmarkUnit(e.target.value)} placeholder="unit" required />
                </div>
                <div className="md:col-span-7">
                  <input className="input input-bordered w-full" value={modalities} onChange={(e) => setModalities(e.target.value)} placeholder="Text, Vision, Audio" />
                </div>
                <div className="md:col-span-5 flex items-center">
                  <label className="label cursor-pointer justify-start gap-2">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
                    <span className="label-text">higher is better</span>
                  </label>
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存 Benchmark</button>
                </div>
              </form>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Table2 size={18} />
                新增 Benchmark 值
              </h3>
              <form onSubmit={onCreateValue} className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-6">
                  <select className="select select-bordered w-full" value={valueModelId} onChange={(e) => setValueModelId(e.target.value ? Number(e.target.value) : "")} required>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>{model.modelName}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-6">
                  <select className="select select-bordered w-full" value={valueBenchmarkId} onChange={(e) => setValueBenchmarkId(e.target.value ? Number(e.target.value) : "")} required>
                    {benchmarks.map((benchmark) => (
                      <option key={benchmark.id} value={benchmark.id}>{benchmark.benchmarkName} ({benchmark.benchmarkType})</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <input type="datetime-local" className="input input-bordered w-full" value={benchTime} onChange={(e) => setBenchTime(e.target.value)} required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={valueRaw} onChange={(e) => setValueRaw(e.target.value)} placeholder="value raw, e.g. 31.5*" required />
                </div>
                <div className="md:col-span-4">
                  <input className="input input-bordered w-full" value={valueSource} onChange={(e) => setValueSource(e.target.value)} placeholder="source (optional)" />
                </div>
                <div className="md:col-span-12">
                  <button type="submit" className="btn btn-primary">保存记录</button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {activeTab === "providers" ? (
          <div className="space-y-5">
            {/* Provider search selector */}
            <section className="relative z-20 rounded-2xl border border-base-300/80 bg-base-100/95 p-5 shadow-md backdrop-blur">
              <div className="mb-3 flex items-center gap-2 text-base font-semibold">
                <Settings2 size={18} className="opacity-70" />
                Provider
              </div>
              <div ref={providerSearchRef} className="relative w-full max-w-md">
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-base-200/60 px-3 py-2.5 transition-all duration-200 ${
                    providerSearchOpen ? "border-primary/60 ring-2 ring-primary/20" : "border-base-300/80 hover:border-base-content/30"
                  }`}
                  onClick={() => setProviderSearchOpen(true)}
                >
                  <Search size={15} className="shrink-0 opacity-50" />
                  <input
                    className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm shadow-none outline-none focus:border-none focus:outline-none focus:ring-0 placeholder:text-base-content/40"
                    style={{ border: 'none' }}
                    value={providerSearchQuery}
                    onChange={(e) => {
                      setProviderSearchQuery(e.target.value);
                      setProviderSearchOpen(true);
                    }}
                    onFocus={() => setProviderSearchOpen(true)}
                    placeholder={selectedProviderForConfig ? `${selectedProviderForConfig.name} (${selectedProviderForConfig.slug})` : "搜索或输入新 Provider 名称\u2026"}
                  />
                  {selectedProviderConfigId !== null && !providerSearchQuery ? (
                    <div
                      role="button"
                      className="shrink-0 cursor-pointer rounded-md p-0.5 opacity-50 transition-opacity hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); setSelectedProviderConfigId(null); setProviderSearchQuery(""); }}
                    >
                      <X size={14} />
                    </div>
                  ) : null}
                  <ChevronDown size={15} className={`shrink-0 opacity-40 transition-transform duration-200 ${providerSearchOpen ? "rotate-180" : ""}`} />
                </div>

                {providerSearchOpen ? (() => {
                  const trimmedQuery = providerSearchQuery.trim();
                  const hasExactMatch = trimmedQuery.length > 0 && providers.some(
                    (p) => p.name.toLowerCase() === trimmedQuery.toLowerCase() || p.slug.toLowerCase() === trimmedQuery.toLowerCase()
                  );
                  const showCreateOption = trimmedQuery.length > 0 && !hasExactMatch;

                  return (
                    <div ref={providerDropdownRef} className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-base-300/80 bg-base-100 py-1 shadow-xl">
                      {showCreateOption ? (
                        <div
                          role="button"
                          className="flex w-full cursor-pointer items-center gap-3 border-b border-base-300/50 px-4 py-2.5 text-left text-sm font-normal text-primary transition-colors hover:bg-primary/10"
                          onClick={onCreateProviderFromSearch}
                        >
                          <PlusCircle size={15} className="shrink-0" />
                          <span className="flex-1 truncate">
                            {"创建新 Provider："}
                            <span className="font-semibold">{trimmedQuery}</span>
                          </span>
                        </div>
                      ) : null}
                      {filteredProviderOptions.length === 0 && !showCreateOption ? (
                        <div className="px-4 py-6 text-center text-sm opacity-50">无匹配结果</div>
                      ) : (
                        filteredProviderOptions.map((p) => {
                          const isActive = p.id === selectedProviderConfigId;
                          const pColor = resolveProviderBrandColor(p.name, p.config?.branding?.color);
                          const mergeTargetId = p.config?.displayTargetProviderId;
                          const mergeTargetProvider = typeof mergeTargetId === "number"
                            ? providers.find((tp) => tp.id === mergeTargetId)
                            : null;
                          return (
                            <div
                              key={`provider-search-${p.id}`}
                              role="button"
                              data-provider-active={isActive ? "true" : undefined}
                              className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm font-normal transition-colors ${
                                isActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "hover:bg-base-200/70"
                              }`}
                              onClick={() => {
                                setSelectedProviderConfigId(p.id);
                                setProviderSearchQuery("");
                                setProviderSearchOpen(false);
                              }}
                            >
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                                style={{ backgroundColor: pColor }}
                              />
                              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                                {p.name}
                                {mergeTargetProvider ? (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-base-200/80 px-1 py-0.5 text-[10px] font-normal opacity-60">
                                    <MergeIcon size={10} className="shrink-0" />
                                    {mergeTargetProvider.config?.displayName?.trim() || mergeTargetProvider.name}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 rounded-md bg-base-200/80 px-1.5 py-0.5 text-[11px] opacity-60">{p.slug}</span>
                              {isActive ? <Check size={14} className="shrink-0 text-primary" /> : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })() : null}
              </div>
            </section>

            {/* Provider edit panel */}
            {selectedProviderForConfig ? (() => {
              const provider = selectedProviderForConfig;
              const draft = providerConfigDrafts[provider.id] ?? toProviderConfigDraft(provider);
              const previewDisplayName = draft.displayName.trim() || provider.name;
              const previewBrandColor = resolveProviderBrandColor(provider.name, draft.brandingColor);
              const isSaving = savingProviderConfigId === provider.id;
              const isDeleting = deletingProviderId === provider.id;
              const providerModels = models.filter((m) => m.providerId === provider.id);

              return (
                <section className="rounded-2xl border border-base-300/80 bg-base-100/95 shadow-md backdrop-blur">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 px-6 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white text-sm font-bold shadow-md transition-colors duration-300"
                        style={{ backgroundColor: previewBrandColor }}
                      >
                        {previewDisplayName.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex flex-col justify-center">
                        <div className="text-lg font-semibold leading-tight">{provider.name}</div>
                        <span className="mt-1 inline-block rounded-md bg-base-200/80 px-1.5 py-0.5 text-[11px] font-mono opacity-60 w-fit">{provider.slug}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm gap-1.5 rounded-xl border border-error/20 text-error shadow-sm hover:border-error/40 hover:bg-error/10 disabled:border-base-300 disabled:text-base-content/40"
                        onClick={() => openDeleteProviderConfirm(provider.id)}
                        disabled={isSaving || isDeleting}
                      >
                        {isDeleting ? (
                          <><span className="loading loading-spinner loading-xs" /> 删除中…</>
                        ) : (
                          <><Trash2 size={14} /> 删除 Provider</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm gap-1.5 rounded-xl shadow-sm"
                        onClick={() => onSaveProviderConfig(provider.id)}
                        disabled={isSaving || isDeleting}
                      >
                        {isSaving ? (
                          <><span className="loading loading-spinner loading-xs" /> 保存中…</>
                        ) : (
                          <><Check size={14} /> 保存配置</>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-base-300/50" />

                  {/* Form fields — three-column row */}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-6 py-5 lg:grid-cols-[1fr_1fr_280px] lg:items-end">
                    {/* Display name */}
                    <label className="form-control w-full">
                      <span className="label-text mb-1.5 text-xs font-medium opacity-70">展示名</span>
                      <input
                        className="input input-bordered w-full rounded-xl bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                        value={draft.displayName}
                        onChange={(e) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            displayName: e.target.value
                          }))
                        }
                        placeholder={provider.name}
                      />
                    </label>

                    {/* Brand color: picker + text */}
                    <div className="form-control w-full">
                      <span className="label-text mb-1.5 text-xs font-medium opacity-70">品牌色</span>
                      <div className="flex items-center gap-2">
                        <label className="relative shrink-0 cursor-pointer">
                          <input
                            type="color"
                            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                            value={isValidHexColor(draft.brandingColor) ? draft.brandingColor : previewBrandColor}
                            onClick={() => {
                              if (!draft.brandingColor) {
                                updateProviderDraft(provider.id, (current) => ({
                                  ...current,
                                  brandingColor: previewBrandColor
                                }));
                              }
                            }}
                            onChange={(e) =>
                              updateProviderDraft(provider.id, (current) => ({
                                ...current,
                                brandingColor: e.target.value
                              }))
                            }
                          />
                          <div
                            className="flex h-[2.75rem] w-[2.75rem] cursor-pointer items-center justify-center rounded-xl border border-base-300 shadow-sm transition-transform hover:scale-105 active:scale-95"
                            style={{ backgroundColor: previewBrandColor }}
                          >
                            <Palette size={16} className="text-white/80 drop-shadow-sm" />
                          </div>
                        </label>
                        <input
                          className="input input-bordered min-w-0 flex-1 rounded-xl font-mono text-sm uppercase bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                          value={draft.brandingColor}
                          onChange={(e) => {
                            let value = e.target.value;
                            // Auto-add # prefix: if user types/pastes a bare hex like "112233"
                            if (/^[0-9a-fA-F]{6}$/.test(value)) {
                              value = `#${value}`;
                            }
                            updateProviderDraft(provider.id, (current) => ({
                              ...current,
                              brandingColor: value
                            }));
                          }}
                          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
                            const pasted = e.clipboardData.getData("text").trim();
                            if (/^[0-9a-fA-F]{6}$/.test(pasted)) {
                              e.preventDefault();
                              updateProviderDraft(provider.id, (current) => ({
                                ...current,
                                brandingColor: `#${pasted}`
                              }));
                            } else if (/^#[0-9a-fA-F]{6}$/.test(pasted)) {
                              e.preventDefault();
                              updateProviderDraft(provider.id, (current) => ({
                                ...current,
                                brandingColor: pasted
                              }));
                            }
                          }}
                          placeholder="#34D399"
                          maxLength={7}
                        />
                      </div>
                    </div>

                    {/* Live preview */}
                    <div className="form-control w-full">
                      <span className="label-text mb-1.5 text-xs font-medium opacity-70">实时预览</span>
                      <div
                        className="relative flex h-[2.75rem] items-center overflow-hidden rounded-xl border border-base-300/50 px-4"
                        style={{ background: `linear-gradient(135deg, ${previewBrandColor}14, ${previewBrandColor}06)` }}
                      >
                        <div
                          className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full opacity-10 blur-lg transition-colors duration-500"
                          style={{ backgroundColor: previewBrandColor }}
                        />
                        <span className="relative z-10 truncate text-base font-bold tracking-tight transition-colors duration-200" style={{ color: previewBrandColor }}>
                          {previewDisplayName}
                        </span>
                        <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 pl-3 font-mono text-[11px] opacity-50">
                          <span
                            className="inline-block h-2 w-2 rounded-full transition-colors duration-200"
                            style={{ backgroundColor: previewBrandColor }}
                          />
                          {isValidHexColor(draft.brandingColor) ? draft.brandingColor.toLowerCase() : previewBrandColor.toLowerCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-6 pb-5 lg:grid-cols-[minmax(280px,1fr)_1fr] lg:items-end">
                    <label className="form-control w-full">
                      <span className="label-text mb-1.5 text-xs font-medium opacity-70">归并到</span>
                      <select
                        className="select select-bordered w-full rounded-xl bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                        value={draft.displayTargetProviderId ?? ""}
                        onChange={(e) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            displayTargetProviderId: e.target.value ? Number(e.target.value) : null
                          }))
                        }
                      >
                        <option value="">不归并，独立展示</option>
                        {availableDisplayTargetProviders.map((targetProvider) => (
                          <option key={`provider-display-target-${targetProvider.id}`} value={targetProvider.id}>
                            {targetProvider.config?.displayName?.trim() || targetProvider.name} ({targetProvider.slug})
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="rounded-xl border border-base-300/50 bg-base-200/25 px-4 py-3 text-sm leading-6 opacity-80">
                      {draft.displayTargetProviderId
                        ? (() => {
                            const targetProvider = providers.find((item) => item.id === draft.displayTargetProviderId) ?? null;
                            const targetDisplayName = targetProvider?.config?.displayName?.trim() || targetProvider?.name;
                            return (
                              <>
                                <div className="font-medium">当前将归并展示到：{targetDisplayName}</div>
                                <div className="mt-1 text-xs opacity-70">仅影响前台展示分组、名称和品牌色，不修改已有模型所属 provider。</div>
                              </>
                            );
                          })()
                        : (
                          <>
                            <div className="font-medium">当前独立展示</div>
                            <div className="mt-1 text-xs opacity-70">适合保留该 provider 自己的名称、品牌色和分组。</div>
                          </>
                        )}
                    </div>
                  </div>

                  <div className="border-t border-base-300/50" />

                  {/* Prefix rules */}
                  <div className="px-6 py-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Layers size={14} className="opacity-60" />
                        前缀规则
                      </h4>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1 rounded-lg"
                        onClick={() =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            prefixRules: [...current.prefixRules, createProviderPrefixRuleDraft()]
                          }))
                        }
                      >
                        <PlusCircle size={13} />
                        新增一条
                      </button>
                    </div>

                    <div className="space-y-2">
                      {draft.prefixRules.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-base-300/60 px-4 py-6 text-center text-sm opacity-50">
                          暂无前缀规则，点击上方「新增一条」添加
                        </div>
                      ) : (
                        draft.prefixRules.map((rule, index) => (
                          <div key={rule.id} className="flex items-center gap-2 rounded-xl border border-base-300/50 bg-base-200/30 px-3 py-2 transition-colors hover:border-base-300">
                            <input
                              className="input input-bordered input-sm min-w-0 flex-1 rounded-lg bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
                              value={rule.prefix}
                              onChange={(e) =>
                                updateProviderDraft(provider.id, (current) => ({
                                  ...current,
                                  prefixRules: current.prefixRules.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, prefix: e.target.value } : item
                                  )
                                }))
                              }
                              placeholder="例如 gpt-"
                            />
                            <label className="label cursor-pointer gap-1.5">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm checkbox-primary"
                                checked={rule.enabled}
                                onChange={(e) =>
                                  updateProviderDraft(provider.id, (current) => ({
                                    ...current,
                                    prefixRules: current.prefixRules.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, enabled: e.target.checked } : item
                                    )
                                  }))
                                }
                              />
                              <span className="label-text text-xs">启用</span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-square rounded-lg text-error/70 hover:bg-error/10 hover:text-error"
                              onClick={() =>
                                updateProviderDraft(provider.id, (current) => ({
                                  ...current,
                                  prefixRules: current.prefixRules.filter((_, itemIndex) => itemIndex !== index)
                                }))
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border-t border-base-300/50" />

                  {/* Provider Models */}
                  <div className="px-6 py-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Database size={14} className="opacity-60" />
                        包含模型 ({providerModels.length})
                      </h4>
                    </div>

                    {providerModels.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300/60 px-4 py-6 text-center text-sm opacity-50">
                        该 Provider 下暂无模型
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-base-300/50">
                        <table className="table table-sm table-zebra w-full">
                          <thead>
                            <tr className="bg-base-200/50 text-base-content/70">
                              <th className="font-medium">ID</th>
                              <th className="font-medium">模型名称</th>
                              <th className="font-medium">Canonical Key</th>
                            </tr>
                          </thead>
                          <tbody>
                            {providerModels.map(m => (
                              <tr key={m.id} className="border-base-300/50">
                                <td className="font-mono text-xs opacity-60 w-16">{m.id}</td>
                                <td className="font-medium">{m.modelName}</td>
                                <td className="font-mono text-xs opacity-70 break-all">{m.canonicalKey}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              );
            })() : (
              /* Empty state */
              <section className="rounded-2xl border border-dashed border-base-300/60 bg-base-100/60 p-10 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Palette size={28} className="text-primary/60" />
                </div>
                <h3 className="text-lg font-semibold opacity-80">{"选择一个 Provider 开始配置"}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm opacity-50">
                  {"在上方搜索框中输入 Provider 名称或 slug，选择后即可编辑展示名、品牌色和前缀规则。"}
                </p>
              </section>
            )}
          </div>
        ) : null}

        {activeTab === "rename" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Search size={18} />
              实体名称维护
            </h3>
            <p className="mb-3 text-sm opacity-80">
              支持搜索并更改已有 model 名称与 provider / benchmark 名称与 type。若命中重名冲突，可自动合并并保留当前选中实体。
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <select
                  className="select select-bordered w-full"
                  value={renameEntityType}
                  onChange={(event) => resetRenameStateForEntityType(event.target.value as "model" | "benchmark")}
                >
                  <option value="model">model</option>
                  <option value="benchmark">benchmark</option>
                </select>
              </div>
              <div className="md:col-span-9">
                <input
                  className="input input-bordered w-full"
                  value={renameSearchKeyword}
                  onChange={(event) => updateRenameSearchKeyword(event.target.value)}
                  placeholder="输入名称或 ID 关键字搜索实体"
                />
              </div>
              <div className="md:col-span-12 text-xs opacity-70">
                匹配 {filteredRenameEntityOptions.length} 条（虚拟列表渲染）
              </div>
            </div>

            {filteredRenameEntityOptions.length > 0 ? (
              <div className="mt-3 rounded-box border border-base-300">
                <div className="grid grid-cols-[80px_minmax(0,1fr)_180px] border-b border-base-300 bg-base-100/60 px-1 py-2 text-xs font-semibold">
                  <span className="px-2">ID</span>
                  <span className="px-2">名称</span>
                  <span className="px-2">{renameEntityType === "model" ? "Provider" : "Type"}</span>
                </div>
                <div
                  ref={renameListViewportRef}
                  className="overflow-auto"
                  style={{ height: `${RENAME_LIST_VIEWPORT_HEIGHT}px` }}
                  onScroll={(event) => setRenameListScrollTop(event.currentTarget.scrollTop)}
                >
                  <div className="relative" style={{ height: `${renameListSpacerHeight}px` }}>
                    {visibleRenameEntityOptions.map((item, visibleIndex) => {
                      const index = renameVirtualWindow.start + visibleIndex;
                      const top = index * RENAME_LIST_ROW_HEIGHT;
                      const isSelected = renameSelectedEntityId === item.id;
                      const detailText = renameEntityType === "model"
                        ? (() => {
                            const model = modelById.get(item.id);
                            if (!model) return "-";
                            return providerById.get(model.providerId)?.config?.displayName?.trim() || providerById.get(model.providerId)?.name || "-";
                          })()
                        : (benchmarkById.get(item.id)?.benchmarkType ?? "-");

                      return (
                        <div
                          key={`rename-entity-${renameEntityType}-${item.id}`}
                          role="button"
                          tabIndex={0}
                          className={`absolute left-0 right-0 grid cursor-pointer grid-cols-[80px_minmax(0,1fr)_180px] items-center border-b px-1 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ${
                            isSelected
                              ? "z-10 rounded-lg border border-primary/35 bg-primary/15 font-semibold text-base-content shadow-sm ring-1 ring-primary/25 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-1 before:rounded-r-full before:bg-primary before:content-['']"
                              : "border-base-300/50 bg-transparent hover:bg-base-200/35"
                          }`}
                          style={{
                            top: `${top}px`,
                            height: `${RENAME_LIST_ROW_HEIGHT}px`
                          }}
                          onClick={() => onPickRenameEntity(item.id)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onPickRenameEntity(item.id);
                          }}
                        >
                          <span className="truncate px-2 text-xs opacity-80">{item.id}</span>
                          <span className="truncate px-2 text-sm">{item.label}</span>
                          <span className="truncate px-2 text-xs opacity-80">{detailText}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm opacity-70">未匹配到实体，请调整关键词。</p>
            )}

            <form onSubmit={onRenameEntity} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="mb-1 text-xs opacity-70">当前实体</div>
                <input
                  className="input input-bordered w-full"
                  value={renameSelectedEntityLabel}
                  readOnly
                  placeholder="请先在上方列表选中实体"
                />
              </div>
              <div className={renameEntityType === "benchmark" ? "md:col-span-3" : "md:col-span-4"}>
                <div className="mb-1 text-xs opacity-70">新名称</div>
                <input
                  className="input input-bordered w-full"
                  value={renameNextName}
                  onChange={(event) => setRenameNextName(event.target.value)}
                  placeholder={renameEntityType === "model" ? "输入新的 model 名称" : "输入新的 benchmark 名称"}
                  required
                />
              </div>
              {renameEntityType === "benchmark" ? (
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs opacity-70">新 Type</div>
                  <input
                    className="input input-bordered w-full"
                    value={renameNextBenchmarkType}
                    onChange={(event) => setRenameNextBenchmarkType(event.target.value)}
                    placeholder="输入新的 benchmark type"
                    required
                  />
                </div>
              ) : null}
              {renameEntityType === "model" && renameSelectedEntityId !== null ? (
                <div className="md:col-span-3">
                  <div className="mb-1 text-xs opacity-70">Provider</div>
                  <input
                    list="rename-provider-options"
                    className="input input-bordered w-full"
                    value={renameNextProviderInput}
                    onChange={(event) => setRenameNextProviderInput(event.target.value)}
                    placeholder="输入或选择 provider"
                    required
                  />
                  <datalist id="rename-provider-options">
                    {providerEntityOptions.map((item) => (
                      <option key={`rename-provider-${item.id}`} value={`${item.label} [${item.id}]`} />
                    ))}
                  </datalist>
                </div>
              ) : null}
              <div className={renameEntityType === "benchmark" ? "md:col-span-3 flex items-end" : "md:col-span-2 flex items-end"}>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={renameMergeOnConflict}
                    onChange={(event) => setRenameMergeOnConflict(event.target.checked)}
                  />
                  <span className="label-text text-xs">重名时自动合并</span>
                </label>
              </div>
              <div className="md:col-span-12 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className={`btn ${renameSubmitState === "success" ? "btn-success" : "btn-primary"}`}
                  disabled={renameSubmitState === "submitting" || renameSelectedEntityId === null}
                >
                  {renameSubmitState === "submitting"
                    ? "提交中..."
                    : renameSubmitState === "success"
                      ? "已提交"
                      : "保存名称变更"}
                </button>
                <span className="text-xs opacity-70">
                  自动合并开启时：若命中重名冲突，会把冲突实体并入当前选中实体后再完成改名。
                </span>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === "merge" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <MergeIcon size={18} />
              实体合并去重
            </h3>
            <div className="mb-5 rounded-2xl border border-primary/25 bg-gradient-to-br from-base-200/45 via-base-100/30 to-base-100/70 p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles size={16} className="text-primary" />
                  重复候选检测
                </h4>
                <button
                  type="button"
                  className="btn btn-sm btn-primary ml-auto"
                  onClick={onDetectDuplicateCandidates}
                  disabled={isDetectingDuplicates}
                >
                  <Search size={14} />
                  {isDetectingDuplicates ? "检测中..." : "检测重复候选"}
                </button>
              </div>

              <p className="mt-2 text-xs opacity-75">
                模型：去噪词（如 high/reasoning）+ 字符重复匹配度；Benchmark：名称归一化 + 字符重复匹配度（不依赖模型重合度）。
              </p>

              {duplicateDetectionResult ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
                    <span className="opacity-70">生成时间：{new Date(duplicateDetectionResult.generatedAt).toLocaleString()}</span>
                  </div>

                  <div className="tabs tabs-boxed inline-flex bg-base-200/70 p-1">
                    <button
                      type="button"
                      className={`tab ${duplicateDetectionEntityType === "model" ? "tab-active" : ""}`}
                      onClick={() => setDuplicateDetectionEntityType("model")}
                    >
                      {`Model 候选（${duplicateDetectionResult.modelCandidates.length}）`}
                    </button>
                    <button
                      type="button"
                      className={`tab ${duplicateDetectionEntityType === "benchmark" ? "tab-active" : ""}`}
                      onClick={() => setDuplicateDetectionEntityType("benchmark")}
                    >
                      {`Benchmark 候选（${duplicateDetectionResult.benchmarkCandidates.length}）`}
                    </button>
                  </div>

                  <div className="inline-flex items-center gap-1 rounded-lg border border-base-300/70 bg-base-100/60 p-1 text-xs">
                    <button
                      type="button"
                      className={`btn btn-xs ${duplicateConfidenceFilter === "high-medium" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setDuplicateConfidenceFilter("high-medium")}
                    >
                      仅高/中置信
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${duplicateConfidenceFilter === "all" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setDuplicateConfidenceFilter("all")}
                    >
                      显示全部
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-base-300/70 bg-base-100/60 p-2 text-xs">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={isAllActiveDuplicateCandidatesSelected}
                        disabled={activeDuplicateCandidateCount === 0 || isBatchMergingDuplicates}
                        onChange={(e) => toggleAllVisibleDuplicateCandidates(e.target.checked)}
                      />
                      <span>选择当前列表全部候选</span>
                    </label>
                    <span className="opacity-70">已选 {selectedActiveDuplicateCandidateCount} / {activeDuplicateCandidateCount}</span>
                    <button
                      type="button"
                      className="btn btn-xs btn-error ml-auto"
                      disabled={selectedActiveDuplicateCandidateCount === 0 || isBatchMergingDuplicates}
                      onClick={onBatchMergeDuplicateCandidates}
                    >
                      {isBatchMergingDuplicates ? "批量合并中..." : "批量合并已选"}
                    </button>
                  </div>

                  {duplicateDetectionEntityType === "model" ? (
                    visibleModelDuplicateCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                        当前筛选条件下未检测到 model 重复候选。
                      </div>
                    ) : (
                      <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                        {visibleModelDuplicateCandidates.map((candidate) => (
                          <div
                            key={`dup-model-${candidate.sourceId}-${candidate.targetId}`}
                            className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-sm"
                                  checked={Boolean(selectedDuplicateCandidateKeys[getDuplicateCandidateKey("model", candidate)])}
                                  disabled={isBatchMergingDuplicates}
                                  onChange={(e) => setDuplicateCandidateSelected("model", candidate, e.target.checked)}
                                  aria-label={`选择 ${candidate.sourceName} 合并到 ${candidate.targetName}`}
                                />
                              </label>
                              <span className="font-semibold">
                                {candidate.sourceName} [{candidate.sourceId}] → {candidate.targetName} [{candidate.targetId}]
                              </span>
                              <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                                {duplicateConfidenceLabel(candidate.confidence)}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline ml-auto"
                                onClick={() => applyModelDuplicateCandidate(candidate)}
                              >
                                填充到合并表单
                              </button>
                            </div>

                            <div className="mt-1 text-xs opacity-80">
                              {/* 提供方：{candidate.sourceProviderName} → {candidate.targetProviderName} */}
                              记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                              ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                              ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.reasons.map((reason) => (
                                <span
                                  key={`dup-model-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                                  className="badge badge-outline badge-xs"
                                >
                                  {duplicateReasonLabel(reason)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    visibleBenchmarkDuplicateCandidates.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-70">
                        当前筛选条件下未检测到 benchmark 重复候选。
                      </div>
                    ) : (
                      <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                        {visibleBenchmarkDuplicateCandidates.map((candidate) => (
                          <div
                            key={`dup-benchmark-${candidate.sourceId}-${candidate.targetId}`}
                            className={`rounded-xl border p-3 shadow-sm ${duplicateCandidateCardClass(candidate.confidence)}`}
                          >
                            <div className="flex flex-wrap items-start gap-2">
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-sm"
                                  checked={Boolean(selectedDuplicateCandidateKeys[getDuplicateCandidateKey("benchmark", candidate)])}
                                  disabled={isBatchMergingDuplicates}
                                  onChange={(e) => setDuplicateCandidateSelected("benchmark", candidate, e.target.checked)}
                                  aria-label={`选择 ${candidate.sourceName} 合并到 ${candidate.targetName}`}
                                />
                              </label>
                              <span className="font-semibold">
                                {candidate.sourceName} [{candidate.sourceType}] → {candidate.targetName} [{candidate.targetType}]
                              </span>
                              <span className={`badge badge-sm font-semibold ${duplicateConfidenceBadgeClass(candidate.confidence)}`}>
                                {duplicateConfidenceLabel(candidate.confidence)}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline ml-auto"
                                onClick={() => applyBenchmarkDuplicateCandidate(candidate)}
                              >
                                填充到合并表单
                              </button>
                            </div>

                            <div className="mt-1 text-xs opacity-80">
                              记录数：{candidate.sourceValueCount} → {candidate.targetValueCount}
                              ・相似度 {(candidate.similarity * 100).toFixed(1)}%
                              ・字符重复 {(candidate.characterRepeatScore * 100).toFixed(1)}%
                              {candidate.sourceSourceSummary || candidate.targetSourceSummary
                                ? `・Source ${candidate.sourceSourceSummary ?? "空 source"} → ${candidate.targetSourceSummary ?? "空 source"}`
                                : ""}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1">
                              {candidate.reasons.map((reason) => (
                                <span
                                  key={`dup-benchmark-reason-${candidate.sourceId}-${candidate.targetId}-${reason}`}
                                  className="badge badge-outline badge-xs"
                                >
                                  {duplicateReasonLabel(reason)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-base-300 p-3 text-sm opacity-75">
                  点击“检测重复候选”后，会列出可疑的 model / benchmark，并支持一键填充到下方合并表单。
                </div>
              )}
            </div>

            <form onSubmit={onMerge} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <select
                  className="select select-bordered w-full"
                  value={mergeType}
                  onChange={(e) => {
                    setMergeType(e.target.value as "model" | "benchmark");
                    setMergeSourceInput("");
                    setMergeTargetInput("");
                    setMergeTargetBenchmarkNameInput("");
                  }}
                >
                  <option value="model">model</option>
                  <option value="benchmark">benchmark</option>
                </select>
              </div>
              <div className="md:col-span-4">
                <input
                  list={`merge-options-${mergeType}`}
                  className="input input-bordered w-full"
                  value={mergeSourceInput}
                  onChange={(e) => setMergeSourceInput(e.target.value)}
                  placeholder="source：输入名称或ID"
                  required
                />
              </div>
              <div className="md:col-span-4">
                <input
                  list={`merge-options-${mergeType}`}
                  className="input input-bordered w-full"
                  value={mergeTargetInput}
                  onChange={(e) => setMergeTargetInput(e.target.value)}
                  placeholder="target：输入名称或ID"
                  required
                />
                <datalist id={`merge-options-${mergeType}`}>
                  {mergeEntityOptions.map((item) => (
                    <option key={`${mergeType}-${item.id}`} value={`${item.label} [${item.id}]`} />
                  ))}
                </datalist>
              </div>
              <div className="md:col-span-12 flex flex-wrap items-center gap-2 text-xs">
                <span className="opacity-75">解析结果：source = {resolvedMergeSourceId ?? "-"}，target = {resolvedMergeTargetId ?? "-"}</span>
                {shouldRenderBenchmarkValueOverlapBadge ? (
                  <span
                    className={`badge badge-xs ${benchmarkValueOverlapBadgeClass}`}
                    style={isLoadingBenchmarkValueOverlap ? undefined : { color: "#0f172a" }}
                  >
                    相同值 = {isLoadingBenchmarkValueOverlap
                      ? "计算中..."
                      : `${benchmarkValueOverlapStats?.sameCount ?? 0} / ${benchmarkValueOverlapStats?.overlapCount ?? 0}`}
                  </span>
                ) : null}
              </div>
              {mergeType === "benchmark" ? (
                <div className="md:col-span-8">
                  <input
                    className="input input-bordered w-full"
                    value={mergeTargetBenchmarkNameInput}
                    onChange={(e) => setMergeTargetBenchmarkNameInput(e.target.value)}
                    placeholder="可选：合并时同时修改 target benchmark 显示名称"
                  />
                </div>
              ) : null}
              <div className={mergeType === "benchmark" ? "md:col-span-4" : "md:col-span-12"}>
                <button
                  ref={mergeSubmitButtonRef}
                  type="submit"
                  className={`btn ${mergeSubmitState === "success" ? "btn-success" : "btn-error"}`}
                  disabled={!canSubmitMerge}
                  style={{ scrollMarginBottom: "72px" }}
                >
                  {mergeSubmitState === "submitting"
                    ? "合并中..."
                    : mergeSubmitState === "success"
                      ? "已合并"
                      : "合并实体"}
                </button>
              </div>
            </form>

            <h4 className="mt-6 mb-2 font-semibold">已有合并去重记录</h4>
            {mergedRecordList.length === 0 ? (
              <p className="text-sm opacity-70">暂无已合并记录</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Target（可编辑）</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRecordList.map((record) => {
                      const recordKey = `${record.entityType}:${record.sourceId}`;
                      const inputValue = mergedRecordTargetInputs[recordKey] ?? `${record.targetName} [${record.targetId}]`;

                      return (
                        <tr key={recordKey}>
                          <td>{record.entityType}</td>
                          <td>{record.sourceName} [{record.sourceId}]</td>
                          <td>
                            <input
                              list={`merge-edit-options-${record.entityType}`}
                              className="input input-bordered input-sm w-full min-w-[300px]"
                              value={inputValue}
                              onChange={(e) =>
                                setMergedRecordTargetInputs((prev) => ({
                                  ...prev,
                                  [recordKey]: e.target.value
                                }))
                              }
                              placeholder="输入名称或ID"
                            />
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-xs btn-outline"
                                onClick={() => onUpdateMergedRecord(record)}
                              >
                                保存修改
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs btn-outline btn-error"
                                onClick={() => onDeleteMergedRecord(record)}
                              >
                                删除记录
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <datalist id="merge-edit-options-model">
              {modelEntityOptions.map((item) => (
                <option key={`merge-edit-model-${item.id}`} value={`${item.label} [${item.id}]`} />
              ))}
            </datalist>
            <datalist id="merge-edit-options-benchmark">
              {benchmarkEntityOptions.map((item) => (
                <option key={`merge-edit-benchmark-${item.id}`} value={`${item.label} [${item.id}]`} />
              ))}
            </datalist>
          </section>
        ) : null}

        {activeTab === "maintenance" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <div className="relative overflow-hidden rounded-2xl border border-warning/35 bg-gradient-to-br from-warning/10 via-base-100 to-primary/10 p-5">
              <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-warning/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />

              <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Database size={18} />
                    数据一致性检测
                  </h3>
                  <p className="mt-1 text-sm opacity-80">
                    检测同一 benchmark 是否同时出现 <code>&lt;1</code> 与 <code>&gt;10</code> 的混合量纲，或同时出现 <code>0-100</code> 与 <code>&gt;100</code> 的 Elo 风格分值，并提供修复动作。
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-warning shadow-md"
                  onClick={() => onCheckScaleConsistency()}
                  disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                >
                  {isCheckingScaleConsistency ? "检测中..." : "开始一致性检测"}
                </button>
              </div>

              <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide opacity-60">最近检测</div>
                  <div className="mt-1 text-sm font-medium">
                    {scaleConsistencyCheckedAt
                      ? new Date(scaleConsistencyCheckedAt).toLocaleString("zh-CN", { hour12: false })
                      : "尚未检测"}
                  </div>
                </div>
                <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide opacity-60">异常 benchmark</div>
                  <div className="mt-1 text-sm font-medium">{scaleConsistencyIssues.length} 个</div>
                </div>
                <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide opacity-60">待处理混合值</div>
                  <div className="mt-1 text-sm font-medium">{scaleConsistencyAffectedValueCount} 条</div>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {scaleConsistencyIssues.length === 0 ? (
                <div className="rounded-xl border border-base-300/70 bg-base-200/40 px-4 py-6 text-sm opacity-80">
                  {scaleConsistencyCheckedAt
                    ? "最近一次检测未发现混合量纲问题。"
                    : "点击“开始一致性检测”后将在这里展示异常 benchmark。"}
                </div>
              ) : (
                scaleConsistencyIssues.map((issue) => {
                  const isNormalizingCurrent = normalizingScaleBenchmarkId === issue.benchmarkId;
                  const isSplittingCurrent = splittingScaleBenchmarkId === issue.benchmarkId;
                  const issueValueDetails = issue.valueDetails ?? [];
                  const hasTtsSource = issueValueDetails.some((detail) =>
                    (detail.source ?? "").toLowerCase().includes("tts")
                  );
                  const belowOneDetails = issueValueDetails.filter((detail) => detail.value < 1);
                  const hasOnlyZeroInSmallValues =
                    belowOneDetails.length > 0
                    && belowOneDetails.every((detail) => Math.abs(detail.value) < 1e-12);
                  const shouldDefaultCollapse = hasTtsSource || hasOnlyZeroInSmallValues;

                  const splitDraft = scaleSplitNameDrafts[issue.benchmarkId] ?? {
                    baseName: issue.benchmarkName,
                    eloName: `${issue.benchmarkName} (Elo)`
                  };

                  return (
                    <details
                      open={!shouldDefaultCollapse}
                      key={`scale-consistency-${issue.benchmarkId}`}
                      className="rounded-2xl border border-warning/40 bg-base-100 shadow-sm transition-shadow open:shadow-md"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="badge badge-warning badge-outline">混合量纲告警</span>
                          <h4 className="truncate text-base font-semibold">{issue.benchmarkName}</h4>
                          <span className="text-xs opacity-70">[{issue.benchmarkType}]</span>
                          {shouldDefaultCollapse ? (
                            <span className="badge badge-ghost badge-sm">默认折叠</span>
                          ) : null}
                          {hasTtsSource ? <span className="badge badge-info badge-outline badge-sm">source: tts</span> : null}
                          {hasOnlyZeroInSmallValues ? <span className="badge badge-outline badge-sm">&lt;1 仅 0 值</span> : null}
                        </div>
                        <span className="text-xs opacity-55">点击展开/折叠</span>
                      </summary>

                      <div className="border-t border-base-300/50 px-4 pb-4 pt-2">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <p className="text-sm opacity-80">
                              {issue.issueType === "mixed-scale-0-1-vs-100"
                                ? <>该 benchmark 同时出现 <code>&lt;1</code> 与 <code>&gt;10</code> 的值，请选择目标量纲进行同化。</>
                                : <>该 benchmark 同时出现 <code>0-100</code> 与 <code>&gt;100</code> 的值，建议拆分为原 benchmark 与 Elo benchmark。</>}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <div className="group relative inline-flex items-center">
                                <span className="cursor-help rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                                  总值 {issue.valueCount}
                                </span>

                                {issueValueDetails.length > 0 ? (
                                  <div className="invisible absolute left-0 top-full z-20 mt-2 max-h-64 w-[min(82vw,300px)] overflow-auto rounded-lg border border-base-300/70 bg-base-100 p-1.5 opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:opacity-100">
                                    <ul className="space-y-1">
                                      {issueValueDetails.map((detail, index) => {
                                        const benchTimeText = detail.benchTime
                                          ? new Date(detail.benchTime).toLocaleString("zh-CN", { hour12: false })
                                          : "-";
                                        const sourceText = detail.source?.trim() ? detail.source : "空 source";

                                        return (
                                          <li
                                            key={`scale-detail-${issue.benchmarkId}-${index}`}
                                            className="rounded-md border border-base-300/50 bg-base-200/30 px-2 py-0.5"
                                          >
                                            <div className="flex items-center gap-1 text-[11px] text-base-content">
                                              <span className="font-mono font-semibold">
                                                {Number(detail.value.toFixed(6)).toString()}
                                              </span>
                                              <span className="truncate opacity-75">· {detail.modelName}</span>
                                            </div>
                                            <div className="mt-0.5 break-all text-[11px] leading-4 opacity-75">
                                              {sourceText} · {benchTimeText}
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                ) : null}
                              </div>
                              {issue.issueType === "mixed-scale-0-1-vs-100" ? (
                                <>
                                  <span className="rounded-full border border-info/35 bg-info/10 px-2 py-1">
                                    &lt;1：{issue.smallValueCount}
                                  </span>
                                  <span className="rounded-full border border-warning/35 bg-warning/10 px-2 py-1">
                                    &gt;10：{issue.largeValueCount}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="rounded-full border border-info/35 bg-info/10 px-2 py-1">
                                    0-100：{issue.zeroToHundredCount}
                                  </span>
                                  <span className="rounded-full border border-warning/35 bg-warning/10 px-2 py-1">
                                    &gt;100：{issue.overHundredCount}
                                  </span>
                                </>
                              )}
                              <span className="rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                                min={Number(issue.minValue.toFixed(6)).toString()}
                              </span>
                              <span className="rounded-full border border-base-300 bg-base-200/60 px-2 py-1">
                                max={Number(issue.maxValue.toFixed(6)).toString()}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            {issue.issueType === "mixed-scale-0-1-vs-100" ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline btn-primary"
                                  onClick={() => onNormalizeBenchmarkScale(issue, 1)}
                                  disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                                >
                                  {isNormalizingCurrent ? "处理中..." : "同化为 1 量纲"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline btn-secondary"
                                  onClick={() => onNormalizeBenchmarkScale(issue, 100)}
                                  disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                                >
                                  {isNormalizingCurrent ? "处理中..." : "同化为 100 量纲"}
                                </button>
                              </>
                            ) : (
                              <div className="w-full space-y-2 xl:w-[420px]">
                                <input
                                  className="input input-bordered input-sm w-full"
                                  value={splitDraft.baseName}
                                  onChange={(event) =>
                                    setScaleSplitNameDrafts((prev) => ({
                                      ...prev,
                                      [issue.benchmarkId]: {
                                        ...(prev[issue.benchmarkId] ?? {
                                          baseName: issue.benchmarkName,
                                          eloName: `${issue.benchmarkName} (Elo)`
                                        }),
                                        baseName: event.target.value
                                      }
                                    }))
                                  }
                                  placeholder="原 benchmark 名称"
                                />
                                <input
                                  className="input input-bordered input-sm w-full"
                                  value={splitDraft.eloName}
                                  onChange={(event) =>
                                    setScaleSplitNameDrafts((prev) => ({
                                      ...prev,
                                      [issue.benchmarkId]: {
                                        ...(prev[issue.benchmarkId] ?? {
                                          baseName: issue.benchmarkName,
                                          eloName: `${issue.benchmarkName} (Elo)`
                                        }),
                                        eloName: event.target.value
                                      }
                                    }))
                                  }
                                  placeholder="Elo benchmark 名称"
                                />
                                <div className="text-[11px] opacity-70">
                                  type / modality / unit / higherIsBetter 将继承原 benchmark。
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-warning"
                                  onClick={() => onSplitBenchmarkScale(issue)}
                                  disabled={isCheckingScaleConsistency || normalizingScaleBenchmarkId !== null || splittingScaleBenchmarkId !== null}
                                >
                                  {isSplittingCurrent ? "处理中..." : "拆分为原 benchmark + Elo"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Settings2 size={18} />
              Settings
            </h3>

            <div className="mb-5 rounded-box border border-base-300 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold">模型重复识别规则</h4>
              <p className="mb-3 text-sm opacity-80">
                当前默认：小写 + 去掉 `-`、空格、`.` 后比较模型名；若归一化结果相同，则判定为同一模型。
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.lowercase}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, lowercase: e.target.checked }))
                    }
                  />
                  <span className="label-text">转为小写</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeHyphen}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeHyphen: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除连字符 -</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeSpace}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeSpace: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除空格</span>
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={modelDedupeRule.removeDot}
                    onChange={(e) =>
                      setModelDedupeRule((prev) => ({ ...prev, removeDot: e.target.checked }))
                    }
                  />
                  <span className="label-text">移除小数点 .</span>
                </label>
              </div>
              <div className="mt-3">
                <button type="button" className="btn btn-primary" onClick={onSaveModelDedupeRule}>
                  保存模型规则
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-box border border-error/40 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold text-error">删除单个模型</h4>
              <p className="mb-3 text-sm opacity-80">
                会删除该模型记录与其所有 benchmark_values（不可恢复）。
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(420px,1fr)_auto] md:items-center">
                <input
                  className="input input-bordered w-full"
                  list="delete-model-options"
                  value={deleteModelInput}
                  onChange={(e) => setDeleteModelInput(e.target.value)}
                  placeholder="输入模型名或ID后选择候选"
                />
                <datalist id="delete-model-options">
                  {modelEntityOptions.map((item) => (
                    <option key={`delete-model-${item.id}`} value={`${item.label} [${item.id}]`} />
                  ))}
                </datalist>
                <button type="button" className="btn btn-outline btn-error" onClick={onDeleteModelData}>
                  删除模型及数据
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-box border border-error/40 bg-base-200/50 p-4">
              <h4 className="mb-2 font-semibold text-error">删除 source</h4>
              <p className="mb-3 text-sm opacity-80">
                会删除 benchmark_values 中该 source 对应的所有记录（不可恢复）。输入 llm-benchmark 会按 text:llm-benchmark 删除；留空可删除 source 为空（NULL/空字符串）的记录。
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(420px,1fr)_auto] md:items-center">
                <input
                  className="input input-bordered w-full"
                  list="delete-source-options"
                  value={deleteSourceInput}
                  onChange={(e) => setDeleteSourceInput(e.target.value)}
                  placeholder="输入 source（留空表示删除空 source）"
                />
                <datalist id="delete-source-options">
                  {deleteSourceOptions.map((item) => (
                    <option key={`delete-source-${item}`} value={item} />
                  ))}
                </datalist>
                <button type="button" className="btn btn-outline btn-error" onClick={onDeleteSourceData}>
                  删除 source 数据
                </button>
              </div>
            </div>

            <form onSubmit={onSaveSetting} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <input className="input input-bordered w-full" value={settingKey} onChange={(e) => setSettingKey(e.target.value)} placeholder="key" required />
              </div>
              <div className="md:col-span-6">
                <textarea className="textarea textarea-bordered min-h-[120px] w-full" value={settingValue} onChange={(e) => setSettingValue(e.target.value)} required />
              </div>
              <div className="md:col-span-3 space-y-3">
                <input className="input input-bordered w-full" value={settingNote} onChange={(e) => setSettingNote(e.target.value)} placeholder="note (optional)" />
                <button type="submit" className="btn btn-primary w-full">保存 Setting</button>
                <button type="button" className="btn btn-outline btn-error w-full" onClick={onClearDatabase}>
                  清空数据库（保留 settings）
                </button>
              </div>
            </form>

            <h4 className="mt-6 mb-2 font-semibold">当前 settings（初始快照）</h4>
            {sortedSettings.length === 0 ? (
              <p className="text-sm opacity-70">暂无 settings 记录</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300">
                <table className="table table-zebra table-sm">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSettings.map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>
                          <pre className="m-0 whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
