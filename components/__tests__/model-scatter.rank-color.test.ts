import { describe, expect, test } from "vitest";

import {
  computeScatterRankRange,
  getScatterRankColor,
  toScatterRankScore
} from "@/components/model-scatter/rank-color";

describe("toScatterRankScore", () => {
  test("线性轴直接用原值，越小越好取负", () => {
    expect(toScatterRankScore(10, true, "linear")).toBe(10);
    expect(toScatterRankScore(10, false, "linear")).toBe(-10);
  });

  test("对数轴按 log 排名，非正数不可比", () => {
    expect(toScatterRankScore(100, true, "log")).toBeCloseTo(Math.log(100));
    expect(toScatterRankScore(0, true, "log")).toBeNull();
    expect(toScatterRankScore(-1, false, "log")).toBeNull();
  });
});

describe("computeScatterRankRange", () => {
  test("边界只看有数值点", () => {
    const range = computeScatterRankRange([1, 10, Number.NaN], true, "linear");
    expect(range).toEqual({ min: 1, max: 10 });
  });

  test("对数边界在 log 空间", () => {
    const range = computeScatterRankRange([1, 100, 10], true, "log");
    expect(range.min).toBeCloseTo(Math.log(1));
    expect(range.max).toBeCloseTo(Math.log(100));
  });
});

describe("getScatterRankColor", () => {
  const values = [1, 10, 100];

  test("缺有效范围时返回 null", () => {
    expect(getScatterRankColor(Number.NaN, values, true, "linear")).toBeNull();
    expect(getScatterRankColor(1, [], true, "linear")).toBeNull();
  });

  test("线性高低值颜色不同且不透明", () => {
    const low = getScatterRankColor(1, values, true, "linear")!;
    const high = getScatterRankColor(100, values, true, "linear")!;
    expect(low.startsWith("rgb(")).toBe(true);
    expect(high.startsWith("rgb(")).toBe(true);
    expect(low).not.toContain("rgba");
    expect(low).not.toBe(high);
  });

  test("对数轴中位数在 log 中点，而不是线性中点", () => {
    // log 中点是 10；线性中点是 50.5
    const logMid = getScatterRankColor(10, values, true, "log")!;
    const linearMid = getScatterRankColor(10, values, true, "linear")!;
    const linearTrueMid = getScatterRankColor(50.5, values, true, "linear")!;

    expect(logMid).not.toBe(linearMid);
    // 对数中点应接近线性真中点的中位色（都是 mid 附近）
    expect(logMid).toBe(linearTrueMid);
  });
});
