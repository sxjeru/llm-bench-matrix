import { MAX_PARAMS_B, MIN_PARAMS_B } from "@/lib/model-params-parse";
import type { ModelParamsDraft, ModelParamsRow } from "../types";

export function toParamsDraft(row: ModelParamsRow): ModelParamsDraft {
  return {
    totalParamsB: row.totalParamsB === null ? "" : String(row.totalParamsB),
    activatedParamsB: row.activatedParamsB === null ? "" : String(row.activatedParamsB),
    isEstimated: row.isEstimated,
    note: row.note ?? ""
  };
}

/** 空串表示清空该项参数量；其余要求正数并落在 DB 列精度允许的区间内 */
export function parseOptionalParams(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    throw new Error("参数量必须是正数");
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("参数量必须是正数");
  }
  // 与后端 schema 同源。这里先拦一道是为了给出中文提示：交给后端会得到一串 ZodError JSON
  if (parsed < MIN_PARAMS_B || parsed > MAX_PARAMS_B) {
    throw new Error(`参数量需在 ${MIN_PARAMS_B}B ~ ${MAX_PARAMS_B}B 之间`);
  }

  return parsed;
}

function normalizeNote(value: string | null | undefined) {
  return (value ?? "").trim() || null;
}

/** 数值相等即视为未改动："70.0" 与 70 不该被算成一处修改 */
function isParamsValueUnchanged(rowValue: number | null, draftValue: string) {
  const trimmed = draftValue.trim();
  if (!trimmed) return rowValue === null;

  const parsed = Number(trimmed);
  // 非法输入（NaN）视为「有改动」，这样批量保存会走到校验并把错误报出来
  if (!Number.isFinite(parsed)) return false;

  return rowValue !== null && parsed === rowValue;
}

/** 草稿相对服务端数据是否有改动，决定它是否进入「保存全部修改」的范围 */
export function isParamsDraftDirty(row: ModelParamsRow, draft: ModelParamsDraft | undefined): boolean {
  if (!draft) return false;

  if (draft.isEstimated !== row.isEstimated) return true;
  if (normalizeNote(draft.note) !== normalizeNote(row.note)) return true;
  if (!isParamsValueUnchanged(row.totalParamsB, draft.totalParamsB)) return true;
  if (!isParamsValueUnchanged(row.activatedParamsB, draft.activatedParamsB)) return true;

  return false;
}

export function countDirtyParamsDrafts(
  rows: ModelParamsRow[],
  drafts: Record<number, ModelParamsDraft>
): number {
  return rows.reduce((count, row) => (isParamsDraftDirty(row, drafts[row.modelId]) ? count + 1 : count), 0);
}

/** 行内保存与批量保存共用的提交体，校验不通过时抛出可直接展示的中文错误 */
export function buildParamsUpdatePayload(modelId: number, draft: ModelParamsDraft) {
  const totalParamsB = parseOptionalParams(draft.totalParamsB);
  const activatedParamsB = parseOptionalParams(draft.activatedParamsB);

  if (totalParamsB !== null && activatedParamsB !== null && activatedParamsB > totalParamsB) {
    throw new Error("激活参数量不能大于总参数量");
  }

  return {
    modelId,
    totalParamsB,
    activatedParamsB,
    isEstimated: draft.isEstimated,
    note: normalizeNote(draft.note)
  };
}
