import { describe, expect, test } from "vitest";
import {
  computeDeletionBlocking,
  type DeletionCandidateModelRow
} from "@/scripts/backfill-model-params.mjs";

/**
 * 删除原 benchmark 是不可逆操作，computeDeletionBlocking 是唯一的安全闸门：
 * 只有返回空数组才允许删除。
 */

function modelRow(overrides: Partial<DeletionCandidateModelRow> = {}): DeletionCandidateModelRow {
  return {
    model_id: 1,
    model_name: "Model A",
    merged_into_model_id: null,
    total_params_b: null,
    value_count: "1",
    ...overrides
  };
}

describe("computeDeletionBlocking", () => {
  test("模型已有参数量时不阻塞删除", () => {
    const rows = [modelRow({ total_params_b: "397.000" })];

    expect(computeDeletionBlocking(rows, new Set())).toEqual([]);
  });

  test("本次待写入的模型不阻塞删除", () => {
    const rows = [modelRow({ model_id: 42, total_params_b: null })];

    expect(computeDeletionBlocking(rows, new Set([42]))).toEqual([]);
  });

  test("未迁移的活跃模型会阻塞删除", () => {
    const rows = [modelRow({ model_id: 7, model_name: "Unmigrated", value_count: "3" })];

    expect(computeDeletionBlocking(rows, new Set())).toEqual([
      { modelName: "Unmigrated", valueCount: 3, reason: "参数量未迁移成功" }
    ]);
  });

  test("挂在已合并模型上的记录会阻塞删除，并标明原因", () => {
    const rows = [
      modelRow({ model_id: 9, model_name: "Merged Away", merged_into_model_id: 1, value_count: "2" })
    ];

    expect(computeDeletionBlocking(rows, new Set())).toEqual([
      { modelName: "Merged Away", valueCount: 2, reason: "模型已被合并，未参与迁移" }
    ]);
  });

  test("参数量为 0 或非法值仍视为未填写", () => {
    const rows = [modelRow({ total_params_b: "0" }), modelRow({ model_id: 2, total_params_b: "abc" })];

    expect(computeDeletionBlocking(rows, new Set())).toHaveLength(2);
  });

  test("混合场景只保留真正会丢数据的模型", () => {
    const rows = [
      modelRow({ model_id: 1, model_name: "Already", total_params_b: "120.000" }),
      modelRow({ model_id: 2, model_name: "Planned" }),
      modelRow({ model_id: 3, model_name: "Blocked", value_count: "5" })
    ];

    expect(computeDeletionBlocking(rows, new Set([2]))).toEqual([
      { modelName: "Blocked", valueCount: 5, reason: "参数量未迁移成功" }
    ]);
  });
});
