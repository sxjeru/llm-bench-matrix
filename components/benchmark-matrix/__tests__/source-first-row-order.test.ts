import { describe, expect, test } from "vitest";
import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import { buildFirstRowSourceOptions, buildSourceOptions } from "@/components/benchmark-matrix/selectors";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

function createRow(
  source: string,
  timeStr?: string,
  recordId?: number,
  updatedAt?: string
): MatrixInputRow {
  return {
    recordId,
    providerName: "Provider",
    modelName: `Model ${source}`,
    benchmarkName: "Bench",
    benchmarkType: "General",
    benchTime: timeStr ?? "",
    valueRaw: "80",
    valueNum: 80,
    source,
    updatedAt
  };
}

describe("buildFirstRowSourceOptions", () => {
  test("All 为第一，Artificial Analysis 为第二，后面按最近添加时间倒序", () => {
    const rows = [
      createRow("text:Artificial Analysis", "2026-04-01T00:00:00.000Z"),
      createRow("text:Claude 3.7", "2026-05-10T00:00:00.000Z"),
      createRow("text:GPT-4.5", "2026-05-09T00:00:00.000Z"),
      createRow("text:DeepSeek-V3", "2026-05-08T00:00:00.000Z"),
      createRow("text:Alpha", "2026-03-01T00:00:00.000Z")
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:Artificial Analysis",
      "text:Claude 3.7",
      "text:GPT-4.5",
      "text:DeepSeek-V3",
      "text:Alpha"
    ]);
  });

  test("无 Artificial Analysis 时 All 为第一，随后按最近添加时间倒序", () => {
    const rows = [
      createRow("text:Alpha", "2026-05-01T00:00:00.000Z"),
      createRow("text:Beta", "2026-05-12T00:00:00.000Z"),
      createRow("text:Gamma", "2026-05-08T00:00:00.000Z")
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:Beta",
      "text:Gamma",
      "text:Alpha"
    ]);
  });

  test("无时间戳时按 recordId 倒序，有时间戳优先于无时间戳", () => {
    const rows = [
      createRow("text:NoTimeRecentId", "", 105),
      createRow("text:NoTimeOldId", "", 10),
      createRow("text:HasTime", "2026-05-01T00:00:00.000Z", 50)
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:HasTime",
      "text:NoTimeRecentId",
      "text:NoTimeOldId"
    ]);
  });

  test("多个 source 无时间无 recordId 时按版本/字母排序", () => {
    const sourceOptions = [
      { key: SOURCE_ALL, label: "All" },
      { key: "text:Beta", label: "Beta" },
      { key: "text:Alpha", label: "Alpha" }
    ];

    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, []);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:Alpha",
      "text:Beta"
    ]);
  });

  test("旧 source 后续写入不会把它排到更晚添加的 source 前面", () => {
    const rows = [
      createRow("text:OldSource", "2026-03-01T00:00:00.000Z", 10, "2026-03-01T00:00:00.000Z"),
      createRow("text:OldSource", "2026-05-20T00:00:00.000Z", 200, "2026-05-20T00:00:00.000Z"),
      createRow("text:NewSource", "2026-05-10T00:00:00.000Z", 50, "2026-05-10T00:00:00.000Z")
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:NewSource",
      "text:OldSource"
    ]);
  });

  test("优先用 updatedAt（写入时间）而不是 benchTime（评测日期）判断添加先后", () => {
    const rows = [
      createRow("text:OldEvalRecent", "2026-05-20T00:00:00.000Z", 10, "2026-03-01T00:00:00.000Z"),
      createRow("text:NewEvalOlder", "2026-04-01T00:00:00.000Z", 50, "2026-05-10T00:00:00.000Z")
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "text:NewEvalOlder",
      "text:OldEvalRecent"
    ]);
  });

  test("识别不带 text: 前缀的 Artificial Analysis", () => {
    const rows = [
      createRow("Artificial Analysis", "2026-04-01T00:00:00.000Z"),
      createRow("text:NewModel", "2026-05-10T00:00:00.000Z")
    ];

    const sourceOptions = buildSourceOptions(rows, []);
    const firstRowOptions = buildFirstRowSourceOptions(sourceOptions, rows);

    expect(firstRowOptions.map((opt) => opt.key)).toEqual([
      SOURCE_ALL,
      "Artificial Analysis",
      "text:NewModel"
    ]);
  });
});
