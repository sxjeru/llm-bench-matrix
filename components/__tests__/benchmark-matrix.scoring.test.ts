import { describe, expect, test } from "vitest";

import {
  getMatrixCellDisplayValue,
  getMatrixCellPairDisplayParts
} from "@/components/benchmark-matrix/scoring";

describe("benchmark matrix value display", () => {
  test("双值展示保留紧贴数字的后缀", () => {
    expect(getMatrixCellDisplayValue(2, 3, "2x / 3x", null)).toBe("2x / 3x");

    const parts = getMatrixCellPairDisplayParts(2, 3, "2x / 3x", null);
    expect(parts).toEqual({
      first: "2x",
      second: "3x",
      hasCurrencySymbol: false
    });
  });

  test("双值展示将星号 note 收敛到末尾", () => {
    expect(getMatrixCellDisplayValue(58.4, 62.1, "58.4 / 62.1 *", "*")).toBe("58.4 / 62.1*");
  });

  test("带空格的单位后缀仍由数值列控制简洁展示", () => {
    expect(getMatrixCellDisplayValue(95, null, "95 ms", null)).toBe("95");
  });

  test("半空双值两侧都走数值归一化", () => {
    expect(getMatrixCellDisplayValue(null, 66.1, "-- / 66.10", null)).toBe("-- / 66.1");
    expect(getMatrixCellDisplayValue(66.1, null, "66.10 / --", null)).toBe("66.1 / --");

    expect(getMatrixCellPairDisplayParts(null, 66.1, "-- / 66.10", null)).toEqual({
      first: "--",
      second: "66.1",
      hasCurrencySymbol: false
    });
  });

  test("含斜杠的空占位不会被切分错位", () => {
    expect(getMatrixCellDisplayValue(null, 66.1, "n/a / 66.10", null)).toBe("n/a / 66.1");
    expect(getMatrixCellDisplayValue(66.1, null, "66.10 / n/a", null)).toBe("66.1 / n/a");
    expect(getMatrixCellDisplayValue(null, 66.1, "NA / 66.1", null)).toBe("NA / 66.1");

    expect(getMatrixCellPairDisplayParts(null, 66.1, "n/a / 66.10", null)).toEqual({
      first: "n/a",
      second: "66.1",
      hasCurrencySymbol: false
    });
  });

  test("非空占位的缺失侧不走 pair 展示，退回原始值", () => {
    expect(getMatrixCellDisplayValue(null, 66.1, "TBD / 66.1", null)).toBe("TBD / 66.1");
    expect(getMatrixCellPairDisplayParts(null, 66.1, "TBD / 66.1", null)).toBeNull();
  });

  test("两侧都无数值时不走 pair 展示", () => {
    expect(getMatrixCellPairDisplayParts(null, null, "- / -", null)).toBeNull();
    expect(getMatrixCellDisplayValue(null, null, "- / -", null)).toBe("- / -");
  });

  test("量级后缀按原书写回显，不展开成完整数字", () => {
    expect(getMatrixCellDisplayValue(1_200_000, null, "1.2M", null)).toBe("1.2M");
    expect(getMatrixCellDisplayValue(128_000, null, "128K", null)).toBe("128K");
    expect(getMatrixCellDisplayValue(1_038_250, null, "$1.03825M", null)).toBe("$1.03825M");
  });

  test("双值量级后缀同样保留原书写", () => {
    expect(getMatrixCellDisplayValue(1_038_250, 687_250, "$1.03825M / $687.25k", null))
      .toBe("$1.03825M / $687.25k");
    expect(getMatrixCellDisplayValue(128_000, 256_000, "128K / 256K", null))
      .toBe("128K / 256K");

    expect(getMatrixCellPairDisplayParts(1_038_250, 687_250, "$1.03825M / $687.25k", null)).toEqual({
      first: "$1.03825M",
      second: "$687.25k",
      hasCurrencySymbol: true
    });
  });

  test("小写脚注字母不会被当成量级", () => {
    // 非货币数值的 note 一直不进单元格文本，这里只确认不会被展开成 85.3B
    expect(getMatrixCellDisplayValue(85.3, null, "85.3b", "b")).toBe("85.3");
  });
});
