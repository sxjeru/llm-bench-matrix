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
});
