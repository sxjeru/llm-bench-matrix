"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Eye,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Database
} from "lucide-react";
import { getJson, postJson } from "../api";
import type { ImportBatchPreview, ImportBatchSummary } from "@/lib/import-batch-service";

type ImportBatchDeletionSectionProps = {
  notifySuccess: (message: string, details?: string[]) => void;
  notifyError: (message: string, details?: string[]) => void;
  /** silent 为 true 时由本组件负责提示缓存刷新结果；返回 false 表示确定失败 */
  onRefreshCaches: (options?: { silent?: boolean }) => Promise<boolean | void> | boolean | void;
};

export function ImportBatchDeletionSection({
  notifySuccess,
  notifyError,
  onRefreshCaches
}: ImportBatchDeletionSectionProps) {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(true);
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("");

  const [preview, setPreview] = useState<ImportBatchPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const selectedBatchKeyRef = useRef(selectedBatchKey);

  useEffect(() => {
    selectedBatchKeyRef.current = selectedBatchKey;
  }, [selectedBatchKey]);

  useEffect(() => {
    return () => {
      if (previewAbortControllerRef.current) {
        previewAbortControllerRef.current.abort();
        previewAbortControllerRef.current = null;
      }
    };
  }, []);

  async function loadBatches(autoSelectFirst = false) {
    setIsLoadingBatches(true);
    try {
      const res = await getJson("/api/admin/data-maintenance/import-batches?limit=100");
      const list: ImportBatchSummary[] = res?.batches ?? [];
      setBatches(list);

      if (list.length > 0) {
        if (autoSelectFirst || !selectedBatchKey || !list.some((b) => b.batchKey === selectedBatchKey)) {
          if (previewAbortControllerRef.current) {
            previewAbortControllerRef.current.abort();
            previewAbortControllerRef.current = null;
          }
          setIsLoadingPreview(false);
          setSelectedBatchKey(list[0].batchKey);
          setPreview(null);
        }
      } else {
        if (previewAbortControllerRef.current) {
          previewAbortControllerRef.current.abort();
          previewAbortControllerRef.current = null;
        }
        setIsLoadingPreview(false);
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
    let ignore = false;
    async function initBatches() {
      try {
        const res = await getJson("/api/admin/data-maintenance/import-batches?limit=100");
        if (ignore) return;
        const list: ImportBatchSummary[] = res?.batches ?? [];
        setBatches(list);

        if (list.length > 0) {
          setSelectedBatchKey(list[0].batchKey);
        } else {
          setSelectedBatchKey("");
          setPreview(null);
        }
      } catch (error) {
        if (!ignore) {
          notifyError(error instanceof Error ? error.message : "获取导入批次列表失败");
        }
      } finally {
        if (!ignore) {
          setIsLoadingBatches(false);
        }
      }
    }

    void initBatches();
    return () => {
      ignore = true;
    };
  }, [notifyError]);

  const selectedBatch = batches.find((b) => b.batchKey === selectedBatchKey) ?? null;

  async function onLoadPreview() {
    if (!selectedBatch) return;

    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    previewAbortControllerRef.current = abortController;

    const targetBatchKey = selectedBatch.batchKey;
    setIsLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        batchTime: selectedBatch.batchTime,
        sampleLimit: "1000",
        // 显式传入 source 参数（即使为 null/undefined 也传入空字符串），保证未标注来源的批次在预览和删除时使用相同的筛选条件
        source: selectedBatch.source ?? ""
      });

      const res = await getJson(
        `/api/admin/data-maintenance/import-batches/preview?${params.toString()}`,
        { signal: abortController.signal }
      );

      // 只有当该请求未被中止，且当前选中的批次仍然与发起请求时的批次完全一致时才保存预览结果
      if (!abortController.signal.aborted && selectedBatchKeyRef.current === targetBatchKey) {
        if (res?.preview) {
          setPreview(res.preview);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      if (selectedBatchKeyRef.current === targetBatchKey) {
        notifyError(error instanceof Error ? error.message : "获取批次预览失败");
      }
    } finally {
      if (previewAbortControllerRef.current === abortController) {
        setIsLoadingPreview(false);
        previewAbortControllerRef.current = null;
      }
    }
  }

  async function onExecuteDelete() {
    if (!selectedBatch || isDeleting) return;

    const targetBatch = selectedBatch;

    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    setIsLoadingPreview(false);

    setIsDeleting(true);
    try {
      const res = await postJson("/api/admin/data-maintenance/import-batches", {
        batchTime: targetBatch.batchTime,
        source: targetBatch.source
      });

      const deletedCount = res?.deleted ?? targetBatch.recordCount;
      const prunedMetaCount = res?.prunedSourceMeta ?? 0;
      const serverCacheInvalidated = res?.cacheInvalidated !== false;
      const serverWarning = typeof res?.warning === "string" ? res.warning : undefined;

      const notifyDeleted = () => {
        notifySuccess(
          `成功删除 [${targetBatch.displayTime}] 导入批次共 ${deletedCount} 条数据！${
            prunedMetaCount > 0 ? `（级联清理孤儿 source 元数据 ${prunedMetaCount} 项）` : ""
          }`
        );
      };

      setIsConfirmModalOpen(false);
      setPreview(null);

      if (serverCacheInvalidated) {
        notifyDeleted();
        await loadBatches(true);
        await onRefreshCaches();
      } else {
        // 服务端缓存失效失败时，先静默补偿重试，避免出现“先报失败、又自动恢复”的自相矛盾提示
        await loadBatches(true);

        let cacheRecovered = false;
        try {
          cacheRecovered = (await onRefreshCaches({ silent: true })) !== false;
        } catch {
          cacheRecovered = false;
        }

        if (cacheRecovered) {
          notifyDeleted();
        } else {
          const details = [
            serverWarning ?? "服务端缓存失效失败，重试后仍未恢复。",
            "前台公开矩阵可能仍展示已删除的旧数据，请稍后在维护面板手动执行「刷新缓存」。"
          ];
          if (prunedMetaCount > 0) {
            details.unshift(`级联清理孤儿 source 元数据 ${prunedMetaCount} 项`);
          }
          notifyError(`批次数据已删除（${deletedCount} 条），但前台缓存仍未刷新`, details);
        }
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "删除导入批次数据失败");
    } finally {
      setIsDeleting(false);
    }
  }

  // 构建二维矩阵数据映射（Benchmark 为行，Model 为列）
  const { matrixMap, benchmarkTypeMap } = useMemo(() => {
    const cellMap = new Map<string, { valueRaw: string; valueNum: number | null; valueNote: string | null }>();
    const typeMap = new Map<string, string>();

    if (preview?.sampleRecords) {
      for (const item of preview.sampleRecords) {
        cellMap.set(`${item.benchmarkName}:::${item.modelName}`, {
          valueRaw: item.valueRaw,
          valueNum: item.valueNum,
          valueNote: item.valueNote
        });
        if (item.benchmarkType && !typeMap.has(item.benchmarkName)) {
          typeMap.set(item.benchmarkName, item.benchmarkType);
        }
      }
    }

    return { matrixMap: cellMap, benchmarkTypeMap: typeMap };
  }, [preview]);

  return (
    <div className="mb-5 rounded-box border border-error/50 bg-base-200/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <History className="h-5 w-5 text-error" />
        <h4 className="font-semibold text-error">按导入时间删除</h4>
      </div>
      <p className="mb-3 text-sm opacity-80">
        同一批次导入的数据具有严格一致的入库时间。
      </p>

      {/* 批次选择与操作区 */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="relative">
            <select
              className="select select-bordered w-full font-mono text-sm text-base-content bg-base-100"
              value={selectedBatchKey}
              onChange={(e) => {
                const nextKey = e.target.value;
                if (previewAbortControllerRef.current) {
                  previewAbortControllerRef.current.abort();
                  previewAbortControllerRef.current = null;
                }
                setIsLoadingPreview(false);
                setSelectedBatchKey(nextKey);
                setPreview(null);
              }}
              disabled={isLoadingBatches || batches.length === 0 || isDeleting || isConfirmModalOpen}
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
            className="btn btn-outline text-base-content"
            onClick={() => loadBatches(false)}
            disabled={isLoadingBatches || isDeleting || isConfirmModalOpen}
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
              disabled={!selectedBatch || isLoadingPreview || isDeleting || isConfirmModalOpen}
            >
              <Eye className="h-4 w-4" />
              {isLoadingPreview ? "解析预览中..." : "预览待删除数据"}
            </button>

            <button
              type="button"
              className="btn btn-outline btn-error gap-1.5"
              onClick={() => setIsConfirmModalOpen(true)}
              disabled={!selectedBatch || isDeleting || isConfirmModalOpen}
            >
              <Trash2 className="h-4 w-4" />
              删除此批次
            </button>
          </div>
        </div>

        {/* 预览数据展示面板 */}
        {preview && preview.batchKey === selectedBatchKey ? (
          <div className="mt-4 rounded-xl border border-warning/60 bg-base-100 p-4 shadow-sm space-y-4">
            {/* 顶栏信息与高对比度徽章 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 pb-3">
              <div className="flex items-center gap-2.5">
                <Database className="h-5 w-5 text-amber-500 shrink-0" />
                <span className="font-bold text-base text-base-content">待删除批次数据概览</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40">
                  {preview.totalRecords} 条记录
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-base-300 dark:bg-base-200 text-base-content border border-base-content/20">
                  {preview.sourceLabel}
                </span>
              </div>
              <span className="text-xs font-mono font-medium text-base-content/85">
                入库时间: {preview.displayTime}
              </span>
            </div>

            {/* 高对比度级联清理与回退预告 */}
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/15 p-3 text-xs leading-relaxed text-amber-950 dark:text-amber-100 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-sm text-amber-900 dark:text-amber-200">级联清理与回滚说明</p>
                <p className="text-amber-950/90 dark:text-amber-100/90 leading-relaxed">
                  本次将删除该批次写入的{" "}
                  <strong className="font-bold text-amber-950 dark:text-white underline decoration-amber-500/60 underline-offset-2">
                    {preview.totalRecords}
                  </strong>{" "}
                  条评测打分。
                  {preview.orphanSourceMetaCount > 0 ? (
                    <span className="text-rose-700 dark:text-rose-300 font-semibold">
                      {" "}检测到其中 {preview.orphanSourceMetaCount} 项 Benchmark 配置在该 source 下已无其它数据残留，将自动级联清理孤儿 source_meta。
                    </span>
                  ) : (
                    " 该批次关联的所有 Benchmark 在此 source 下仍有其它版本数据保留，无需清理 source_meta。"
                  )}
                  {" "}删除后，前台公开评测矩阵将自动平滑回退，展示对应模型在上一历史版本中的有效打分。
                </p>
              </div>
            </div>

            {/* 二维数据矩阵表格（Model 为列，Benchmark 为行） */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-xs text-base-content/85">
                  待删除数据矩阵预览（Model 为列，Benchmark 为行）
                </span>
                <span className="text-xs text-base-content/75 font-mono">
                  共 <strong className="text-base-content">{preview.benchmarks.length}</strong> 行 Benchmark ×{" "}
                  <strong className="text-base-content">{preview.models.length}</strong> 列 Model
                </span>
              </div>

              <div className="overflow-x-auto overflow-y-auto max-h-[460px] rounded-lg border border-base-300 dark:border-base-content/20 bg-base-100 shadow-inner">
                <table className="table table-xs border-separate border-spacing-0 w-full">
                  <thead>
                    <tr>
                      <th className="sticky top-0 left-0 z-30 bg-base-200 dark:bg-base-300 font-bold border-b border-r border-base-300 dark:border-base-content/20 p-2 min-w-[200px] text-base-content">
                        <div className="flex items-center justify-between gap-1">
                          <span>Benchmark</span>
                          <span className="text-[11px] font-normal text-base-content/60">
                            ({preview.benchmarks.length})
                          </span>
                        </div>
                      </th>
                      {preview.models.map((modelName) => (
                        <th
                          key={modelName}
                          className="sticky top-0 z-20 bg-base-200 dark:bg-base-300 font-semibold text-center border-b border-r border-base-300 dark:border-base-content/20 p-2 min-w-[120px] max-w-[200px] text-base-content"
                          title={modelName}
                        >
                          <span className="block truncate text-xs">{modelName}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.benchmarks.map((benchmarkName) => {
                      const type = benchmarkTypeMap.get(benchmarkName);
                      return (
                        <tr key={benchmarkName} className="hover:bg-base-200/50 transition-colors">
                          <th className="sticky left-0 z-10 bg-base-100 dark:bg-base-200 font-medium border-b border-r border-base-300 dark:border-base-content/20 p-2 text-base-content min-w-[200px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-xs truncate max-w-[170px]" title={benchmarkName}>
                                {benchmarkName}
                              </span>
                              {type ? (
                                <span className="badge badge-ghost badge-xs shrink-0 font-normal text-base-content/75 border border-base-content/15">
                                  {type}
                                </span>
                              ) : null}
                            </div>
                          </th>
                          {preview.models.map((modelName) => {
                            const cell = matrixMap.get(`${benchmarkName}:::${modelName}`);
                            return (
                              <td
                                key={`${benchmarkName}:::${modelName}`}
                                className="border-b border-r border-base-300/80 dark:border-base-content/10 p-2 text-center font-mono text-xs text-base-content"
                              >
                                {cell ? (
                                  <span
                                    className="inline-block px-1.5 py-0.5 rounded font-medium text-amber-600 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/20 hover:bg-amber-500/30 transition-colors cursor-default"
                                    title={
                                      cell.valueNote
                                        ? `打分: ${cell.valueRaw}\n注释: ${cell.valueNote}`
                                        : `打分: ${cell.valueRaw}`
                                    }
                                  >
                                    {cell.valueRaw}
                                  </span>
                                ) : (
                                  <span className="text-base-content/25 select-none">-</span>
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

            {/* 预览卡片底部操作条 */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-base-200 dark:border-base-content/10">
              <div className="text-xs text-base-content/70">
                提示：悬浮单元格可查看详细打分及导入注释。
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-base-content"
                  onClick={() => setPreview(null)}
                >
                  收起预览
                </button>
                <button
                  type="button"
                  className="btn btn-error btn-sm gap-1.5 shadow-sm text-white dark:text-base-content"
                  onClick={() => setIsConfirmModalOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  确认删除此批次（共 {preview.totalRecords} 条）
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 确认删除二次确认弹窗 */}
      {isConfirmModalOpen && selectedBatch ? (
        <div className="modal modal-open">
          <div className="modal-box border border-error/30 bg-base-100 text-base-content">
            <h3 className="font-bold text-lg text-error flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              确认删除该导入批次？
            </h3>
            <div className="py-3 text-sm space-y-2 text-base-content/90">
              <p>
                您即将删除于{" "}
                <span className="font-mono font-bold text-error">{selectedBatch.displayTime}</span> 导入、属于{" "}
                <span className="font-bold text-base-content">{selectedBatch.sourceLabel}</span> 的全部{" "}
                <span className="font-mono font-bold text-error">{selectedBatch.recordCount}</span> 条评测数据。
              </p>
              <p className="text-xs text-base-content/70 leading-relaxed">
                • 系统将自动清理失去引用的孤儿 source 元数据，并重置前台矩阵缓存。
                <br />
                • 该操作不可撤销，请确认是否继续。
              </p>
            </div>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost text-base-content"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isDeleting}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-error text-white dark:text-base-content"
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
