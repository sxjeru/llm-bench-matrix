"use client";

import type { ModelOption, ProviderOption } from "../types";

type SheetPickerDialogProps = {
  open: boolean;
  sheetNames: string[];
  onSelectSheet: (sheetName: string) => void;
  onClose: () => void;
};

export function SheetPickerDialog({ open, sheetNames, onSelectSheet, onClose }: SheetPickerDialogProps) {
  if (!open) {
    return null;
  }

  return (
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
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

type ConfirmImportWithoutPreviewDialogProps = {
  open: boolean;
  isImportingTextCsv: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmImportWithoutPreviewDialog({
  open,
  isImportingTextCsv,
  onClose,
  onConfirm
}: ConfirmImportWithoutPreviewDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="text-lg font-bold">尚未预览，确认直接导入？</h3>
        <p className="mt-2 text-sm opacity-80">
          你还没有点击“预览导入结果”。建议先预览再导入，以检查重复嫌疑、注释和合并策略。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isImportingTextCsv}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isImportingTextCsv}
          >
            {isImportingTextCsv ? "导入中..." : "仍然导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ConfirmImportWithoutSourceDialogProps = {
  open: boolean;
  isImportingTextCsv: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmImportWithoutSourceDialog({
  open,
  isImportingTextCsv,
  onClose,
  onConfirm
}: ConfirmImportWithoutSourceDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="text-lg font-bold">Source 为空，确认继续导入？</h3>
        <p className="mt-2 text-sm opacity-80">
          当前导入将不会带统一 source 标记，后续按 source 筛选/删除会更困难。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isImportingTextCsv}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isImportingTextCsv}
          >
            {isImportingTextCsv ? "导入中..." : "继续导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ClearDatabaseConfirmDialogProps = {
  open: boolean;
  isClearingDatabase: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ClearDatabaseConfirmDialog({
  open,
  isClearingDatabase,
  onClose,
  onConfirm
}: ClearDatabaseConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-error/35 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="text-lg font-bold text-error">确认清空数据库？</h3>
        <p className="mt-2 text-sm opacity-85">
          该操作会删除除 <code>settings</code> 外所有表数据，且无法恢复。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isClearingDatabase}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-error"
            onClick={onConfirm}
            disabled={isClearingDatabase}
          >
            {isClearingDatabase ? "清空中..." : "确认清空"}
          </button>
        </div>
      </div>
    </div>
  );
}

type DeleteSourceConfirmDialogProps = {
  open: boolean;
  isDeletingSourceData: boolean;
  deleteSourceInput: string;
  getDeleteSourceDisplayLabel: (sourceInput: string) => string;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteSourceConfirmDialog({
  open,
  isDeletingSourceData,
  deleteSourceInput,
  getDeleteSourceDisplayLabel,
  onClose,
  onConfirm
}: DeleteSourceConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isDeletingSourceData) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-base-300/80 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="text-lg font-bold text-error">确认删除 source 数据？</h3>
        <p className="mt-2 text-sm opacity-85">
          将删除 <code>{getDeleteSourceDisplayLabel(deleteSourceInput)}</code> 匹配的所有 benchmark_values 记录（不可恢复）。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isDeletingSourceData}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-error"
            onClick={onConfirm}
            disabled={isDeletingSourceData}
          >
            {isDeletingSourceData ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ProviderDeleteConfirmDialogProps = {
  open: boolean;
  providers: ProviderOption[];
  models: ModelOption[];
  providerDeleteTargetId: number | null;
  providerDeleteTransferTargetId: number | null;
  deletingProviderId: number | null;
  onClose: () => void;
  onTransferTargetChange: (providerId: number | null) => void;
  onConfirm: () => void;
};

export function ProviderDeleteConfirmDialog({
  open,
  providers,
  models,
  providerDeleteTargetId,
  providerDeleteTransferTargetId,
  deletingProviderId,
  onClose,
  onTransferTargetChange,
  onConfirm
}: ProviderDeleteConfirmDialogProps) {
  if (!open) {
    return null;
  }

  const providerToDelete = providerDeleteTargetId !== null
    ? providers.find((provider) => provider.id === providerDeleteTargetId) ?? null
    : null;
  const transferCandidates = providers.filter((provider) => provider.id !== providerDeleteTargetId);
  const transferTarget = providerDeleteTransferTargetId !== null
    ? providers.find((provider) => provider.id === providerDeleteTransferTargetId) ?? null
    : null;
  const providerModels = providerToDelete ? models.filter((model) => model.providerId === providerToDelete.id) : [];

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && deletingProviderId === null) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-error/35 bg-base-100/95 p-6 shadow-2xl backdrop-blur">
        <h3 className="text-lg font-bold text-error">确认删除 Provider？</h3>
        <p className="mt-2 text-sm opacity-85">
          将删除 <code>{providerToDelete?.name ?? "当前 provider"}</code>。为避免级联删除模型与分数数据，需先把其下 models 迁移到其他 provider。
        </p>

        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-base-300/70 bg-base-200/30 px-4 py-3 text-sm">
            <div className="font-medium">待迁移模型数：{providerModels.length}</div>
            <div className="mt-1 text-xs opacity-70">
              {providerModels.length > 0
                ? `删除前会把这 ${providerModels.length} 个 model 的 provider 归属整体迁移。`
                : "当前 provider 下暂无 model，删除时不会触发模型迁移。"}
            </div>
          </div>

          <label className="form-control w-full">
            <span className="label-text mb-1.5 text-xs font-medium opacity-70">迁移 models 到</span>
            <select
              className="select select-bordered w-full rounded-xl bg-base-200/40 transition-colors focus:bg-base-100 focus:border-primary focus:outline-none"
              value={providerDeleteTransferTargetId ?? ""}
              onChange={(e) => onTransferTargetChange(e.target.value ? Number(e.target.value) : null)}
              disabled={deletingProviderId !== null || transferCandidates.length === 0}
            >
              <option value="">请选择目标 Provider</option>
              {transferCandidates.map((provider) => (
                <option key={`provider-delete-transfer-${provider.id}`} value={provider.id}>
                  {provider.config?.displayName?.trim() || provider.name} ({provider.slug})
                </option>
              ))}
            </select>
          </label>

          {transferTarget ? (
            <div className="rounded-xl border border-base-300/70 bg-base-200/20 px-4 py-3 text-xs opacity-75">
              确认后会先把 models 迁移到 <span className="font-medium">{transferTarget.config?.displayName?.trim() || transferTarget.name}</span>，再删除当前 provider。
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={deletingProviderId !== null}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-error"
            onClick={onConfirm}
            disabled={deletingProviderId !== null || transferCandidates.length === 0 || providerDeleteTransferTargetId === null}
          >
            {deletingProviderId !== null ? "删除中..." : "确认迁移并删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
