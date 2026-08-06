import { describe, expect, it } from "vitest";
import { computeScatterTrendLine } from "@/components/model-scatter/trend-line";

describe("computeScatterTrendLine", () => {
  it("计算正相关数据的回归线", () => {
    expect(
      computeScatterTrendLine([
        { x: 1, y: 3 },
        { x: 2, y: 5 },
        { x: 3, y: 7 }
      ])
    ).toEqual({
      slope: 2,
      intercept: 1,
      start: { x: 1, y: 3 },
      end: { x: 3, y: 7 }
    });
  });

  it("计算负相关数据的回归线", () => {
    expect(
      computeScatterTrendLine([
        { x: 1, y: 8 },
        { x: 2, y: 6 },
        { x: 3, y: 4 }
      ])
    ).toEqual({
      slope: -2,
      intercept: 10,
      start: { x: 1, y: 8 },
      end: { x: 3, y: 4 }
    });
  });

  it("少于两个点或 X 值无差异时不返回回归线", () => {
    expect(computeScatterTrendLine([{ x: 1, y: 3 }])).toBeNull();
    expect(
      computeScatterTrendLine([
        { x: 2, y: 3 },
        { x: 2, y: 5 }
      ])
    ).toBeNull();
  });

  it("忽略非有限数值", () => {
    expect(
      computeScatterTrendLine([
        { x: 1, y: 3 },
        { x: Number.NaN, y: 5 },
        { x: 2, y: 5 },
        { x: 3, y: Number.POSITIVE_INFINITY }
      ])
    ).toEqual({
      slope: 2,
      intercept: 1,
      start: { x: 1, y: 3 },
      end: { x: 2, y: 5 }
    });
  });
});