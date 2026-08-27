import { describe, expect, test } from "vitest";

import { resolveRecordsErrorStatus } from "@/app/api/admin/records/error-status";

describe("resolveRecordsErrorStatus", () => {
  test("实体不存在映射 404", () => {
    expect(resolveRecordsErrorStatus("model not found or merged: 1")).toBe(404);
    expect(resolveRecordsErrorStatus("benchmark not found")).toBe(404);
  });

  test("参数 / 前置条件类错误映射 400", () => {
    expect(resolveRecordsErrorStatus("没有需要保存的改动")).toBe(400);
    expect(resolveRecordsErrorStatus("单次最多保存 2000 处改动，当前 2001 处")).toBe(400);
    expect(resolveRecordsErrorStatus("草稿缺少有效的 modelId / benchmarkId")).toBe(400);
    expect(resolveRecordsErrorStatus("未设置任何筛选条件：如需清空全部数据请显式传 allowUnfiltered")).toBe(400);
    expect(resolveRecordsErrorStatus("批量归一化必须限定筛选范围（模型 / 指标 / source 至少一项）")).toBe(400);
    expect(resolveRecordsErrorStatus("当前筛选范围内没有可删除的数据")).toBe(400);
    expect(resolveRecordsErrorStatus("目标 source 与当前 source 相同，无需变更归属")).toBe(400);
    expect(resolveRecordsErrorStatus("source 不能为空：sourceMode=specific 需要给出具体 source")).toBe(400);
    expect(resolveRecordsErrorStatus("targetScale 只能是 1 或 100")).toBe(400);
  });

  test("未识别错误映射 500", () => {
    expect(resolveRecordsErrorStatus("database connection lost")).toBe(500);
    expect(resolveRecordsErrorStatus("unexpected failure")).toBe(500);
  });
});
