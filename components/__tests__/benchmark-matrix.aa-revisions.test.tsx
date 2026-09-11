import { describe, expect, test, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderReady } from "@/tests/flush-microtasks";
import { BenchmarkMatrix } from "@/components/benchmark-matrix";
import {
  buildAaIndexRevisionsByRow,
  buildMatrixRows,
  buildModelColumns
} from "@/components/benchmark-matrix/selectors";
import { getMatrixGroupingKey } from "@/components/benchmark-matrix/utils";
import { isCellTrendEligible } from "@/components/benchmark-matrix/cell-trend";
import { buildScatterMetrics } from "@/components/model-scatter/metrics";
import { buildScatterDataset } from "@/components/model-scatter/dataset";
import { extractMetricSnapshots } from "@/components/model-scatter/snapshots";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => mockSearchParams
}));

function makeRow(
  modelName: string,
  benchmarkName: string,
  valueRaw: string,
  valueNum: number,
  benchTime: string,
  recordId: number
): MatrixInputRow {
  return {
    recordId,
    modelName,
    providerName: "TestProvider",
    benchmarkName,
    benchmarkType: "Overall",
    higherIsBetter: true,
    modalities: [],
    valueRaw,
    valueNum,
    valueNum2: null,
    valueNote: null,
    source: "text:Artificial Analysis",
    benchTime
  };
}

describe("AA 三大指数主要变动自适应与版本合并", () => {
  const benchmark = "AA Intelligence Index";

  test("buildMatrixRows: 111, 130, 120, 20, 110 序列下，仅展示 110 批次（及后续小补丁），老版本模型显示为空", () => {
    const rows: MatrixInputRow[] = [];
    let id = 1;

    // Batch 1: 111 models on 2026-01-01
    for (let i = 0; i < 111; i += 1) {
      rows.push(makeRow(`b1_model_${i}`, benchmark, `${50 + (i % 30)}`, 50 + (i % 30), "2026-01-01T00:00:00.000Z", id++));
    }
    // Batch 2: 130 models on 2026-02-01
    for (let i = 0; i < 130; i += 1) {
      rows.push(makeRow(`b2_model_${i}`, benchmark, `${60 + (i % 30)}`, 60 + (i % 30), "2026-02-01T00:00:00.000Z", id++));
    }
    // Batch 3: 120 models on 2026-03-01
    for (let i = 0; i < 120; i += 1) {
      rows.push(makeRow(`b3_model_${i}`, benchmark, `${70 + (i % 30)}`, 70 + (i % 30), "2026-03-01T00:00:00.000Z", id++));
    }
    // Batch 4: 20 models on 2026-03-15 (小变动，应合并入 Batch 3)
    for (let i = 0; i < 20; i += 1) {
      rows.push(makeRow(`b4_patch_${i}`, benchmark, `${75 + (i % 10)}`, 75 + (i % 10), "2026-03-15T00:00:00.000Z", id++));
    }
    // Batch 5: 110 models on 2026-04-01 (最新主要变动)
    for (let i = 0; i < 110; i += 1) {
      rows.push(makeRow(`b5_latest_${i}`, benchmark, `${80 + (i % 20)}`, 80 + (i % 20), "2026-04-01T00:00:00.000Z", id++));
    }
    // 跨批次重叠模型：在 Batch 3 是 70，在 Batch 5 是 88，且在 Batch 6（后续小补丁 5 个模型）是 93
    rows.push(makeRow("shared_model", benchmark, "70", 70, "2026-03-01T00:00:00.000Z", id++));
    rows.push(makeRow("shared_model", benchmark, "88", 88, "2026-04-01T00:00:00.000Z", id++));

    // Batch 6: 5 models on 2026-04-15 (最新主要变动之后的后续小变动)
    rows.push(makeRow("shared_model", benchmark, "93", 93, "2026-04-15T00:00:00.000Z", id++));
    rows.push(makeRow("b6_patch_new", benchmark, "91", 91, "2026-04-15T00:00:00.000Z", id++));

    const matrixRows = buildMatrixRows(rows, rows, false, false, "__ALL__");
    const targetRow = matrixRows.find((r) => r.benchmark === benchmark)!;
    expect(targetRow).toBeDefined();

    // 1. 最新主要变动中的模型应具有正确有效值
    const latestCell0 = targetRow.cells.get("b5_latest_0")!;
    expect(latestCell0.valueNum).toBe(80);
    expect(latestCell0.displayValue).toBe("80");

    // 2. 最新主要变动之后的后续小变动模型也应合并进入
    const patchCell = targetRow.cells.get("b6_patch_new")!;
    expect(patchCell.valueNum).toBe(91);
    expect(patchCell.displayValue).toBe("91");

    // 3. 重复模型取最新小变动的值（93 而非 88 或 70）
    const sharedCell = targetRow.cells.get("shared_model")!;
    expect(sharedCell.valueNum).toBe(93);
    expect(sharedCell.displayValue).toBe("93");
    // sharedCell 有多条历史记录，应显示问号
    expect(sharedCell.shouldShowQuestionMark).toBe(true);
    expect(sharedCell.uniqueEntries.length).toBeGreaterThan(1);

    // 4. 仅在历史老版本中出现的模型（如 b1_model_0、b3_model_0）在当前表格中值为空（displayValue 为 --，valueNum 为 null），但保留历史问号
    const oldCellB1 = targetRow.cells.get("b1_model_0")!;
    expect(oldCellB1.valueNum).toBeNull();
    expect(oldCellB1.displayValue).toBe("--");
    expect(oldCellB1.shouldShowQuestionMark).toBe(true);
    expect(oldCellB1.allEntries).toHaveLength(1);

    const oldCellB4 = targetRow.cells.get("b4_patch_0")!;
    expect(oldCellB4.valueNum).toBeNull();
    expect(oldCellB4.displayValue).toBe("--");
    expect(oldCellB4.shouldShowQuestionMark).toBe(true);
  });

  test("isCellTrendEligible: AA三大指数在任何 source 下均不允许展开折线图", () => {
    const mockCell = {
      valueNum: 90,
      valueNum2: null,
      valueRaw: "90",
      valueNote: null,
      source: "text:Artificial Analysis",
      benchTime: "2026-04-01T00:00:00.000Z",
      allEntries: [
        {
          recordId: 1,
          valueRaw: "80",
          valueNum: 80,
          valueNum2: null,
          valueNote: null,
          source: "text:Artificial Analysis",
          benchTime: "2026-01-01T00:00:00.000Z"
        },
        {
          recordId: 2,
          valueRaw: "90",
          valueNum: 90,
          valueNum2: null,
          valueNote: null,
          source: "text:Artificial Analysis",
          benchTime: "2026-04-01T00:00:00.000Z"
        }
      ],
      uniqueEntries: [],
      hasMultipleValues: true,
      hasMeaningfulMultipleValues: true,
      hasMultipleActiveSourceValues: true,
      noteText: "",
      displayValue: "90",
      shouldShowQuestionMark: true
    };

    // 普通指标支持折线图
    expect(isCellTrendEligible(mockCell, "text:Artificial Analysis", "MMLU-Pro")).toBe(true);

    // AA三大指数全部禁止折线图
    expect(isCellTrendEligible(mockCell, "text:Artificial Analysis", "AA Intelligence Index")).toBe(false);
    expect(isCellTrendEligible(mockCell, "text:Artificial Analysis", "AA Coding Index")).toBe(false);
    expect(isCellTrendEligible(mockCell, "text:Artificial Analysis", "AA Agentic Index")).toBe(false);
    expect(isCellTrendEligible(mockCell, "text:Artificial Analysis", "AA Math Index")).toBe(false);
  });

  test("散点图 buildScatterMetrics: 默认最新数据只取最新一次主要变动及后续小变动模型，且重复取最新值", () => {
    const rows: MatrixInputRow[] = [];
    let id = 1;

    // V3: 100 models
    for (let i = 0; i < 100; i += 1) {
      rows.push(makeRow(`old_model_${i}`, benchmark, "70", 70, "2026-01-01T00:00:00.000Z", id++));
    }
    // V4: 110 models
    for (let i = 0; i < 110; i += 1) {
      rows.push(makeRow(`latest_model_${i}`, benchmark, "85", 85, "2026-04-01T00:00:00.000Z", id++));
    }
    // Shared model in V3, V4, and V4.1 patch
    rows.push(makeRow("shared_model", benchmark, "70", 70, "2026-01-01T00:00:00.000Z", id++));
    rows.push(makeRow("shared_model", benchmark, "85", 85, "2026-04-01T00:00:00.000Z", id++));
    rows.push(makeRow("shared_model", benchmark, "92", 92, "2026-04-15T00:00:00.000Z", id++));
    rows.push(makeRow("patch_model", benchmark, "89", 89, "2026-04-15T00:00:00.000Z", id++));

    const matrixRows = buildMatrixRows(rows, rows, false, false, "__ALL__");
    const metrics = buildScatterMetrics({
      benchmarkRows: matrixRows,
      priceRows: [],
      paramsRows: []
    });

    const aaMetric = metrics.find((m) => m.label === benchmark)!;
    expect(aaMetric).toBeDefined();

    // 1. 老模型不包含在散点图默认数据集中
    expect(aaMetric.valueByModel.has("old_model_0")).toBe(false);
    expect(aaMetric.valueByModel.has("old_model_99")).toBe(false);

    // 2. 最新主要变动模型包含在内
    expect(aaMetric.valueByModel.get("latest_model_0")).toBe(85);

    // 3. 后续小补丁模型包含在内
    expect(aaMetric.valueByModel.get("patch_model")).toBe(89);

    // 4. 重复模型取最新值 92
    expect(aaMetric.valueByModel.get("shared_model")).toBe(92);
  });

  test("散点图 extractMetricSnapshots: 样例 111, 130, 120, 20, 110 自适应识别主要变动分组", () => {
    const historyByModel = new Map<string, { value: number; benchTime: string; recordId: number }[]>();

    const addBatch = (timeStr: string, count: number, prefix: string) => {
      for (let i = 0; i < count; i += 1) {
        const model = `${prefix}_m${i}`;
        const existing = historyByModel.get(model) ?? [];
        existing.push({ value: 80, benchTime: timeStr, recordId: i });
        historyByModel.set(model, existing);
      }
    };

    addBatch("2026-01-01T00:00:00.000Z", 111, "b1");
    addBatch("2026-02-01T00:00:00.000Z", 130, "b2");
    addBatch("2026-03-01T00:00:00.000Z", 120, "b3");
    addBatch("2026-03-15T00:00:00.000Z", 20, "b4");
    addBatch("2026-04-01T00:00:00.000Z", 110, "b5");

    const snapshots = extractMetricSnapshots(historyByModel);

    // 共有 5 个时间批次
    expect(snapshots).toHaveLength(5);

    // 20 模型批次（2026-03-15）应被自适应识别为 isMajorRevision: false
    const patchSnapshot = snapshots.find((s) => s.label.startsWith("2026-03-15"))!;
    expect(patchSnapshot).toBeDefined();
    expect(patchSnapshot.modelCount).toBe(20);
    expect(patchSnapshot.isMajorRevision).toBe(false);

    // 111, 130, 120, 110 批次应全部被识别为 isMajorRevision: true
    const majorSnapshots = snapshots.filter((s) => s.isMajorRevision);
    expect(majorSnapshots).toHaveLength(4);
    const majorCounts = majorSnapshots.map((s) => s.modelCount);
    expect(majorCounts).toContain(111);
    expect(majorCounts).toContain(130);
    expect(majorCounts).toContain(120);
    expect(majorCounts).toContain(110);
  });

  test("UI 渲染: AA三大指数在矩阵表格中显示最新主要变动值，老模型显示 -- 且带问号，悬浮显示历史值，点击禁止展开折线图", async () => {
    const rows: MatrixInputRow[] = [];
    let id = 1;

    // V3 (老版本): 100 个模型
    for (let i = 0; i < 100; i += 1) {
      rows.push(makeRow(`old_m_${i}`, benchmark, "65", 65, "2026-01-01T00:00:00.000Z", id++));
    }
    // V4 (最新主要变动): 110 个模型
    for (let i = 0; i < 110; i += 1) {
      rows.push(makeRow(`new_m_${i}`, benchmark, "85", 85, "2026-04-01T00:00:00.000Z", id++));
    }
    // Shared model: V3 为 65，V4 为 88，小变动为 95
    rows.push(makeRow("shared_m", benchmark, "65", 65, "2026-01-01T00:00:00.000Z", id++));
    rows.push(makeRow("shared_m", benchmark, "88", 88, "2026-04-01T00:00:00.000Z", id++));
    rows.push(makeRow("shared_m", benchmark, "95", 95, "2026-04-10T00:00:00.000Z", id++));

    const { container } = await renderReady(
      <BenchmarkMatrix rows={[...rows]} allRows={[...rows]} />
    );

    // 1. 验证不允许展开折线图（data-cell-trend-trigger 为空）
    const trendTrigger = container.querySelector('[data-cell-trend-trigger="1"]');
    expect(trendTrigger).toBeNull();

    // 2. 找到 shared_m 所在单元格
    const sharedTd = container.querySelector('td[data-model-name="shared_m"]');
    expect(sharedTd).not.toBeNull();
    // 单元格应显示最新合并值 95
    expect(sharedTd?.textContent).toContain("95");

    // 3. 单元格内应有问号图标
    const questionMark = sharedTd?.querySelector("span.cursor-help");
    expect(questionMark).not.toBeNull();
    expect(questionMark?.textContent?.trim()).toBe("?");

    // 4. 点击该问号不弹出折线图面板
    fireEvent.click(questionMark!);
    expect(container.querySelector("[data-cell-trend-panel]")).toBeNull();

    // 5. 悬浮问号显示历史记录 tooltip
    fireEvent.mouseEnter(questionMark!);
    // tooltip 浮层应出现
    const tooltip = document.querySelector('[data-cell-tooltip="1"]');
    expect(tooltip).not.toBeNull();
    // tooltip 内部包含历史值 65, 88, 95
    expect(tooltip?.textContent).toContain("65");
    expect(tooltip?.textContent).toContain("88");
    expect(tooltip?.textContent).toContain("95");

    // 6. 老版本独有的模型（如 old_m_0），在表格中显示为 --，但保留问号查看历史
    const oldTd = container.querySelector('td[data-model-name="old_m_0"]');
    expect(oldTd).not.toBeNull();
    expect(oldTd?.textContent).toContain("--");
    const oldQuestionMark = oldTd?.querySelector("span.cursor-help");
    expect(oldQuestionMark).not.toBeNull();

    fireEvent.mouseEnter(oldQuestionMark!);
    const oldTooltip = document.querySelector('[data-cell-tooltip="1"]');
    expect(oldTooltip?.textContent).toContain("65");
  });

  test("问题 1: 模型筛选只选两个模型时，不会误把单模型补丁当成主要变动，保留完整版本判定", () => {
    const allRows: MatrixInputRow[] = [];
    let id = 1;

    // 主要批次：100 个模型 (包含 ModelA)
    for (let i = 0; i < 99; i += 1) {
      allRows.push(makeRow(`bg_model_${i}`, benchmark, "70", 70, "2026-04-01T00:00:00.000Z", id++));
    }
    allRows.push(makeRow("ModelA", benchmark, "80", 80, "2026-04-01T00:00:00.000Z", id++));

    // 后续补丁：更新 ModelB (1 个模型)
    allRows.push(makeRow("ModelB", benchmark, "95", 95, "2026-04-10T00:00:00.000Z", id++));

    // 基于全量数据划分版本
    const aaRevisionsByRow = buildAaIndexRevisionsByRow(allRows, false);

    // 模拟筛选后只剩下 ModelA 和 ModelB 两行
    const filteredRows = allRows.filter((r) => r.modelName === "ModelA" || r.modelName === "ModelB");

    // 传入外部预计算的 aaRevisionsByRow
    const matrixRows = buildMatrixRows(
      allRows,
      filteredRows,
      false,
      false,
      "__ALL__",
      "latest",
      aaRevisionsByRow
    );

    const matrixRow = matrixRows.find((r) => r.benchmark === benchmark)!;
    expect(matrixRow).toBeDefined();

    // ModelA 在主要批次中，补丁为小变动并入主要批次，因此 ModelA 的有效值 80 仍然保留，不能消失为 --
    const cellA = matrixRow.cells.get("ModelA");
    expect(cellA?.displayValue).toBe("80");
    expect(cellA?.valueNum).toBe(80);

    // ModelB 作为小补丁新增，其值 95 也正常展示
    const cellB = matrixRow.cells.get("ModelB");
    expect(cellB?.displayValue).toBe("95");
    expect(cellB?.valueNum).toBe(95);
  });

  test("问题 2: 散点图手动选择主要历史版本时，真正合并后续小补丁更新 (80 -> 95) 及补丁新增模型", () => {
    const rows: MatrixInputRow[] = [];
    let id = 1;

    // V3: 100 个模型 (含 ModelA = 60)
    for (let i = 0; i < 99; i += 1) {
      rows.push(makeRow(`old_m_${i}`, benchmark, "60", 60, "2026-01-01T00:00:00.000Z", id++));
    }
    rows.push(makeRow("ModelA", benchmark, "60", 60, "2026-01-01T00:00:00.000Z", id++));

    // V4 主要变动：100 个模型 (ModelA = 80)
    for (let i = 0; i < 99; i += 1) {
      rows.push(makeRow(`v4_m_${i}`, benchmark, "75", 75, "2026-04-01T00:00:00.000Z", id++));
    }
    rows.push(makeRow("ModelA", benchmark, "80", 80, "2026-04-01T00:00:00.000Z", id++));

    // V4 小补丁：更新 ModelA 为 95，并新增 PatchModel = 88
    rows.push(makeRow("ModelA", benchmark, "95", 95, "2026-04-10T00:00:00.000Z", id++));
    rows.push(makeRow("PatchModel", benchmark, "88", 88, "2026-04-10T00:00:00.000Z", id++));

    const aaRevisionsByRow = buildAaIndexRevisionsByRow(rows, false);
    const matrixRows = buildMatrixRows(rows, rows, false, false, "__ALL__", "latest", aaRevisionsByRow);

    const metrics = buildScatterMetrics({
      benchmarkRows: matrixRows,
      priceRows: [],
      paramsRows: []
    });

    const aaMetric = metrics.find((m) => m.label === benchmark)!;
    expect(aaMetric).toBeDefined();

    // 找到 2026-04-01 主要变动快照
    const v4Snapshot = aaMetric.snapshots.find((s) => s.isMajorRevision && s.label.startsWith("2026-04-01"))!;
    expect(v4Snapshot).toBeDefined();

    // 验证快照的 sampleByModel 真正包含了补丁合并后的值
    expect(v4Snapshot.sampleByModel?.get("ModelA")?.value).toBe(95);
    expect(v4Snapshot.sampleByModel?.get("PatchModel")?.value).toBe(88);

    // 构建散点图数据集，指定 Y 轴选中该主要版本快照
    const dummyXMetric = {
      ...aaMetric,
      key: "dummy-x",
      snapshots: []
    };

    const dataset = buildScatterDataset({
      xMetric: dummyXMetric,
      yMetric: aaMetric,
      modelNames: ["ModelA", "PatchModel", "v4_m_0"],
      providerNameByModel: new Map(),
      colorByModel: new Map(),
      xScale: "linear",
      yScale: "linear",
      ySnapshot: v4Snapshot.id
    });

    const pointA = dataset.points.find((p) => p.modelName === "ModelA");
    expect(pointA).toBeDefined();
    // 补丁将 80 更新为 95，选择该主要版本应展示合并后的 95，而非旧值 80
    expect(pointA?.y).toBe(95);

    const pointPatch = dataset.points.find((p) => p.modelName === "PatchModel");
    expect(pointPatch).toBeDefined();
    // 补丁新增模型在选择该主要版本时不会缺失
    expect(pointPatch?.y).toBe(88);
  });

  test("问题 5: 表格排序使用当前版本有效分数，老版本独有模型 (-- ) 排在当前有分模型之后", () => {
    const rows: MatrixInputRow[] = [];
    let id = 1;

    // V3 (老版本独有模型，分数 95)
    rows.push(makeRow("OldTopModel", benchmark, "95", 95, "2026-01-01T00:00:00.000Z", id++));

    // V4 (当前主要版本：包含 100 个模型，分数均为 80)
    for (let i = 0; i < 99; i += 1) {
      rows.push(makeRow(`current_m_${i}`, benchmark, "80", 80, "2026-04-01T00:00:00.000Z", id++));
    }
    rows.push(makeRow("CurrentModel", benchmark, "80", 80, "2026-04-01T00:00:00.000Z", id++));

    const aaRevisionsByRow = buildAaIndexRevisionsByRow(rows, false);

    // 按当前指标排序
    const columnSortKey = getMatrixGroupingKey(rows[0]!, false);
    const orderedColumns = buildModelColumns(
      rows,
      "",
      columnSortKey,
      false,
      {},
      "__ALL__",
      aaRevisionsByRow
    );

    // CurrentModel 有当前版本分数 80，OldTopModel 在当前版本中无分数（主表显示 --）
    // OldTopModel 绝不能因老分数 95 排在 CurrentModel 之前
    const currentModelIndex = orderedColumns.indexOf("CurrentModel");
    const oldTopModelIndex = orderedColumns.indexOf("OldTopModel");

    expect(currentModelIndex).toBeGreaterThanOrEqual(0);
    expect(oldTopModelIndex).toBeGreaterThanOrEqual(0);
    expect(currentModelIndex).toBeLessThan(oldTopModelIndex);
  });
});
