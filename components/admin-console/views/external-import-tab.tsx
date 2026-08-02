"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import { Cloud, Download, Eye, RefreshCw, RotateCcw, Save } from "lucide-react";
import type {
  ExternalImportSnapshot,
  ExternalImportSummary,
  ExternalMappingDraft,
  ExternalMappingRow,
  ExternalMetricCatalogEntry,
  ExternalMetricOverride
} from "../types";
import { isMappingDraftDirty } from "../hooks/use-external-import";

/** 与 lib/external-providers/reasoning-effort.ts 的档位保持一致 */
const REASONING_EFFORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "未指定" },
  { value: "nonthinking", label: "关闭推理" },
  { value: "minimal", label: "minimal" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "thinking", label: "开启推理（未分档）" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" }
];

const MATCH_REASON_LABELS: Record<string, string> = {
  "source-model-id": "source_model_id 精确命中",
  "effort-exact": "同族且推理强度一致",
  "highest-effort-default": "本地未标强度，默认取上游最高档",
  "effort-fallback": "同族但强度档位就近回退",
  "fuzzy-model-name": "名称模糊匹配",
  "no-match": "未找到候选",
  "empty-model-name": "模型名为空",
  manual: "人工绑定",
  "created-from-upstream": "由上游条目创建"
};

type ExternalImportTabProps = {
  snapshot: ExternalImportSnapshot | null;
  loading: boolean;
  savingMappings: boolean;
  savingConfig: boolean;
  previewing: boolean;
  importing: boolean;
  summary: ExternalImportSummary | null;
  mappingDrafts: Record<number, ExternalMappingDraft>;
  selectedMetrics: string[];
  metricOverrides: Record<string, ExternalMetricOverride>;
  createExternalModelIds: string[];
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  statusFilter: "all" | "matched" | "unmatched" | "manual" | "ignored";
  setStatusFilter: Dispatch<SetStateAction<"all" | "matched" | "unmatched" | "manual" | "ignored">>;
  dirtyMappingCount: number;
  configDirty: boolean;
  onLoadSnapshot: (forceRefresh?: boolean) => void | Promise<void>;
  onUpdateMappingDraft: (modelId: number, updater: (draft: ExternalMappingDraft) => ExternalMappingDraft) => void;
  onDiscardMappingDrafts: () => void;
  onToggleMetric: (key: string) => void;
  onSetAllMetrics: (keys: string[]) => void;
  onUpdateMetricOverride: (key: string, patch: ExternalMetricOverride) => void;
  onToggleCreateModel: (externalModelId: string) => void;
  onSaveMappings: () => void | Promise<void>;
  onSaveConfig: () => void | Promise<void>;
  onPreviewImport: () => void | Promise<void>;
  onRunImport: () => void | Promise<void>;
};

function getStatusBadgeClass(status: ExternalMappingRow["matchStatus"], manualOverride: boolean) {
  if (manualOverride || status === "manual") return "border-amber-400 text-amber-200";
  if (status === "matched") return "border-green-500 text-green-300";
  if (status === "ignored") return "border-base-content/30 text-base-content/60";
  return "border-red-500 text-red-300";
}

function getStatusLabel(status: ExternalMappingRow["matchStatus"], manualOverride: boolean) {
  if (manualOverride || status === "manual") return "手动";
  if (status === "matched") return "已匹配";
  if (status === "ignored") return "忽略";
  return "未匹配";
}

function formatSampleValue(entry: ExternalMetricCatalogEntry) {
  if (entry.sampleValues.length === 0) return "--";
  const scale = entry.valueScale === "fraction" ? 100 : 1;
  return entry.sampleValues
    .map((value) => String(Math.round(value * scale * 1000) / 1000))
    .join(" / ");
}

export function ExternalImportTab({
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
  onLoadSnapshot,
  onUpdateMappingDraft,
  onDiscardMappingDrafts,
  onToggleMetric,
  onSetAllMetrics,
  onUpdateMetricOverride,
  onToggleCreateModel,
  onSaveMappings,
  onSaveConfig,
  onPreviewImport,
  onRunImport
}: ExternalImportTabProps) {
  const busy = loading || savingMappings || savingConfig || previewing || importing;
  const apiKeyMissing = snapshot !== null && !snapshot.apiKeyConfigured;

  const conflictModelIds = useMemo(
    () => new Set((snapshot?.conflicts ?? []).flatMap((conflict) => conflict.modelIds)),
    [snapshot]
  );

  const filteredMappings = useMemo(() => {
    if (!snapshot) return [];
    const query = searchQuery.trim().toLowerCase();

    return snapshot.mappings.filter((row) => {
      const draft = mappingDrafts[row.modelId];
      const effectiveStatus = draft?.ignored ? "ignored" : row.matchStatus;

      const matchesQuery =
        !query ||
        row.modelName.toLowerCase().includes(query) ||
        row.providerName.toLowerCase().includes(query) ||
        (row.externalModelName ?? "").toLowerCase().includes(query);
      if (!matchesQuery) return false;

      if (statusFilter === "all") return true;
      if (statusFilter === "manual") return draft?.manualOverride || row.manualOverride;
      return effectiveStatus === statusFilter;
    });
  }, [snapshot, mappingDrafts, searchQuery, statusFilter]);

  const matchedCount = snapshot?.mappings.filter(
    (row) => row.matchStatus === "matched" || row.matchStatus === "manual"
  ).length ?? 0;
  const unmatchedCount = snapshot?.mappings.filter((row) => row.matchStatus === "unmatched").length ?? 0;
  const highestEffortDefaultCount =
    snapshot?.mappings.filter((row) => row.matchReason === "highest-effort-default").length ?? 0;

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Cloud size={18} />
          外部数据源
        </h3>
        <select className="select select-bordered select-sm" value="artificial-analysis" disabled>
          <option value="artificial-analysis">Artificial Analysis</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirtyMappingCount > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onDiscardMappingDrafts}
              disabled={busy}
              title="放弃所有未保存的匹配改动"
            >
              <RotateCcw size={14} />
              撤销修改
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn-sm ${dirtyMappingCount > 0 ? "btn-warning" : "btn-outline"}`}
            onClick={onSaveMappings}
            disabled={busy || dirtyMappingCount === 0}
          >
            {savingMappings ? <span className="loading loading-spinner loading-xs" /> : <Save size={14} />}
            保存匹配{dirtyMappingCount > 0 ? `（${dirtyMappingCount}）` : ""}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${configDirty ? "btn-warning" : "btn-outline"}`}
            onClick={onSaveConfig}
            disabled={busy}
          >
            {savingConfig ? <span className="loading loading-spinner loading-xs" /> : <Save size={14} />}
            保存数据项
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => onLoadSnapshot(true)}
            disabled={busy}
          >
            {loading ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw size={14} />}
            拉取上游
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onPreviewImport} disabled={busy || apiKeyMissing}>
            {previewing ? <span className="loading loading-spinner loading-xs" /> : <Eye size={14} />}
            预览导入
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onRunImport} disabled={busy || apiKeyMissing}>
            {importing ? <span className="loading loading-spinner loading-xs" /> : <Download size={14} />}
            执行导入
          </button>
        </div>
      </div>

      {apiKeyMissing ? (
        <div className="alert alert-warning mb-4 text-sm">
          <span>
            未配置 <code>ARTIFICIAL_ANALYSIS_API_KEY</code>，无法拉取数据。请在环境变量中配置后重启服务。
            API key 可在 <span className="font-mono">artificialanalysis.ai</span> 的 Insights Platform 中生成。
          </span>
        </div>
      ) : null}

      {snapshot && snapshot.conflicts.length > 0 ? (
        <div className="alert alert-error mb-4 text-sm">
          <span>
            有 {snapshot.conflicts.length} 个上游条目被多个本地模型同时绑定，导入前需要先手动改绑：
            {snapshot.conflicts.slice(0, 5).map((conflict) => ` ${conflict.externalModelName}`).join("；")}
          </span>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">已匹配模型</div>
            <div className="stat-value text-xl">{matchedCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">未匹配模型</div>
            <div className="stat-value text-xl">{unmatchedCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">默认取最高强度</div>
            <div className="stat-value text-xl">{highestEffortDefaultCount}</div>
          </div>
        </div>
        <div className="stats rounded-box border border-base-300 bg-base-200/40">
          <div className="stat py-3">
            <div className="stat-title text-xs">上游拉取时间</div>
            <div className="stat-value text-sm">
              {snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "--"}
            </div>
          </div>
        </div>
      </div>

      {/* --- 数据项选择 --- */}
      <div className="mb-5 rounded-2xl border border-base-300/70 bg-base-200/30 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="text-base font-semibold">可导入数据项</h4>
          <span className="text-xs opacity-70">每一项会作为一个独立 benchmark 写入</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onSetAllMetrics((snapshot?.catalog ?? []).map((entry) => entry.key))}
              disabled={busy || !snapshot}
            >
              全选
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onSetAllMetrics([])} disabled={busy}>
              清空
            </button>
          </div>
        </div>

        {!snapshot || snapshot.catalog.length === 0 ? (
          <div className="rounded-xl border border-base-300/70 bg-base-100/60 px-4 py-6 text-sm opacity-70">
            {loading ? "正在拉取上游数据…" : "点击「拉取上游」后在这里选择要导入的数据项。"}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-box border border-base-300">
            <table className="table table-zebra table-sm min-w-[980px]">
              <thead>
                <tr>
                  <th className="w-10" />
                  <th>上游字段</th>
                  <th>Benchmark 名称</th>
                  <th>类别</th>
                  <th>方向</th>
                  <th>覆盖模型</th>
                  <th>样例值</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.catalog.map((entry) => {
                  const override = metricOverrides[entry.key] ?? {};
                  const checked = selectedMetrics.includes(entry.key);

                  return (
                    <tr key={entry.key}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={checked}
                          onChange={() => onToggleMetric(entry.key)}
                          aria-label={`选择数据项 ${entry.label}`}
                        />
                      </td>
                      <td className="min-w-[200px]">
                        <div className="font-mono text-xs">{entry.key}</div>
                        <div className="text-xs opacity-60">
                          {entry.group === "evaluation" ? "评测" : "性能"}
                          {entry.valueScale === "fraction" ? " · 上游 0-1，导入时 ×100" : ""}
                        </div>
                      </td>
                      <td className="min-w-[200px]">
                        <input
                          className="input input-bordered input-xs w-full"
                          value={override.benchmarkName ?? entry.label}
                          onChange={(event) =>
                            onUpdateMetricOverride(entry.key, { benchmarkName: event.target.value })
                          }
                        />
                      </td>
                      <td className="min-w-[130px]">
                        <input
                          className="input input-bordered input-xs w-full"
                          value={override.benchmarkType ?? entry.benchmarkType}
                          onChange={(event) =>
                            onUpdateMetricOverride(entry.key, { benchmarkType: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="select select-bordered select-xs"
                          value={(override.higherIsBetter ?? entry.higherIsBetter) ? "higher" : "lower"}
                          onChange={(event) =>
                            onUpdateMetricOverride(entry.key, { higherIsBetter: event.target.value === "higher" })
                          }
                          aria-label={`${entry.label} 的方向`}
                        >
                          <option value="higher">越高越好</option>
                          <option value="lower">越低越好</option>
                        </select>
                      </td>
                      <td className="text-sm">{entry.modelCount}</td>
                      <td className="font-mono text-xs opacity-70">{formatSampleValue(entry)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- 模型匹配 --- */}
      <div className="mb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="text-base font-semibold">模型匹配</h4>
          <span className="text-xs opacity-70">本地未标注推理强度的模型，默认绑定上游同族里最高的档位</span>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
          <input
            className="input input-bordered w-full"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索本地模型、Provider 或上游条目"
          />
          <select
            className="select select-bordered w-full"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            aria-label="匹配状态筛选"
          >
            <option value="all">全部</option>
            <option value="matched">已匹配</option>
            <option value="unmatched">未匹配</option>
            <option value="manual">手动覆盖</option>
            <option value="ignored">已忽略</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-zebra table-sm min-w-[1040px]">
            <thead>
              <tr>
                <th>本地模型</th>
                <th>上游条目</th>
                <th>推理强度</th>
                <th>匹配来源</th>
                <th>状态</th>
                <th className="w-16">忽略</th>
              </tr>
            </thead>
            <tbody>
              {filteredMappings.map((row) => {
                const draft = mappingDrafts[row.modelId];
                if (!draft) return null;
                const dirty = isMappingDraftDirty(row, draft);
                const effectiveStatus = draft.ignored ? "ignored" : row.matchStatus;

                return (
                  <tr key={row.modelId} className={conflictModelIds.has(row.modelId) ? "bg-error/10" : undefined}>
                    <td className="min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{row.modelName}</span>
                        {dirty ? <span className="badge badge-warning badge-xs whitespace-nowrap">未保存</span> : null}
                      </div>
                      <div className="text-xs opacity-60">{row.providerName}</div>
                    </td>
                    <td className="min-w-[280px]">
                      <select
                        className="select select-bordered select-xs w-full"
                        value={draft.externalModelId ?? ""}
                        disabled={draft.ignored}
                        onChange={(event) => {
                          // 先把值取出来再进 updater：state updater 可能被 React 延后执行，
                          // 那时 event.target 已经是重渲染后的 DOM，读出来是旧值
                          const nextExternalModelId = event.target.value || null;
                          onUpdateMappingDraft(row.modelId, (current) => ({
                            ...current,
                            externalModelId: nextExternalModelId,
                            manualOverride: true
                          }));
                        }}
                        aria-label={`${row.modelName} 的上游条目`}
                      >
                        <option value="">（不绑定）</option>
                        {(snapshot?.upstreamOptions ?? []).map((option) => (
                          <option key={option.externalModelId} value={option.externalModelId}>
                            {option.externalModelName}
                            {option.externalCreator ? ` — ${option.externalCreator}` : ""}
                          </option>
                        ))}
                      </select>
                      {row.externalMissing ? (
                        <div className="mt-1 text-xs text-error">已绑定的上游条目在本次拉取中不存在</div>
                      ) : null}
                    </td>
                    <td className="min-w-[150px]">
                      <select
                        className="select select-bordered select-xs w-full"
                        value={draft.reasoningEffort ?? ""}
                        disabled={draft.ignored}
                        onChange={(event) => {
                          const nextEffort = event.target.value || null;
                          onUpdateMappingDraft(row.modelId, (current) => ({
                            ...current,
                            reasoningEffort: nextEffort,
                            manualOverride: true
                          }));
                        }}
                        aria-label={`${row.modelName} 的推理强度`}
                      >
                        {REASONING_EFFORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="min-w-[190px] text-xs opacity-75">
                      {MATCH_REASON_LABELS[row.matchReason] ?? row.matchReason}
                    </td>
                    <td>
                      <div
                        className={`inline-flex h-6 items-center rounded-full border-2 bg-transparent px-3 text-xs font-semibold ${getStatusBadgeClass(
                          effectiveStatus,
                          draft.manualOverride
                        )}`}
                      >
                        {getStatusLabel(effectiveStatus, draft.manualOverride)}
                      </div>
                      <div className="mt-1 text-xs opacity-60">置信 {row.matchConfidence}</div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={draft.ignored}
                        onChange={(event) => {
                          const nextIgnored = event.target.checked;
                          onUpdateMappingDraft(row.modelId, (current) => ({
                            ...current,
                            ignored: nextIgnored,
                            manualOverride: nextIgnored ? false : current.manualOverride
                          }));
                        }}
                        aria-label={`忽略 ${row.modelName}`}
                      />
                    </td>
                  </tr>
                );
              })}
              {filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm opacity-60">
                    {snapshot ? "无匹配记录" : "尚未拉取上游数据"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- 上游独有模型 --- */}
      {snapshot && snapshot.upstreamOnly.length > 0 ? (
        <details className="mb-5 rounded-2xl border border-base-300/70 bg-base-200/30">
          <summary className="cursor-pointer list-none px-4 py-3 text-base font-semibold">
            上游独有模型（{snapshot.upstreamOnly.length}）
            <span className="ml-2 text-xs font-normal opacity-70">
              默认全部跳过；勾选的会在执行导入时新建本地模型
              {createExternalModelIds.length > 0 ? `（已勾选 ${createExternalModelIds.length} 个）` : ""}
            </span>
          </summary>
          <div className="max-h-96 overflow-y-auto px-4 pb-4">
            <table className="table table-zebra table-sm">
              <thead>
                <tr>
                  <th className="w-10" />
                  <th>上游模型</th>
                  <th>Creator</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.upstreamOnly.map((item) => (
                  <tr key={item.externalModelId}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={createExternalModelIds.includes(item.externalModelId)}
                        onChange={() => onToggleCreateModel(item.externalModelId)}
                        aria-label={`创建 ${item.externalModelName}`}
                      />
                    </td>
                    <td>{item.externalModelName}</td>
                    <td className="text-sm opacity-70">{item.externalCreator ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {/* --- 预览 / 导入结果 --- */}
      {summary ? (
        <div className="rounded-2xl border border-base-300/70 bg-base-200/30 p-4">
          <h4 className="mb-3 text-base font-semibold">
            {summary.dryRun ? "预览结果（未落库）" : "导入结果"}
          </h4>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">首次新增</div>
              <div className="mt-1 text-lg font-medium">{summary.inserted}</div>
            </div>
            <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">值变化追加</div>
              <div className="mt-1 text-lg font-medium">{summary.appended}</div>
            </div>
            <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">值未变覆盖</div>
              <div className="mt-1 text-lg font-medium">{summary.unchanged}</div>
            </div>
            <div className="rounded-xl border border-base-300/70 bg-base-100/75 px-3 py-2">
              <div className="text-xs uppercase tracking-wide opacity-60">跳过</div>
              <div className="mt-1 text-lg font-medium">{summary.skipped}</div>
            </div>
          </div>

          {summary.createdBenchmarks.length > 0 ? (
            <div className="alert alert-info mb-3 text-sm">
              <span>将新建 benchmark：{summary.createdBenchmarks.join("、")}</span>
            </div>
          ) : null}

          <div className="max-h-96 overflow-auto rounded-box border border-base-300">
            <table className="table table-zebra table-sm">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>Benchmark</th>
                  <th>新值</th>
                  <th>原值</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {summary.preview.map((row, index) => (
                  <tr key={`${row.modelName}-${row.benchmarkName}-${index}`}>
                    <td>{row.modelName}</td>
                    <td>{row.benchmarkName}</td>
                    <td className="font-mono text-xs">{row.rawValue}</td>
                    <td className="font-mono text-xs opacity-60">{row.previousValue ?? "--"}</td>
                    <td className="text-xs">
                      {row.outcome === "inserted"
                        ? "新增"
                        : row.outcome === "appended"
                          ? "追加历史"
                          : row.outcome === "unchanged"
                            ? "覆盖（值未变）"
                            : "跳过"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.total > summary.preview.length ? (
            <div className="mt-2 text-xs opacity-60">
              共 {summary.total} 行，此处仅展示前 {summary.preview.length} 行。
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
