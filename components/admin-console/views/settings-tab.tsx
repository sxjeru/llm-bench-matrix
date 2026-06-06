"use client";

import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Settings2, HelpCircle } from "lucide-react";
import type { ModelDedupeRule } from "../types";
import { postJson } from "../api";

type SettingsTabProps = {
  modelDedupeRule: ModelDedupeRule;
  setModelDedupeRule: Dispatch<SetStateAction<ModelDedupeRule>>;
  onSaveModelDedupeRule: () => void | Promise<void>;
  deleteModelInput: string;
  setDeleteModelInput: Dispatch<SetStateAction<string>>;
  modelEntityOptions: Array<{ id: number; label: string }>;
  onDeleteModelData: () => void | Promise<void>;
  deleteSourceInput: string;
  setDeleteSourceInput: Dispatch<SetStateAction<string>>;
  deleteSourceOptions: string[];
  onDeleteSourceData: () => void | Promise<void>;
  settingKey: string;
  setSettingKey: Dispatch<SetStateAction<string>>;
  settingValue: string;
  setSettingValue: Dispatch<SetStateAction<string>>;
  settingNote: string;
  setSettingNote: Dispatch<SetStateAction<string>>;
  onSaveSetting: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClearDatabase: () => void;
  sortedSettings: [string, unknown][];
  notifySuccess: (message: string, details?: string[]) => void;
  notifyError: (message: string, details?: string[]) => void;
};

export function SettingsTab({
  modelDedupeRule,
  setModelDedupeRule,
  onSaveModelDedupeRule,
  deleteModelInput,
  setDeleteModelInput,
  modelEntityOptions,
  onDeleteModelData,
  deleteSourceInput,
  setDeleteSourceInput,
  deleteSourceOptions,
  onDeleteSourceData,
  settingKey,
  setSettingKey,
  settingValue,
  setSettingValue,
  settingNote,
  setSettingNote,
  onSaveSetting,
  onClearDatabase,
  sortedSettings,
  notifySuccess,
  notifyError
}: SettingsTabProps) {
  const [footnoteText, setFootnoteText] = useState(() => {
    const footnoteSetting = sortedSettings.find(([key]) => key === "export_footnote_text");
    const val = footnoteSetting?.[1];
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      const config = val as Record<string, unknown>;
      if (typeof config.text === "string") return config.text;
    }
    return "";
  });
  const [footnoteAlign, setFootnoteAlign] = useState<"left" | "center" | "right">(() => {
    const footnoteSetting = sortedSettings.find(([key]) => key === "export_footnote_text");
    const val = footnoteSetting?.[1];
    if (val && typeof val === "object") {
      const config = val as Record<string, unknown>;
      if (typeof config.align === "string" && ["left", "center", "right"].includes(config.align)) {
        return config.align as "left" | "center" | "right";
      }
    }
    return "center";
  });
  const [isSavingFootnote, setIsSavingFootnote] = useState(false);

  async function handleSaveFootnote() {
    if (isSavingFootnote) return;
    setIsSavingFootnote(true);
    try {
      await postJson("/api/admin/settings", {
        key: "export_footnote_text",
        valueJson: {
          text: footnoteText,
          align: footnoteAlign
        },
        note: "图片导出时的底部脚注",
        updatedBy: "admin"
      });
      notifySuccess("脚注内容已保存。");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingFootnote(false);
    }
  }

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Settings2 size={18} />
        Settings
      </h3>

      <div className="mb-5 rounded-box border border-base-300 bg-base-200/50 p-4">
        <h4 className="mb-2 flex items-center gap-2 font-semibold">
          图片导出脚注
          <div 
            className="tooltip tooltip-right font-normal" 
            data-tip="支持占位符：{time} (当前日期)、 {model_count} (当前显示的模型数)、{data_source} (当前选定的数据源)"
          >
            <HelpCircle size={16} className="text-base-content/50 hover:text-base-content/80 transition-colors cursor-help" />
          </div>
        </h4>
        <p className="mb-3 text-sm opacity-80">
          设置导出矩阵图片时底部显示的脚注内容。可留空不显示脚注。
        </p>
        <div className="flex flex-col gap-3">
          <textarea
            className="textarea textarea-bordered w-full min-h-[80px]"
            value={footnoteText}
            onChange={(e) => setFootnoteText(e.target.value)}
            placeholder="例如：数据来源：xxx评测集 | 制表时间：{time}"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap">对齐方式：</span>
              <select
                className="select select-bordered select-sm"
                value={footnoteAlign}
                onChange={(e) => setFootnoteAlign(e.target.value as "left" | "center" | "right")}
              >
                <option value="left">居左</option>
                <option value="center">居中</option>
                <option value="right">居右</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSaveFootnote}
              disabled={isSavingFootnote}
            >
              {isSavingFootnote ? "保存中..." : "保存脚注配置"}
            </button>
          </div>
        </div>
      </div>

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
  );
}
