import { describe, expect, test } from "vitest";
import { buildMatrixMarkdownTable } from "@/components/benchmark-matrix/export-markdown";
import type { LatestAaRevisionResolution } from "@/lib/aa-index-revisions";
import type { MatrixRow } from "@/components/benchmark-matrix/types";

function makeAaRevision(version: string | null): LatestAaRevisionResolution {
  return {
    latestEntriesByModel: new Map(),
    batches: [],
    groups: [],
    adaptiveThreshold: 0,
    latestVersion: version
  };
}

function makeRow(overrides: Partial<MatrixRow> = {}): MatrixRow {
  return {
    rowKey: "aa-intelligence-index",
    category: "Summary",
    benchmark: "AA Intelligence Index",
    higherIsBetter: true,
    modalities: ["text"],
    cells: new Map(),
    firstSeenIndex: 0,
    sourceOrderKey: null,
    rowDataCount: 0,
    rowNumericCount: 0,
    minComparable: null,
    maxComparable: null,
    minComparable2: null,
    maxComparable2: null,
    minNum: null,
    maxNum: null,
    minNum2: null,
    maxNum2: null,
    ...overrides
  };
}

describe("buildMatrixMarkdownTable 版本标注", () => {
  test("行名后标注版本，并在表格末尾追加版本说明", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [makeRow({ aaRevision: makeAaRevision("v5") })],
      modelColumns: ["GPT-5"],
      showCategory: false
    });

    expect(markdown).toContain("| AA Intelligence Index (v5) | -- |");
    expect(markdown).toContain("> 数据版本：AA Intelligence Index v5。跨版本分数不可直接比较。");
  });

  test("多个 AA 指数各自标注版本", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [
        makeRow({ rowKey: "aa-intelligence", benchmark: "AA Intelligence Index", aaRevision: makeAaRevision("v5") }),
        makeRow({ rowKey: "aa-coding", benchmark: "AA Coding Index", aaRevision: makeAaRevision("v3") })
      ],
      modelColumns: ["GPT-5"],
      showCategory: false
    });

    expect(markdown).toContain("AA Intelligence Index (v5)");
    expect(markdown).toContain("AA Coding Index (v3)");
    expect(markdown).toContain("AA Intelligence Index v5；AA Coding Index v3");
  });

  test("includeVersionLegend=false 时保持原样", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [makeRow({ aaRevision: makeAaRevision("v5") })],
      modelColumns: ["GPT-5"],
      showCategory: false,
      includeVersionLegend: false
    });

    expect(markdown).not.toContain("(v5)");
    expect(markdown).not.toContain("数据版本");
  });

  test("没有版本时行为不变", () => {
    const markdown = buildMatrixMarkdownTable({
      rows: [makeRow()],
      modelColumns: ["GPT-5"],
      showCategory: false
    });

    expect(markdown).not.toContain("(v5)");
    expect(markdown).not.toContain("数据版本");
  });
});
