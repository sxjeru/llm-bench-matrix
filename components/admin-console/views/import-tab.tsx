"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, Dispatch, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, ShieldAlert, Table2, Upload } from "lucide-react";
import { MODALITY_OPTIONS } from "../constants";
import type {
  BenchmarkOption,
  BenchmarkPreviewValueOverlapStats,
  BenchmarkWarningItem,
  ImportWarning,
  MatrixPreviewRow,
  ModelWarningItem,
  PreviewRow,
  StructuredCsvImportRow,
  TextImportPreviewRow
} from "../types";
import { buildBenchmarkCompareKey, getOmniDocBenchNormalizeHint } from "../utils/benchmark";
import { toDomSafeId } from "../utils/dom";
import { formatPreviewNumericValue } from "../utils/import-values";
import { parseExplicitMergeEntityId } from "../utils/merge";
import { normalizeModalityList, normalizeModalityName } from "../utils/modality";
import { ModalityBadge } from "./shared/modality-badge";

type EntityOption = { id: number; label: string };

type PairValueRow = {
  rowIndex: number;
  benchmarkKey: string;
  benchmarkName: string;
  benchmarkType: string;
  modelName: string;
  first: string;
  second: string;
  note: string | null;
};

type StarValueRow = {
  rowIndex: number;
  benchmarkName: string;
  modelName: string;
  value: string;
  supplement: string;
};

type BenchmarkParenthesesItem = {
  key: string;
  benchmarkName: string;
  benchmarkType: string;
};

type BenchmarkCandidateOption = {
  targetId: number;
  label: string;
};

type FloatingPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

type MatrixBenchmarkCandidateFieldProps = {
  matrixRowKey: string;
  benchmarkName: string;
  inputValue: string;
  candidateOptions: BenchmarkCandidateOption[];
  isOpen: boolean;
  setOpenMatrixBenchmarkCandidateFor: Dispatch<SetStateAction<string | null>>;
  applyBenchmarkOverwriteByTargetId: (previewBenchmarkKey: string, targetId: number) => boolean;
  onMatrixBenchmarkNameInputChange: (previewBenchmarkKey: string, nextValue: string) => void;
  onMatrixBenchmarkNameInputBlur: (previewBenchmarkKey: string, originalName: string, nextValue: string) => void;
  benchmarkPreviewValueOverlapStatsMap: Map<string, BenchmarkPreviewValueOverlapStats>;
  getBenchmarkPreviewValueOverlapStatsKey: (previewBenchmarkKey: string, candidateBenchmarkId: number) => string;
  benchmarkPreviewValueOverlapState: {
    key: string;
    status: "idle" | "loading" | "success" | "error";
    stats: BenchmarkPreviewValueOverlapStats[];
  };
  benchmarkPreviewValueOverlapPayload: {
    key: string;
  };
  getBenchmarkPreviewValueOverlapBadgeClass: (stats: BenchmarkPreviewValueOverlapStats) => string;
  formatBenchmarkPreviewValueOverlapStats: (stats: BenchmarkPreviewValueOverlapStats) => string;
};

function MatrixBenchmarkCandidateField({
  matrixRowKey,
  benchmarkName,
  inputValue,
  candidateOptions,
  isOpen,
  setOpenMatrixBenchmarkCandidateFor,
  applyBenchmarkOverwriteByTargetId,
  onMatrixBenchmarkNameInputChange,
  onMatrixBenchmarkNameInputBlur,
  benchmarkPreviewValueOverlapStatsMap,
  getBenchmarkPreviewValueOverlapStatsKey,
  benchmarkPreviewValueOverlapState,
  benchmarkPreviewValueOverlapPayload,
  getBenchmarkPreviewValueOverlapBadgeClass,
  formatBenchmarkPreviewValueOverlapStats
}: MatrixBenchmarkCandidateFieldProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    setPosition({
      left: rect.left,
      top: rect.top - 4,
      width: rect.width,
      maxHeight: Math.min(240, Math.max(120, rect.top - 12))
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const dropdown =
    isOpen && position && typeof document !== "undefined"
      ? createPortal(
          <div
            role="listbox"
            data-matrix-benchmark-candidate-container="true"
            className="fixed z-[9999] overflow-auto rounded-md border border-base-300 bg-base-100/95 p-1 shadow-xl backdrop-blur"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
              transform: "translateY(-100%)"
            }}
          >
            {candidateOptions.map((option) => {
              const overlapStats = benchmarkPreviewValueOverlapStatsMap.get(
                getBenchmarkPreviewValueOverlapStatsKey(matrixRowKey, option.targetId)
              );
              const isLoadingOverlapStats =
                benchmarkPreviewValueOverlapState.key === benchmarkPreviewValueOverlapPayload.key
                && benchmarkPreviewValueOverlapState.status === "loading";

              return (
                <div
                  key={`matrix-benchmark-override-option-${matrixRowKey}-${option.targetId}`}
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
                  className="cursor-pointer rounded-sm px-2 py-1 text-left text-xs leading-5 text-base-content hover:bg-base-200/90"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyBenchmarkOverwriteByTargetId(matrixRowKey, option.targetId);
                    setOpenMatrixBenchmarkCandidateFor(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }
                    event.preventDefault();
                    applyBenchmarkOverwriteByTargetId(matrixRowKey, option.targetId);
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
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={anchorRef} className="relative" data-matrix-benchmark-candidate-container="true">
      <input
        className="input input-bordered input-xs w-full"
        value={inputValue}
        onFocus={() => {
          if (candidateOptions.length > 0) {
            setOpenMatrixBenchmarkCandidateFor(matrixRowKey);
          }
        }}
        onChange={(e) => {
          const nextInput = e.target.value;
          const parsedTargetId = parseExplicitMergeEntityId(nextInput);
          if (parsedTargetId !== null && applyBenchmarkOverwriteByTargetId(matrixRowKey, parsedTargetId)) {
            setOpenMatrixBenchmarkCandidateFor(null);
            return;
          }
          onMatrixBenchmarkNameInputChange(matrixRowKey, nextInput);
          setOpenMatrixBenchmarkCandidateFor(matrixRowKey);
        }}
        onBlur={(e) => {
          onMatrixBenchmarkNameInputBlur(
            matrixRowKey,
            benchmarkName,
            e.target.value
          );
          setOpenMatrixBenchmarkCandidateFor((current) =>
            current === matrixRowKey ? null : current
          );
        }}
      />
      {dropdown}
    </div>
  );
}

type ImportTabProps = {
  onPreviewWorkbook: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  setWorkbookFile: Dispatch<SetStateAction<File | null>>;
  setSheetPickerOpen: Dispatch<SetStateAction<boolean>>;
  sheetNames: string[];
  previewMeta: {
    benchmarkColumn: string;
    categoryColumn: string | null;
    parsedCount: number;
    warningCount: number;
  } | null;
  selectedSheet: string;
  allowWarningsImport: boolean;
  setAllowWarningsImport: Dispatch<SetStateAction<boolean>>;
  onImportWorkbook: () => void | Promise<void>;
  isImportingWorkbook: boolean;
  importStatus: "idle" | "running" | "success" | "error";
  importProgress: number;
  importStatusText: string;
  previewWarnings: ImportWarning[];
  previewRows: PreviewRow[];
  onImportCsv: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  csvSource: string;
  setCsvSource: Dispatch<SetStateAction<string>>;
  csvText: string;
  setCsvText: Dispatch<SetStateAction<string>>;
  setCsvHtmlText: Dispatch<SetStateAction<string>>;
  setHasParsedHtmlTable: Dispatch<SetStateAction<boolean>>;
  onCsvTextPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onPreviewCsvImport: () => void | Promise<void>;
  isPreviewingTextImport: boolean;
  isImportingTextCsv: boolean;
  hasParsedHtmlTable: boolean;
  textImportStatus: "idle" | "running" | "success" | "error";
  textImportProgress: number;
  textImportStatusText: string;
  textImportPreviewMeta: {
    format: string;
    total: number;
    skipped: number;
  } | null;
  textImportDraftRows: TextImportPreviewRow[];
  finalizedTextImportRows: StructuredCsvImportRow[];
  ignoredTextImportCount: number;
  pairValueRows: PairValueRow[];
  pairRowsMissingNoteCount: number;
  onUpdateTextImportDraftNote: (rowIndex: number, valueNote: string) => void;
  onPairNoteInputBlur: (rowIndex: number, benchmarkKey: string, valueNote: string) => void;
  pairNoteHistory: string[];
  starValueRows: StarValueRow[];
  starRowsMissingSupplementCount: number;
  globalStarSupplement: string;
  setGlobalStarSupplement: Dispatch<SetStateAction<string>>;
  onApplyGlobalStarSupplement: () => void;
  onUpdateTextImportDraftStarSupplement: (rowIndex: number, supplement: string) => void;
  onStarSupplementInputBlur: (rowIndex: number, supplement: string) => void;
  starNoteHistory: string[];
  matrixPreview: {
    modelNames: string[];
    rows: MatrixPreviewRow[];
  };
  matrixPreviewHeaderCounts: {
    benchmarkUniqueCount: number;
    typeUniqueCount: number;
  };
  modelWarningMap: Map<string, ModelWarningItem>;
  modelWarningSet: Set<string>;
  matrixModelNameDrafts: Record<string, string>;
  applyModelOverwriteByTargetId: (modelName: string, targetId: number) => boolean;
  onMatrixModelNameInputChange: (modelName: string, nextModelName: string) => void;
  onMatrixModelNameInputBlur: (modelName: string, inputValue: string) => void;
  modelEntityOptions: EntityOption[];
  benchmarkWarningMap: Map<string, BenchmarkWarningItem>;
  benchmarkMergeCandidateMap: Map<string, number[]>;
  benchmarkParenthesesSet: Set<string>;
  benchmarkEntityOptions: EntityOption[];
  matrixBenchmarkNameDrafts: Record<string, string>;
  setOpenMatrixBenchmarkCandidateFor: Dispatch<SetStateAction<string | null>>;
  openMatrixBenchmarkCandidateFor: string | null;
  applyBenchmarkOverwriteByTargetId: (benchmarkKey: string, targetId: number) => boolean;
  onMatrixBenchmarkNameInputChange: (benchmarkKey: string, nextBenchmarkName: string) => void;
  onMatrixBenchmarkNameInputBlur: (benchmarkKey: string, currentBenchmarkName: string, inputValue: string) => void;
  benchmarkPreviewValueOverlapStatsMap: Map<string, BenchmarkPreviewValueOverlapStats>;
  getBenchmarkPreviewValueOverlapStatsKey: (previewBenchmarkKey: string, candidateBenchmarkId: number) => string;
  benchmarkPreviewValueOverlapState: {
    key: string;
    status: "idle" | "loading" | "success" | "error";
    stats: BenchmarkPreviewValueOverlapStats[];
  };
  benchmarkPreviewValueOverlapPayload: {
    key: string;
  };
  getBenchmarkPreviewValueOverlapBadgeClass: (stats: BenchmarkPreviewValueOverlapStats) => string;
  formatBenchmarkPreviewValueOverlapStats: (stats: BenchmarkPreviewValueOverlapStats) => string;
  matrixBenchmarkTypeDrafts: Record<string, string>;
  onMatrixBenchmarkTypeInputChange: (benchmarkKey: string, nextBenchmarkType: string) => void;
  onMatrixBenchmarkTypeInputBlur: (benchmarkKey: string, currentBenchmarkType: string, inputValue: string) => void;
  onToggleMatrixBenchmarkLowerIsBetter: (benchmarkKey: string, checkedLowerIsBetter: boolean) => void;
  onToggleMatrixBenchmarkModality: (benchmarkKey: string, modality: string, checked: boolean) => void;
  onUpdateTextImportDraftValue: (rowIndex: number, rawValue: string) => void;
  benchmarkWarnings: BenchmarkWarningItem[];
  benchmarkMergeFilters: Record<string, string>;
  setBenchmarkMergeFilters: Dispatch<SetStateAction<Record<string, string>>>;
  setBenchmarkMergeTargets: Dispatch<SetStateAction<Record<string, string>>>;
  ignoredBenchmarkKeys: Record<string, boolean>;
  setIgnoredBenchmarkKeys: Dispatch<SetStateAction<Record<string, boolean>>>;
  benchmarksWithParentheses: BenchmarkParenthesesItem[];
  parenthesesModes: Record<string, "keep" | "remove" | "custom">;
  setParenthesesModes: Dispatch<SetStateAction<Record<string, "keep" | "remove" | "custom">>>;
  parenthesesCustomNames: Record<string, string>;
  setParenthesesCustomNames: Dispatch<SetStateAction<Record<string, string>>>;
  modelWarnings: ModelWarningItem[];
  modelMergeFilters: Record<string, string>;
  setModelMergeFilters: Dispatch<SetStateAction<Record<string, string>>>;
  setModelMergeTargets: Dispatch<SetStateAction<Record<string, string>>>;
  modelsWithParentheses: string[];
  modelParenthesesModes: Record<string, "keep" | "remove" | "custom">;
  setModelParenthesesModes: Dispatch<SetStateAction<Record<string, "keep" | "remove" | "custom">>>;
  modelParenthesesCustomNames: Record<string, string>;
  setModelParenthesesCustomNames: Dispatch<SetStateAction<Record<string, string>>>;
  textImportPreviewTableRows: TextImportPreviewRow[];
  visibleResolvedTextImportPreviewRows: TextImportPreviewRow[];
  setTextImportPreviewVisibleCount: Dispatch<SetStateAction<number>>;
  textImportPreviewVisibleCount: number;
  benchmarks: BenchmarkOption[];
};

export function ImportTab({
  onPreviewWorkbook,
  setWorkbookFile,
  setSheetPickerOpen,
  sheetNames,
  previewMeta,
  selectedSheet,
  allowWarningsImport,
  setAllowWarningsImport,
  onImportWorkbook,
  isImportingWorkbook,
  importStatus,
  importProgress,
  importStatusText,
  previewWarnings,
  previewRows,
  onImportCsv,
  csvSource,
  setCsvSource,
  csvText,
  setCsvText,
  setCsvHtmlText,
  setHasParsedHtmlTable,
  onCsvTextPaste,
  onPreviewCsvImport,
  isPreviewingTextImport,
  isImportingTextCsv,
  hasParsedHtmlTable,
  textImportStatus,
  textImportProgress,
  textImportStatusText,
  textImportPreviewMeta,
  textImportDraftRows,
  finalizedTextImportRows,
  ignoredTextImportCount,
  pairValueRows,
  pairRowsMissingNoteCount,
  onUpdateTextImportDraftNote,
  onPairNoteInputBlur,
  pairNoteHistory,
  starValueRows,
  starRowsMissingSupplementCount,
  globalStarSupplement,
  setGlobalStarSupplement,
  onApplyGlobalStarSupplement,
  onUpdateTextImportDraftStarSupplement,
  onStarSupplementInputBlur,
  starNoteHistory,
  matrixPreview,
  matrixPreviewHeaderCounts,
  modelWarningMap,
  modelWarningSet,
  matrixModelNameDrafts,
  applyModelOverwriteByTargetId,
  onMatrixModelNameInputChange,
  onMatrixModelNameInputBlur,
  modelEntityOptions,
  benchmarkWarningMap,
  benchmarkMergeCandidateMap,
  benchmarkParenthesesSet,
  benchmarkEntityOptions,
  matrixBenchmarkNameDrafts,
  setOpenMatrixBenchmarkCandidateFor,
  openMatrixBenchmarkCandidateFor,
  applyBenchmarkOverwriteByTargetId,
  onMatrixBenchmarkNameInputChange,
  onMatrixBenchmarkNameInputBlur,
  benchmarkPreviewValueOverlapStatsMap,
  getBenchmarkPreviewValueOverlapStatsKey,
  benchmarkPreviewValueOverlapState,
  benchmarkPreviewValueOverlapPayload,
  getBenchmarkPreviewValueOverlapBadgeClass,
  formatBenchmarkPreviewValueOverlapStats,
  matrixBenchmarkTypeDrafts,
  onMatrixBenchmarkTypeInputChange,
  onMatrixBenchmarkTypeInputBlur,
  onToggleMatrixBenchmarkLowerIsBetter,
  onToggleMatrixBenchmarkModality,
  onUpdateTextImportDraftValue,
  benchmarkWarnings,
  benchmarkMergeFilters,
  setBenchmarkMergeFilters,
  setBenchmarkMergeTargets,
  ignoredBenchmarkKeys,
  setIgnoredBenchmarkKeys,
  benchmarksWithParentheses,
  parenthesesModes,
  setParenthesesModes,
  parenthesesCustomNames,
  setParenthesesCustomNames,
  modelWarnings,
  modelMergeFilters,
  setModelMergeFilters,
  setModelMergeTargets,
  modelsWithParentheses,
  modelParenthesesModes,
  setModelParenthesesModes,
  modelParenthesesCustomNames,
  setModelParenthesesCustomNames,
  textImportPreviewTableRows,
  visibleResolvedTextImportPreviewRows,
  setTextImportPreviewVisibleCount,
  benchmarks
}: ImportTabProps) {
  function renderModalityBadge(modalityInput: string, key: string) {
    return <ModalityBadge key={key} modalityInput={modalityInput} />;
  }

  function getBenchmarkSearchCandidateIds(inputValue: string, benchmarkType: string) {
    const normalizedInput = inputValue.trim().toLowerCase();
    const inputCompareKey = buildBenchmarkCompareKey(inputValue);
    if (!normalizedInput && !inputCompareKey) return [];

    return benchmarks
      .map((item, index) => {
        const nameLower = item.benchmarkName.toLowerCase();
        const typeLower = item.benchmarkType.toLowerCase();
        const labelLower = `${item.benchmarkName} [${item.benchmarkType}]`.toLowerCase();
        const compareKey = buildBenchmarkCompareKey(item.benchmarkName);
        let score = 0;

        if (nameLower === normalizedInput && item.benchmarkType === benchmarkType) {
          score += 100;
        } else if (nameLower === normalizedInput) {
          score += 90;
        }

        if (compareKey && inputCompareKey && compareKey === inputCompareKey) {
          score += 80;
        }

        if (normalizedInput && labelLower.includes(normalizedInput)) {
          score += 50;
        }

        if (normalizedInput && (nameLower.includes(normalizedInput) || typeLower.includes(normalizedInput))) {
          score += 40;
        }

        if (compareKey && inputCompareKey && (compareKey.includes(inputCompareKey) || inputCompareKey.includes(compareKey))) {
          score += 30;
        }

        if (item.benchmarkType === benchmarkType) {
          score += 10;
        }

        return score > 0 ? { id: item.id, score, index } : null;
      })
      .filter((item): item is { id: number; score: number; index: number } => item !== null)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 30)
      .map((item) => item.id);
  }

  return (
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
            <div className="max-h-[420px] overflow-auto rounded-box border border-base-300">
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
                              const benchmarkInputValue = matrixBenchmarkNameDrafts[matrixRow.key] ?? matrixRow.benchmarkName;
                              const benchmarkCandidateTargetIds = Array.from(new Set([
                                ...(benchmarkMergeCandidateMap.get(matrixRow.key) ?? []),
                                ...(warning?.candidateTargetIds ?? []),
                                ...(warning?.suggestedTargetId ? [warning.suggestedTargetId] : []),
                                ...getBenchmarkSearchCandidateIds(benchmarkInputValue, matrixRow.benchmarkType)
                              ])).slice(0, 30);
                              const benchmarkCandidateOptions = benchmarkCandidateTargetIds.map((targetId) => {
                                const target = benchmarkEntityOptions.find((item) => String(item.id) === String(targetId));
                                return {
                                  targetId,
                                  label: target?.label ?? `#${targetId}`
                                };
                              });

                              return (
                                <>
                                  <MatrixBenchmarkCandidateField
                                    matrixRowKey={matrixRow.key}
                                    benchmarkName={matrixRow.benchmarkName}
                                    inputValue={benchmarkInputValue}
                                    candidateOptions={benchmarkCandidateOptions}
                                    isOpen={benchmarkCandidateOptions.length > 0 && openMatrixBenchmarkCandidateFor === matrixRow.key}
                                    setOpenMatrixBenchmarkCandidateFor={setOpenMatrixBenchmarkCandidateFor}
                                    applyBenchmarkOverwriteByTargetId={applyBenchmarkOverwriteByTargetId}
                                    onMatrixBenchmarkNameInputChange={onMatrixBenchmarkNameInputChange}
                                    onMatrixBenchmarkNameInputBlur={onMatrixBenchmarkNameInputBlur}
                                    benchmarkPreviewValueOverlapStatsMap={benchmarkPreviewValueOverlapStatsMap}
                                    getBenchmarkPreviewValueOverlapStatsKey={getBenchmarkPreviewValueOverlapStatsKey}
                                    benchmarkPreviewValueOverlapState={benchmarkPreviewValueOverlapState}
                                    benchmarkPreviewValueOverlapPayload={benchmarkPreviewValueOverlapPayload}
                                    getBenchmarkPreviewValueOverlapBadgeClass={getBenchmarkPreviewValueOverlapBadgeClass}
                                    formatBenchmarkPreviewValueOverlapStats={formatBenchmarkPreviewValueOverlapStats}
                                  />
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
  );
}
