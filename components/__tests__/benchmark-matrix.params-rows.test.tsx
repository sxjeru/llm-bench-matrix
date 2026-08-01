import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

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

  test("不参与热力着色：minComparable / maxComparable 恒为 null", () => {
    const paramsRows = buildParamsMatrixRows(modelColumns, modelParams);

    for (const row of paramsRows) {
      expect(row.minComparable).toBeNull();
      expect(row.maxComparable).toBeNull();
    }
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
  test("info 行不计入综合分", () => {
    const paramsRows = buildParamsMatrixRows(modelColumns, modelParams);
    const columns = ["MoE Model", "Dense Model"];

    const withoutParams = buildOverallSummaryByModel([], columns);
    const withParams = buildOverallSummaryByModel(paramsRows, columns);

    expect(withParams.get("MoE Model")?.rawScore).toEqual(withoutParams.get("MoE Model")?.rawScore);
    expect(withParams.get("MoE Model")?.totalRows).toBe(withoutParams.get("MoE Model")?.totalRows);
  });
});

describe("BenchmarkMatrix 参数量展示", () => {
  test("默认不显示参数量，开启后表头徽标与 Model Info 行出现", () => {
    render(<BenchmarkMatrix rows={rows} allRows={rows} modelParams={modelParams} />);

    expect(screen.queryByText("17B / 397B")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /显示参数量/ }));

    expect(screen.getByText("17B / 397B")).toBeInTheDocument();
    expect(screen.getByText("MoE")).toBeInTheDocument();
    expect(screen.getByText("Params")).toBeInTheDocument();
    expect(screen.getByText("激活占比")).toBeInTheDocument();
  });

  test("没有参数量数据时不渲染开关", () => {
    render(<BenchmarkMatrix rows={rows} allRows={rows} modelParams={[]} />);

    expect(screen.queryByRole("button", { name: /显示参数量/ })).toBeNull();
  });
});
