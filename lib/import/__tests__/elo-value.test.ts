import { describe, expect, test } from "vitest";
import { hasEloCandidateValue } from "@/lib/import/elo-value";
import { hasMagnitudeSuffix } from "@/lib/import/scaled-amount";

describe("hasMagnitudeSuffix", () => {
  test("识别带 k/K/M/B/T 量级后缀的 token（含货币符号与尾随标记）", () => {
    expect(hasMagnitudeSuffix("$1.2M")).toBe(true);
    expect(hasMagnitudeSuffix("$687.25k")).toBe(true);
    expect(hasMagnitudeSuffix("128K")).toBe(true);
    expect(hasMagnitudeSuffix("1.5B")).toBe(true);
    expect(hasMagnitudeSuffix("2T")).toBe(true);
    expect(hasMagnitudeSuffix("$1.2M*")).toBe(true);
    expect(hasMagnitudeSuffix("1.2M*paper")).toBe(true);
    expect(hasMagnitudeSuffix("128K^2")).toBe(true);
    expect(hasMagnitudeSuffix("  $1,038.25k note")).toBe(true);
  });

  test("不把普通数字、小写 m/b/t 脚注或后接字母单位识别为量级后缀", () => {
    expect(hasMagnitudeSuffix("1215")).toBe(false);
    expect(hasMagnitudeSuffix("1,215")).toBe(false);
    expect(hasMagnitudeSuffix("1215*")).toBe(false);
    expect(hasMagnitudeSuffix("$1,200")).toBe(false);
    expect(hasMagnitudeSuffix("85.3b")).toBe(false);
    expect(hasMagnitudeSuffix("1200m")).toBe(false);
    expect(hasMagnitudeSuffix("1.2MB")).toBe(false);
    expect(hasMagnitudeSuffix("1.2 M")).toBe(false);
    expect(hasMagnitudeSuffix("n/a")).toBe(false);
    expect(hasMagnitudeSuffix("")).toBe(false);
  });
});

describe("hasEloCandidateValue", () => {
  test("排除带量级后缀的 >100 换算值", () => {
    expect(hasEloCandidateValue({ rawValue: "$1.2M", valueNum: 1_200_000, valueNum2: null })).toBe(false);
    expect(hasEloCandidateValue({ rawValue: "128K", valueNum: 128_000, valueNum2: null })).toBe(false);
    expect(hasEloCandidateValue({ rawValue: "1.5B", valueNum: 1_500_000_000, valueNum2: null })).toBe(false);
    expect(hasEloCandidateValue({ rawValue: "2T", valueNum: 2_000_000_000_000, valueNum2: null })).toBe(false);
    expect(hasEloCandidateValue({ rawValue: "$687.25k*", valueNum: 687_250, valueNum2: null })).toBe(false);
  });

  test("普通 >100 数值仍判定为 Elo 候选", () => {
    expect(hasEloCandidateValue({ rawValue: "1215", valueNum: 1215, valueNum2: null })).toBe(true);
    expect(hasEloCandidateValue({ rawValue: "1,215*", valueNum: 1215, valueNum2: null })).toBe(true);
    expect(hasEloCandidateValue({ rawValue: "100", valueNum: 100, valueNum2: null })).toBe(false);
    expect(hasEloCandidateValue({ rawValue: "85.3", valueNum: 85.3, valueNum2: null })).toBe(false);
  });

  test("双值单元格按段独立判定量级后缀", () => {
    expect(hasEloCandidateValue({
      rawValue: "$1.2M / $687.25k",
      valueNum: 1_200_000,
      valueNum2: 687_250
    })).toBe(false);

    expect(hasEloCandidateValue({
      rawValue: "n/a / $317.5k",
      valueNum: null,
      valueNum2: 317_500
    })).toBe(false);

    expect(hasEloCandidateValue({
      rawValue: "$1.2M / 50",
      valueNum: 1_200_000,
      valueNum2: 50
    })).toBe(false);

    expect(hasEloCandidateValue({
      rawValue: "$1.2M / 1215",
      valueNum: 1_200_000,
      valueNum2: 1215
    })).toBe(true);

    expect(hasEloCandidateValue({
      rawValue: "1215 / 128K",
      valueNum: 1215,
      valueNum2: 128_000
    })).toBe(true);

    expect(hasEloCandidateValue({
      rawValue: "85 / 1215",
      valueNum: 85,
      valueNum2: 1215
    })).toBe(true);
  });
});
