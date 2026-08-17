import { describe, expect, test } from "vitest";

import { toMatrixInputRow } from "@/components/benchmark-matrix/map-row";
import type { MatrixInputRow } from "@/components/benchmark-matrix/types";
import type { DashboardRow } from "@/lib/db/queries";
import {
  createPublicDashboardSnapshotEtag,
  createPublicDashboardStatsEtag,
  decodePublicDashboardSnapshot,
  encodePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
  type PublicDashboardSnapshotWire
} from "@/lib/dashboard-snapshot-cache";

function createSnapshot(rows: MatrixInputRow[]): PublicDashboardSnapshot {
  return {
    versions: {
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    },
    rows,
    sourceOptions: ["text:only"],
    stats: {
      providerCount: 1,
      modelCount: 2,
      benchmarkCount: 3,
      totalRecords: rows.length
    },
    modelPrices: [],
    modelParams: [],
    exportFootnoteText: "来源：公开评测",
    exportFootnoteAlign: "center"
  };
}

/** 线上真实链路：编码结果要先过一遍 JSON，再交给客户端解码。 */
function transport(snapshot: PublicDashboardSnapshot): PublicDashboardSnapshot {
  const wire = JSON.parse(
    JSON.stringify(encodePublicDashboardSnapshot(snapshot))
  ) as PublicDashboardSnapshotWire;

  return decodePublicDashboardSnapshot(wire);
}

function createDashboardRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    id: 1,
    providerName: "openai",
    providerDisplayName: "OpenAI",
    providerBrandColor: "#10a37f",
    providerEntityId: 11,
    modelName: "GPT-5",
    benchmarkName: "MMLU",
    benchmarkType: "General",
    sourceBenchmarkType: "general",
    higherIsBetter: true,
    benchmarkCanonicalKey: "mmlu:general",
    modalities: ["Text"],
    sourceModalities: null,
    benchTime: "2026-04-06T00:00:00.000Z",
    valueRaw: "88.1",
    valueNum: 88.1,
    valueNum2: null,
    valueNote: null,
    source: "text:only",
    updatedAt: "2026-04-07T00:00:00.000Z",
    ...overrides
  };
}

describe("encode/decodePublicDashboardSnapshot", () => {
  test("空 rows 也能原样往返", () => {
    const snapshot = createSnapshot([]);
    const wire = encodePublicDashboardSnapshot(snapshot);

    expect(wire.rowCount).toBe(0);
    expect(wire.columns).toEqual({});
    expect(transport(snapshot)).toStrictEqual(snapshot);
  });

  test("非 rows 字段原样透传，不被列式编码改写", () => {
    const wire = encodePublicDashboardSnapshot(createSnapshot([]));

    expect(wire.versions).toEqual({
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    });
    expect(wire.sourceOptions).toEqual(["text:only"]);
    expect(wire.exportFootnoteText).toBe("来源：公开评测");
    expect(wire.exportFootnoteAlign).toBe("center");
    expect(wire).not.toHaveProperty("rows");
  });

  test("toMatrixInputRow 产出的真实行形状逐字段往返保真", () => {
    const rows = [
      // 全字段齐备
      createDashboardRow(),
      // providerDisplayName 与 providerName 相同 → 被 toMatrixInputRow 省略
      createDashboardRow({ id: 2, providerName: "meta", providerDisplayName: "meta" }),
      // 大量 optional 字段缺省 + valueNum 为 null（无可比数值）
      createDashboardRow({
        id: 3,
        providerBrandColor: null,
        sourceBenchmarkType: null,
        higherIsBetter: false,
        modalities: [],
        sourceModalities: ["Text", "Image"],
        valueRaw: "N/A",
        valueNum: null,
        valueNote: "  ",
        source: null
      }),
      // 双数值 + 脚注
      createDashboardRow({ id: 4, valueNum: 90, valueNum2: 91.5, valueNote: "自测" })
    ].map(toMatrixInputRow);

    const snapshot = createSnapshot(rows);

    expect(transport(snapshot)).toStrictEqual(snapshot);
  });

  test("高重复列走字典编码，字典按值去重", () => {
    const rows = Array.from({ length: 12 }, (_, index) => toMatrixInputRow(createDashboardRow({
      id: index + 1,
      providerName: index % 2 === 0 ? "openai" : "anthropic",
      providerDisplayName: index % 2 === 0 ? "OpenAI" : "Anthropic"
    })));

    const { columns } = encodePublicDashboardSnapshot(createSnapshot(rows));
    const providerName = columns.providerName;

    expect(providerName).toHaveProperty("d");
    if (!("d" in providerName)) throw new Error("providerName 应为字典列");
    expect(providerName.d).toEqual(["openai", "anthropic"]);
    expect(providerName.c).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);

    // 12 行完全相同的常量列只留一个字典项
    const benchTime = columns.benchTime;
    if (!("d" in benchTime)) throw new Error("benchTime 应为字典列");
    expect(benchTime.d).toEqual(["2026-04-06T00:00:00.000Z"]);
    expect(benchTime.c).toEqual(new Array(12).fill(0));
  });

  test("去重率不足一半的列退回原始列，避免下标数组反而变大", () => {
    const rows = Array.from({ length: 12 }, (_, index) => toMatrixInputRow(createDashboardRow({
      id: index + 1,
      valueRaw: `${index}`,
      valueNum: index
    })));

    const { columns } = encodePublicDashboardSnapshot(createSnapshot(rows));

    // recordId / valueNum / valueRaw 每行唯一 → 建字典是净负收益
    expect(columns.recordId).toEqual({ v: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    expect(columns.valueNum).toHaveProperty("v");
    expect(columns.valueRaw).toHaveProperty("v");
    // 恰好一半重复仍值得建字典（dict*2 <= rowCount）
    expect(columns.providerName).toHaveProperty("d");
  });

  test("稀疏字段用 -1 标记缺省，解码后键不存在而非 null", () => {
    const rows = [
      toMatrixInputRow(createDashboardRow({ id: 1, valueNote: "仅此行有脚注" })),
      toMatrixInputRow(createDashboardRow({ id: 2 })),
      toMatrixInputRow(createDashboardRow({ id: 3 })),
      toMatrixInputRow(createDashboardRow({ id: 4 }))
    ];

    const { columns } = encodePublicDashboardSnapshot(createSnapshot(rows));
    const valueNote = columns.valueNote;
    if (!("d" in valueNote)) throw new Error("valueNote 应为字典列");
    expect(valueNote.d).toEqual(["仅此行有脚注"]);
    expect(valueNote.c).toEqual([0, -1, -1, -1]);

    const decoded = transport(createSnapshot(rows));
    expect(decoded.rows[0].valueNote).toBe("仅此行有脚注");
    expect("valueNote" in decoded.rows[1]).toBe(false);
    expect(decoded.rows).toStrictEqual(rows);
  });

  test("valueNum 的 null 在字典列与原始列两条路径下都保留", () => {
    // 大量重复值 → valueNum 走字典列，null 作为字典项之一
    const dictRows = Array.from({ length: 12 }, (_, index) => toMatrixInputRow(createDashboardRow({
      id: index + 1,
      valueNum: index % 3 === 0 ? null : 70,
      valueRaw: index % 3 === 0 ? "N/A" : "70"
    })));
    const dictColumn = encodePublicDashboardSnapshot(createSnapshot(dictRows)).columns.valueNum;
    if (!("d" in dictColumn)) throw new Error("valueNum 应为字典列");
    expect(dictColumn.d).toEqual([null, 70]);

    const dictDecoded = transport(createSnapshot(dictRows));
    expect(dictDecoded.rows[0].valueNum).toBeNull();
    expect("valueNum" in dictDecoded.rows[0]).toBe(true);
    expect(dictDecoded.rows).toStrictEqual(dictRows);

    // 每行唯一 → valueNum 退回原始列，null 仍需原样保留
    const rawRows = Array.from({ length: 6 }, (_, index) => toMatrixInputRow(createDashboardRow({
      id: index + 1,
      valueNum: index === 0 ? null : index,
      valueRaw: index === 0 ? "N/A" : `${index}`
    })));
    expect(encodePublicDashboardSnapshot(createSnapshot(rawRows)).columns.valueNum)
      .toEqual({ v: [null, 1, 2, 3, 4, 5] });

    const rawDecoded = transport(createSnapshot(rawRows));
    expect(rawDecoded.rows[0].valueNum).toBeNull();
    expect(rawDecoded.rows).toStrictEqual(rawRows);
  });

  test("字段清单取所有行的并集，行间字段集不同也不丢字段", () => {
    const rows: MatrixInputRow[] = [
      {
        providerName: "openai",
        modelName: "GPT-5",
        benchmarkName: "MMLU",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "88.1",
        valueNum: 88.1,
        recordId: 1
      },
      {
        providerName: "anthropic",
        modelName: "Claude",
        benchmarkName: "GPQA",
        benchmarkType: "General",
        benchTime: "2026-04-06T00:00:00.000Z",
        valueRaw: "90",
        valueNum: 90,
        higherIsBetter: false,
        modalities: ["Text", "Image"],
        updatedAt: "2026-04-08T00:00:00.000Z"
      }
    ];

    const { columns } = encodePublicDashboardSnapshot(createSnapshot(rows));

    expect(Object.keys(columns).sort()).toEqual([
      "benchTime",
      "benchmarkName",
      "benchmarkType",
      "higherIsBetter",
      "modalities",
      "modelName",
      "providerName",
      "recordId",
      "updatedAt",
      "valueNum",
      "valueRaw"
    ]);
    expect(transport(createSnapshot(rows))).toStrictEqual(createSnapshot(rows));
  });

  test("字典键区分类型，false / 0 / \"0\" 不会互相串味", () => {
    const rows: MatrixInputRow[] = Array.from({ length: 8 }, (_, index) => ({
      providerName: "openai",
      modelName: "GPT-5",
      benchmarkName: "MMLU",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      // 字符串 "0" 与数值 0 必须落在不同字典项上
      valueRaw: index % 2 === 0 ? "0" : "1",
      valueNum: index % 2 === 0 ? 0 : 1,
      // 布尔 false 与数值 0 必须落在不同字典项上
      ...(index % 2 === 0 ? { higherIsBetter: false as const } : {})
    }));

    const { columns } = encodePublicDashboardSnapshot(createSnapshot(rows));
    const valueNum = columns.valueNum;
    const valueRaw = columns.valueRaw;
    const higherIsBetter = columns.higherIsBetter;
    if (!("d" in valueNum) || !("d" in valueRaw) || !("d" in higherIsBetter)) {
      throw new Error("三列都应为字典列");
    }

    expect(valueNum.d).toEqual([0, 1]);
    expect(valueRaw.d).toEqual(["0", "1"]);
    expect(higherIsBetter.d).toEqual([false]);
    expect(transport(createSnapshot(rows))).toStrictEqual(createSnapshot(rows));
  });

  test("数组值按内容去重，顺序不同视为不同字典项", () => {
    const rows: MatrixInputRow[] = Array.from({ length: 6 }, (_, index) => ({
      providerName: "openai",
      modelName: "GPT-5",
      benchmarkName: "MMLU",
      benchmarkType: "General",
      benchTime: "2026-04-06T00:00:00.000Z",
      valueRaw: "88",
      valueNum: 88,
      modalities: index < 4 ? ["Text", "Image"] : ["Image", "Text"]
    }));

    const modalities = encodePublicDashboardSnapshot(createSnapshot(rows)).columns.modalities;
    if (!("d" in modalities)) throw new Error("modalities 应为字典列");

    expect(modalities.d).toEqual([["Text", "Image"], ["Image", "Text"]]);
    expect(modalities.c).toEqual([0, 0, 0, 0, 1, 1]);
    expect(transport(createSnapshot(rows))).toStrictEqual(createSnapshot(rows));
  });

  test("解码严格按 rowCount 定长，畸形短列不产生越界行", () => {
    const wire: PublicDashboardSnapshotWire = {
      ...createSnapshot([]),
      rowCount: 3,
      columns: {
        providerName: { d: ["openai"], c: [0] },
        valueNum: { v: [1] }
      }
    } as unknown as PublicDashboardSnapshotWire;

    const decoded = decodePublicDashboardSnapshot(wire);

    expect(decoded.rows).toHaveLength(3);
    expect(decoded.rows[0]).toStrictEqual({ providerName: "openai", valueNum: 1 });
    expect(decoded.rows[1]).toStrictEqual({});
    expect(decoded.rows[2]).toStrictEqual({});
  });

  test("valueNum 之外的 null 在解码时归约为缺省，复原紧凑行形状", () => {
    const wire: PublicDashboardSnapshotWire = {
      ...createSnapshot([]),
      rowCount: 1,
      columns: {
        providerName: { v: ["openai"] },
        valueNote: { v: [null] },
        source: { d: [null], c: [0] },
        valueNum: { v: [null] }
      }
    } as unknown as PublicDashboardSnapshotWire;

    expect(decodePublicDashboardSnapshot(wire).rows[0]).toStrictEqual({
      providerName: "openai",
      valueNum: null
    });
  });

  test("列式编码显著小于行式 JSON", () => {
    const rows = Array.from({ length: 400 }, (_, index) => toMatrixInputRow(createDashboardRow({
      id: index + 1,
      modelName: `model-${index % 20}`,
      benchmarkName: `bench-${index % 25}`,
      valueRaw: `${60 + (index % 40)}`,
      valueNum: 60 + (index % 40)
    })));
    const snapshot = createSnapshot(rows);

    const rowWiseSize = JSON.stringify(snapshot).length;
    const columnarSize = JSON.stringify(encodePublicDashboardSnapshot(snapshot)).length;

    expect(columnarSize).toBeLessThan(rowWiseSize * 0.5);
    expect(transport(snapshot)).toStrictEqual(snapshot);
  });
});

describe("createPublicDashboardStatsEtag", () => {
  test("只随 dashboard 版本变化，与快照 ETag 不会互相串味", () => {
    const versions = {
      dashboard: "dashboard-version",
      pricing: "pricing-version",
      settings: "settings-version"
    };

    const statsEtag = createPublicDashboardStatsEtag(versions.dashboard);

    expect(statsEtag).toBe('"dashboard-stats:dashboard-version"');
    expect(statsEtag).not.toBe(createPublicDashboardSnapshotEtag(versions));
    // 价格与设置的变动不该让这 4 个数字失效
    expect(createPublicDashboardStatsEtag(versions.dashboard)).toBe(statsEtag);
    expect(createPublicDashboardStatsEtag("next-dashboard-version")).not.toBe(statsEtag);
  });
});
