import type { ModelPricingDraft, ModelPricingRow } from "../types";

/** 草稿里的价格字段与 ModelPricingRow 同名，比较与提交都按这一份顺序遍历 */
const PRICING_COST_FIELDS = [
  "inputCost",
  "outputCost",
  "cacheReadCost",
  "reasoningCost",
  "cacheWriteCost",
  "inputAudioCost",
  "outputAudioCost"
] as const;

const PRICING_TEXT_FIELDS = [
  "sourceProviderId",
  "sourceProviderName",
  "sourceModelId",
  "sourceModelName",
  "note"
] as const;

export function toPricingDraft(row: ModelPricingRow): ModelPricingDraft {
  const costToString = (value: number | null) => (value === null ? "" : String(value));

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

/** 空串表示清空该项价格；其余一律要求非负数字，不接受 "1abc" 这类半数字串 */
export function parseOptionalCost(raw: string): number | null {
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

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim() || null;
}

/** 数值相等即视为未改动："1.50" 与 1.5 不该被算成一处修改 */
function isCostUnchanged(rowValue: number | null, draftValue: string) {
  const trimmed = draftValue.trim();
  if (!trimmed) return rowValue === null;

  const parsed = Number(trimmed);
  // 非法输入（NaN）视为「有改动」，这样批量保存会走到校验并把错误报出来
  if (!Number.isFinite(parsed)) return false;

  return rowValue !== null && parsed === rowValue;
}

/** 草稿相对服务端数据是否有改动，决定它是否进入「保存全部修改」的范围 */
export function isPricingDraftDirty(row: ModelPricingRow, draft: ModelPricingDraft | undefined): boolean {
  if (!draft) return false;

  if (draft.manualOverride !== row.manualOverride) return true;
  if (PRICING_COST_FIELDS.some((field) => !isCostUnchanged(row[field], draft[field]))) return true;
  if (PRICING_TEXT_FIELDS.some((field) => normalizeText(draft[field]) !== normalizeText(row[field]))) return true;

  return false;
}

export function countDirtyPricingDrafts(
  rows: ModelPricingRow[],
  drafts: Record<number, ModelPricingDraft>
): number {
  return rows.reduce((count, row) => (isPricingDraftDirty(row, drafts[row.modelId]) ? count + 1 : count), 0);
}

/**
 * 行内保存与批量保存共用的提交体。
 *
 * 改过任一价格就自动打开手动覆盖，否则下一次 models.dev 同步会把人工填的值冲掉。
 */
export function buildPricingUpdatePayload(
  modelId: number,
  draft: ModelPricingDraft,
  sourceRow: ModelPricingRow | undefined
) {
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
    ? PRICING_COST_FIELDS.some((field) => parsedCosts[field] !== sourceRow[field])
    : false;
  const manualOverride = draft.manualOverride || priceChanged;

  return {
    modelId,
    ...parsedCosts,
    sourceProviderId: normalizeText(draft.sourceProviderId),
    sourceProviderName: normalizeText(draft.sourceProviderName),
    sourceModelId: normalizeText(draft.sourceModelId),
    sourceModelName: normalizeText(draft.sourceModelName),
    manualOverride,
    matchStatus: manualOverride ? ("manual" as const) : ("matched" as const),
    note: normalizeText(draft.note)
  };
}
