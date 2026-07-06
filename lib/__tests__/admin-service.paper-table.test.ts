import { beforeAll, describe, expect, test } from "vitest";

type ParsedTextImportResult = {
  format: string;
  parseSource?: string;
  rows: Array<{
    benchmarkName: string;
    benchmarkType: string;
    benchmarkTypeProvided?: boolean;
    higherIsBetter?: boolean;
    modelName: string;
    valueRaw: string;
    valueNote?: string | null;
    modalities: string[];
  }>;
  warnings?: Array<{
    type?: string;
    field?: string;
    before?: string;
    rowNumber?: number;
    modelName?: string;
    benchmarkName?: string;
    benchmarkType?: string;
    rawValue?: string;
    reason?: string;
    action?: string;
  }>;
};

type PreviewTextImportResult = {
  format: string;
  total: number;
  skipped: number;
  warningCount: number;
  warnings?: Array<{
    type?: string;
    rowNumber?: number;
    modelName?: string;
    benchmarkName?: string;
    benchmarkType?: string;
    rawValue?: string;
    reason?: string;
    action?: string;
  }>;
  previewRows: Array<{
    modelName: string;
    benchmarkName: string;
    rawValue: string;
    valueNum: number | null;
    valueNum2: number | null;
    valid: boolean;
  }>;
};

let parseBenchmarkTextRowsForTest: (
  inputText: string,
  sourceInput?: string | null,
  htmlInput?: string | null
) => Promise<ParsedTextImportResult>;
let previewBenchmarkTextImportForTest: (
  inputText: string,
  sourceInput?: string | null,
  htmlInput?: string | null
) => Promise<PreviewTextImportResult>;
let normalizeDuplicateCompareTextForTest: (input: string) => string;
let getDuplicateNameSimilarityForTest: (left: string, right: string) => number;
let hasBenchmarkNumericTokenMismatchForTest: (left: string, right: string) => boolean;
let hasBenchmarkVariantNoiseNormalizedNameMatchForTest: (left: string, right: string) => boolean;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  parseBenchmarkTextRowsForTest = adminServiceModule.__parseBenchmarkTextRowsForTest as typeof parseBenchmarkTextRowsForTest;
  previewBenchmarkTextImportForTest =
    adminServiceModule.previewBenchmarkTextImport as typeof previewBenchmarkTextImportForTest;
  normalizeDuplicateCompareTextForTest =
    adminServiceModule.__normalizeDuplicateCompareTextForTest as typeof normalizeDuplicateCompareTextForTest;
  getDuplicateNameSimilarityForTest =
    adminServiceModule.__getDuplicateNameSimilarityForTest as typeof getDuplicateNameSimilarityForTest;
  hasBenchmarkNumericTokenMismatchForTest =
    adminServiceModule.__hasBenchmarkNumericTokenMismatchForTest as typeof hasBenchmarkNumericTokenMismatchForTest;
  hasBenchmarkVariantNoiseNormalizedNameMatchForTest =
    adminServiceModule.__hasBenchmarkVariantNoiseNormalizedNameMatchForTest as typeof hasBenchmarkVariantNoiseNormalizedNameMatchForTest;
});

describe("paper-table 文本解析", () => {
  test("可正确识别 Long Video 分类，并避免 benchmark 特殊符号警告按 model 重复", async () => {
    const inputText = [
      "Benchmark GPT-4.1 Gemini-3-Pro Gemini-3-Flash Seed1.8 Qwen2.5 Kimi GPT-4o",
      "TOMATO [78] 95.2 59.6 60.8 60.8 47.4 57.3 59.9",
      "TOMATO (Thinking with Tracking) 95.2 - 64.0 61.0 51.3 59.2 65.3",
      "Long Video",
      "VideoMME‡",
      "[30] - 88.4∗ 85.2 87.8 81.2 87.7 89.5",
      "CGBench [12] - 65.5 65.3 62.4 59.2 59.3 65.0"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    const videoMmeRows = parsed.rows.filter((row) => row.benchmarkName === "VideoMME");
    expect(videoMmeRows.length).toBeGreaterThan(0);
    expect(new Set(videoMmeRows.map((row) => row.benchmarkType))).toEqual(new Set(["Long Video"]));

    const cgBenchRows = parsed.rows.filter((row) => row.benchmarkName === "CGBench");
    expect(cgBenchRows.length).toBeGreaterThan(0);
    expect(new Set(cgBenchRows.map((row) => row.benchmarkType))).toEqual(new Set(["Long Video"]));

    const benchmarkWarnings = (parsed.warnings ?? []).filter(
      (warning) =>
        warning.type === "unsupported-special-symbol"
        && warning.field === "benchmark"
        && (warning.before ?? "").includes("VideoMME")
    );

    expect(benchmarkWarnings).toHaveLength(1);
  });


  test("可将 77.9 (65.3) 解析为 77.9 / 65.3", async () => {
    const inputText = [
      "Benchmark M1 M2 M3 M4 M5",
      "BrowseComp 77.9 (65.3) 43.9 (29.5) 67.8 (57.2) 59.2 77.3"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const browseRows = parsed.rows.filter((row) => row.benchmarkName === "BrowseComp");

    expect(browseRows.length).toBeGreaterThan(0);

    const valueByModel = new Map(browseRows.map((row) => [row.modelName, row.valueRaw]));

    expect(valueByModel.get("M1")).toBe("77.9 / 65.3");
    expect(valueByModel.get("M2")).toBe("43.9 / 29.5");
    expect(valueByModel.get("M3")).toBe("67.8 / 57.2");
    expect(valueByModel.get("M4")).toBe("59.2");
    expect(valueByModel.get("M5")).toBe("77.3");
  });

  test("成对值段内星号不会被解析为注释", async () => {
    const inputText = [
      "Benchmark M1 M2 M3 M4 M5",
      "PairBench 81/77.3* 91*/83 81/77.3*1 81/77.3*a 81/77.3^2"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const byModel = new Map(parsed.rows.map((row) => [row.modelName, row]));

    expect(byModel.get("M1")?.valueRaw).toBe("81 / 77.3*");
    expect(byModel.get("M1")?.valueNote).toBeNull();
    expect(byModel.get("M2")?.valueRaw).toBe("91* / 83");
    expect(byModel.get("M2")?.valueNote).toBeNull();
    expect(byModel.get("M3")?.valueRaw).toBe("81 / 77.3*1");
    expect(byModel.get("M3")?.valueNote).toBeNull();
    expect(byModel.get("M4")?.valueRaw).toBe("81 / 77.3*a");
    expect(byModel.get("M4")?.valueNote).toBeNull();
    expect(byModel.get("M5")?.valueRaw).toBe("81 / 77.3^2");
    expect(byModel.get("M5")?.valueNote).toBeNull();
  });

  test("成对值星号后的紧贴明确文本会作为注释", async () => {
    const inputText = [
      "Benchmark M1 M2",
      "PairBench 81/77.3*paper 91*source/83"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const byModel = new Map(parsed.rows.map((row) => [row.modelName, row]));

    expect(byModel.get("M1")?.valueRaw).toBe("81 / 77.3*");
    expect(byModel.get("M1")?.valueNote).toBe("paper");
    expect(byModel.get("M2")?.valueRaw).toBe("91* / 83");
    expect(byModel.get("M2")?.valueNote).toBe("source");
  });

  test("三值指标标签会自动拆成多个 benchmark", async () => {
    const inputText = [
      "Benchmark\tModel-A\tModel-B\tModel-C",
      "SongFormBench-HarmonixSet(acc|hr.5f|hr3f)\t75.6|46.8|77.9\t80.6|67.8|83.4\t81.1|72.9|85.3"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));

    expect(benchmarkNames).toEqual(
      new Set([
        "SongFormBench-HarmonixSet (acc)",
        "SongFormBench-HarmonixSet (hr.5f)",
        "SongFormBench-HarmonixSet (hr3f)"
      ])
    );

    const valueByBenchmarkModel = new Map(
      parsed.rows.map((row) => [`${row.benchmarkName}::${row.modelName}`, row.valueRaw])
    );

    expect(valueByBenchmarkModel.get("SongFormBench-HarmonixSet (acc)::Model-A")).toBe("75.6");
    expect(valueByBenchmarkModel.get("SongFormBench-HarmonixSet (hr.5f)::Model-B")).toBe("67.8");
    expect(valueByBenchmarkModel.get("SongFormBench-HarmonixSet (hr3f)::Model-C")).toBe("85.3");
  });

  test("双值指标标签会保留双值并写入注释", async () => {
    const inputText = [
      "Benchmark\tM1\tM2\tM3",
      "Librispeech(clean|other)\t3.36|4.41\t1.30|2.43\t1.11|2.23"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const byModel = new Map(parsed.rows.map((row) => [row.modelName, row]));

    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((row) => row.benchmarkName === "Librispeech")).toBe(true);
    expect(byModel.get("M1")?.valueRaw).toBe("3.36 / 4.41");
    expect(byModel.get("M2")?.valueRaw).toBe("1.30 / 2.43");
    expect(byModel.get("M3")?.valueRaw).toBe("1.11 / 2.23");
    expect(byModel.get("M1")?.valueNote).toContain("(clean|other)");
  });

  test("可将分行的 τ / 2 / -Bench 前缀合并为 τ2-Bench", async () => {
    const inputText = [
      "Benchmark M1 M2 M3 M4 M5",
      "τ",
      "2",
      "-Bench (retail) 82 86.2 88.9 85.3 90.4",
      "τ",
      "2",
      "-Bench (telecom) 98.7 98.0 98.2 98.0 94.2"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));

    expect(benchmarkNames.has("τ2-Bench (retail)")).toBe(true);
    expect(benchmarkNames.has("τ2-Bench (telecom)")).toBe(true);
    expect(Array.from(benchmarkNames).some((name) => name.includes("τ 2 -Bench"))).toBe(false);
  });

  test("判重归一化中 τ2 与 τ² 一致，且 τ² 与 τ³ 可区分", () => {
    expect(normalizeDuplicateCompareTextForTest("τ2-Bench [General]")).toBe("τ2 bench general");
    expect(normalizeDuplicateCompareTextForTest("τ²-Bench [General]")).toBe("τ2 bench general");
    expect(normalizeDuplicateCompareTextForTest("τ³-Bench [General]")).toBe("τ3 bench general");

    expect(normalizeDuplicateCompareTextForTest("τ²-Bench [General]")).not.toBe(
      normalizeDuplicateCompareTextForTest("τ³-Bench [General]")
    );
  });

  test("重复相似度计算保留希腊字母并区分上标数字", () => {
    const exactEquivalent = getDuplicateNameSimilarityForTest("τ2-Bench", "τ²-Bench");
    const superscriptGap = getDuplicateNameSimilarityForTest("τ²-Bench", "τ³-Bench");

    expect(exactEquivalent).toBe(1);
    expect(superscriptGap).toBeLessThan(1);
    expect(normalizeDuplicateCompareTextForTest("Λ-τ Bench")).toBe("λ τ bench");
  });

  test("重复比较归一化会折叠 non-breaking hyphen，避免导入预览把同名模型仅标成相似", () => {
    expect(normalizeDuplicateCompareTextForTest("GPT‑5.4 Pro")).toBe(
      normalizeDuplicateCompareTextForTest("GPT-5.4 Pro")
    );

    expect(getDuplicateNameSimilarityForTest("GPT‑5.4 Pro", "GPT-5.4 Pro")).toBe(1);
  });

  test("导入文本解析时会把 U+2011 归一化为普通连字符", async () => {
    const inputText = [
      "Benchmark\tGPT‑5.4\tGPT-5.4 Pro",
      "SWE-bench\t57.7\t60.1"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const modelNames = new Set(parsed.rows.map((row) => row.modelName));

    expect(modelNames.has("GPT‑5.4")).toBe(false);
    expect(modelNames.has("GPT-5.4")).toBe(true);
    expect(modelNames.has("GPT-5.4 Pro")).toBe(true);
  });

  test("benchmark 数字片段差异会被识别为不一致", () => {
    expect(
      hasBenchmarkNumericTokenMismatchForTest(
        "SongFormBench-HarmonixSet (hr3f)",
        "SongFormBench-HarmonixSet (hr.5f)"
      )
    ).toBe(true);

    expect(
      hasBenchmarkNumericTokenMismatchForTest(
        "SongFormBench-HarmonixSet (hr3f)",
        "SongFormBench-HarmonixSet (hr3f)"
      )
    ).toBe(false);
  });

  test("判重可识别 Max effort 等变体后缀并兼容空格差异", () => {
    expect(
      hasBenchmarkVariantNoiseNormalizedNameMatchForTest(
        "Vending Bench 2",
        "VendingBench 2 (Max effort)"
      )
    ).toBe(true);

    expect(
      hasBenchmarkVariantNoiseNormalizedNameMatchForTest(
        "SongFormBench-HarmonixSet (hr3f)",
        "SongFormBench-HarmonixSet (hr.5f)"
      )
    ).toBe(false);
  });

  test("VLM 关键词可识别为 Vision 模态", async () => {
    const inputText = [
      "Benchmark M1 M2",
      "VLM Arena",
      "SceneQA 80 81"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const sceneRows = parsed.rows.filter((row) => row.benchmarkName === "SceneQA");

    expect(sceneRows.length).toBeGreaterThan(0);
    expect(new Set(sceneRows.map((row) => row.benchmarkType))).toEqual(new Set(["VLM Arena"]));
    expect(sceneRows.every((row) => row.modalities.includes("Vision"))).toBe(true);
  });

  test("Fleurs 只要含双向标记就不再默认 low-is-better", async () => {
    const inputText = [
      "Benchmark\tM1",
      "Fleurs en⇄zh\t12.3",
      "Fleurs en⇄fr\t13.1",
      "Fleurs en-fr\t14.1"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const fleursZhRow = parsed.rows.find((row) => row.benchmarkName === "Fleurs en⇄zh");
    const fleursBiDirectionalRow = parsed.rows.find((row) => row.benchmarkName === "Fleurs en⇄fr");
    const fleursGeneralRow = parsed.rows.find((row) => row.benchmarkName === "Fleurs en-fr");

    expect(fleursZhRow?.higherIsBetter).toBe(true);
    expect(fleursBiDirectionalRow?.higherIsBetter).toBe(true);
    expect(fleursGeneralRow?.higherIsBetter).toBe(false);
  });

  test("分类含 ASR 时默认 low-is-better", async () => {
    const inputText = [
      "Benchmark\tM1",
      "ASR\t",
      "Librispeech\t3.2"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const row = parsed.rows.find((item) => item.benchmarkName === "Librispeech");

    expect(row).toBeDefined();
    expect(row?.benchmarkType).toBe("ASR");
    expect(row?.higherIsBetter).toBe(false);
  });

  test("benchmark 名包含 MSE 时默认 low-is-better", async () => {
    const inputText = [
      "Benchmark\tM1",
      "Depth MSE\t0.12"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const row = parsed.rows.find((item) => item.benchmarkName === "Depth MSE");

    expect(row).toBeDefined();
    expect(row?.higherIsBetter).toBe(false);
  });

  test("Tab 矩阵文本可正确识别 Vision/Audio 分类与模态", async () => {
    const inputText = [
      "\tGemma 4 31B\tGemma 4 26B A4B",
      "MMLU Pro\t85.2%\t82.6%",
      "Vision\t\t",
      "MMMU Pro\t76.9%\t73.8%",
      "Audio\t\t",
      "CoVoST\t35.54\t33.47"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    const mmmuRows = parsed.rows.filter((row) => row.benchmarkName === "MMMU Pro");
    expect(mmmuRows.length).toBeGreaterThan(0);
    expect(new Set(mmmuRows.map((row) => row.benchmarkType))).toEqual(new Set(["Vision"]));
    expect(mmmuRows.every((row) => row.modalities.includes("Vision"))).toBe(true);

    const covostRows = parsed.rows.filter((row) => row.benchmarkName === "CoVoST");
    expect(covostRows.length).toBeGreaterThan(0);
    expect(new Set(covostRows.map((row) => row.benchmarkType))).toEqual(new Set(["Audio"]));
    expect(covostRows.every((row) => row.modalities.includes("Audio"))).toBe(true);
  });

  test("Tab 矩阵文本支持 benchmark 换行并继承上一类型", async () => {
    const inputText = [
      "Benchmark\tKimi K2.6\tGPT-5.4\tClaude Opus 4.6\tGemini 3.1 Pro\tKimi K2.5",
      "Agentic",
      "HLE-Full",
      "(w/ tools)\t54.0\t52.1\t53.0\t51.4\t50.2",
      "BrowseComp\t83.2\t82.7\t83.7\t85.9\t74.9"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const hleRows = parsed.rows.filter((row) => row.benchmarkName === "HLE-Full (w/ tools)");
    expect(hleRows).toHaveLength(5);
    expect(new Set(hleRows.map((row) => row.benchmarkType))).toEqual(new Set(["Agentic"]));

    const hleValueByModel = new Map(hleRows.map((row) => [row.modelName, row.valueRaw]));
    expect(hleValueByModel.get("Kimi K2.6")).toBe("54.0");
    expect(hleValueByModel.get("GPT-5.4")).toBe("52.1");
    expect(hleValueByModel.get("Claude Opus 4.6")).toBe("53.0");
    expect(hleValueByModel.get("Gemini 3.1 Pro")).toBe("51.4");
    expect(hleValueByModel.get("Kimi K2.5")).toBe("50.2");

    const browseCompRows = parsed.rows.filter((row) => row.benchmarkName === "BrowseComp");
    expect(browseCompRows).toHaveLength(5);
    expect(new Set(browseCompRows.map((row) => row.benchmarkType))).toEqual(new Set(["Agentic"]));
  });

  test("提供 htmlText 时优先按 HTML 表格解析，并识别 colspan 分类行", async () => {
    const fallbackText = [
      "Benchmark\tM1",
      "Fallback\t1.0"
    ].join("\n");

    const htmlInput = [
      "<html><body><table>",
      "<thead>",
      "<tr><th>Benchmark</th><th>Kimi K2.6</th><th>GPT-5.4<br>(xhigh)</th><th>Kimi K2.5</th></tr>",
      "</thead>",
      "<tbody>",
      "<tr><td colspan=\"4\">Agentic</td></tr>",
      "<tr><td>HLE-Full<br>(w/ tools)</td><td>54.0</td><td>52.1</td><td>50.2</td></tr>",
      "</tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest(fallbackText, "text:unit-test", htmlInput);

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.parseSource).toBe("html");

    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));
    expect(benchmarkNames.has("Fallback")).toBe(false);
    expect(benchmarkNames.has("HLE-Full (w/ tools)")).toBe(true);

    const hleRows = parsed.rows.filter((row) => row.benchmarkName === "HLE-Full (w/ tools)");
    expect(hleRows).toHaveLength(3);
    expect(new Set(hleRows.map((row) => row.benchmarkType))).toEqual(new Set(["Agentic"]));

    const valueByModel = new Map(hleRows.map((row) => [row.modelName, row.valueRaw]));
    expect(Number(valueByModel.get("Kimi K2.6"))).toBeCloseTo(54.0);
    expect(Array.from(valueByModel.entries()).some(([modelName, value]) => modelName.includes("GPT-5.4") && value === "52.1")).toBe(true);
    expect(valueByModel.get("Kimi K2.5")).toBe("50.2");
  });

  test("HTML 表格外部标题可作为 type 前导行", async () => {
    const fallbackText = [
      "Benchmark\tM1",
      "Fallback\t1.0"
    ].join("\n");

    const htmlInput = [
      '<html><body><h5>Coding</h5><div><table>',
      "<thead>",
      "<tr><th>Eval</th><th>GPT-5.5</th><th>GPT‑5.4</th></tr>",
      "</thead>",
      "<tbody>",
      "<tr><td>SWE-Bench Pro (Public)</td><td>58.6%</td><td>57.7%</td></tr>",
      "<tr><td>Terminal-Bench 2.0</td><td>82.7%</td><td>75.1%</td></tr>",
      "</tbody>",
      "</table></div></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest(fallbackText, "text:unit-test", htmlInput);

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.parseSource).toBe("html");

    const sweRows = parsed.rows.filter((row) => row.benchmarkName === "SWE-Bench Pro (Public)");
    expect(sweRows).toHaveLength(2);
    expect(new Set(sweRows.map((row) => row.benchmarkType))).toEqual(new Set(["Coding"]));
    expect(sweRows.every((row) => row.benchmarkTypeProvided)).toBe(true);

    const terminalRows = parsed.rows.filter((row) => row.benchmarkName === "Terminal-Bench 2.0");
    expect(terminalRows).toHaveLength(2);
    expect(new Set(terminalRows.map((row) => row.benchmarkType))).toEqual(new Set(["Coding"]));
    expect(terminalRows.every((row) => row.benchmarkTypeProvided)).toBe(true);
  });

  test("HTML 仅模型表头时可识别隐式 benchmark 首列与单独 type 行", async () => {
    const fallbackText = [
      "Benchmark\tM1",
      "Fallback\t1.0"
    ].join("\n");

    const htmlInput = [
      "<html><body><table>",
      "<thead>",
      "<tr><th>Opus-4.6 Max</th><th>K2.6 Thinking</th><th>GLM-5.1 Thinking</th><th>DS-V4-Pro Max</th><th>Qwen3.6-Plus</th><th>Qwen3.7-Max</th></tr>",
      "</thead>",
      "<tbody>",
      "<tr><td>Coding Agent</td></tr>",
      "<tr><td>Terminal Bench 2.0-Terminus</td><td>65.4</td><td>66.7</td><td>63.5</td><td>67.9</td><td>61.6</td><td>69.7</td></tr>",
      "<tr><td>SWE-Verified</td><td>80.8</td><td>80.2</td><td>--</td><td>80.6</td><td>78.8</td><td>80.4</td></tr>",
      "</tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest(fallbackText, "text:unit-test", htmlInput);

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.parseSource).toBe("html");

    const terminalRows = parsed.rows.filter((row) => row.benchmarkName === "Terminal Bench 2.0-Terminus");
    expect(terminalRows).toHaveLength(6);
    expect(new Set(terminalRows.map((row) => row.benchmarkType))).toEqual(new Set(["Coding Agent"]));
    expect(terminalRows.every((row) => row.benchmarkTypeProvided)).toBe(true);

    const sweRows = parsed.rows.filter((row) => row.benchmarkName === "SWE-Verified");
    expect(sweRows).toHaveLength(5);
    expect(new Set(sweRows.map((row) => row.benchmarkType))).toEqual(new Set(["Coding Agent"]));
    expect(sweRows.every((row) => row.benchmarkTypeProvided)).toBe(true);

    const terminalValueByModel = new Map(terminalRows.map((row) => [row.modelName, row.valueRaw]));
    expect(terminalValueByModel.get("Opus-4.6 Max")).toBe("65.4");
    expect(terminalValueByModel.get("Qwen3.7-Max")).toBe("69.7");

    const sweValueByModel = new Map(sweRows.map((row) => [row.modelName, row.valueRaw]));
    expect(sweValueByModel.has("GLM-5.1 Thinking")).toBe(false);
    expect(sweValueByModel.get("Qwen3.7-Max")).toBe("80.4");
  });

  test("提供 htmlText 时可识别中英混合 Category/Benchmark 表头并继承空白分类", async () => {
    const fallbackText = [
      "Benchmark\tM1",
      "Fallback\t1.0"
    ].join("\n");

    const htmlInput = [
      "<html><body><table>",
      "<thead>",
      "<tr><td><strong>评测大类 (Category)</strong></td><td><strong>评测基准 (Benchmark)</strong></td><td><strong>M1</strong></td><td><strong>M2</strong></td></tr>",
      "</thead>",
      "<tbody>",
      "<tr><td>Knowledge</td><td>C-SimpleQA</td><td>60.30</td><td>47.03</td></tr>",
      "<tr><td>Math</td><td>AIME26</td><td>73.80</td><td>88.59</td></tr>",
      "<tr><td></td><td>HMMT-Feb26</td><td>50.76</td><td>76.23</td></tr>",
      "</tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest(fallbackText, "text:unit-test", htmlInput);

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.parseSource).toBe("html");

    const simpleQaRows = parsed.rows.filter((row) => row.benchmarkName === "C-SimpleQA");
    expect(simpleQaRows).toHaveLength(2);
    expect(new Set(simpleQaRows.map((row) => row.benchmarkType))).toEqual(new Set(["Knowledge"]));
    expect(simpleQaRows.every((row) => row.benchmarkTypeProvided)).toBe(true);

    const aimeRows = parsed.rows.filter((row) => row.benchmarkName === "AIME26");
    expect(aimeRows).toHaveLength(2);
    expect(new Set(aimeRows.map((row) => row.benchmarkType))).toEqual(new Set(["Math"]));
    expect(aimeRows.every((row) => row.benchmarkTypeProvided)).toBe(true);

    const hmmtRows = parsed.rows.filter((row) => row.benchmarkName === "HMMT-Feb26");
    expect(hmmtRows).toHaveLength(2);
    expect(new Set(hmmtRows.map((row) => row.benchmarkType))).toEqual(new Set(["Math"]));
    expect(hmmtRows.every((row) => row.benchmarkTypeProvided)).toBe(true);
  });

  test("HTML 表格 rowspan 分数会复制到覆盖行", async () => {
    const htmlInput = [
      "<html><body><table>",
      "<thead>",
      "<tr><th>Benchmark</th><th>M1</th><th>M2</th><th>M3</th><th>M4</th><th>M5</th></tr>",
      "</thead>",
      "<tbody>",
      "<tr><td>BrowseComp</td><td>83.2</td><td rowspan=\"2\">82.7</td><td rowspan=\"2\">83.7</td><td rowspan=\"2\">85.9</td><td>74.9</td></tr>",
      "<tr><td>BrowseComp<br>(Agent Swarm)</td><td>86.3</td><td>78.4</td></tr>",
      "</tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest(htmlInput, "text:unit-test");
    expect(parsed.format).toBe("matrix-table");

    const valueByBenchmarkAndModel = new Map(
      parsed.rows.map((row) => [`${row.benchmarkName}::${row.modelName}`, row.valueRaw])
    );

    expect(valueByBenchmarkAndModel.get("BrowseComp::M2")).toBe("82.7");
    expect(valueByBenchmarkAndModel.get("BrowseComp::M3")).toBe("83.7");
    expect(valueByBenchmarkAndModel.get("BrowseComp::M4")).toBe("85.9");

    expect(valueByBenchmarkAndModel.get("BrowseComp (Agent Swarm)::M2")).toBe("82.7");
    expect(valueByBenchmarkAndModel.get("BrowseComp (Agent Swarm)::M3")).toBe("83.7");
    expect(valueByBenchmarkAndModel.get("BrowseComp (Agent Swarm)::M4")).toBe("85.9");
    expect(valueByBenchmarkAndModel.get("BrowseComp (Agent Swarm)::M1")).toBe("86.3");
    expect(valueByBenchmarkAndModel.get("BrowseComp (Agent Swarm)::M5")).toBe("78.4");
  });

  test("HTML 表格中的星号值会保留原始写法", async () => {
    const htmlInput = [
      "<html><body><table>",
      "<thead><tr><th>Benchmark</th><th>M1</th></tr></thead>",
      "<tbody><tr><td>Star Bench</td><td>65.4*</td></tr></tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest("Benchmark\tX\nFallback\t1", "text:unit-test", htmlInput);
    const starRow = parsed.rows.find((row) => row.benchmarkName === "Star Bench" && row.modelName === "M1");

    expect(parsed.parseSource).toBe("html");
    expect(starRow).toBeDefined();
    expect(starRow?.valueRaw).toBe("65.4*");
  });

  test("HTML 表格中的 LaTeX 希腊字母会转换为 Unicode 标准字符", async () => {
    const htmlInput = [
      "<html><body><table>",
      "<thead><tr><th>Benchmark</th><th>M1</th></tr></thead>",
      "<tbody>",
      "<tr><td>$\\tau$3-bench</td><td>72.9</td></tr>",
      "<tr><td>$\\Gamma$-bench</td><td>70.1</td></tr>",
      "<tr><td>$\\varphi$-bench</td><td>68.4</td></tr>",
      "</tbody>",
      "</table></body></html>"
    ].join("");

    const parsed = await parseBenchmarkTextRowsForTest("Benchmark\tX\nFallback\t1", "text:unit-test", htmlInput);
    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));

    expect(parsed.parseSource).toBe("html");
    expect(benchmarkNames.has("τ3-bench")).toBe(true);
    expect(benchmarkNames.has("Γ-bench")).toBe(true);
    expect(benchmarkNames.has("ϕ-bench")).toBe(true);
  });

  test("多行堆叠模型表头可重建并正确对齐数值列", async () => {
    const inputText = [
      "Evaluation Claude family",
      "models",
      "Other models",
      "Claude",
      "Opus 4.7",
      "Claude",
      "Opus 4.6",
      "GPT-5.4 GPT-5.4",
      "Pro",
      "Gemini",
      "3.1 Pro",
      "SWE-bench Verified 87.6% 80.8% - - 80.6%",
      "SWE-bench Pro 64.3% 53.4% 57.7% - 54.2%",
      "SWE-bench Plus 60.0% 50.0% 55.0% 54.0% 52.0%"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("paper-table");

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames).toEqual(
      new Set([
        "Claude Opus 4.7",
        "Claude Opus 4.6",
        "GPT-5.4",
        "GPT-5.4 Pro",
        "Gemini 3.1 Pro"
      ])
    );

    expect(modelNames.has("Evaluation")).toBe(false);
    expect(modelNames.has("Other")).toBe(false);

    const verifiedByModel = new Map(
      parsed.rows
        .filter((row) => row.benchmarkName === "SWE-bench Verified")
        .map((row) => [row.modelName, row.valueRaw])
    );

    expect(verifiedByModel.get("Claude Opus 4.7")).toBe("87.6");
    expect(verifiedByModel.get("Claude Opus 4.6")).toBe("80.8");
    expect(verifiedByModel.get("Gemini 3.1 Pro")).toBe("80.6");
    expect(verifiedByModel.has("GPT-5.4")).toBe(false);
    expect(verifiedByModel.has("GPT-5.4 Pro")).toBe(false);

    const proByModel = new Map(
      parsed.rows
        .filter((row) => row.benchmarkName === "SWE-bench Pro")
        .map((row) => [row.modelName, row.valueRaw])
    );

    expect(proByModel.get("Claude Opus 4.7")).toBe("64.3");
    expect(proByModel.get("Claude Opus 4.6")).toBe("53.4");
    expect(proByModel.get("GPT-5.4")).toBe("57.7");
    expect(proByModel.get("GPT-5.4 Pro")).toBeUndefined();
    expect(proByModel.get("Gemini 3.1 Pro")).toBe("54.2");

    const plusByModel = new Map(
      parsed.rows
        .filter((row) => row.benchmarkName === "SWE-bench Plus")
        .map((row) => [row.modelName, row.valueRaw])
    );

    expect(plusByModel.get("Claude Opus 4.7")).toBe("60.0");
    expect(plusByModel.get("Claude Opus 4.6")).toBe("50.0");
    expect(plusByModel.get("GPT-5.4")).toBe("55.0");
    expect(plusByModel.get("GPT-5.4 Pro")).toBe("54.0");
    expect(plusByModel.get("Gemini 3.1 Pro")).toBe("52.0");
  });

  test("Category + Benchmark 双列表头可正确解析并继承分类", async () => {
    const inputText = [
      "Category\tBenchmark\tGPT‑5.4\tGPT‑5.4 Pro\tGPT‑5.4 mini\tGPT‑5.4 nano\tGPT‑5.3-Codex\tGPT‑5.2\tGPT‑5.2 Pro\tGPT-5 mini",
      "Knowledge & STEM\tGPQA Diamond\t92.8\t94.4\t88\t82.8\t92.6\t92.4\t93.2\t81.6",
      "Professional\tGDPval\t83\t82\t—\t—\t70.9\t70.9\t74.1\t—",
      "\tFinanceAgent v1.1\t56\t61.5\t—\t—\t54\t59.5\t—\t—",
      "\tInvestment Banking\t87.3\t83.6\t—\t—\t79.3\t68.4\t71.7\t—",
      "\tOfficeQA\t68.1\t—\t—\t—\t65.1\t63.1\t—\t—"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.rows.length).toBe(25);

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames.has("Benchmark")).toBe(false);
    expect(modelNames.has("Category")).toBe(false);
    expect(modelNames.has("GPT-5.3-Codex")).toBe(true);

    const gpqaRows = parsed.rows.filter((row) => row.benchmarkName === "GPQA Diamond");
    expect(gpqaRows.length).toBe(8);
    expect(new Set(gpqaRows.map((row) => row.benchmarkType))).toEqual(new Set(["Knowledge & STEM"]));

    const professionalBenchmarks = ["GDPval", "FinanceAgent v1.1", "Investment Banking", "OfficeQA"];
    for (const benchmarkName of professionalBenchmarks) {
      const benchmarkRows = parsed.rows.filter((row) => row.benchmarkName === benchmarkName);
      expect(benchmarkRows.length).toBeGreaterThan(0);
      expect(new Set(benchmarkRows.map((row) => row.benchmarkType))).toEqual(new Set(["Professional"]));
    }
  });

  test("逗号分隔矩阵文本可正确识别 Category + Benchmark 列", async () => {
    const inputText = [
      "Category,Benchmark,Muse Spark Thinking,Opus 4.6 Max,Gemini 3.1 Pro High,GPT 5.4 Xhigh,Grok 4.2 Reasoning",
      "Multimodal,CharXiv Reasoning,86.4,65.3 (Self-Reported: 61.5),80.2,82.8,60.9"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const charxivRows = parsed.rows.filter((row) => row.benchmarkName === "CharXiv Reasoning");
    expect(charxivRows).toHaveLength(5);
    expect(new Set(charxivRows.map((row) => row.benchmarkType))).toEqual(new Set(["Multimodal"]));
    expect(charxivRows.every((row) => row.modalities.includes("Multimodal"))).toBe(true);

    const opusRow = charxivRows.find((row) => row.modelName === "Opus 4.6 Max");
    expect(opusRow?.valueRaw).toBe("65.3");
    expect(opusRow?.valueNote).toBe("(Self-Reported: 61.5)");
  });

  test("逗号分隔矩阵存在 Benchmark 列时可按位置推断左侧类别列", async () => {
    const inputText = [
      "Capability,Benchmark,Seed2.0 Lite(0428),Seed2.0 Lite(0215),Seed2.0 Pro(0215),Seed2.0 Mini(0215),Seed1.8,GPT-5.4 Mini,GPT-5.4 High,Gemini 3 Flash,Gemini 3 Flash High,Gemini 3 Pro High,Gemini 3.1 Pro,Gemini 3.1 Pro High,Claude Opus 4.7,Claude Sonnet 4.6,Claude Sonnet 4.5",
      "Knowledge,GPQA Diamond,88.4%,85.1%,88.9%,-,-,88.0%,-,90.7%,-,-,-,-,-,-,-",
      ",SuperGPQA,69.6%,67.5%,68.7%,-,-,63.9%,-,72.7%,-,-,-,-,-,-,-"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames.has("Capability")).toBe(false);
    expect(modelNames.has("Benchmark")).toBe(false);

    const gpqaRows = parsed.rows.filter((row) => row.benchmarkName === "GPQA Diamond");
    expect(gpqaRows).toHaveLength(5);
    expect(new Set(gpqaRows.map((row) => row.benchmarkType))).toEqual(new Set(["Knowledge"]));

    const superGpqaRows = parsed.rows.filter((row) => row.benchmarkName === "SuperGPQA");
    expect(superGpqaRows).toHaveLength(5);
    expect(new Set(superGpqaRows.map((row) => row.benchmarkType))).toEqual(new Set(["Knowledge"]));
  });

  test("逗号分隔矩阵会合并 benchmark 名中未加引号的逗号片段", async () => {
    const inputText = [
      "Capability,Benchmark,M1,M2,M3,M4,M5,M6,M7,M8,M9,M10,M11",
      ",WildClawBench (35, text-only),45.3,53.6,48.7*,59.2*,43.5*,50.5*,61.7/47.1*,41.5*,46.2*,58.4*,63.2*"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const rows = parsed.rows.filter((row) => row.benchmarkName === "WildClawBench (35, text-only)");
    expect(rows).toHaveLength(11);
    expect(parsed.rows.some((row) => row.benchmarkName === "WildClawBench (35")).toBe(false);
    expect(parsed.rows.some((row) => row.valueRaw === "text-only)")).toBe(false);

    const valueByModel = new Map(rows.map((row) => [row.modelName, row.valueRaw]));
    expect(valueByModel.get("M1")).toBe("45.3");
    expect(valueByModel.get("M7")).toBe("61.7 / 47.1*");
    expect(valueByModel.get("M11")).toBe("63.2*");
  });

  test("文本导入预览会对模型值列中的非数值内容返回错误提示所需 warning", async () => {
    const inputText = [
      "Benchmark,M1,M2",
      "BrokenBench,text-only),45.3"
    ].join("\n");

    const preview = await previewBenchmarkTextImportForTest(inputText, "text:unit-test");

    expect(preview.format).toBe("matrix-table");
    expect(preview.warningCount).toBe(1);

    const warning = preview.warnings?.[0];
    expect(warning?.type).toBe("non-numeric-import-value");
    expect(warning?.rowNumber).toBe(2);
    expect(warning?.modelName).toBe("M1");
    expect(warning?.benchmarkName).toBe("BrokenBench");
    expect(warning?.rawValue).toBe("text-only)");
    expect(warning?.reason).toContain("模型列解析到非数值内容");

    const invalidRow = preview.previewRows.find((row) => row.modelName === "M1");
    expect(invalidRow?.rawValue).toBe("text-only)");
    expect(invalidRow?.valueNum).toBeNull();
    expect(invalidRow?.valueNum2).toBeNull();
    expect(invalidRow?.valid).toBe(false);
  });

  test("逗号分隔矩阵首列为评测维度时不会被当作模型", async () => {
    const inputText = [
      "评测维度,Claude Opus 4.7,Claude Opus 4.6,GPT-5.4,GPT-5.4 Pro,Gemini 3.1 Pro",
      "SWE-bench Verified,87.6%,80.8%,-,-,80.6%"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames.has("评测维度")).toBe(false);
    expect(modelNames).toEqual(
      new Set([
        "Claude Opus 4.7",
        "Claude Opus 4.6",
        "Gemini 3.1 Pro"
      ])
    );

    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));
    expect(benchmarkNames).toEqual(new Set(["SWE-bench Verified"]));

    const valueByModel = new Map(parsed.rows.map((row) => [row.modelName, row.valueRaw]));
    expect(valueByModel.get("Claude Opus 4.7")).toBe("87.6");
    expect(valueByModel.get("Claude Opus 4.6")).toBe("80.8");
    expect(valueByModel.get("Gemini 3.1 Pro")).toBe("80.6");
  });

  test("逗号分隔矩阵首列为任意标签时按右侧数据列推断模型数", async () => {
    const inputText = [
      "随便写点,Claude Opus 4.7,Claude Opus 4.6,GPT-5.4,GPT-5.4 Pro,Gemini 3.1 Pro",
      "SWE-bench Verified,87.6%,80.8%,-,-,80.6%"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames.has("随便写点")).toBe(false);
    expect(modelNames).toEqual(
      new Set([
        "Claude Opus 4.7",
        "Claude Opus 4.6",
        "Gemini 3.1 Pro"
      ])
    );

    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));
    expect(benchmarkNames).toEqual(new Set(["SWE-bench Verified"]));
  });

  test("结构化 CSV 识别不受逗号矩阵支持影响", async () => {
    const inputText = [
      "provider,model,benchmark,benchmark_type,value_raw,source",
      "OpenAI,GPT-5.4,GPQA Diamond,Knowledge,92.8,text:unit-test"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("structured-csv");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.modelName).toBe("GPT-5.4");
    expect(parsed.rows[0]?.benchmarkName).toBe("GPQA Diamond");
    expect(parsed.rows[0]?.valueRaw).toBe("92.8");
  });

  test("结构化 CSV 支持 benchmark_type_provided 标记", async () => {
    const inputText = [
      "provider,model,benchmark,benchmark_type,benchmark_type_provided,value_raw,source",
      "OpenAI,GPT-5.4,GPQA Diamond,General,0,92.8,text:unit-test",
      "OpenAI,GPT-5.4,AIME 2025,Math,1,91.2,text:unit-test"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("structured-csv");
    expect(parsed.rows).toHaveLength(2);

    const gpqa = parsed.rows.find((row) => row.benchmarkName === "GPQA Diamond");
    const aime = parsed.rows.find((row) => row.benchmarkName === "AIME 2025");

    expect(gpqa?.benchmarkTypeProvided).toBe(false);
    expect(aime?.benchmarkTypeProvided).toBe(true);
  });

  test("矩阵值中的括号说明会拆分为数值与备注", async () => {
    const inputText = [
      "Benchmark\tClaude Sonnet 4\tGPT-5",
      "Terminal-Bench 2.0 (Best self-reported)\t66.5 (Claude Code)\t56.2 (Claude Code)"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    expect(parsed.format).toBe("matrix-table");

    const terminalRows = parsed.rows.filter(
      (row) => row.benchmarkName === "Terminal-Bench 2.0 (Best self-reported)"
    );
    expect(terminalRows.length).toBe(2);

    const byModel = new Map(terminalRows.map((row) => [row.modelName, row]));

    expect(byModel.get("Claude Sonnet 4")?.valueRaw).toBe("66.5");
    expect(byModel.get("Claude Sonnet 4")?.valueNote).toBe("(Claude Code)");

    expect(byModel.get("GPT-5")?.valueRaw).toBe("56.2");
    expect(byModel.get("GPT-5")?.valueNote).toBe("(Claude Code)");
  });

  test("值带 # 前缀时自动标记 higherIsBetter 为 false（矩阵表格）", async () => {
    const inputText = [
      "Benchmark\tModel A\tModel B",
      "Rank Eval\t#3\t#5"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const rows = parsed.rows.filter((row) => row.benchmarkName === "Rank Eval");

    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.higherIsBetter === false)).toBe(true);
  });

  test("值带 # 前缀时自动标记 higherIsBetter 为 false（论文格式）", async () => {
    const inputText = [
      "Rank Eval  Model A  Model B",
      "Arena      #3       #5"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const rows = parsed.rows.filter((row) => row.benchmarkName === "Arena");

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.higherIsBetter === false)).toBe(true);
  });

  test("benchmark 方向标识优先于 # 前缀值推断 higherIsBetter", async () => {
    const inputText = [
      "Benchmark\tModel A\tModel B",
      "Rank Eval ↑\t#3\t#5",
      "Rank Eval ↓\t#3\t#5"
    ].join("\n");

    const parsed = await parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const rows = parsed.rows.filter((row) => row.benchmarkName === "Rank Eval");
    const upRows = rows.slice(0, 2);
    const downRows = rows.slice(2, 4);

    expect(upRows.length).toBe(2);
    expect(upRows.every((row) => row.benchmarkName === "Rank Eval")).toBe(true);
    expect(upRows.every((row) => row.higherIsBetter === true)).toBe(true);

    expect(downRows.length).toBe(2);
    expect(downRows.every((row) => row.benchmarkName === "Rank Eval")).toBe(true);
    expect(downRows.every((row) => row.higherIsBetter === false)).toBe(true);
  });
});
