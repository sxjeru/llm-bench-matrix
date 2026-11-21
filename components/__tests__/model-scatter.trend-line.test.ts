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
      intercept: 1
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
      intercept: 10
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
      intercept: 1
    });
  });

  it.each([
    { xScale: "log", yScale: "linear", points: [{ x: 1, y: 1 }, { x: 10, y: 3 }, { x: 100, y: 5 }] },
    { xScale: "linear", yScale: "log", points: [{ x: 0, y: 10 }, { x: 1, y: 1000 }, { x: 2, y: 100000 }] },
    { xScale: "log", yScale: "log", points: [{ x: 1, y: 10 }, { x: 10, y: 1000 }, { x: 100, y: 100000 }] }
  ] as const)("在 $xScale / $yScale 刻度中拟合显示坐标", ({ xScale, yScale, points }) => {
    expect(computeScatterTrendLine(points, xScale, yScale)).toEqual({ slope: 2, intercept: 1 });
  });
});
