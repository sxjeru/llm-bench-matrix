import { describe, expect, it } from "vitest";
import {
  buildParetoStepPoints,
  computeParetoFrontier,
  orderParetoPath,
  type ParetoInput
} from "@/components/model-scatter/pareto";

function frontierOf(
  points: readonly ParetoInput[],
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean
): string[] {
  return [...computeParetoFrontier(points, xHigherIsBetter, yHigherIsBetter)].sort();
}

describe("computeParetoFrontier", () => {
  it("空集与单点", () => {
    expect(computeParetoFrontier([], true, true).size).toBe(0);
    expect(frontierOf([{ key: "only", x: 3, y: 7 }], true, true)).toEqual(["only"]);
  });

  it("两轴都越大越好时淘汰被全面压制的点", () => {
    const points: ParetoInput[] = [
      { key: "best", x: 10, y: 10 },
      { key: "wide", x: 12, y: 4 },
      { key: "tall", x: 3, y: 14 },
      { key: "dominated", x: 5, y: 5 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["best", "tall", "wide"]);
  });

  it("两轴都越小越好时方向整体翻转", () => {
    const points: ParetoInput[] = [
      { key: "cheapest", x: 1, y: 1 },
      { key: "worst", x: 9, y: 9 },
      { key: "mixed", x: 0.5, y: 6 }
    ];

    expect(frontierOf(points, false, false)).toEqual(["cheapest", "mixed"]);
  });

  it("X 越小越好、Y 越大越好（价格 vs 智能，AA 主视图）", () => {
    const points: ParetoInput[] = [
      { key: "cheap-dumb", x: 1, y: 50 },
      { key: "mid", x: 5, y: 70 },
      { key: "expensive-smart", x: 20, y: 90 },
      // 比 expensive-smart 又贵又笨，必被压制
      { key: "overpriced", x: 30, y: 60 }
    ];

    expect(frontierOf(points, false, true)).toEqual(["cheap-dumb", "expensive-smart", "mid"]);
  });

  it("X 越大越好、Y 越小越好", () => {
    const points: ParetoInput[] = [
      { key: "smart-cheap", x: 90, y: 5 },
      { key: "smart-pricey", x: 92, y: 40 },
      { key: "dumb-cheap", x: 40, y: 1 },
      { key: "dumb-pricey", x: 41, y: 30 }
    ];

    expect(frontierOf(points, true, false)).toEqual(["dumb-cheap", "smart-cheap", "smart-pricey"]);
  });

  it("完全重合的点同为最优，全部保留", () => {
    const points: ParetoInput[] = [
      { key: "twin-a", x: 10, y: 10 },
      { key: "twin-b", x: 10, y: 10 },
      { key: "behind", x: 9, y: 9 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["twin-a", "twin-b"]);
  });

  it("仅一轴相等时，另一轴更优者压制对方", () => {
    const points: ParetoInput[] = [
      { key: "same-y-worse-x", x: 4, y: 7 },
      { key: "same-y-better-x", x: 8, y: 7 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["same-y-better-x"]);
  });

  it("某一轴全部相同时只留另一轴最优者", () => {
    const points: ParetoInput[] = [
      { key: "a", x: 1, y: 5 },
      { key: "b", x: 2, y: 5 },
      { key: "c", x: 3, y: 5 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["c"]);
  });

  it("全部点完全相同时都是最优", () => {
    const points: ParetoInput[] = [
      { key: "a", x: 2, y: 2 },
      { key: "b", x: 2, y: 2 },
      { key: "c", x: 2, y: 2 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["a", "b", "c"]);
  });

  it("忽略非有限数值", () => {
    const points: ParetoInput[] = [
      { key: "valid", x: 1, y: 1 },
      { key: "nan-x", x: Number.NaN, y: 100 },
      { key: "inf-y", x: 5, y: Number.POSITIVE_INFINITY }
    ];

    expect(frontierOf(points, true, true)).toEqual(["valid"]);
  });

  it("负值参与比较时不做特殊处理", () => {
    const points: ParetoInput[] = [
      { key: "neg", x: -5, y: -1 },
      { key: "less-neg", x: -1, y: -3 },
      { key: "dominated", x: -6, y: -4 }
    ];

    expect(frontierOf(points, true, true)).toEqual(["less-neg", "neg"]);
  });
});

describe("orderParetoPath", () => {
  it("按支配序排列：X 越大越好时即 X 升序", () => {
    const path = orderParetoPath(
      [
        { key: "c", x: 30, y: 1 },
        { key: "a", x: 10, y: 9 },
        { key: "b", x: 20, y: 5 }
      ],
      true,
      true
    );

    expect(path.map((point) => point.key)).toEqual(["a", "b", "c"]);
  });

  it("X 越小越好时支配序为 X 降序", () => {
    const path = orderParetoPath(
      [
        { key: "cheap", x: 1, y: 50 },
        { key: "mid", x: 5, y: 70 },
        { key: "pricey", x: 20, y: 90 }
      ],
      false,
      true
    );

    expect(path.map((point) => point.key)).toEqual(["pricey", "mid", "cheap"]);
  });
});

describe("buildParetoStepPoints", () => {
  it("空路径返回空", () => {
    expect(buildParetoStepPoints([])).toEqual([]);
  });

  it("单点无拐点", () => {
    expect(buildParetoStepPoints([{ x: 4, y: 9 }])).toEqual([{ x: 4, y: 9 }]);
  });

  it("相邻两点之间的拐点落在 (p.x, q.y)", () => {
    const ordered = orderParetoPath(
      [
        { key: "cheap", x: 1, y: 50 },
        { key: "mid", x: 5, y: 70 },
        { key: "pricey", x: 20, y: 90 }
      ],
      false,
      true
    );

    expect(buildParetoStepPoints(ordered)).toEqual([
      { x: 20, y: 90 },
      { x: 20, y: 70 },
      { x: 5, y: 70 },
      { x: 5, y: 50 },
      { x: 1, y: 50 }
    ]);
  });

  it("阶梯边界把被压制的候选点划到线的另一侧", () => {
    const ordered = orderParetoPath(
      [
        { key: "cheap", x: 1, y: 50 },
        { key: "mid", x: 5, y: 70 },
        { key: "pricey", x: 20, y: 90 }
      ],
      false,
      true
    );
    const stepPoints = buildParetoStepPoints(ordered);

    // x = 10 处边界应为 y = 70：(10, 65) 被 mid 压制，(10, 75) 不被任何点压制
    const boundarySegment = stepPoints.find((point) => point.x === 5 && point.y === 70);
    expect(boundarySegment).toBeDefined();

    const frontierWithCandidate = computeParetoFrontier(
      [
        { key: "cheap", x: 1, y: 50 },
        { key: "mid", x: 5, y: 70 },
        { key: "pricey", x: 20, y: 90 },
        { key: "below", x: 10, y: 65 },
        { key: "above", x: 10, y: 75 }
      ],
      false,
      true
    );

    expect(frontierWithCandidate.has("below")).toBe(false);
    expect(frontierWithCandidate.has("above")).toBe(true);
  });
});
