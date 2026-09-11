import { fireEvent, screen } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import { describe, expect, test, vi } from "vitest";
import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import { buildMatrixRows, buildBenchmarkRankingData } from "@/components/benchmark-matrix/selectors";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import { buildOutdatedNote } from "@/lib/benchmark-versions/aa-index-version";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

describe("BenchmarkMatrix 旧版本模型分数中性化与问号提示", () => {
  const outdatedNote = buildOutdatedNote({
    versionNumber: 2,
    previousValueRaw: "62.4"
  });

  const rows: MatrixInputRow[] = [
    {
      providerName: "OpenAI",
      modelName: "GPT-4o",
      benchmarkName: "AA Intelligence Index",
      benchmarkType: "Overall",
      benchTime: "2026-09-10T00:00:00.000Z",
      valueRaw: "88.5",
      valueNum: 88.5,
      valueNum2: null,
      valueNote: null,
      source: "text:Artificial Analysis"
    },
    {
      providerName: "OpenAI",
      modelName: "GPT-3.5-Turbo",
      benchmarkName: "AA Intelligence Index",
      benchmarkType: "Overall",
      benchTime: "2025-06-01T00:00:00.000Z",
      // 经服务端数据边界中性化改写后的无数值行
      valueRaw: "",
      valueNum: null,
      valueNum2: null,
      valueNote: outdatedNote,
      source: "text:Artificial Analysis"
    },
    // 添加第二个指标，保证两个模型均满足 All 视图下的基础覆盖率要求，使两列均完整渲染
    {
      providerName: "OpenAI",
      modelName: "GPT-4o",
      benchmarkName: "MMLU",
      benchmarkType: "Language",
      benchTime: "2026-09-10T00:00:00.000Z",
      valueRaw: "88.0",
      valueNum: 88.0,
      valueNum2: null,
      valueNote: null,
      source: "text:Artificial Analysis"
    },
    {
      providerName: "OpenAI",
      modelName: "GPT-3.5-Turbo",
      benchmarkName: "MMLU",
      benchmarkType: "Language",
      benchTime: "2025-06-01T00:00:00.000Z",
      valueRaw: "70.0",
      valueNum: 70.0,
      valueNum2: null,
      valueNote: null,
      source: "text:Artificial Analysis"
    }
  ];

  test("buildMatrixRows 将中性化行处理为 -- 且 valueNum 为 null，不影响极值统计", () => {
    const aaRows = rows.filter((r) => r.benchmarkName === "AA Intelligence Index");
    const matrixRows = buildMatrixRows(aaRows, aaRows, false, false, "all", "latest");
    expect(matrixRows.length).toBe(1);

    const row = matrixRows[0];
    expect(row.cells.has("GPT-4o")).toBe(true);
    expect(row.cells.has("GPT-3.5-Turbo")).toBe(true);

    const currentCell = row.cells.get("GPT-4o")!;
    expect(currentCell.displayValue).toBe("88.5");
    expect(currentCell.valueNum).toBe(88.5);

    const outdatedCell = row.cells.get("GPT-3.5-Turbo")!;
    expect(outdatedCell.displayValue).toBe("--");
    expect(outdatedCell.valueNum).toBeNull();
    expect(outdatedCell.shouldShowQuestionMark).toBe(true);
    expect(outdatedCell.noteText).toContain("该模型未参与 AA 当前版本（第 2 版）评测");
    expect(outdatedCell.noteText).toContain("旧版本得分 62.4");

    // 旧版本模型的数值不进入 rowNumericCount，也不影响可比极值
    expect(row.rowNumericCount).toBe(1);
    expect(row.minComparable).toBe(88.5);
    expect(row.maxComparable).toBe(88.5);
  });

  test("在表格中旧版本模型数值显示为 --，并展示问号及 Hover Tooltip 说明", async () => {
    const { container } = await renderReady(<BenchmarkMatrix rows={rows} />);

    // 当前模型 GPT-4o 正常展示数值 88.5
    expect(screen.getByText("88.5")).toBeInTheDocument();

    const cells = container.querySelectorAll("td");
    const outdatedCell = Array.from(cells).find(
      (td) => td.getAttribute("data-model-name") === "GPT-3.5-Turbo"
        && td.textContent?.includes("--")
    );
    expect(outdatedCell).toBeDefined();
    expect(outdatedCell?.textContent).toContain("--");
    expect(outdatedCell?.textContent).toContain("?");

    // 找到问号图标
    const questionMark = Array.from(outdatedCell?.querySelectorAll("span") ?? []).find(
      (node) => node.textContent === "?" && !node.hasAttribute("data-overall-tooltip-trigger")
    );
    expect(questionMark).toBeDefined();
    expect(questionMark?.textContent).toBe("?");

    // 触发 Hover 弹出 Tooltip
    fireEvent.mouseEnter(questionMark as Element);

    // 验证 Tooltip 包含旧版本提示文案与历史分值
    expect(
      await screen.findByText(/注释：该模型未参与 AA 当前版本（第 2 版）评测/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/旧版本得分 62.4/).length).toBeGreaterThanOrEqual(1);
  });

  test("中性化模型自动从排名弹窗（buildBenchmarkRankingData）中排除", () => {
    const aaRows = rows.filter((r) => r.benchmarkName === "AA Intelligence Index");
    const matrixRows = buildMatrixRows(aaRows, aaRows, false, false, "all", "latest");
    const row = matrixRows[0];
    const candidateModelNames = ["GPT-4o", "GPT-3.5-Turbo"];

    const rankingData = buildBenchmarkRankingData(
      row,
      rows,
      candidateModelNames,
      candidateModelNames,
      false,
      "relative"
    );

    // 排名列表中只包含当前模型 GPT-4o，被中性化的 GPT-3.5-Turbo 自动被过滤
    expect(rankingData.items.length).toBe(1);
    expect(rankingData.items[0].modelName).toBe("GPT-4o");
    expect(rankingData.items[0].valueNum).toBe(88.5);
    expect(rankingData.items.some((item) => item.modelName === "GPT-3.5-Turbo")).toBe(false);
  });
});
