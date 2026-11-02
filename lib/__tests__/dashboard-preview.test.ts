import { describe, expect, test } from "vitest";

import { buildDefaultViewRows } from "@/lib/dashboard-preview";
import { deserializeAaRevisions } from "@/lib/aa-revision-serialization";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

function makeRow(overrides: Partial<MatrixInputRow>): MatrixInputRow {
  return {
    recordId: 1,
    providerName: "OpenAI",
    modelName: "GPT-5",
    benchmarkName: "MMLU",
    benchmarkType: "Knowledge",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "88.1",
    valueNum: 88.1,
    ...overrides
  };
}

/** 覆盖 8 个模型 × 2 个指标，足够触发 40% 的行/列覆盖率阈值 */
function makeRows(): MatrixInputRow[] {
  const rows: MatrixInputRow[] = [];
  let id = 0;
  for (let modelIndex = 0; modelIndex < 8; modelIndex += 1) {
    for (const benchmark of ["MMLU", "GPQA"]) {
      id += 1;
      rows.push(makeRow({
        recordId: id,
        modelName: `Model ${modelIndex}`,
        benchmarkName: benchmark,
        valueRaw: String(60 + modelIndex),
        valueNum: 60 + modelIndex
      }));
    }
  }
  return rows;
}

describe("首屏预览行集", () => {
  test("裁剪结果保持原始行顺序，而不是按模型分组", () => {
    const rows = makeRows();
    const previewRows = buildDefaultViewRows(rows);

    expect(previewRows.length).toBeGreaterThan(0);
    // 原始数组是「模型 → 指标」，裁剪结果必须是它的子序列
    const originalIndex = new Map(rows.map((row, index) => [row, index]));
    const indexes = previewRows.map((row) => originalIndex.get(row) ?? -1);
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });

  test("行序在输入被打乱后依然等于原序", () => {
    const rows = makeRows();
    const reversed = [...rows].reverse();
    const previewRows = buildDefaultViewRows(reversed);

    const orderInReversed = new Map(reversed.map((row, index) => [row, index]));
    const indexes = previewRows.map((row) => orderInReversed.get(row) ?? -1);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });

  test("AA 划分反序列化保留模型条目与版本号", () => {
    const revisions = deserializeAaRevisions({
      "aa:intelligence": {
        latestVersion: "v5",
        latestEntriesByModel: {
          "GPT-5": {
            recordId: 7,
            valueRaw: "88.1",
            valueNum: 88.1,
            valueNum2: null,
            valueNote: null,
            source: "text:Artificial Analysis",
            benchTime: "2026-04-06T00:00:00.000Z"
          }
        }
      }
    });

    expect(revisions).not.toBeNull();
    const revision = revisions!.get("aa:intelligence");
    expect(revision?.latestVersion).toBe("v5");
    expect(revision?.latestEntriesByModel.get("GPT-5")?.recordId).toBe(7);
  });

  test("没有 AA 划分时不伪造一个空表", () => {
    expect(deserializeAaRevisions(undefined)).toBeNull();
  });
});
