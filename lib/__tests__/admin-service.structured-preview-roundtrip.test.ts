import { beforeAll, describe, expect, test } from "vitest";

import type { StructuredCsvImportRow } from "@/components/admin-console/types";
import { buildStructuredCsvText } from "@/components/admin-console/utils/csv";

type ParsedRow = {
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  benchmarkTypeProvided?: boolean;
  higherIsBetter?: boolean;
  valueRaw: string;
  valueNote?: string | null;
  modalities: string[];
  source: string | null;
};

let parseBenchmarkTextRowsForTest: (
  inputText: string,
  sourceInput?: string | null
) => Promise<{ format: string; rows: ParsedRow[] }>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminServiceModule = await import("@/lib/admin-service");
  parseBenchmarkTextRowsForTest =
    adminServiceModule.__parseBenchmarkTextRowsForTest as typeof parseBenchmarkTextRowsForTest;
});

describe("最新预览表格内容往返导入", () => {
  test("结构化 CSV 可无损保留预览中的导入字段和特殊字符", async () => {
    const previewRows: StructuredCsvImportRow[] = [
      {
        providerName: "OpenAI, Official",
        providerDisplayName: "OpenAI 官方",
        modelName: "Model \"A\", Preview",
        benchmarkName: "Bench, Alpha",
        benchmarkType: "Vision & Audio",
        benchmarkTypeProvided: true,
        higherIsBetter: false,
        modalities: ["Vision", "Audio"],
        rawValue: "88.5*",
        valueNote: "official, \"verified\"",
        source: "text:release,2026"
      },
      {
        providerName: "Google",
        modelName: "Model B",
        benchmarkName: "Latency",
        benchmarkType: "General",
        benchmarkTypeProvided: false,
        higherIsBetter: false,
        modalities: ["Text"],
        rawValue: "0.12 / 0.34",
        valueNote: null,
        source: null
      }
    ];

    const output = buildStructuredCsvText(previewRows);
    const parsed = await parseBenchmarkTextRowsForTest(output, "text:fallback");

    expect(parsed.format).toBe("structured-csv");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      providerName: "OpenAI, Official",
      modelName: "Model \"A\", Preview",
      benchmarkName: "Bench, Alpha",
      benchmarkType: "Vision & Audio",
      benchmarkTypeProvided: true,
      higherIsBetter: false,
      valueRaw: "88.5*",
      valueNote: "official, \"verified\"",
      modalities: ["Vision", "Audio"],
      source: "text:release,2026"
    });
    expect(parsed.rows[1]).toMatchObject({
      providerName: "Google",
      modelName: "Model B",
      benchmarkName: "Latency",
      benchmarkType: "General",
      benchmarkTypeProvided: false,
      higherIsBetter: false,
      valueRaw: "0.12 / 0.34",
      valueNote: null,
      modalities: ["Text"],
      source: "text:fallback"
    });
  });
});
