import { describe, expect, test } from "vitest";

import { parseExportFootnote, toPublicModelPrice } from "@/lib/dashboard-snapshot";

describe("parseExportFootnote", () => {
  test("字符串直接作为脚注文本", () => {
    expect(parseExportFootnote("来源：公开评测")).toEqual({
      exportFootnoteText: "来源：公开评测",
      exportFootnoteAlign: "center"
    });
  });

  test("对象可覆盖文本和对齐", () => {
    expect(parseExportFootnote({ text: "脚注", align: "left" })).toEqual({
      exportFootnoteText: "脚注",
      exportFootnoteAlign: "left"
    });
  });

  test("非法对齐回落到居中", () => {
    expect(parseExportFootnote({ text: "脚注", align: "justify" })).toEqual({
      exportFootnoteText: "脚注",
      exportFootnoteAlign: "center"
    });
  });
});

describe("toPublicModelPrice", () => {
  test("只投影矩阵和散点用到的价格字段", () => {
    expect(toPublicModelPrice({
      modelId: 7,
      modelName: "GPT-5",
      inputCost: 1.2,
      outputCost: 3.4,
      cacheReadCost: 0.1,
      lastSyncedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    })).toEqual({
      modelId: 7,
      modelName: "GPT-5",
      inputCost: 1.2,
      outputCost: 3.4,
      cacheReadCost: 0.1,
      lastSyncedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    });
  });
});
