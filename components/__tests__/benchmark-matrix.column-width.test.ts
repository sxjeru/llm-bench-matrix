import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODEL_COLUMN_BASELINE_WIDTH,
  DUAL_VALUE_QUESTION_MARK_MIN_WIDTH
} from "../benchmark-matrix/constants";
import {
  buildActiveColumnWidthMap,
  buildAutoModelWidthMap,
  buildModelColumnMeta,
  measureCellDisplayWidth
} from "../benchmark-matrix/column-width";
import { getModelColumnWidthKey } from "../benchmark-matrix/utils";
import type { MatrixCell, MatrixInputRow, MatrixRow } from "../benchmark-matrix/types";

describe("measureCellDisplayWidth", () => {
  const mockMeasure = (text: string) => text.length * 7;

  test("单值无问号计算包含基础边距", () => {
    // text length 4 -> 28px, decorationPadding 18 -> 46px
    const width = measureCellDisplayWidth("85.4", false, null, false, 0, mockMeasure);
    expect(width).toBe(46);
  });

  test("单值带问号计算包含问号边距", () => {
    // text length 5 -> 35px, decorationPadding 36 -> 71px
    const width = measureCellDisplayWidth("65.5*", false, null, true, 0, mockMeasure);
    expect(width).toBe(71);
  });

  test("双值无问号包含斜杠外边距与粗体buffer", () => {
    // first "58.4" (4*7=28) + "/" (1*7=7) + 4px margin + second "62.1" (4*7=28) + 4px bold buffer = 71px
    // decorationPadding 18 -> 89px
    const width = measureCellDisplayWidth(
      "58.4 / 62.1",
      true,
      { first: "58.4", second: "62.1" },
      false,
      0,
      mockMeasure
    );
    expect(width).toBe(89);
  });

  test("双值带问号至少达到 DUAL_VALUE_QUESTION_MARK_MIN_WIDTH (112px)", () => {
    // 71 + 36 = 107px, 自动应用 DUAL_VALUE_QUESTION_MARK_MIN_WIDTH (112px) 下限
    const width = measureCellDisplayWidth(
      "58.4 / 62.1",
      true,
      { first: "58.4", second: "62.1" },
      true,
      0,
      mockMeasure
    );
    expect(width).toBeGreaterThanOrEqual(DUAL_VALUE_QUESTION_MARK_MIN_WIDTH);
    expect(width).toBe(112);
  });

  test("较长双值带问号根据内容自适应扩宽至 120px 以上", () => {
    // "100.0" (35) + "/" (7) + 4 + "100.0" (35) + 4 = 85px
    // 85 + 36 = 121px
    const width = measureCellDisplayWidth(
      "100.0 / 100.0",
      true,
      { first: "100.0", second: "100.0" },
      true,
      0,
      mockMeasure
    );
    expect(width).toBeGreaterThanOrEqual(121);
  });

  test("带货币符号的长双值带问号自适应扩宽", () => {
    // "$0.15" (35) + "/" (7) + 4 + "$0.60" (35) + 4 = 85px -> 85 + 36 = 121px
    const width = measureCellDisplayWidth(
      "$0.15 / $0.60",
      true,
      { first: "$0.15", second: "$0.60" },
      true,
      0,
      mockMeasure
    );
    expect(width).toBeGreaterThanOrEqual(121);
  });
});

describe("buildAutoModelWidthMap", () => {
  test("单值无问号列保持默认基线宽度 88px", () => {
    const rows: MatrixInputRow[] = [
      {
        providerName: "OpenAI",
        modelName: "GPT-4o",
        benchmarkName: "MMLU",
        benchmarkType: "General",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "84.2",
        valueNum: 84.2,
        source: "text:demo"
      }
    ];

    const map = buildAutoModelWidthMap({
      modelColumns: ["GPT-4o"],
      coveragePrunedRows: rows,
      showDuplicateRows: false,
      displaySourceValuesInCells: false,
      displaySourceValueDeltasInCells: false,
      activeSource: "all",
      sourceValueMode: "latest"
    });

    expect(map.get(getModelColumnWidthKey("GPT-4o"))).toBe(DEFAULT_MODEL_COLUMN_BASELINE_WIDTH);
  });

  test("双值+问号单元格自动将列宽扩展至至少 112px", () => {
    const rows: MatrixInputRow[] = [
      {
        providerName: "OpenAI",
        modelName: "GPT-4o",
        benchmarkName: "SWE-bench",
        benchmarkType: "Coding",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "58.4 / 62.1",
        valueNum: 58.4,
        valueNum2: 62.1,
        valueNote: "pass@1 / pass@5",
        source: "text:demo"
      }
    ];

    const map = buildAutoModelWidthMap({
      modelColumns: ["GPT-4o"],
      coveragePrunedRows: rows,
      showDuplicateRows: false,
      displaySourceValuesInCells: false,
      displaySourceValueDeltasInCells: false,
      activeSource: "all",
      sourceValueMode: "latest"
    });

    const width = map.get(getModelColumnWidthKey("GPT-4o"))!;
    expect(width).toBeGreaterThanOrEqual(DUAL_VALUE_QUESTION_MARK_MIN_WIDTH);
    expect(width).toBe(112);
  });

  test("当传入 matrixRows 时，基于真实单元格自适应并包含参数/价格等合成行", () => {
    const cell: MatrixCell = {
      valueNum: 13,
      valueNum2: 284,
      valueRaw: "13B / 284B",
      valueNote: "Active / Total",
      noteText: "Active / Total",
      source: "official",
      benchTime: "2026-01-01T00:00:00.000Z",
      uniqueEntries: [],
      allEntries: [],
      displayValue: "13B / 284B",
      hasMultipleValues: false,
      hasMeaningfulMultipleValues: false,
      hasMultipleActiveSourceValues: false,
      shouldShowQuestionMark: true
    };

    const matrixRows: MatrixRow[] = [
      {
        rowKey: "__PARAMS__",
        category: "Model Info",
        benchmark: "Params",
        higherIsBetter: true,
        modalities: [],
        cells: new Map([["DeepSeek-V3", cell]]),
        firstSeenIndex: 0,
        sourceOrderKey: 0,
        rowDataCount: 1,
        rowNumericCount: 1,
        minComparable: null,
        maxComparable: null,
        minComparable2: null,
        maxComparable2: null,
        minNum: null,
        maxNum: null,
        minNum2: null,
        maxNum2: null
      }
    ];

    const map = buildAutoModelWidthMap({
      modelColumns: ["DeepSeek-V3"],
      coveragePrunedRows: [],
      matrixRows,
      showDuplicateRows: false,
      displaySourceValuesInCells: false,
      displaySourceValueDeltasInCells: false,
      activeSource: "all",
      sourceValueMode: "latest"
    });

    const width = map.get(getModelColumnWidthKey("DeepSeek-V3"))!;
    expect(width).toBeGreaterThanOrEqual(DUAL_VALUE_QUESTION_MARK_MIN_WIDTH);
  });

  test("在非 All 数据源标签页下，结合 baseSourceRows 正确识别多源问号并自适应", () => {
    const baseSourceRows: MatrixInputRow[] = [
      {
        providerName: "OpenAI",
        modelName: "GPT-4o",
        benchmarkName: "SWE-bench",
        benchmarkType: "Coding",
        benchTime: "2026-01-01T00:00:00.000Z",
        valueRaw: "58.4 / 62.1",
        valueNum: 58.4,
        valueNum2: 62.1,
        source: "opencompass"
      },
      {
        providerName: "OpenAI",
        modelName: "GPT-4o",
        benchmarkName: "SWE-bench",
        benchmarkType: "Coding",
        benchTime: "2026-01-02T00:00:00.000Z",
        valueRaw: "59.0 / 63.5",
        valueNum: 59.0,
        valueNum2: 63.5,
        source: "official"
      }
    ];

    const coveragePrunedRows: MatrixInputRow[] = [baseSourceRows[0]];

    const map = buildAutoModelWidthMap({
      modelColumns: ["GPT-4o"],
      coveragePrunedRows,
      baseSourceRows,
      showDuplicateRows: false,
      displaySourceValuesInCells: false,
      displaySourceValueDeltasInCells: false,
      activeSource: "opencompass",
      sourceValueMode: "latest"
    });

    const width = map.get(getModelColumnWidthKey("GPT-4o"))!;
    expect(width).toBeGreaterThanOrEqual(DUAL_VALUE_QUESTION_MARK_MIN_WIDTH);
  });
});

describe("buildActiveColumnWidthMap 与 buildModelColumnMeta 自适应优化", () => {
  const modelKey = getModelColumnWidthKey("GPT-4o");

  test("buildActiveColumnWidthMap 未存储时采用 autoWidth", () => {
    const autoModelWidthMap = new Map([[modelKey, 112]]);
    const savedForSource = {};

    const activeMap = buildActiveColumnWidthMap(
      savedForSource,
      autoModelWidthMap
    );

    expect(activeMap[modelKey]).toBe(112);
  });

  test("buildActiveColumnWidthMap 存在存储宽度时读取存储宽度", () => {
    const autoModelWidthMap = new Map([[modelKey, 112]]);
    const savedForSource = { [modelKey]: 80 };

    const activeMap = buildActiveColumnWidthMap(
      savedForSource,
      autoModelWidthMap
    );

    expect(activeMap[modelKey]).toBe(80);
  });

  test("buildModelColumnMeta 未手动覆盖时保证不小于 autoWidth", () => {
    const autoModelWidthMap = new Map([[modelKey, 112]]);
    const activeColumnWidthMap = { [modelKey]: 88 };

    const meta = buildModelColumnMeta({
      modelColumns: ["GPT-4o"],
      modelProviderMap: new Map(),
      modelProviderBrandColorMap: new Map(),
      sourceMatchedModelSet: new Set(),
      sourceMatchedGroupBoundaryByModel: { firstSet: new Set(), lastSet: new Set() },
      columnWidthOverrideKeySet: new Set(),
      autoModelWidthMap,
      activeColumnWidthMap,
      compareModelSet: new Set(),
      compareBaselineModelName: null,
      activeSource: "all"
    });

    expect(meta[0].columnWidth).toBe(112);
  });

  test("buildModelColumnMeta 手动缩小覆盖时尊重手动调整宽度", () => {
    const autoModelWidthMap = new Map([[modelKey, 112]]);
    const activeColumnWidthMap = { [modelKey]: 80 };

    const meta = buildModelColumnMeta({
      modelColumns: ["GPT-4o"],
      modelProviderMap: new Map(),
      modelProviderBrandColorMap: new Map(),
      sourceMatchedModelSet: new Set(),
      sourceMatchedGroupBoundaryByModel: { firstSet: new Set(), lastSet: new Set() },
      columnWidthOverrideKeySet: new Set([`all::${modelKey}`]),
      autoModelWidthMap,
      activeColumnWidthMap,
      compareModelSet: new Set(),
      compareBaselineModelName: null,
      activeSource: "all"
    });

    expect(meta[0].columnWidth).toBe(80);
  });
});
