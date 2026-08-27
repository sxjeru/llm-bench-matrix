import { parseBenchmarkValue, type ParsedBenchmarkValue } from "@/lib/db/parse-value";
import { isEmptyImportPairValue } from "@/lib/import/pair-value";
import { isImportValueEmptyMarker } from "@/lib/import/value-patterns";

/**
 * 后台「数据管理」页签的纯决策层。
 *
 * 这里只做「给定当前库里的记录 + 前端草稿，应该 INSERT / UPDATE / DELETE 哪些行」的推导，
 * 不碰数据库。DB 编排在 lib/admin-records-service.ts，两边分开是为了让批量语义
 * （空值即删除、冲突策略、双值分拆）可以脱离 drizzle mock 直接单测。
 */

export const RECORD_SCALE_NOTE_TO_ONE = "normalized-scale-to-1";
export const RECORD_SCALE_NOTE_TO_HUNDRED = "normalized-scale-to-100";
export const RECORD_SPLIT_DUAL_NOTE_FIRST = "split-dual-first";
export const RECORD_SPLIT_DUAL_NOTE_SECOND = "split-dual-second";

/** 单元格 = 当前筛选范围内某 (model, benchmark) 的记录集合 */
export function getRecordCellKey(modelId: number, benchmarkId: number): string {
  return `${modelId}::${benchmarkId}`;
}

/** 归属变更时用来判断目标格是否已被占用：另一坐标轴 + source */
export function getRecordSlotKey(otherAxisId: number, source: string | null | undefined): string {
  return `${otherAxisId}::${source?.trim() ?? ""}`;
}

export type RecordDraftInput = {
  modelId: number;
  benchmarkId: number;
  /** 已有记录的主记录 id（单元格内最新一条）。为空表示新增单元格 */
  recordId?: number | null;
  /** 该单元格在当前筛选范围内的全部记录 id（含历史）。清空时会一并删除 */
  recordIds?: number[];
  /** 空字符串 / `-` / `n/a` 之类的空标记都视为清空 */
  valueRaw: string;
  /** 打开页面时的原值，用于跳过「改回原样」的无效草稿 */
  originalValueRaw?: string | null;
  /** 新增记录时写入的 source；已有记录不会改动 source（归属变更走 reassign） */
  source?: string | null;
  /** 显式标记删除（前端 Backspace 批量清空会置 true） */
  isDeleted?: boolean;
};

export type PlannedRecordInsert = {
  modelId: number;
  benchmarkId: number;
  source: string | null;
  parsed: ParsedBenchmarkValue;
};

export type PlannedRecordUpdate = {
  recordId: number;
  modelId: number;
  benchmarkId: number;
  parsed: ParsedBenchmarkValue;
};

export type RecordDraftMutationPlan = {
  inserts: PlannedRecordInsert[];
  updates: PlannedRecordUpdate[];
  deleteRecordIds: number[];
  /** 解析不出数值、只能按 non-numeric 落库的单元格，用于保存后提示 */
  nonNumericCells: Array<{ modelId: number; benchmarkId: number; valueRaw: string }>;
  /** 值与原值一致，无需落库 */
  unchanged: number;
  /** 新增单元格但填的是空值，直接忽略 */
  ignoredEmptyInserts: number;
};

export function isEmptyRecordValue(rawInput: string): boolean {
  const raw = rawInput.trim();
  if (!raw) return true;
  if (isImportValueEmptyMarker(raw)) return true;
  return isEmptyImportPairValue(raw);
}

function dedupeRecordIds(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
}

function collectDraftRecordIds(draft: RecordDraftInput): number[] {
  const ids = [...(draft.recordIds ?? [])];
  if (typeof draft.recordId === "number") {
    ids.push(draft.recordId);
  }
  return dedupeRecordIds(ids);
}

/**
 * 同一单元格的多份草稿以最后一份为准（前端理论上已去重，这里兜底避免同一行被
 * 先 UPDATE 再 DELETE 的顺序问题）。
 */
function dedupeDraftsByCell(drafts: RecordDraftInput[]): RecordDraftInput[] {
  const byCell = new Map<string, RecordDraftInput>();
  drafts.forEach((draft) => {
    byCell.set(getRecordCellKey(draft.modelId, draft.benchmarkId), draft);
  });
  return Array.from(byCell.values());
}

export function planRecordDraftMutations(
  drafts: RecordDraftInput[],
  parseValue: (draft: RecordDraftInput, raw: string) => ParsedBenchmarkValue = (_draft, raw) =>
    parseBenchmarkValue(raw)
): RecordDraftMutationPlan {
  const plan: RecordDraftMutationPlan = {
    inserts: [],
    updates: [],
    deleteRecordIds: [],
    nonNumericCells: [],
    unchanged: 0,
    ignoredEmptyInserts: 0
  };

  dedupeDraftsByCell(drafts).forEach((draft) => {
    const recordIds = collectDraftRecordIds(draft);
    const shouldDelete = draft.isDeleted === true || isEmptyRecordValue(draft.valueRaw);

    if (shouldDelete) {
      if (recordIds.length === 0) {
        // 新增的空单元格：本来就没落库，忽略即可
        plan.ignoredEmptyInserts += 1;
        return;
      }

      plan.deleteRecordIds.push(...recordIds);
      return;
    }

    const nextRaw = draft.valueRaw.trim();
    const originalRaw = draft.originalValueRaw?.trim() ?? "";
    if (recordIds.length > 0 && originalRaw && originalRaw === nextRaw) {
      plan.unchanged += 1;
      return;
    }

    const parsed = parseValue(draft, nextRaw);
    if (parsed.valueNum === null && parsed.valueNum2 === null) {
      plan.nonNumericCells.push({
        modelId: draft.modelId,
        benchmarkId: draft.benchmarkId,
        valueRaw: nextRaw
      });
    }

    if (typeof draft.recordId === "number" && draft.recordId > 0) {
      plan.updates.push({
        recordId: draft.recordId,
        modelId: draft.modelId,
        benchmarkId: draft.benchmarkId,
        parsed
      });
      return;
    }

    plan.inserts.push({
      modelId: draft.modelId,
      benchmarkId: draft.benchmarkId,
      source: draft.source?.trim() ? draft.source.trim() : null,
      parsed
    });
  });

  plan.deleteRecordIds = dedupeRecordIds(plan.deleteRecordIds);

  return plan;
}

// --- 量纲归一化 ---

export type RecordScaleTarget = 1 | 100;

export type NormalizableRecord = {
  id: number;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
};

export type PlannedScaleUpdate = {
  recordId: number;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string;
};

export function normalizeRecordScaleValue(
  value: number | null,
  targetScale: RecordScaleTarget
): number | null {
  if (value === null || !Number.isFinite(value)) return value;

  if (targetScale === 1) {
    return value > 10 ? Number((value / 100).toFixed(6)) : value;
  }

  return value < 1 ? Number((value * 100).toFixed(6)) : value;
}

export function formatRecordNumericValue(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/** 单值直接输出，双值保持 `a / b` 的存量书写习惯 */
export function composeRecordValueRaw(valueNum: number | null, valueNum2: number | null): string {
  if (valueNum !== null && valueNum2 !== null) {
    return `${formatRecordNumericValue(valueNum)} / ${formatRecordNumericValue(valueNum2)}`;
  }
  if (valueNum !== null) return formatRecordNumericValue(valueNum);
  if (valueNum2 !== null) return formatRecordNumericValue(valueNum2);
  return "";
}

export function appendRecordNote(valueNote: string | null | undefined, marker: string): string {
  const current = valueNote?.trim() ?? "";
  if (!current) return marker;
  if (current.includes(marker)) return current;
  return `${current}; ${marker}`;
}

function hasNumericChange(previous: number | null, next: number | null): boolean {
  if (previous === null && next === null) return false;
  if (previous === null || next === null) return true;
  return Math.abs(previous - next) > 1e-12;
}

/**
 * 与「数据维护」页的按 benchmark 同化不同，这里是按当前筛选范围逐条同化，
 * 并且会把 valueRaw 一起改写 —— 矩阵单元格显示的就是 valueRaw，不改写会出现
 * 「保存成功但格子还是旧数字」的错觉。
 */
export function planRecordScaleNormalization(
  records: NormalizableRecord[],
  targetScale: RecordScaleTarget
): { updates: PlannedScaleUpdate[]; unchanged: number } {
  const updates: PlannedScaleUpdate[] = [];
  let unchanged = 0;

  records.forEach((record) => {
    const nextValueNum = normalizeRecordScaleValue(record.valueNum, targetScale);
    const nextValueNum2 = normalizeRecordScaleValue(record.valueNum2, targetScale);

    if (!hasNumericChange(record.valueNum, nextValueNum) && !hasNumericChange(record.valueNum2, nextValueNum2)) {
      unchanged += 1;
      return;
    }

    const nextValueRaw = composeRecordValueRaw(nextValueNum, nextValueNum2);

    updates.push({
      recordId: record.id,
      valueRaw: nextValueRaw || record.valueRaw,
      valueNum: nextValueNum,
      valueNum2: nextValueNum2,
      valueNote: appendRecordNote(
        record.valueNote,
        targetScale === 1 ? RECORD_SCALE_NOTE_TO_ONE : RECORD_SCALE_NOTE_TO_HUNDRED
      )
    });
  });

  return { updates, unchanged };
}

// --- 双值分拆 ---

export type SplittableRecord = {
  id: number;
  modelId: number;
  benchTime: Date | string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
};

export type PlannedSplitUpdate = {
  recordId: number;
  benchmarkId: number;
  valueRaw: string;
  valueNum: number;
  valueNote: string;
};

export type PlannedSplitInsert = {
  modelId: number;
  benchmarkId: number;
  benchTime: Date | string;
  valueRaw: string;
  valueNum: number;
  valueNote: string;
  source: string | null;
};

/**
 * `77 / 88` 这类复合值拆成两个独立 benchmark：
 * 第一个值留在 firstBenchmarkId（可以还是原 benchmark），第二个值新建记录挂到 secondBenchmarkId。
 */
export function planDualValueSplit(
  records: SplittableRecord[],
  input: { firstBenchmarkId: number; secondBenchmarkId: number }
): { updates: PlannedSplitUpdate[]; inserts: PlannedSplitInsert[]; skipped: number } {
  const updates: PlannedSplitUpdate[] = [];
  const inserts: PlannedSplitInsert[] = [];
  let skipped = 0;

  records.forEach((record) => {
    if (record.valueNum === null || record.valueNum2 === null) {
      skipped += 1;
      return;
    }

    updates.push({
      recordId: record.id,
      benchmarkId: input.firstBenchmarkId,
      valueRaw: formatRecordNumericValue(record.valueNum),
      valueNum: record.valueNum,
      valueNote: appendRecordNote(record.valueNote, RECORD_SPLIT_DUAL_NOTE_FIRST)
    });

    inserts.push({
      modelId: record.modelId,
      benchmarkId: input.secondBenchmarkId,
      benchTime: record.benchTime,
      valueRaw: formatRecordNumericValue(record.valueNum2),
      valueNum: record.valueNum2,
      valueNote: appendRecordNote(record.valueNote, RECORD_SPLIT_DUAL_NOTE_SECOND),
      source: record.source
    });
  });

  return { updates, inserts, skipped };
}

// --- 归属变更（列头 benchmark / 行头 model / source） ---

export type RecordReassignConflictStrategy = "skip" | "overwrite" | "keep-both";

export type ReassignSourceRecord = {
  id: number;
  /** 迁移时保持不变的另一坐标轴：换 benchmark 时是 modelId，换 model 时是 benchmarkId */
  otherAxisId: number;
  source: string | null;
};

export type RecordReassignPlan = {
  moveRecordIds: number[];
  /** 目标格已有数据且策略为 skip 时保留在原处的记录 */
  skippedRecordIds: number[];
  /** overwrite 策略下需要先删掉的目标侧记录 */
  deleteTargetRecordIds: number[];
  conflictCount: number;
};

export function planRecordReassign(input: {
  sourceRecords: ReassignSourceRecord[];
  /** 目标实体下已存在的记录，用于检测占位冲突 */
  targetRecords: ReassignSourceRecord[];
  conflictStrategy: RecordReassignConflictStrategy;
}): RecordReassignPlan {
  const targetIdsBySlot = new Map<string, number[]>();
  input.targetRecords.forEach((record) => {
    const key = getRecordSlotKey(record.otherAxisId, record.source);
    const existing = targetIdsBySlot.get(key);
    if (existing) {
      existing.push(record.id);
      return;
    }
    targetIdsBySlot.set(key, [record.id]);
  });

  const plan: RecordReassignPlan = {
    moveRecordIds: [],
    skippedRecordIds: [],
    deleteTargetRecordIds: [],
    conflictCount: 0
  };

  const consumedSlots = new Set<string>();

  input.sourceRecords.forEach((record) => {
    const key = getRecordSlotKey(record.otherAxisId, record.source);
    const conflictingTargetIds = targetIdsBySlot.get(key) ?? [];
    const hasConflict = conflictingTargetIds.length > 0;

    if (!hasConflict) {
      // 同一批里两条源记录挤同一个目标格：第一条正常迁移，其余按冲突策略处理
      if (consumedSlots.has(key)) {
        plan.conflictCount += 1;
        if (input.conflictStrategy === "skip") {
          plan.skippedRecordIds.push(record.id);
          return;
        }
        plan.moveRecordIds.push(record.id);
        return;
      }

      consumedSlots.add(key);
      plan.moveRecordIds.push(record.id);
      return;
    }

    plan.conflictCount += 1;

    if (input.conflictStrategy === "skip") {
      plan.skippedRecordIds.push(record.id);
      return;
    }

    if (input.conflictStrategy === "overwrite" && !consumedSlots.has(key)) {
      plan.deleteTargetRecordIds.push(...conflictingTargetIds);
    }

    consumedSlots.add(key);
    plan.moveRecordIds.push(record.id);
  });

  plan.deleteTargetRecordIds = dedupeRecordIds(plan.deleteTargetRecordIds);

  return plan;
}
