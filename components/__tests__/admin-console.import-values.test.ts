import { describe, expect, test } from "vitest";

import {
  composePairRawValue,
  formatPreviewNumericValue,
  parsePairRawValue,
  parseSingleRawValue
} from "@/components/admin-console/utils/import-values";

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

  test("成对值星号后的紧贴明确文本会作为注释", () => {
    const parsed = parsePairRawValue("81/77.3*paper");

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

  test("成对值短脚注标记不作为注释", () => {
    expect(parsePairRawValue("81/77.3*1")).toEqual({
      first: "81",
      second: "77.3*1",
      note: null
    });
    expect(parsePairRawValue("81/77.3*a")).toEqual({
      first: "81",
      second: "77.3*a",
      note: null
    });
    expect(parsePairRawValue("81/77.3^2")).toEqual({
      first: "81",
      second: "77.3^2",
      note: null
    });
  });

  test("成对值支持半空占位段", () => {
    expect(parsePairRawValue("-- / 66.1")).toEqual({
      first: "--",
      second: "66.1",
      note: null
    });
    expect(parsePairRawValue("66.1 / --")).toEqual({
      first: "66.1",
      second: "--",
      note: null
    });
    expect(composePairRawValue("--", "66.1")).toBe("-- / 66.1");
  });

  test("成对值保留量级后缀", () => {
    expect(parsePairRawValue("$1.03825M / $687.25k")).toEqual({
      first: "$1.03825M",
      second: "$687.25k",
      note: null
    });
  });

  test("单值解析识别量级后缀", () => {
    expect(parseSingleRawValue("1.2M")).toEqual({ value: "1.2M", tail: "" });
    expect(parseSingleRawValue("1.2M*")).toEqual({ value: "1.2M", tail: "*" });
    expect(parseSingleRawValue("1.2MB")).toEqual({ value: "1.2", tail: "MB" });
  });

  test("预览数值保持量级书写", () => {
    expect(formatPreviewNumericValue("$1.03825M", 1_038_250, "first")).toBe("$1.03825M");
    expect(formatPreviewNumericValue("$687.25k / $438k", 438_000, "second")).toBe("$438k");
    expect(formatPreviewNumericValue("128K", 128_000)).toBe("128K");
    expect(formatPreviewNumericValue("$438k", 438_500)).toBe("$438.5k");
  });

  test("无后缀的货币预览保持原有补零行为", () => {
    expect(formatPreviewNumericValue("$4,432.12", 4432.12)).toBe("$4,432.12");
  });
});
