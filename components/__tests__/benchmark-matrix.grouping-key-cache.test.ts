import { describe, expect, it } from "vitest";
import { getMatrixGroupingKey } from "@/components/benchmark-matrix/utils";
import { resolveBaseSourceRows, buildRowsBySource } from "@/components/benchmark-matrix/selectors";
import { SOURCE_ALL } from "@/components/benchmark-matrix/constants";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";

function makeRow(overrides: Partial<MatrixInputRow> = {}): MatrixInputRow {
  return {
    providerName: "OpenAI",
    modelName: "GPT-5.6",
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    benchTime: "2026-08-01",
    valueRaw: "88.1",
    valueNum: 88.1,
    ...overrides
  };
}

/**
 * getMatrixGroupingKey 的 merged 键走两级缓存（按 row 对象 + 按 benchmark 字段值），
 * 前提是分组键涉及的字段从不被原地改写。这里锁住那个前提：
 * 一旦将来有人改成 mutate row，或让缓存漏掉某个输入维度，这些用例就会失败。
 */
describe("getMatrixGroupingKey 的分组键缓存", () => {
  it("同一 row 反复求值结果稳定", () => {
    const row = makeRow({ benchmarkCanonicalKey: "mmlu-pro:main" });
    const first = getMatrixGroupingKey(row, false);

    expect(getMatrixGroupingKey(row, false)).toBe(first);
    expect(getMatrixGroupingKey(row, false)).toBe(first);
  });

  it("字段相同的不同 row 对象得到同一个键", () => {
    const left = makeRow({ benchmarkCanonicalKey: "gpqa:diamond" });
    const right = makeRow({ benchmarkCanonicalKey: "gpqa:diamond" });

    expect(getMatrixGroupingKey(right, false)).toBe(getMatrixGroupingKey(left, false));
  });

  it("canonicalKey 不同则键不同，不会被缓存串味", () => {
    const left = makeRow({ benchmarkName: "同名", benchmarkCanonicalKey: "alpha:v1" });
    const right = makeRow({ benchmarkName: "同名", benchmarkCanonicalKey: "beta:v1" });

    expect(getMatrixGroupingKey(left, false)).not.toBe(getMatrixGroupingKey(right, false));
  });

  it("benchmarkName 不同则键不同（无 canonicalKey 时靠它兜底）", () => {
    const left = makeRow({ benchmarkName: "AIME 2025" });
    const right = makeRow({ benchmarkName: "AIME 2026" });

    expect(getMatrixGroupingKey(left, false)).not.toBe(getMatrixGroupingKey(right, false));
  });

  it("raw 模式与 merged 模式互不污染，且 raw 模式认 benchmarkType", () => {
    const row = makeRow({ benchmarkCanonicalKey: "mmlu-pro:main" });
    const merged = getMatrixGroupingKey(row, false);
    const raw = getMatrixGroupingKey(row, true);

    expect(raw).not.toBe(merged);
    // 同一份 canonicalKey 下改 benchmarkType：merged 不变，raw 必须变
    const retyped = makeRow({ benchmarkCanonicalKey: "mmlu-pro:main", benchmarkType: "Reasoning" });
    expect(getMatrixGroupingKey(retyped, false)).toBe(merged);
    expect(getMatrixGroupingKey(retyped, true)).not.toBe(raw);
  });

  it("上下标数字归一化后与半角写法同组", () => {
    const superscript = makeRow({ benchmarkName: "Bench²" });
    const plain = makeRow({ benchmarkName: "Bench2" });

    expect(getMatrixGroupingKey(superscript, false)).toBe(getMatrixGroupingKey(plain, false));
  });

  it("两字段的拼接歧义不会让缓存串味", () => {
    // 若缓存键直接把两字段首尾相连，("a","bc") 与 ("ab","c") 会拼成同一个串，
    // 后者就会错误命中前者的缓存。二者的真实分组键分别取自 canonicalKey，必须不同。
    const left = makeRow({ benchmarkCanonicalKey: "a", benchmarkName: "bc" });
    const right = makeRow({ benchmarkCanonicalKey: "ab", benchmarkName: "c" });

    expect(getMatrixGroupingKey(left, false)).toBe("merged::a");
    expect(getMatrixGroupingKey(right, false)).toBe("merged::ab");
  });
});

/**
 * resolveBaseSourceRows 在 All 视图下用短路判断替代了两个全量 Set。
 * 判定语义是「恰好一个 source 且分组键不超过一个」才回退到 allRows。
 */
describe("resolveBaseSourceRows 的 All 视图短路", () => {
  const allRows = [
    makeRow({ source: "A", benchmarkName: "Bench A" }),
    makeRow({ source: "B", benchmarkName: "Bench B" })
  ];

  function resolve(scopedRows: MatrixInputRow[]) {
    const bySource = buildRowsBySource(scopedRows);
    return resolveBaseSourceRows(allRows, scopedRows, bySource, bySource, SOURCE_ALL, false);
  }

  it("空输入回退到 allRows", () => {
    expect(resolve([])).toBe(allRows);
  });

  it("单一 source 且单一分组键时回退到 allRows", () => {
    const scoped = [
      makeRow({ source: "A", benchmarkName: "Bench A", modelName: "M1" }),
      makeRow({ source: "A", benchmarkName: "Bench A", modelName: "M2" })
    ];

    expect(resolve(scoped)).toBe(allRows);
  });

  it("source 多于一个时用传入的 rows", () => {
    const scoped = [
      makeRow({ source: "A", benchmarkName: "Bench A" }),
      makeRow({ source: "B", benchmarkName: "Bench A" })
    ];

    expect(resolve(scoped)).toBe(scoped);
  });

  it("同一 source 但分组键多于一个时用传入的 rows", () => {
    const scoped = [
      makeRow({ source: "A", benchmarkName: "Bench A" }),
      makeRow({ source: "A", benchmarkName: "Bench B" })
    ];

    expect(resolve(scoped)).toBe(scoped);
  });

  it("差异出现在末尾也能被发现（短路不能提前收工）", () => {
    const scoped = [
      ...Array.from({ length: 50 }, () => makeRow({ source: "A", benchmarkName: "Bench A" })),
      makeRow({ source: "A", benchmarkName: "Bench Z" })
    ];

    expect(resolve(scoped)).toBe(scoped);
  });
});
