import { beforeAll, describe, expect, test } from "vitest";

import type { normalizeBenchmarkValueForStorage as NormalizeBenchmarkValueForStorage } from "@/lib/admin-service";

let normalizeBenchmarkValueForStorage: typeof NormalizeBenchmarkValueForStorage;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  const adminService = await import("@/lib/admin-service");
  normalizeBenchmarkValueForStorage = adminService.normalizeBenchmarkValueForStorage;
});

describe("normalizeBenchmarkValueForStorage", () => {
  test("OmniDocBench 1.5 把 >1 的值转成 (100-x)/100 并记 note", () => {
    expect(normalizeBenchmarkValueForStorage("OmniDocBench 1.5", "85")).toEqual({
      valueRaw: "85",
      valueNum: 0.15,
      valueNum2: null,
      valueNote: "normalized-omnidocbench-1.5"
    });
  });

  test("已经是 0-1 量纲或非 OmniDocBench 不改写", () => {
    expect(normalizeBenchmarkValueForStorage("OmniDocBench 1.5", "0.12")).toEqual(
      expect.objectContaining({
        valueNum: 0.12,
        valueNote: null
      })
    );
    expect(normalizeBenchmarkValueForStorage("MMLU", "85")).toEqual(
      expect.objectContaining({
        valueRaw: "85",
        valueNum: 85,
        valueNote: null
      })
    );
  });

  test("没有 benchmark 名时只做普通解析", () => {
    expect(normalizeBenchmarkValueForStorage(null, "77 / 88")).toEqual(
      expect.objectContaining({
        valueNum: 77,
        valueNum2: 88
      })
    );
  });
});
