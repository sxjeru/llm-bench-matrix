"use client";

import { useEffect, useState, useTransition } from "react";
import {
  History,
  Eye,
  Trash2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  Layers,
  Sparkles
} from "lucide-react";
import { getJson, postJson } from "../api";
import type { ImportBatchPreview, ImportBatchSummary } from "@/lib/import-batch-service";

type ImportBatchDeletionSectionProps = {
  notifySuccess: (message: string, details?: string[]) => void;
  notifyError: (message: string, details?: string[]) => void;
  onRefreshCaches: () => void | Promise<void>;
};

export function ImportBatchDeletionSection({
  notifySuccess,
  notifyError,
  onRefreshCaches
}: ImportBatchDeletionSectionProps) {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("");

  const [preview, setPreview] = useState<ImportBatchPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isModelsExpanded, setIsModelsExpanded] = useState(false);
  const [isBenchmarksExpanded, setIsBenchmarksExpanded] = useState(false);

  async function loadBatches(autoSelectFirst = false) {
    setIsLoadingBatches(true);
    try {
      const res = await getJson("/api/admin/data-maintenance/import-batches?limit=100");
      const list: ImportBatchSummary[] = res?.batches ?? [];
      setBatches(list);

      if (list.length > 0) {
        if (autoSelectFirst || !selectedBatchKey || !list.some((b) => b.batchKey === selectedBatchKey)) {
          setSelectedBatchKey(list[0].batchKey);
        }
      } else {
        setSelectedBatchKey("");
        setPreview(null);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "获取导入批次列表失败");
    } finally {
      setIsLoadingBatches(false);
    }
  }

  useEffect(() => {
    loadBatches(true);
  }, []);

  const selectedBatch = batches.find((b) => b.batchKey === selectedBatchKey) ?? null;

  async function onLoadPreview() {
    if (!selectedBatch) return;

    setIsLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        batchTime: selectedBatch.batchTime,
        sampleLimit: "50"
      });
      if (selectedBatch.source !== null && selectedBatch.source !== undefined) {
        params.set("source", selectedBatch.source);
      }

      const res = await getJson(`/api/admin/data-maintenance/import-batches/preview?${params.toString()}`);
      if (res?.preview) {
        setPreview(res.preview);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "获取批次预览失败");
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function onExecuteDelete() {
    if (!selectedBatch || isDeleting) return;

    setIsDeleting(true);
    try {
      const res = await postJson("/api/admin/data-maintenance/import-batches", {
        batchTime: selectedBatch.batchTime,
        source: selectedBatch.source
      });

      const deletedCount = res?.deleted ?? selectedBatch.recordCount;
      const prunedMetaCount = res?.prunedSourceMeta ?? 0;

      notifySuccess(
        `成功删除 [${selectedBatch.displayTime}] 导入批次共 ${deletedCount} 条数据！${
          prunedMetaCount > 0 ? `（级联清理孤儿 source 元数据 ${prunedMetaCount} 项）` : ""
        }`
      );

      setIsConfirmModalOpen(false);
      setPreview(null);
      await loadBatches(true);
      await onRefreshCaches();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除导入批次数据失败");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mb-5 rounded-box border border-error/40 bg-base-200/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <History className="h-5 w-5 text-error" />
        <h4 className="font-semibold text-error">按导入时间删除（批次清理 / 回滚）</h4>
      </div>
      <p className="mb-3 text-sm opacity-80">
        同一批次导入的数据具有严格一致的入库时间（精确到微秒）。支持在删除前完整预览待删除的数据明细与受影响的模型，删除时将自动级联清理孤儿元数据（source_meta），且前台矩阵将自动平滑回退至上一有效打分版本。
      </p>

      {/* 批次选择与操作区 */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="relative">
            <select
              className="select select-bordered w-full font-mono text-sm"
              value={selectedBatchKey}
              onChange={(e) => {
                setSelectedBatchKey(e.target.value);
                setPreview(null);
              }}
              disabled={isLoadingBatches || batches.length === 0}
            >
              {batches.length === 0 ? (
                <option value="">{isLoadingBatches ? "加载批次中..." : "暂无导入记录"}</option>
              ) : (
                batches.map((batch) => (
                  <option key={batch.batchKey} value={batch.batchKey}>
                    {batch.displayTime} · {batch.sourceLabel} ({batch.recordCount} 条数据 · {batch.modelCount} 模型 · {batch.benchmarkCount} 指标)
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            className="btn btn-outline"
            onClick={() => loadBatches(false)}
            disabled={isLoadingBatches}
            title="刷新导入批次列表"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingBatches ? "animate-spin" : ""}`} />
            刷新批次
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-info gap-1.5"
              onClick={onLoadPreview}
              disabled={!selectedBatch || isLoadingPreview}
            >
              <Eye className="h-4 w-4" />
              {isLoadingPreview ? "解析预览中..." : "预览待删除数据"}
            </button>

            <button
              type="button"
              className="btn btn-outline btn-error gap-1.5"
              onClick={() => setIsConfirmModalOpen(true)}
              disabled={!selectedBatch || isDeleting}
            >
              <Trash2 className="h-4 w-4" />
              删除此批次
            </button>
          </div>
        </div>

        {/* 预览数据展示面板 */}
        {preview ? (
          <div className="mt-4 rounded-xl border border-warning/50 bg-base-100 p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-warning" />
                <span className="font-semibold text-base">待删除批次数据概览</span>
                <span className="badge badge-error badge-sm font-mono font-bold">
                  {preview.totalRecords} 条记录
                </span>
                <span className="badge badge-neutral badge-sm font-mono">
                  {preview.sourceLabel}
                </span>
              </div>
              <span className="text-xs opacity-70 font-mono">
                入库时间: {preview.displayTime}
              </span>
            </div>

            {/* 级联清理与回退预告 */}
            <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-xs leading-relaxed text-warning-content flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
              <div>
                <p className="font-semibold text-sm mb-0.5">级联清理与回滚说明</p>
                <p>
                  本次将删除该批次写入的 <strong>{preview.totalRecords}</strong> 条评测打分。
                  {preview.orphanSourceMetaCount > 0 ? (
                    <span className="text-error font-medium">
                      {" "}检测到其中 {preview.orphanSourceMetaCount} 项 Benchmark 配置在该 source 下已无其它数据残留，将自动级联清理孤儿 source_meta。
                    </span>
                  ) : (
                    " 该批次关联的所有 Benchmark 在此 source 下仍有其它版本数据保留，无需清理 source_meta。"
                  )}
                  {" "}删除后，前台公开评测矩阵将自动平滑回退，展示对应模型在上一历史版本中的有效打分。
                </p>
              </div>
            </div>

            {/* 涉及的模型与指标概览折叠区 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-base-300 p-2.5 bg-base-200/40">
                <div
                  className="flex items-center justify-between cursor-pointer select-none font-medium text-sm mb-1.5"
                  onClick={() => setIsModelsExpanded(!isModelsExpanded)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-primary" />
                    涉及模型 ({preview.modelCount} 个)
                  </span>
                  {isModelsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
                {isModelsExpanded ? (
                  <div className="flex flex-wrap gap-1 mt-2 max-h-36 overflow-y-auto pt-1">
                    {preview.models.map((name) => (
                      <span key={name} className="badge badge-sm badge-outline">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="opacity-70 truncate">
                    {preview.models.slice(0, 5).join("、")}
                    {preview.models.length > 5 ? ` 等共 ${preview.models.length} 个模型` : ""}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-base-300 p-2.5 bg-base-200/40">
                <div
                  className="flex items-center justify-between cursor-pointer select-none font-medium text-sm mb-1.5"
                  onClick={() => setIsBenchmarksExpanded(!isBenchmarksExpanded)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-secondary" />
                    涉及 Benchmark ({preview.benchmarkCount} 个)
                  </span>
                  {isBenchmarksExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
                {isBenchmarksExpanded ? (
                  <div className="flex flex-wrap gap-1 mt-2 max-h-36 overflow-y-auto pt-1">
                    {preview.benchmarks.map((name) => (
                      <span key={name} className="badge badge-sm badge-outline">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="opacity-70 truncate">
                    {preview.benchmarks.slice(0, 5).join("、")}
                    {preview.benchmarks.length > 5 ? ` 等共 ${preview.benchmarks.length} 个基准` : ""}
                  </p>
                )}
              </div>
            </div>

            {/* 待删除数据明细表格预览 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs opacity-80">
                  待删除数据明细抽样（展示前 {preview.sampleRecords.length} / {preview.totalRecords} 条）
                </span>
              </div>
              <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-lg border border-base-300">
                <table className="table table-zebra table-xs w-full">
                  <thead className="bg-base-200 sticky top-0 z-10">
                    <tr>
                      <th className="w-16">ID</th>
                      <th>模型名称</th>
                      <th>Benchmark</th>
                      <th>类别</th>
                      <th>原始打分</th>
                      <th>解析数值</th>
                      <th>评测时间</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRecords.map((item) => (
                      <tr key={item.id}>
                        <td className="font-mono text-opacity-70">{item.id}</td>
                        <td className="font-medium">{item.modelName}</td>
                        <td>{item.benchmarkName}</td>
                        <td>
                          <span className="badge badge-ghost badge-xs">{item.benchmarkType}</span>
                        </td>
                        <td className="font-mono font-medium text-warning">{item.valueRaw}</td>
                        <td className="font-mono">{item.valueNum ?? "-"}</td>
                        <td className="font-mono text-xs opacity-70">
                          {item.benchTime ? item.benchTime.split("T")[0] : "-"}
                        </td>
                        <td className="max-w-[160px] truncate opacity-70" title={item.valueNote ?? ""}>
                          {item.valueNote || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 预览卡片底部操作条 */}
            <div className="flex items-center justify-between pt-2 border-t border-base-200">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPreview(null)}
              >
                收起预览
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm gap-1.5"
                onClick={() => setIsConfirmModalOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                确认删除此批次（共 {preview.totalRecords} 条）
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 确认删除二次确认弹窗 */}
      {isConfirmModalOpen && selectedBatch ? (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg text-error flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              确认删除该导入批次？
            </h3>
            <div className="py-3 text-sm space-y-2 opacity-90">
              <p>
                您即将删除于{" "}
                <span className="font-mono font-bold text-error">{selectedBatch.displayTime}</span> 导入、属于{" "}
                <span className="font-bold">{selectedBatch.sourceLabel}</span> 的全部{" "}
                <span className="font-mono font-bold text-error">{selectedBatch.recordCount}</span> 条评测数据。
              </p>
              <p className="text-xs opacity-75">
                • 系统将自动清理失去引用的孤儿 source 元数据，并重置前台矩阵缓存。
                <br />
                • 该操作不可撤销，请确认是否继续。
              </p>
            </div>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isDeleting}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={onExecuteDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "正在级联删除并刷新缓存..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

