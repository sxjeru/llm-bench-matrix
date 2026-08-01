import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { buildOverallSummaryByModel, buildParamsMatrixRows } from "@/components/benchmark-matrix/selectors";
import { PARAMS_ACTIVE_RATIO_ROW_KEY, PARAMS_ROW_KEY } from "@/components/benchmark-matrix/constants";
import type { ModelParamsInfo } from "@/components/benchmark-matrix/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

const modelParams: ModelParamsInfo[] = [
  {
    modelId: 1,
    modelName: "MoE Model",
    totalParamsB: 397,
    activatedParamsB: 17,
    isEstimated: false,
    note: null
  },
  {
    modelId: 2,
    modelName: "Dense Model",
    totalParamsB: 120,
    activatedParamsB: null,
    isEstimated: false,
    note: null
  },
  {
    modelId: 3,
    modelName: "Estimated Model",
    totalParamsB: 4,
    activatedParamsB: null,
    isEstimated: true,
    note: null
  }
];

const modelColumns = ["MoE Model", "Dense Model", "Estimated Model", "Unknown Model"];

const rows = [
  {
    providerName: "OpenAI",
    modelName: "MoE Model",
    benchmarkName: "Bench-01",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "90",
    valueNum: 90,
    valueNote: null,
    source: "text:params"
  },
  {
    providerName: "OpenAI",
    modelName: "Dense Model",
    benchmarkName: "Bench-01",
    benchmarkType: "General",
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "80",
    valueNum: 80,
    valueNote: null,
    source: "text:params"
  }
];

describe("buildParamsMatrixRows", () => {
  test("生成 Params 与激活占比两行", () => {
    const paramsRows = buildParamsMatrixRows(modelColumns, modelParams);

    expect(paramsRows.map((row) => row.rowKey)).toEqual([PARAMS_ROW_KEY, PARAMS_ACTIVE_RATIO_ROW_KEY]);
    expect(paramsRows.every((row) => row.isInfoRow)).toBe(true);
    expect(paramsRows.every((row) => row.category === "Model Info")).toBe(true);
  });

  test("MoE 显示「激活 / 总量」，稠密只显示一个数字", () => {
    const [paramsRow] = buildParamsMatrixRows(modelColumns, modelParams);

    expect(paramsRow.cells.get("MoE Model")?.displayValue).toBe("17B / 397B");
    expect(paramsRow.cells.get("Dense Model")?.displayValue).toBe("120B");
    expect(paramsRow.cells.get("Unknown Model")?.displayValue).toBe("--");
  });

  test("valueNum 存总参数量，保证稠密与 MoE 排序口径一致", () => {
    const [paramsRow] = buildParamsMatrixRows(modelColumns, modelParams);

    expect(paramsRow.cells.get("MoE Model")?.valueNum).toBe(397);
    expect(paramsRow.cells.get("Dense Model")?.valueNum).toBe(120);
    // 展示顺序由 displayValue 控制，不走 pair 渲染路径
    expect(paramsRow.cells.get("MoE Model")?.valueNum2).toBeNull();
  });

  test("激活占比只对 MoE 有值", () => {
    const [, ratioRow] = buildParamsMatrixRows(modelColumns, modelParams);

    expect(ratioRow.cells.get("MoE Model")?.displayValue).toBe("4.3%");
    expect(ratioRow.cells.get("Dense Model")?.displayValue).toBe("--");
    expect(ratioRow.cells.get("Dense Model")?.valueNum).toBeNull();
  });

  test("参与热力着色：以小为好，comparable 取负值", () => {
    const paramsRows = buildParamsMatrixRows(modelColumns, modelParams);

    for (const row of paramsRows) {
      expect(row.higherIsBetter).toBe(false);
    }

    const [paramsRow] = paramsRows;
    // 4B ~ 397B → comparable -397 ~ -4，参数量最小的模型落在热力图高分端
    expect(paramsRow.minComparable).toBe(-397);
    expect(paramsRow.maxComparable).toBe(-4);
  });

  test("估算值与 MoE 写进 noteText 供 tooltip 使用", () => {
    const [paramsRow] = buildParamsMatrixRows(modelColumns, modelParams);

    expect(paramsRow.cells.get("Estimated Model")?.noteText).toContain("估算值");
    expect(paramsRow.cells.get("MoE Model")?.noteText).toContain("MoE");
  });

  test("排在价格行（-100）之前", () => {
    const paramsRows = buildParamsMatrixRows(modelColumns, modelParams);

    for (const row of paramsRows) {
      expect(row.firstSeenIndex).toBeLessThan(-100);
    }
  });
});

describe("参数量行与 Overall 打分", () => {
  test("计入综合分时以小为好", () => {
    const [paramsRow] = buildParamsMatrixRows(modelColumns, modelParams);
    const columns = ["MoE Model", "Dense Model"];

    const summary = buildOverallSummaryByModel([paramsRow], columns);

    // 120B 的稠密模型比 397B 的 MoE 更小，因此得分更高
    expect(summary.get("Dense Model")?.rawScore).toBe(100);
    expect(summary.get("Dense Model")?.rawRank).toBe(1);
    expect(summary.get("MoE Model")?.rawScore).toBe(0);
    expect(summary.get("MoE Model")?.rawRank).toBe(2);
  });
});

describe("BenchmarkMatrix 参数量展示", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("默认不显示参数量，开启后出现 Model Info 行且不带表头徽标", () => {
    render(<BenchmarkMatrix rows={rows} allRows={rows} modelParams={modelParams} />);

    expect(screen.queryByText("17B/397B")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /显示参数量/ }));

    expect(screen.getByText("Params")).toBeInTheDocument();
    expect(screen.getByText("Activated %")).toBeInTheDocument();
    expect(screen.getByText("17B/397B")).toBeInTheDocument();
    // 表头徽标已移除，参数量只在 Model Info 行里出现
    expect(screen.queryByText("17B / 397B")).toBeNull();
    expect(screen.queryByText("MoE")).toBeNull();
  });

  test("Ctrl 点击开关切换是否计入总评，未计入时行名压暗", () => {
    render(<BenchmarkMatrix rows={rows} allRows={rows} modelParams={modelParams} />);

    const paramsToggle = screen.getByRole("button", { name: /显示参数量/ });
    fireEvent.click(paramsToggle);

    // 默认不计入总评
    expect(screen.getByText("Params").style.opacity).toBe("0.5");

    fireEvent.click(paramsToggle, { ctrlKey: true });

    expect(screen.getByText("Params").style.opacity).toBe("");
    // Ctrl 点击只切换计入状态，不应把参数量行隐藏
    expect(screen.getByText("Activated %")).toBeInTheDocument();
  });

  test("没有参数量数据时不渲染开关", () => {
    render(<BenchmarkMatrix rows={rows} allRows={rows} modelParams={[]} />);

    expect(screen.queryByRole("button", { name: /显示参数量/ })).toBeNull();
  });
});
