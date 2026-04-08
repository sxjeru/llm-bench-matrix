import { beforeAll, describe, expect, test } from "vitest";

type ParsedTextImportResult = {
  format: string;
  rows: Array<{
    benchmarkName: string;
    benchmarkType: string;
    modelName: string;
    valueRaw: string;
    valueNote?: string | null;
    modalities: string[];
  }>;
  warnings?: Array<{
    type?: string;
    field?: string;
    before?: string;
  }>;
};

let parseBenchmarkTextRowsForTest: (
  inputText: string,
  sourceInput?: string | null
) => ParsedTextImportResult;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const module = await import("@/lib/admin-service");
  parseBenchmarkTextRowsForTest = module.__parseBenchmarkTextRowsForTest as typeof parseBenchmarkTextRowsForTest;
});

describe("paper-table 文本解析", () => {
  test("可正确识别 Long Video 分类，并避免 benchmark 特殊符号警告按 model 重复", () => {
    const inputText = [
      "Benchmark GPT-4.1 Gemini-3-Pro Gemini-3-Flash Seed1.8 Qwen2.5 Kimi GPT-4o",
      "TOMATO [78] 95.2 59.6 60.8 60.8 47.4 57.3 59.9",
      "TOMATO (Thinking with Tracking) 95.2 - 64.0 61.0 51.3 59.2 65.3",
      "Long Video",
      "VideoMME‡",
      "[30] - 88.4∗ 85.2 87.8 81.2 87.7 89.5",
      "CGBench [12] - 65.5 65.3 62.4 59.2 59.3 65.0"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

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


  test("可将 77.9 (65.3) 解析为 77.9 / 65.3", () => {
    const inputText = [
      "Benchmark M1 M2 M3 M4 M5",
      "BrowseComp 77.9 (65.3) 43.9 (29.5) 67.8 (57.2) 59.2 77.3"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const browseRows = parsed.rows.filter((row) => row.benchmarkName === "BrowseComp");

    expect(browseRows.length).toBeGreaterThan(0);

    const valueByModel = new Map(browseRows.map((row) => [row.modelName, row.valueRaw]));

    expect(valueByModel.get("M1")).toBe("77.9 / 65.3");
    expect(valueByModel.get("M2")).toBe("43.9 / 29.5");
    expect(valueByModel.get("M3")).toBe("67.8 / 57.2");
    expect(valueByModel.get("M4")).toBe("59.2");
    expect(valueByModel.get("M5")).toBe("77.3");
  });

  test("可将分行的 τ / 2 / -Bench 前缀合并为 τ2-Bench", () => {
    const inputText = [
      "Benchmark M1 M2 M3 M4 M5",
      "τ",
      "2",
      "-Bench (retail) 82 86.2 88.9 85.3 90.4",
      "τ",
      "2",
      "-Bench (telecom) 98.7 98.0 98.2 98.0 94.2"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const benchmarkNames = new Set(parsed.rows.map((row) => row.benchmarkName));

    expect(benchmarkNames.has("τ2-Bench (retail)")).toBe(true);
    expect(benchmarkNames.has("τ2-Bench (telecom)")).toBe(true);
    expect(Array.from(benchmarkNames).some((name) => name.includes("τ 2 -Bench"))).toBe(false);
  });

  test("VLM 关键词可识别为 Vision 模态", () => {
    const inputText = [
      "Benchmark M1 M2",
      "VLM Arena",
      "SceneQA 80 81"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
    const sceneRows = parsed.rows.filter((row) => row.benchmarkName === "SceneQA");

    expect(sceneRows.length).toBeGreaterThan(0);
    expect(new Set(sceneRows.map((row) => row.benchmarkType))).toEqual(new Set(["VLM Arena"]));
    expect(sceneRows.every((row) => row.modalities.includes("Vision"))).toBe(true);
  });

  test("Tab 矩阵文本可正确识别 Vision/Audio 分类与模态", () => {
    const inputText = [
      "Gemma 4 31B\tGemma 4 26B A4B",
      "MMLU Pro\t85.2%\t82.6%",
      "Vision\t\t",
      "MMMU Pro\t76.9%\t73.8%",
      "Audio\t\t",
      "CoVoST\t35.54\t33.47"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    const mmmuRows = parsed.rows.filter((row) => row.benchmarkName === "MMMU Pro");
    expect(mmmuRows.length).toBeGreaterThan(0);
    expect(new Set(mmmuRows.map((row) => row.benchmarkType))).toEqual(new Set(["Vision"]));
    expect(mmmuRows.every((row) => row.modalities.includes("Vision"))).toBe(true);

    const covostRows = parsed.rows.filter((row) => row.benchmarkName === "CoVoST");
    expect(covostRows.length).toBeGreaterThan(0);
    expect(new Set(covostRows.map((row) => row.benchmarkType))).toEqual(new Set(["Audio"]));
    expect(covostRows.every((row) => row.modalities.includes("Audio"))).toBe(true);
  });

  test("Category + Benchmark 双列表头可正确解析并继承分类", () => {
    const inputText = [
      "Category\tBenchmark\tGPT‑5.4\tGPT‑5.4 Pro\tGPT‑5.4 mini\tGPT‑5.4 nano\tGPT‑5.3-Codex\tGPT‑5.2\tGPT‑5.2 Pro\tGPT-5 mini",
      "Knowledge & STEM\tGPQA Diamond\t92.8\t94.4\t88\t82.8\t92.6\t92.4\t93.2\t81.6",
      "Professional\tGDPval\t83\t82\t—\t—\t70.9\t70.9\t74.1\t—",
      "\tFinanceAgent v1.1\t56\t61.5\t—\t—\t54\t59.5\t—\t—",
      "\tInvestment Banking\t87.3\t83.6\t—\t—\t79.3\t68.4\t71.7\t—",
      "\tOfficeQA\t68.1\t—\t—\t—\t65.1\t63.1\t—\t—"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");

    expect(parsed.format).toBe("matrix-table");
    expect(parsed.rows.length).toBe(25);

    const modelNames = new Set(parsed.rows.map((row) => row.modelName));
    expect(modelNames.has("Benchmark")).toBe(false);
    expect(modelNames.has("Category")).toBe(false);
    expect(modelNames.has("GPT‑5.3-Codex")).toBe(true);

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

  test("矩阵值中的括号说明会拆分为数值与备注", () => {
    const inputText = [
      "Benchmark\tClaude Sonnet 4\tGPT-5",
      "Terminal-Bench 2.0 (Best self-reported)\t66.5 (Claude Code)\t56.2 (Claude Code)"
    ].join("\n");

    const parsed = parseBenchmarkTextRowsForTest(inputText, "text:unit-test");
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
});
