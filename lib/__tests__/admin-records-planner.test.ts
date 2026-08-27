import { describe, expect, test } from "vitest";

import {
  RECORD_SCALE_NOTE_TO_HUNDRED,
  RECORD_SCALE_NOTE_TO_ONE,
  RECORD_SPLIT_DUAL_NOTE_FIRST,
  RECORD_SPLIT_DUAL_NOTE_SECOND,
  appendRecordNote,
  composeRecordValueRaw,
  formatRecordNumericValue,
  getRecordCellKey,
  getRecordSlotKey,
  isEmptyRecordValue,
  normalizeRecordScaleValue,
  planDualValueSplit,
  planRecordDraftMutations,
  planRecordReassign,
  planRecordScaleNormalization,
  type RecordDraftInput
} from "@/lib/admin-records-planner";

function draft(overrides: Partial<RecordDraftInput> & Pick<RecordDraftInput, "modelId" | "benchmarkId" | "valueRaw">): RecordDraftInput {
  return overrides;
}

describe("record keys", () => {
  test("单元格与归属槽位按约定拼接", () => {
    expect(getRecordCellKey(3, 11)).toBe("3::11");
    expect(getRecordSlotKey(7, " text:src ")).toBe("7::text:src");
    expect(getRecordSlotKey(7, null)).toBe("7::");
    expect(getRecordSlotKey(7, "  ")).toBe("7::");
  });
});

describe("isEmptyRecordValue", () => {
  test("空白、空标记、两侧都是空占位的双值视为空", () => {
    expect(isEmptyRecordValue("")).toBe(true);
    expect(isEmptyRecordValue("   ")).toBe(true);
    expect(isEmptyRecordValue("-")).toBe(true);
    expect(isEmptyRecordValue("n/a")).toBe(true);
    expect(isEmptyRecordValue("NULL")).toBe(true);
    expect(isEmptyRecordValue("- / -")).toBe(true);
    expect(isEmptyRecordValue("n/a / null")).toBe(true);
  });

  test("有数值的格子不是空", () => {
    expect(isEmptyRecordValue("77")).toBe(false);
    expect(isEmptyRecordValue("77 / 88")).toBe(false);
    expect(isEmptyRecordValue("77 / -")).toBe(false);
  });
});

describe("planRecordDraftMutations", () => {
  test("空值或 isDeleted 会删除单元格内全部 recordIds", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101, 102],
        valueRaw: "  "
      }),
      draft({
        modelId: 2,
        benchmarkId: 12,
        recordId: 201,
        recordIds: [201],
        valueRaw: "keep-me",
        isDeleted: true
      })
    ]);

    expect(plan.deleteRecordIds).toEqual([101, 102, 201]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  test("新增空单元格被忽略，不会 INSERT", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        valueRaw: "-",
        source: "text:new"
      })
    ]);

    expect(plan.ignoredEmptyInserts).toBe(1);
    expect(plan.inserts).toEqual([]);
    expect(plan.deleteRecordIds).toEqual([]);
  });

  test("改回原值视为 unchanged", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101],
        valueRaw: " 77.5 ",
        originalValueRaw: "77.5"
      })
    ]);

    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([]);
  });

  test("已有 recordId 走 UPDATE，无 recordId 走 INSERT", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101],
        valueRaw: "88",
        originalValueRaw: "77"
      }),
      draft({
        modelId: 2,
        benchmarkId: 12,
        valueRaw: "12.5",
        source: " text:src "
      })
    ]);

    expect(plan.updates).toEqual([
      expect.objectContaining({
        recordId: 101,
        modelId: 1,
        benchmarkId: 11,
        parsed: expect.objectContaining({ valueNum: 88, valueNum2: null })
      })
    ]);
    expect(plan.inserts).toEqual([
      expect.objectContaining({
        modelId: 2,
        benchmarkId: 12,
        source: "text:src",
        parsed: expect.objectContaining({ valueNum: 12.5 })
      })
    ]);
  });

  test("解析不出数值仍会落库，并记入 nonNumericCells", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        valueRaw: "not-a-score",
        originalValueRaw: "77"
      })
    ]);

    expect(plan.nonNumericCells).toEqual([
      { modelId: 1, benchmarkId: 11, valueRaw: "not-a-score" }
    ]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.parsed).toEqual(
      expect.objectContaining({
        valueRaw: "not-a-score",
        valueNum: null,
        valueNum2: null
      })
    );
  });

  test("同一单元格多份草稿以最后一份为准", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101],
        valueRaw: "90",
        originalValueRaw: "70"
      }),
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101],
        valueRaw: "",
        originalValueRaw: "70"
      })
    ]);

    expect(plan.deleteRecordIds).toEqual([101]);
    expect(plan.updates).toEqual([]);
  });

  test("缺少 originalValueRaw 时即使值看起来没变也走 UPDATE", () => {
    const plan = planRecordDraftMutations([
      draft({
        modelId: 1,
        benchmarkId: 11,
        recordId: 101,
        recordIds: [101],
        valueRaw: "77"
      })
    ]);

    expect(plan.unchanged).toBe(0);
    expect(plan.updates).toEqual([
      expect.objectContaining({
        recordId: 101,
        parsed: expect.objectContaining({ valueNum: 77 })
      })
    ]);
  });
});

describe("scale helpers", () => {
  test("to 1 只缩放 >10 的值，to 100 只缩放 <1 的值", () => {
    expect(normalizeRecordScaleValue(87.4, 1)).toBe(0.874);
    expect(normalizeRecordScaleValue(0.12, 1)).toBe(0.12);
    expect(normalizeRecordScaleValue(5, 1)).toBe(5);
    expect(normalizeRecordScaleValue(0.12, 100)).toBe(12);
    expect(normalizeRecordScaleValue(87.4, 100)).toBe(87.4);
    expect(normalizeRecordScaleValue(null, 1)).toBeNull();
  });

  test("compose / format 保持单值与 a / b 书写", () => {
    expect(formatRecordNumericValue(0.874)).toBe("0.874");
    expect(composeRecordValueRaw(0.874, null)).toBe("0.874");
    expect(composeRecordValueRaw(77, 88)).toBe("77 / 88");
    expect(composeRecordValueRaw(null, 88)).toBe("88");
  });

  test("appendRecordNote 去重追加", () => {
    expect(appendRecordNote(null, RECORD_SCALE_NOTE_TO_ONE)).toBe(RECORD_SCALE_NOTE_TO_ONE);
    expect(appendRecordNote("existing", RECORD_SCALE_NOTE_TO_ONE)).toBe(`existing; ${RECORD_SCALE_NOTE_TO_ONE}`);
    expect(appendRecordNote(`keep; ${RECORD_SCALE_NOTE_TO_ONE}`, RECORD_SCALE_NOTE_TO_ONE)).toBe(
      `keep; ${RECORD_SCALE_NOTE_TO_ONE}`
    );
  });
});

describe("planRecordScaleNormalization", () => {
  test("改写 valueRaw 并追加量纲标记，已是目标量纲则跳过", () => {
    const plan = planRecordScaleNormalization(
      [
        { id: 1, valueRaw: "87.4", valueNum: 87.4, valueNum2: null, valueNote: null },
        { id: 2, valueRaw: "0.12", valueNum: 0.12, valueNum2: null, valueNote: "seed" },
        { id: 3, valueRaw: "77 / 88", valueNum: 77, valueNum2: 88, valueNote: null }
      ],
      1
    );

    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([
      {
        recordId: 1,
        valueRaw: "0.874",
        valueNum: 0.874,
        valueNum2: null,
        valueNote: RECORD_SCALE_NOTE_TO_ONE
      },
      {
        recordId: 3,
        valueRaw: "0.77 / 0.88",
        valueNum: 0.77,
        valueNum2: 0.88,
        valueNote: RECORD_SCALE_NOTE_TO_ONE
      }
    ]);
  });

  test("缩放到 100 时只动 <1 的值", () => {
    const plan = planRecordScaleNormalization(
      [{ id: 1, valueRaw: "0.12", valueNum: 0.12, valueNum2: null, valueNote: null }],
      100
    );

    expect(plan.updates).toEqual([
      {
        recordId: 1,
        valueRaw: "12",
        valueNum: 12,
        valueNum2: null,
        valueNote: RECORD_SCALE_NOTE_TO_HUNDRED
      }
    ]);
  });
});

describe("planDualValueSplit", () => {
  test("缺少任一数值则跳过，双值拆成 update + insert", () => {
    const plan = planDualValueSplit(
      [
        {
          id: 1,
          modelId: 9,
          benchTime: "2026-04-01T00:00:00.000Z",
          valueNum: 77,
          valueNum2: 88,
          valueNote: "paired",
          source: "text:src"
        },
        {
          id: 2,
          modelId: 9,
          benchTime: "2026-04-01T00:00:00.000Z",
          valueNum: 70,
          valueNum2: null,
          valueNote: null,
          source: null
        }
      ],
      { firstBenchmarkId: 11, secondBenchmarkId: 12 }
    );

    expect(plan.skipped).toBe(1);
    expect(plan.updates).toEqual([
      {
        recordId: 1,
        benchmarkId: 11,
        valueRaw: "77",
        valueNum: 77,
        valueNote: `paired; ${RECORD_SPLIT_DUAL_NOTE_FIRST}`
      }
    ]);
    expect(plan.inserts).toEqual([
      {
        modelId: 9,
        benchmarkId: 12,
        benchTime: "2026-04-01T00:00:00.000Z",
        valueRaw: "88",
        valueNum: 88,
        valueNote: `paired; ${RECORD_SPLIT_DUAL_NOTE_SECOND}`,
        source: "text:src"
      }
    ]);
  });

  test("前值为空、后值存在时把原记录迁到第二个 benchmark", () => {
    const plan = planDualValueSplit(
      [
        {
          id: 3,
          modelId: 10,
          benchTime: "2026-04-02T00:00:00.000Z",
          valueNum: null,
          valueNum2: 66.1,
          valueNote: "second only",
          source: "text:src"
        }
      ],
      { firstBenchmarkId: 11, secondBenchmarkId: 12 }
    );

    expect(plan).toEqual({
      updates: [
        {
          recordId: 3,
          benchmarkId: 12,
          valueRaw: "66.1",
          valueNum: 66.1,
          valueNote: `second only; ${RECORD_SPLIT_DUAL_NOTE_SECOND}`
        }
      ],
      inserts: [],
      skipped: 0
    });
  });
});

describe("planRecordReassign", () => {
  const sourceRecords = [
    { id: 1, otherAxisId: 9, source: "text:a" },
    { id: 2, otherAxisId: 10, source: "text:b" }
  ];
  const targetRecords = [{ id: 90, otherAxisId: 9, source: "text:a" }];

  test("skip：冲突格留在原处", () => {
    const plan = planRecordReassign({
      sourceRecords,
      targetRecords,
      conflictStrategy: "skip"
    });

    expect(plan).toEqual({
      moveRecordIds: [2],
      skippedRecordIds: [1],
      deleteTargetRecordIds: [],
      conflictCount: 1
    });
  });

  test("overwrite：先删目标格再迁移", () => {
    const plan = planRecordReassign({
      sourceRecords,
      targetRecords,
      conflictStrategy: "overwrite"
    });

    expect(plan.moveRecordIds).toEqual([1, 2]);
    expect(plan.skippedRecordIds).toEqual([]);
    expect(plan.deleteTargetRecordIds).toEqual([90]);
    expect(plan.conflictCount).toBe(1);
  });

  test("keep-both：冲突也迁移，不删目标", () => {
    const plan = planRecordReassign({
      sourceRecords,
      targetRecords,
      conflictStrategy: "keep-both"
    });

    expect(plan.moveRecordIds).toEqual([1, 2]);
    expect(plan.deleteTargetRecordIds).toEqual([]);
    expect(plan.conflictCount).toBe(1);
  });

  test("同一批挤同一个空目标格：第一条迁移，其余按冲突策略处理", () => {
    const skipPlan = planRecordReassign({
      sourceRecords: [
        { id: 1, otherAxisId: 9, source: "text:a" },
        { id: 2, otherAxisId: 9, source: "text:a" }
      ],
      targetRecords: [],
      conflictStrategy: "skip"
    });

    expect(skipPlan.moveRecordIds).toEqual([1]);
    expect(skipPlan.skippedRecordIds).toEqual([2]);
    expect(skipPlan.conflictCount).toBe(1);

    const keepPlan = planRecordReassign({
      sourceRecords: [
        { id: 1, otherAxisId: 9, source: "text:a" },
        { id: 2, otherAxisId: 9, source: "text:a" }
      ],
      targetRecords: [],
      conflictStrategy: "keep-both"
    });

    expect(keepPlan.moveRecordIds).toEqual([1, 2]);
    expect(keepPlan.skippedRecordIds).toEqual([]);
  });

  test("overwrite 同一批挤已占用槽位：只删目标侧，不删本批先迁入的记录", () => {
    const plan = planRecordReassign({
      sourceRecords: [
        { id: 1, otherAxisId: 9, source: "text:a" },
        { id: 2, otherAxisId: 9, source: "text:a" }
      ],
      targetRecords: [{ id: 90, otherAxisId: 9, source: "text:a" }],
      conflictStrategy: "overwrite"
    });

    expect(plan.moveRecordIds).toEqual([1, 2]);
    expect(plan.skippedRecordIds).toEqual([]);
    expect(plan.deleteTargetRecordIds).toEqual([90]);
    expect(plan.conflictCount).toBe(2);
  });
});
