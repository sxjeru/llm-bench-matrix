import { describe, expect, test } from "vitest";

import type {
  AdminRecordCell,
  AdminRecordMatrix,
  AdminRecordMatrixBenchmark,
  AdminRecordMatrixModel,
  CellDraft
} from "@/components/admin-console/types";
import {
  buildCellIndex,
  buildDraftSavePayload,
  clearCellDrafts,
  countDirtyDrafts,
  countPendingDeleteDrafts,
  fillCellDrafts,
  formatBatchSaveSummary,
  getCellDisplayValue,
  getCellKey,
  getSelectedCellRefs,
  getSelectionCellCount,
  isCellInSelection,
  isPendingDeleteDraft,
  normalizeSelectionRange,
  setCellDraftValue
} from "@/components/admin-console/utils/record-drafts";

function cell(overrides: Partial<AdminRecordCell> = {}): AdminRecordCell {
  return {
    modelId: 1,
    benchmarkId: 11,
    recordId: 101,
    recordIds: [101, 102],
    recordCount: 2,
    valueRaw: "77",
    valueNum: 77,
    valueNum2: null,
    valueNote: null,
    source: "text:src",
    benchTime: "2026-04-01T00:00:00.000Z",
    ...overrides
  };
}

function matrixModel(overrides: Partial<AdminRecordMatrixModel> = {}): AdminRecordMatrixModel {
  return {
    modelId: 1,
    modelName: "Model A",
    providerId: 1,
    providerName: "OpenAI",
    providerDisplayName: "OpenAI",
    recordCount: 1,
    ...overrides
  };
}

function matrixBenchmark(overrides: Partial<AdminRecordMatrixBenchmark> = {}): AdminRecordMatrixBenchmark {
  return {
    benchmarkId: 11,
    benchmarkName: "Bench-1",
    benchmarkType: "Type-A",
    unit: "%",
    higherIsBetter: true,
    modalities: ["Text"],
    recordCount: 1,
    ...overrides
  };
}

describe("record draft selection", () => {
  test("框选范围会归一化并统计格子数", () => {
    const range = { startRow: 2, startCol: 3, endRow: 0, endCol: 1 };
    expect(normalizeSelectionRange(range)).toEqual({
      rowStart: 0,
      rowEnd: 2,
      colStart: 1,
      colEnd: 3
    });
    expect(getSelectionCellCount(range)).toBe(9);
    expect(isCellInSelection(range, 1, 2)).toBe(true);
    expect(isCellInSelection(range, 3, 2)).toBe(false);
    expect(getSelectionCellCount(null)).toBe(0);
  });

  test("选区映射到可见模型/指标，越界轴被跳过", () => {
    const refs = getSelectedCellRefs(
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      [matrixModel({ modelId: 1 }), matrixModel({ modelId: 2, modelName: "Model B" })],
      [matrixBenchmark({ benchmarkId: 11 }), matrixBenchmark({ benchmarkId: 12, benchmarkName: "Bench-2" })]
    );

    expect(refs).toEqual([
      { row: 0, col: 0, modelId: 1, benchmarkId: 11 },
      { row: 0, col: 1, modelId: 1, benchmarkId: 12 },
      { row: 1, col: 0, modelId: 2, benchmarkId: 11 },
      { row: 1, col: 1, modelId: 2, benchmarkId: 12 }
    ]);

    expect(
      getSelectedCellRefs(
        { startRow: 0, startCol: 0, endRow: 5, endCol: 5 },
        [matrixModel()],
        [matrixBenchmark()]
      )
    ).toEqual([{ row: 0, col: 0, modelId: 1, benchmarkId: 11 }]);
  });
});

describe("setCellDraftValue", () => {
  test("改值写入草稿，改回原值则摘掉", () => {
    const existing = cell();
    const dirty = setCellDraftValue({}, {
      modelId: 1,
      benchmarkId: 11,
      cell: existing,
      nextValueRaw: " 88 ",
      newRecordSource: "text:new"
    });

    expect(dirty[getCellKey(1, 11)]).toEqual({
      modelId: 1,
      benchmarkId: 11,
      recordId: 101,
      recordIds: [101, 102],
      originalValueRaw: "77",
      nextValueRaw: "88",
      source: "text:src"
    });

    const reverted = setCellDraftValue(dirty, {
      modelId: 1,
      benchmarkId: 11,
      cell: existing,
      nextValueRaw: "77",
      newRecordSource: "text:new"
    });
    expect(reverted).toEqual({});
  });

  test("空单元格新增会带上 newRecordSource；本来就是空再清空不算脏", () => {
    const created = setCellDraftValue({}, {
      modelId: 1,
      benchmarkId: 11,
      cell: undefined,
      nextValueRaw: "12",
      newRecordSource: "text:new"
    });

    expect(created[getCellKey(1, 11)]).toEqual(
      expect.objectContaining({
        recordId: null,
        recordIds: [],
        originalValueRaw: "",
        nextValueRaw: "12",
        source: "text:new"
      })
    );

    expect(
      setCellDraftValue(created, {
        modelId: 1,
        benchmarkId: 11,
        cell: undefined,
        nextValueRaw: "",
        newRecordSource: "text:new"
      })
    ).toEqual({});
  });
});

describe("selection fill / clear / payload", () => {
  const models = [matrixModel({ modelId: 1 }), matrixModel({ modelId: 2, modelName: "Model B" })];
  const benchmarks = [matrixBenchmark({ benchmarkId: 11 })];
  const matrix: AdminRecordMatrix = {
    generatedAt: "2026-04-01T00:00:00.000Z",
    models,
    benchmarks,
    cells: [cell({ modelId: 1, benchmarkId: 11 })],
    totalRecordCount: 1,
    visibleRecordCount: 1,
    modelTotalCount: 2,
    benchmarkTotalCount: 1,
    truncated: { models: false, benchmarks: false },
    limits: { modelLimit: 40, benchmarkLimit: 30 }
  };

  test("清空已有格记待删除，清空空格不产生草稿", () => {
    const refs = getSelectedCellRefs(
      { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
      models,
      benchmarks
    );
    const next = clearCellDrafts({}, refs, buildCellIndex(matrix), "text:new");

    expect(countDirtyDrafts(next)).toBe(1);
    expect(countPendingDeleteDrafts(next)).toBe(1);
    expect(isPendingDeleteDraft(next[getCellKey(1, 11)])).toBe(true);
    expect(next[getCellKey(2, 11)]).toBeUndefined();
  });

  test("填充会覆盖选区，保存 payload 把空值标成 isDeleted", () => {
    const refs = getSelectedCellRefs(
      { startRow: 0, startCol: 0, endRow: 1, endCol: 0 },
      models,
      benchmarks
    );
    const filled = fillCellDrafts({}, refs, buildCellIndex(matrix), "99", "text:new");

    expect(getCellDisplayValue(cell(), filled[getCellKey(1, 11)])).toBe("99");
    expect(getCellDisplayValue(undefined, filled[getCellKey(2, 11)])).toBe("99");

    const cleared: Record<string, CellDraft> = {
      ...filled,
      [getCellKey(1, 11)]: {
        ...filled[getCellKey(1, 11)]!,
        nextValueRaw: ""
      }
    };

    expect(buildDraftSavePayload(cleared)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 1,
          benchmarkId: 11,
          recordId: 101,
          valueRaw: "",
          isDeleted: true
        }),
        expect.objectContaining({
          modelId: 2,
          benchmarkId: 11,
          recordId: null,
          valueRaw: "99",
          source: "text:new",
          isDeleted: false
        })
      ])
    );
  });
});

describe("formatBatchSaveSummary", () => {
  test("按实际改动拼通知文案", () => {
    expect(formatBatchSaveSummary({ inserted: 1, updated: 2, deleted: 3, unchanged: 4 })).toBe(
      "保存完成：新增 1 · 修改 2 · 删除 3 · 跳过 4"
    );
    expect(formatBatchSaveSummary({ inserted: 0, updated: 0, deleted: 0, unchanged: 0 })).toBe(
      "保存完成：无实际改动"
    );
  });
});
