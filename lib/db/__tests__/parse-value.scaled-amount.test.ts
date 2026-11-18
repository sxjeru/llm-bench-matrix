import { describe, expect, test } from "vitest";

import { parseBenchmarkValue } from "@/lib/db/parse-value";
import {
  formatScaledAmountLike,
  hasMagnitudeSuffix,
  parseNumericTokenAmount,
  parseScaledAmount
} from "@/lib/import/scaled-amount";

describe("parseBenchmarkValue 量级后缀", () => {
  test("支持 k/K 与大写 M/B/T，且不要求货币符号", () => {
    expect(parseBenchmarkValue("1.2k").valueNum).toBeCloseTo(1200);
    expect(parseBenchmarkValue("1.2M").valueNum).toBeCloseTo(1_200_000);
    expect(parseBenchmarkValue("128K").valueNum).toBeCloseTo(128_000);
    expect(parseBenchmarkValue("1.5B").valueNum).toBeCloseTo(1_500_000_000);
    expect(parseBenchmarkValue("1.5T").valueNum).toBeCloseTo(1_500_000_000_000);
  });

  test("保留原始书写，量级不落进备注", () => {
    const parsed = parseBenchmarkValue("1.2M");

    expect(parsed.valueRaw).toBe("1.2M");
    expect(parsed.valueNote).toBeNull();
    expect(parsed.valueNum2).toBeNull();
  });

  test("支持题目里的货币量级写法", () => {
    const parsed = parseBenchmarkValue("$1.03825M");

    expect(parsed.valueRaw).toBe("$1.03825M");
    expect(parsed.valueNum).toBeCloseTo(1_038_250);
    expect(parsed.valueNote).toBeNull();
  });

  test("双值两侧分别换算", () => {
    const parsed = parseBenchmarkValue("$1.03825M / $687.25k");

    expect(parsed.valueRaw).toBe("$1.03825M / $687.25k");
    expect(parsed.valueNum).toBeCloseTo(1_038_250);
    expect(parsed.valueNum2).toBeCloseTo(687_250);
    expect(parsed.valueNote).toBeNull();
  });

  test("半空双值与星号标记继续生效", () => {
    const halfEmpty = parseBenchmarkValue("- / $317.5k");
    expect(halfEmpty.valueNum).toBeNull();
    expect(halfEmpty.valueNum2).toBeCloseTo(317_500);

    const starred = parseBenchmarkValue("1.2M*");
    expect(starred.valueRaw).toBe("1.2M*");
    expect(starred.valueNum).toBeCloseTo(1_200_000);
    expect(starred.valueNote).toBeNull();

    const starredNote = parseBenchmarkValue("1.2M*paper");
    expect(starredNote.valueRaw).toBe("1.2M*paper");
    expect(starredNote.valueNum).toBeCloseTo(1_200_000);
    expect(starredNote.valueNote).toBe("paper");
  });

  test("小写 m/b/t 保持脚注语义", () => {
    expect(parseBenchmarkValue("85.3b")).toMatchObject({
      valueRaw: "85.3b",
      valueNum: 85.3,
      valueNote: "b"
    });
    expect(parseBenchmarkValue("92.1t")).toMatchObject({
      valueRaw: "92.1t",
      valueNum: 92.1,
      valueNote: "t"
    });
    expect(parseBenchmarkValue("1.2m")).toMatchObject({
      valueRaw: "1.2m",
      valueNum: 1.2,
      valueNote: "m"
    });
  });

  test("后缀后接字母时整体回退为备注", () => {
    expect(parseBenchmarkValue("1.2MB")).toMatchObject({
      valueRaw: "1.2MB",
      valueNum: 1.2,
      valueNote: "MB"
    });
  });

  test("后缀与数字之间有空隙时不换算", () => {
    expect(parseBenchmarkValue("1.2 M")).toMatchObject({
      valueRaw: "1.2 M",
      valueNum: 1.2,
      valueNote: "M"
    });
  });

  test("已有 $ 完整数值的行为不变", () => {
    const parsed = parseBenchmarkValue("$4,432.12");

    expect(parsed.valueRaw).toBe("$4,432.12");
    expect(parsed.valueNum).toBeCloseTo(4432.12);
    expect(parsed.valueNote).toBeNull();
  });
});

describe("parseScaledAmount", () => {
  test("严格模式只接受完整 token", () => {
    expect(parseScaledAmount("$1,038.25k")?.amount).toBeCloseTo(1_038_250);
    expect(parseScaledAmount("1.2M*")).toBeNull();
    expect(parseScaledAmount("1.2MB")).toBeNull();
    expect(parseScaledAmount("1.2 M")).toBeNull();
  });
});

describe("parseNumericTokenAmount", () => {
  test("忽略星号等紧贴标记，量级仍然生效", () => {
    expect(parseNumericTokenAmount("$1.2M*")).toBeCloseTo(1_200_000);
    expect(parseNumericTokenAmount("1.2M^2")).toBeCloseTo(1_200_000);
    expect(parseNumericTokenAmount("1.2M*paper")).toBeCloseTo(1_200_000);
  });

  test("保持旧的后备解析行为，并支持 # 前缀与量级后缀组合", () => {
    expect(parseNumericTokenAmount("$4,432.12")).toBeCloseTo(4432.12);
    expect(parseNumericTokenAmount("#3.4")).toBeCloseTo(3.4);
    expect(parseNumericTokenAmount("#1.2M")).toBeCloseTo(1_200_000);
    expect(parseNumericTokenAmount("＃128K*")).toBeCloseTo(128_000);
    expect(parseBenchmarkValue("#1.2M").valueNum).toBeCloseTo(1_200_000);
    expect(hasMagnitudeSuffix("#1.2M")).toBe(true);
    expect(hasMagnitudeSuffix("#3.4")).toBe(false);
    expect(parseNumericTokenAmount("none")).toBeNull();
  });
});

describe("formatScaledAmountLike", () => {
  test("数值未变化时保持原书写", () => {
    expect(formatScaledAmountLike("$1.03825M", 1_038_250)).toBe("$1.03825M");
    expect(formatScaledAmountLike("128K", 128_000)).toBe("128K");
  });

  test("数值变化后沿用原量级", () => {
    expect(formatScaledAmountLike("$438k", 438_500)).toBe("$438.5k");
    expect(formatScaledAmountLike("$1.2M", 2_000_000)).toBe("$2M");
  });

  test("无法同量级表达时返回 null，由调用方回退", () => {
    expect(formatScaledAmountLike("$1.2M", 1)).toBeNull();
    expect(formatScaledAmountLike("$4,432.12", 5000)).toBeNull();
  });
});
