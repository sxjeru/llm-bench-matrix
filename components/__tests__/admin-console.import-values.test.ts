import { describe, expect, test } from "vitest";

import { composePairRawValue, parsePairRawValue } from "@/components/admin-console/utils/import-values";

describe("admin console import value helpers", () => {
  test("成对值第二段紧贴星号时不把星号作为注释", () => {
    expect(parsePairRawValue("81/77.3*")).toEqual({
      first: "81",
      second: "77.3*",
      note: null
    });
  });

  test("成对值第一段紧贴星号时不把星号作为注释", () => {
    expect(parsePairRawValue("91*/83")).toEqual({
      first: "91*",
      second: "83",
      note: null
    });
  });

  test("成对值星号后的明确文本才会作为注释", () => {
    const parsed = parsePairRawValue("81/77.3* paper");

    expect(parsed).toEqual({
      first: "81",
      second: "77.3*",
      note: "paper"
    });
    expect(composePairRawValue(parsed!.first, parsed!.second, parsed!.note)).toBe("81 / 77.3* paper");
  });

  test("成对值星号 URL 语法保留星号并提取注释", () => {
    expect(parsePairRawValue("81/77.3*://https://paper.example")).toEqual({
      first: "81",
      second: "77.3*",
      note: "https://paper.example"
    });
  });
});
