import { describe, expect, test } from "vitest";

import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import type { MatrixCellEntry } from "@/components/benchmark-matrix/types";
import {
  compareMatrixCellEntryRecency,
  getLatestMatrixCellEntry,
  getSourceValueEntry
} from "@/components/benchmark-matrix/utils";

function makeEntry(overrides: Partial<MatrixCellEntry> & { valueRaw: string }): MatrixCellEntry {
  return {
    recordId: null,
    valueNum: Number.isFinite(Number(overrides.valueRaw)) ? Number(overrides.valueRaw) : null,
    valueNum2: null,
    valueNote: null,
    source: "text:S1",
    benchTime: null,
    ...overrides
  };
}

describe("同 source 多次导入的原始值取值", () => {
  test("取最新一次导入，而非指标方向上的最优值", () => {
    const entries = [
      makeEntry({ valueRaw: "80", benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "85", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getSourceValueEntry(entries, "text:S1", true)?.valueRaw).toBe("80");
  });

  test("lower-is-better 指标同样按时间取值，不再取最小值", () => {
    const entries = [
      makeEntry({ valueRaw: "12", benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "9", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getSourceValueEntry(entries, "text:S1", false)?.valueRaw).toBe("12");
  });

  test("最新一条是占位值时跳过，取最新的有效记录", () => {
    const entries = [
      makeEntry({ valueRaw: "N/A", benchTime: "2026-05-01T00:00:00.000Z", recordId: 3 }),
      makeEntry({ valueRaw: "85", benchTime: "2026-04-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "80", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getLatestMatrixCellEntry(entries)?.valueRaw).toBe("85");
  });

  test("全部是占位值时回退到最新那条", () => {
    const entries = [
      makeEntry({ valueRaw: "-", benchTime: "2026-03-01T00:00:00.000Z", recordId: 1 }),
      makeEntry({ valueRaw: "n/a", benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 })
    ];

    expect(getLatestMatrixCellEntry(entries)?.valueRaw).toBe("n/a");
  });

  test("有意义的非数值文本不算占位，仍参与取最新", () => {
    const entries = [
      makeEntry({ valueRaw: "pass", valueNum: null, benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "80", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getLatestMatrixCellEntry(entries)?.valueRaw).toBe("pass");
  });

  test("benchTime 相同时按 recordId 取后导入的一条", () => {
    const entries = [
      makeEntry({ valueRaw: "80", benchTime: "2026-04-01T00:00:00.000Z", recordId: 7 }),
      makeEntry({ valueRaw: "85", benchTime: "2026-04-01T00:00:00.000Z", recordId: 9 })
    ];

    expect(getLatestMatrixCellEntry(entries)?.valueRaw).toBe("85");
  });

  test("缺失 benchTime 或 recordId 的记录视为更旧", () => {
    const missingTime = makeEntry({ valueRaw: "99", benchTime: null, recordId: 100 });
    const hasTime = makeEntry({ valueRaw: "80", benchTime: "2026-01-01T00:00:00.000Z", recordId: 1 });
    expect(compareMatrixCellEntryRecency(missingTime, hasTime)).toBeLessThan(0);
    expect(getLatestMatrixCellEntry([missingTime, hasTime])?.valueRaw).toBe("80");

    const missingId = makeEntry({ valueRaw: "70", benchTime: "2026-04-01T00:00:00.000Z", recordId: null });
    const hasId = makeEntry({ valueRaw: "75", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 });
    expect(compareMatrixCellEntryRecency(missingId, hasId)).toBeLessThan(0);
    expect(getLatestMatrixCellEntry([missingId, hasId])?.valueRaw).toBe("75");
  });

  test("时间与 id 都相同时保留先出现的一条", () => {
    const entries = [
      makeEntry({ valueRaw: "80", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 }),
      makeEntry({ valueRaw: "85", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(compareMatrixCellEntryRecency(entries[0]!, entries[1]!)).toBe(0);
    expect(getLatestMatrixCellEntry(entries)?.valueRaw).toBe("80");
  });

  test("空数组返回 null", () => {
    expect(getLatestMatrixCellEntry([])).toBeNull();
  });

  test("只统计当前 source 的记录，其他 source 更新也不参与", () => {
    const entries = [
      makeEntry({ valueRaw: "90", source: "text:S2", benchTime: "2026-06-01T00:00:00.000Z", recordId: 3 }),
      makeEntry({ valueRaw: "80", source: "text:S1", benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "85", source: "text:S1", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getSourceValueEntry(entries, "text:S1", true)?.valueRaw).toBe("80");
  });

  test("当前 source 无记录时回退到跨 source 的最优值", () => {
    const entries = [
      makeEntry({ valueRaw: "90", source: "text:S2", benchTime: "2026-06-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "95", source: "text:S3", benchTime: "2026-01-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getSourceValueEntry(entries, "text:S1", true)).toBeNull();
  });

  test("全部页签仍按指标方向取最优值", () => {
    const entries = [
      makeEntry({ valueRaw: "80", benchTime: "2026-05-01T00:00:00.000Z", recordId: 2 }),
      makeEntry({ valueRaw: "85", benchTime: "2026-04-01T00:00:00.000Z", recordId: 1 })
    ];

    expect(getSourceValueEntry(entries, SOURCE_ALL, true)?.valueRaw).toBe("85");
    expect(getSourceValueEntry(entries, SOURCE_ALL, false)?.valueRaw).toBe("80");
  });
});
