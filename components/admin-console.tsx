"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Database,
  FileSpreadsheet,
  Merge as MergeIcon,
  PlusCircle,
  Settings2,
  ShieldAlert,
  Table2,
  TriangleAlert,
  Upload
} from "lucide-react";

type ProviderOption = {
  id: number;
  name: string;
  slug: string;
};

type ModelOption = {
  id: number;
  providerId: number;
  modelName: string;
  canonicalKey: string;
};

type BenchmarkOption = {
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  modalities: string[];
};

type MergedRecord = {
  entityType: "model" | "benchmark";
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
};

type PreviewRow = {
  rowNumber: number;
  category: string | null;
  benchmarkName: string;
  modelName: string;
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  valid: boolean;
};

type ImportWarning = {
  rowNumber: number;
  modelName: string;
  benchmarkName: string;
  rawValue: string;
  reason: string;
};

type TextImportPreviewRow = {
  rowNumber: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  rawValue: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
  valid: boolean;
};

type Props = {
  providers: ProviderOption[];
  models: ModelOption[];
  benchmarks: BenchmarkOption[];
  sourceOptions?: string[];
  mergedRecords: MergedRecord[];
  initialSettings: Record<string, unknown>;
};

type ModelDedupeRule = {
  lowercase: boolean;
  removeHyphen: boolean;
  removeSpace: boolean;
  removeDot: boolean;
};

type TabKey = "import" | "entry" | "merge" | "settings";

const DEFAULT_MODEL_DEDUPE_RULE: ModelDedupeRule = {
  lowercase: true,
  removeHyphen: true,
  removeSpace: true,
  removeDot: true
};

function normalizeModelDedupeRule(raw: unknown): ModelDedupeRule {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MODEL_DEDUPE_RULE };
  }

  const candidate = raw as Partial<ModelDedupeRule>;
  return {
    lowercase:
      typeof candidate.lowercase === "boolean"
        ? candidate.lowercase
        : DEFAULT_MODEL_DEDUPE_RULE.lowercase,
    removeHyphen:
      typeof candidate.removeHyphen === "boolean"
        ? candidate.removeHyphen
        : DEFAULT_MODEL_DEDUPE_RULE.removeHyphen,
    removeSpace:
      typeof candidate.removeSpace === "boolean"
        ? candidate.removeSpace
        : DEFAULT_MODEL_DEDUPE_RULE.removeSpace,
    removeDot:
      typeof candidate.removeDot === "boolean"
        ? candidate.removeDot
        : DEFAULT_MODEL_DEDUPE_RULE.removeDot
  };
}

function parseMergeEntityId(
  rawInput: string,
  options: Array<{ id: number; label: string }>
): number | null {
  const normalized = rawInput.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const matchedId = normalized.match(/\[(\d+)\]\s*$/);
  if (matchedId) {
    return Number(matchedId[1]);
  }

  const exact = options.find((option) => option.label === normalized);
  return exact?.id ?? null;
}

async function postJson(
  url: string,
  payload: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST"
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;
    throw new Error(reason);
  }

  return data;
}

async function postFormData(url: string, formData: FormData) {
  const response = await fetch(url, { method: "POST", body: formData });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;

    const error = new Error(reason) as Error & { payload?: unknown };
    error.payload = data;
    throw error;
  }

  return data;
}

export function AdminConsole({
  providers,
  models,
  benchmarks,
  sourceOptions = [],
  mergedRecords,
  initialSettings
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("import");
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);

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
  const [benchTime, setBenchTime] = useState(() => new Date().toISOString().slice(0, 16));

  const [csvText, setCsvText] = useState(
    ""
  );
  const [csvSource, setCsvSource] = useState("");
  const [textImportPreviewRows, setTextImportPreviewRows] = useState<TextImportPreviewRow[]>([]);
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
  const importProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mergeType, setMergeType] = useState<"model" | "benchmark">("model");
  const [mergeSourceInput, setMergeSourceInput] = useState("");
  const [mergeTargetInput, setMergeTargetInput] = useState("");
  const [mergedRecordList, setMergedRecordList] = useState<MergedRecord[]>(mergedRecords);
  const [mergedRecordTargetInputs, setMergedRecordTargetInputs] = useState<Record<string, string>>(() =>
    mergedRecords.reduce<Record<string, string>>((acc, record) => {
      acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
      return acc;
    }, {})
  );

  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("{}");
  const [settingNote, setSettingNote] = useState("");
  const [deleteModelInput, setDeleteModelInput] = useState("");
  const [deleteSourceInput, setDeleteSourceInput] = useState("");
  const [modelDedupeRule, setModelDedupeRule] = useState<ModelDedupeRule>(() =>
    normalizeModelDedupeRule(initialSettings.model_dedupe_rule)
  );

  const sortedSettings = useMemo(() => {
    return Object.entries(initialSettings).sort(([a], [b]) => a.localeCompare(b));
  }, [initialSettings]);

  const visibleTextImportPreviewRows = useMemo(
    () => textImportPreviewRows.slice(0, textImportPreviewVisibleCount),
    [textImportPreviewRows, textImportPreviewVisibleCount]
  );

  const deleteSourceOptions = useMemo(
    () => Array.from(new Set(sourceOptions.map((item) => item.trim()).filter(Boolean))),
    [sourceOptions]
  );

  const modelEntityOptions = useMemo(
    () =>
      models.map((item) => ({
        id: item.id,
        label: item.modelName
      })),
    [models]
  );

  const benchmarkEntityOptions = useMemo(
    () =>
      benchmarks.map((item) => ({
        id: item.id,
        label: `${item.benchmarkName} (${item.benchmarkType})`
      })),
    [benchmarks]
  );

  const mergeEntityOptions = useMemo(() => {
    if (mergeType === "model") {
      return modelEntityOptions;
    }

    return benchmarkEntityOptions;
  }, [mergeType, modelEntityOptions, benchmarkEntityOptions]);

  const resolvedMergeSourceId = useMemo(
    () => parseMergeEntityId(mergeSourceInput, mergeEntityOptions),
    [mergeSourceInput, mergeEntityOptions]
  );

  const resolvedMergeTargetId = useMemo(
    () => parseMergeEntityId(mergeTargetInput, mergeEntityOptions),
    [mergeTargetInput, mergeEntityOptions]
  );

  useEffect(() => {
    return () => {
      if (importProgressTimerRef.current) {
        clearInterval(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }

      if (noticeHideTimerRef.current) {
        clearTimeout(noticeHideTimerRef.current);
        noticeHideTimerRef.current = null;
      }

      if (noticeClearTimerRef.current) {
        clearTimeout(noticeClearTimerRef.current);
        noticeClearTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setMergedRecordList(mergedRecords);
    setMergedRecordTargetInputs(
      mergedRecords.reduce<Record<string, string>>((acc, record) => {
        acc[`${record.entityType}:${record.sourceId}`] = `${record.targetName} [${record.targetId}]`;
        return acc;
      }, {})
    );
  }, [mergedRecords]);

  useEffect(() => {
    if (!notice) return;

    if (noticeHideTimerRef.current) {
      clearTimeout(noticeHideTimerRef.current);
      noticeHideTimerRef.current = null;
    }

    if (noticeClearTimerRef.current) {
      clearTimeout(noticeClearTimerRef.current);
      noticeClearTimerRef.current = null;
    }

    setNoticeVisible(true);

    noticeHideTimerRef.current = setTimeout(() => {
      setNoticeVisible(false);
    }, 2300);

    noticeClearTimerRef.current = setTimeout(() => {
      setNotice(null);
      setNoticeVisible(false);
    }, 2750);
  }, [notice]);

  function notifySuccess(message: string) {
    setNotice({ type: "success", message });
  }

  function notifyError(message: string) {
    setNotice({ type: "error", message });
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

    setSheetNames(result.sheetNames ?? []);
    setSelectedSheet(result.selectedSheet ?? "");
    setPreviewRows((result.previewRows ?? []) as PreviewRow[]);
    setPreviewWarnings((result.warnings ?? []) as ImportWarning[]);
    setPreviewMeta({
      benchmarkColumn: result.benchmarkColumn ?? "Benchmark",
      categoryColumn: result.categoryColumn ?? null,
      parsedCount: result.parsedCount ?? 0,
      warningCount: result.warningCount ?? 0
    });

    notifySuccess(`预览完成：解析 ${result.parsedCount ?? 0} 条，警告 ${result.warningCount ?? 0} 条`);

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
      const payload = buildWorkbookFormData(selectedSheet || undefined, allowWarningsImport);
      const result = await postFormData("/api/admin/import-xlsm/commit", payload);
      notifySuccess(`导入完成：${result.inserted ?? 0}/${result.total ?? 0}，工作表 ${result.selectedSheet ?? selectedSheet}`);
      finalStatus = "success";
      finalProgress = 100;
      finalStatusText = `导入成功：${result.inserted ?? 0}/${result.total ?? 0}`;

      if (Array.isArray(result.warnings)) {
        setPreviewWarnings(result.warnings as ImportWarning[]);
      }
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

  async function onPreviewCsvImport() {
    try {
      const result = await postJson("/api/admin/import-csv/preview", {
        csvText,
        source: csvSource || undefined
      });
      setTextImportPreviewRows((result.previewRows ?? []) as TextImportPreviewRow[]);
      setTextImportPreviewMeta({
        format: result.format ?? "matrix-table",
        total: result.total ?? 0,
        skipped: result.skipped ?? 0
      });
      setTextImportPreviewVisibleCount(200);
      notifySuccess(`文本预览完成：可导入 ${result.total ?? 0} 条，跳过 ${result.skipped ?? 0} 条`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "文本预览失败");
    }
  }

  async function onImportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await postJson("/api/admin/import-csv", {
        csvText,
        source: csvSource || undefined
      });
      notifySuccess(
        `文本导入完成：${result.inserted ?? 0}/${result.total ?? 0}（跳过 ${result.skipped ?? 0}，格式 ${result.format ?? "auto"}）`
      );
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "文本导入失败");
    }
  }

  async function onMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resolvedMergeSourceId === null || resolvedMergeTargetId === null) {
      notifyError("请从下拉候选中选择 source/target，或直接输入合法 ID");
      return;
    }

    try {
      await postJson("/api/admin/merge", {
        entityType: mergeType,
        sourceId: resolvedMergeSourceId,
        targetId: resolvedMergeTargetId
      });
      notifySuccess("合并完成。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "合并失败");
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

  async function onClearDatabase() {
    const confirmed = window.confirm("该操作会清空除 settings 外所有表数据，仅用于调试。确认继续吗？");
    if (!confirmed) return;

    try {
      await postJson("/api/admin/debug/clear-data", {
        confirm: "CLEAR_NON_SETTINGS_DATA"
      });
      notifySuccess("已清空除 settings 外的所有表。若下拉项未更新，请刷新页面。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "清空数据库失败");
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
    const source = deleteSourceInput.trim();
    if (!source) {
      notifyError("请先输入 source");
      return;
    }

    const normalizedSource = source.toLowerCase().startsWith("text:") ? `text:${source.slice(5).trim()}` : `text:${source}`;
    const confirmed = window.confirm(
      `确认删除 source = ${normalizedSource} 的全部数据吗？\n将删除 benchmark_values 中匹配该 source 的所有记录（不可恢复）。`
    );
    if (!confirmed) return;

    try {
      const result = await postJson("/api/admin/debug/delete-source", { source });
      setDeleteSourceInput("");
      notifySuccess(`已删除 source=${result.normalizedSource ?? normalizedSource} 的 ${result.deleted ?? 0} 条记录`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除 source 数据失败");
    }
  }

  async function onSaveModelDedupeRule() {
    try {
      await postJson("/api/admin/settings", {
        key: "model_dedupe_rule",
        valueJson: modelDedupeRule,
        note: "模型重复识别规则",
        updatedBy: "admin"
      });
      notifySuccess("模型重复识别规则已保存。新导入与新增模型会按此规则判重。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存模型规则失败");
    }
  }

  const tabClass = (key: TabKey) =>
    `btn rounded-xl border-0 text-base md:text-base transition-all duration-200 ease-out ${
      activeTab === key
        ? "bg-primary text-primary-content font-semibold shadow-md"
        : "bg-transparent text-base-content/70 hover:bg-base-100/70 hover:text-base-content"
    }`;

  return (
    <>
      {notice ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[120]">
          <div
            className={`pointer-events-auto flex min-w-[260px] max-w-[520px] items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-300 ease-out ${
              noticeVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
            } ${
              notice.type === "success"
                ? "border-emerald-500/45 bg-emerald-900/80 text-emerald-100"
                : "border-rose-500/45 bg-rose-900/80 text-rose-100"
            }`}
          >
            <span
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                notice.type === "success" ? "bg-emerald-500/25 text-emerald-200" : "bg-rose-500/25 text-rose-200"
              }`}
            >
              {notice.type === "success" ? <Check size={18} /> : <TriangleAlert size={18} />}
            </span>
            <span className="text-sm font-semibold tracking-wide">{notice.message}</span>
          </div>
        </div>
      ) : null}

      {sheetPickerOpen ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">选择工作表</h3>
            <p className="py-2 text-sm opacity-80">请选择要导入的工作表，选中后会自动刷新预览。</p>
            <div className="flex flex-col gap-2">
              {sheetNames.map((name) => (
                <button key={name} type="button" className="btn btn-outline" onClick={() => onSelectSheet(name)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setSheetPickerOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div
          role="tablist"
          className="inline-flex w-full max-w-3xl flex-wrap items-center gap-1 rounded-2xl border border-base-300/70 bg-base-200/70 p-1.5 shadow-inner backdrop-blur"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "import"}
            className={tabClass("import")}
            onClick={() => setActiveTab("import")}
          >
            导入中心
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "entry"}
            className={tabClass("entry")}
            onClick={() => setActiveTab("entry")}
          >
            数据录入
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "merge"}
            className={tabClass("merge")}
            onClick={() => setActiveTab("merge")}
          >
            实体去重
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            className={tabClass("settings")}
            onClick={() => setActiveTab("settings")}
          >
            数据库设置
          </button>
        </div>

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
                    预览数据（最多 40 条）
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
                            <td>{row.valueNum ?? "-"}</td>
                            <td>{row.valueNum2 ?? "-"}</td>
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
                  className="textarea textarea-bordered min-h-[180px] w-full"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  required
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline" onClick={onPreviewCsvImport}>
                    预览导入结果
                  </button>
                  <button type="submit" className="btn btn-primary">
                    执行导入
                  </button>
                </div>
              </form>

              {textImportPreviewMeta ? (
                <div className="alert alert-info mt-4">
                  <div>
                    <div>识别格式：{textImportPreviewMeta.format}</div>
                    <div>可导入：{textImportPreviewMeta.total} 条，跳过：{textImportPreviewMeta.skipped} 条</div>
                  </div>
                </div>
              ) : null}

              {textImportPreviewRows.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <h4 className="flex items-center justify-between gap-3 font-semibold">
                    <span>文本导入预览</span>
                    <span className="text-xs opacity-70">
                      已显示 {visibleTextImportPreviewRows.length} / {textImportPreviewRows.length}
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
                        {visibleTextImportPreviewRows.map((row, idx) => (
                          <tr key={`${row.rowNumber}-${row.modelName}-${row.benchmarkName}-${idx}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.providerName}</td>
                            <td>{row.modelName}</td>
                            <td>{row.benchmarkName}</td>
                            <td>{row.benchmarkType}</td>
                            <td>{row.rawValue}</td>
                            <td>{row.valueNum ?? "-"}</td>
                            <td>{row.valueNum2 ?? "-"}</td>
                            <td>{row.valueNote ?? "-"}</td>
                            <td>{row.source ?? "-"}</td>
                            <td>{row.valid ? "✅" : "⚠️"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {visibleTextImportPreviewRows.length < textImportPreviewRows.length ? (
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

        {activeTab === "merge" ? (
          <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <MergeIcon size={18} />
              实体合并（去重）
            </h3>
            <form onSubmit={onMerge} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <select
                  className="select select-bordered w-full"
                  value={mergeType}
                  onChange={(e) => {
                    setMergeType(e.target.value as "model" | "benchmark");
                    setMergeSourceInput("");
                    setMergeTargetInput("");
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
              <div className="md:col-span-12 text-xs opacity-75">
                解析结果：source = {resolvedMergeSourceId ?? "-"}，target = {resolvedMergeTargetId ?? "-"}
              </div>
              <div className="md:col-span-12">
                <button type="submit" className="btn btn-error">合并实体</button>
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
                会删除 benchmark_values 中该 source 对应的所有记录（不可恢复）。输入 llm-benchmark 会按 text:llm-benchmark 删除。
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(420px,1fr)_auto] md:items-center">
                <input
                  className="input input-bordered w-full"
                  list="delete-source-options"
                  value={deleteSourceInput}
                  onChange={(e) => setDeleteSourceInput(e.target.value)}
                  placeholder="输入 source，例如 llm-benchmark 或 text:llm-benchmark"
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
