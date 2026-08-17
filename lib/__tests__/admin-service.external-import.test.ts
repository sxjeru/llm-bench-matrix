import { describe, expect, test, vi } from "vitest";

const dbClientMock = vi.hoisted(() => ({ db: {} as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return dbClientMock.db;
  }
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type Schema = typeof import("@/lib/db/schema");

type ExistingValueRow = {
  id: number;
  modelId: number;
  benchmarkId: number;
  benchTime: Date;
  valueRaw: string;
  valueNum: string | null;
  valueNum2: string | null;
  source: string | null;
};

type BenchmarkRow = {
  id: number;
  benchmarkName: string;
  benchmarkType: string;
  canonicalKey: string;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  mergedIntoBenchmarkId: number | null;
  sourceBenchmarkId: string | null;
};

type SourceMetaRow = {
  benchmarkId: number;
  source: string;
  benchmarkType: string;
  modalities: string[];
};

const PROVIDER_ROW = { id: 1, name: "OpenAI", slug: "openai" };
const MODEL_ROW = { id: 10, providerId: 1, modelName: "GPT 5.4", canonicalKey: "gpt5.4" };

function makeBenchmarkRow(overrides: Partial<BenchmarkRow> = {}): BenchmarkRow {
  return {
    id: 20,
    benchmarkName: "MMLU-Pro",
    benchmarkType: "Knowledge",
    canonicalKey: "mmlu-pro::knowledge",
    unit: "%",
    higherIsBetter: true,
    modalities: ["Text"],
    mergedIntoBenchmarkId: null,
    sourceBenchmarkId: null,
    ...overrides
  };
}

/**
 * 手写 drizzle 链式 mock，风格对齐 lib/__tests__/model-pricing.test.ts。
 *
 * 按表对象「引用」分派，而不是按表名字符串 —— drizzle 把表名存在 Symbol 上，
 * 从外部读 `table._.name` 拿不到。表对象必须来自与被测模块同一次模块注册周期，
 * 所以由 `setup()` 动态 import 后传进来。
 */
function createDbMock(
  schema: Schema,
  options: {
    existingValues?: ExistingValueRow[];
    /** 传入表示该 benchmark 已存在，ensureBenchmark 会复用它 */
    existingBenchmark?: BenchmarkRow | null;
    existingSourceMeta?: SourceMetaRow[];
  }
) {
  const { benchmarkSourceMeta, benchmarkValues, benchmarks, models, providers, settings } = schema;
  const existingValues = options.existingValues ?? [];
  const existingBenchmark = options.existingBenchmark ?? null;
  const existingSourceMeta = options.existingSourceMeta ?? [];

  const captured = {
    insertedValues: [] as Array<Record<string, unknown>>,
    touchedIds: [] as number[],
    rewrites: [] as Array<Record<string, unknown>>,
    sourceMetaRows: [] as Array<Record<string, unknown>>,
    createdBenchmarkNames: [] as string[]
  };

  let nextId = 900;

  const select = vi.fn((selection?: Record<string, unknown>) => {
    const keys = selection ? Object.keys(selection) : [];

    return {
      from: vi.fn((table: unknown) => {
        // ① 事务开头拉全量 benchmark id，用来判断哪些是本次新建的
        if (table === benchmarks && keys.includes("canonicalKey")) {
          return Promise.resolve(existingBenchmark ? [existingBenchmark] : []);
        }

        if (table === providers && keys.includes("slug")) {
          return Promise.resolve([PROVIDER_ROW]);
        }

        if (table === benchmarkSourceMeta) {
          return { where: vi.fn().mockResolvedValue(existingSourceMeta) };
        }

        // ② 同源既有值
        if (table === benchmarkValues) {
          return { where: vi.fn().mockResolvedValue(existingValues) };
        }

        const resolveLimit = () => {
          if (table === providers) return Promise.resolve([PROVIDER_ROW]);
          if (table === models) return Promise.resolve([MODEL_ROW]);
          if (table === benchmarks) return Promise.resolve(existingBenchmark ? [existingBenchmark] : []);
          if (table === settings) return Promise.resolve([]);
          return Promise.resolve([]);
        };

        return {
          where: vi.fn(() => ({ limit: vi.fn(resolveLimit) })),
          limit: vi.fn(resolveLimit)
        };
      })
    };
  });

  const insert = vi.fn((table: unknown) => ({
    values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(rows) ? rows : [rows];

      if (table === benchmarkValues) {
        captured.insertedValues.push(...list);
        return Promise.resolve(undefined);
      }

      if (table === benchmarkSourceMeta) {
        captured.sourceMetaRows.push(...list);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }

      if (table === benchmarks) {
        const created = list.map((row) => {
          nextId += 1;
          captured.createdBenchmarkNames.push(String(row.benchmarkName));
          return { ...makeBenchmarkRow(), ...row, id: nextId };
        });
        return { returning: vi.fn().mockResolvedValue(created) };
      }

      if (table === models) {
        return { returning: vi.fn().mockResolvedValue([{ ...MODEL_ROW, ...list[0] }]) };
      }

      // providers：ensureProvider 走 insert().values().onConflictDoUpdate().returning()
      return {
        onConflictDoUpdate: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([PROVIDER_ROW]) })),
        returning: vi.fn().mockResolvedValue([PROVIDER_ROW])
      };
    }
  }));

  const update = vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({
      where: vi.fn((condition: unknown) => {
        if (values.valueRaw !== undefined) {
          captured.rewrites.push(values);
        } else {
          captured.touchedIds.push(...collectNumbers(condition));
        }
        return Promise.resolve(undefined);
      })
    })
  }));

  const client = { select, insert, update, delete: vi.fn() };

  return {
    captured,
    db: {
      ...client,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(client))
    }
  };
}

/** drizzle 的 inArray 把 id 埋在 SQL chunk 里，粗暴地把数字全捞出来即可 */
function collectNumbers(node: unknown, seen = new Set<unknown>()): number[] {
  if (typeof node === "number") return [node];
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);

  if (Array.isArray(node)) return node.flatMap((item) => collectNumbers(item, seen));
  return Object.values(node as Record<string, unknown>).flatMap((value) => collectNumbers(value, seen));
}

/**
 * 每个用例都从干净的模块注册表开始：先动态 import schema，用它建 mock，
 * 再 import 被测模块，保证三者拿到的是同一批表对象。
 */
async function setup(options: Parameters<typeof createDbMock>[1] = {}) {
  vi.resetModules();
  const schema = await import("@/lib/db/schema");
  const mock = createDbMock(schema, options);
  dbClientMock.db = mock.db;
  const { importExternalBenchmarkRows } = await import("@/lib/admin-service");
  const { revalidatePath } = await import("next/cache");
  vi.mocked(revalidatePath).mockClear();
  return { mock, importExternalBenchmarkRows, revalidatePath: vi.mocked(revalidatePath) };
}

const BASE_ROW = {
  providerName: "OpenAI",
  modelName: "GPT 5.4",
  benchmarkName: "MMLU-Pro",
  benchmarkType: "Knowledge",
  higherIsBetter: true,
  modalities: ["Text"],
  unit: "%",
  sourceModelId: "aa-1",
  sourceBenchmarkId: "mmlu_pro"
};

function existingValue(overrides: Partial<ExistingValueRow> = {}): ExistingValueRow {
  return {
    id: 501,
    modelId: MODEL_ROW.id,
    benchmarkId: 20,
    benchTime: new Date("2026-07-01T00:00:00.000Z"),
    valueRaw: "79.1",
    valueNum: "79.100000",
    valueNum2: null,
    source: "text:Artificial Analysis",
    ...overrides
  };
}

describe("importExternalBenchmarkRows", () => {
  test("同源没有旧值时插入新行", async () => {
    const { mock, importExternalBenchmarkRows } = await setup();

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.inserted).toBe(1);
    expect(result.appended).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(mock.captured.insertedValues).toHaveLength(1);
    expect(mock.captured.insertedValues[0]).toMatchObject({
      modelId: MODEL_ROW.id,
      valueRaw: "79.1",
      source: "text:Artificial Analysis"
    });
    expect(result.preview[0]).toMatchObject({ outcome: "inserted", previousValue: null });
  });

  test("同源已有相同值时不改写时间戳，也不失效公开缓存", async () => {
    const { mock, importExternalBenchmarkRows, revalidatePath } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ valueRaw: "79.1", valueNum: "79.100000" })],
      existingSourceMeta: [{
        benchmarkId: 20,
        source: "text:Artificial Analysis",
        benchmarkType: "Knowledge",
        modalities: ["Text"]
      }]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.unchanged).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.appended).toBe(0);
    expect(result.publicChanged).toBe(false);
    expect(mock.captured.insertedValues).toHaveLength(0);
    expect(mock.captured.touchedIds).not.toContain(501);
    expect(mock.captured.sourceMetaRows).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(result.preview[0]).toMatchObject({ outcome: "unchanged", previousValue: "79.1" });
  });

  test("历史未加前缀的 source 在无变化同步时不误失效", async () => {
    const { mock, importExternalBenchmarkRows, revalidatePath } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ source: "Artificial Analysis" })],
      existingSourceMeta: [{
        benchmarkId: 20,
        source: "Artificial Analysis",
        benchmarkType: "Knowledge",
        modalities: ["Text"]
      }]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.publicChanged).toBe(false);
    expect(mock.captured.sourceMetaRows).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("历史未加前缀的 source 元数据变化时更新原 source", async () => {
    const { mock, importExternalBenchmarkRows } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ source: "Artificial Analysis" })],
      existingSourceMeta: [{
        benchmarkId: 20,
        source: "Artificial Analysis",
        benchmarkType: "Old Type",
        modalities: ["Text"]
      }]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.publicChanged).toBe(true);
    expect(mock.captured.sourceMetaRows[0]).toMatchObject({
      source: "Artificial Analysis",
      benchmarkType: "Knowledge"
    });
  });

  test("数值相同但展示文本变化时保留原测评时间", async () => {
    const { mock, importExternalBenchmarkRows, revalidatePath } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ valueRaw: "79.100" })],
      existingSourceMeta: [{
        benchmarkId: 20,
        source: "text:Artificial Analysis",
        benchmarkType: "Knowledge",
        modalities: ["Text"]
      }]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis",
      benchTime: new Date("2026-08-17T00:00:00.000Z")
    });

    expect(result.unchanged).toBe(1);
    expect(result.publicChanged).toBe(true);
    expect(mock.captured.rewrites).toEqual([{ valueRaw: "79.1", valueNote: null }]);
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("小到一个最小刻度的差异也算值变化", async () => {
    // numeric(14,6) 是精确十进制，79.099999 与 79.1 是两个真实不同的值，
    // 容差只用来吸收浮点表示误差，不能把相邻刻度也吞掉
    const { mock, importExternalBenchmarkRows, revalidatePath } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ valueRaw: "79.099999", valueNum: "79.099999" })]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.appended).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.publicChanged).toBe(true);
    expect(mock.captured.insertedValues).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("上游小数换算带来的浮点尾巴不算值变化", async () => {
    // 0.791 * 100 在 JS 里是 79.10000000000001，formatMetricValue 会先收敛成 "79.1"，
    // 与库里存的 79.100000 必须判为相同，否则每次同步都会凭空追加一行
    const { mock, importExternalBenchmarkRows } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ valueRaw: "79.1", valueNum: "79.100000" })]
    });

    const { formatMetricValue } = await import("@/lib/external-providers/artificial-analysis");
    const rawValue = formatMetricValue(0.791, "fraction");
    expect(rawValue).toBe("79.1");

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue }], {
      source: "Artificial Analysis"
    });

    expect(result.unchanged).toBe(1);
    expect(mock.captured.insertedValues).toHaveLength(0);
  });

  test("同源已有不同值时追加一行，旧行保留", async () => {
    const { mock, importExternalBenchmarkRows } = await setup({
      existingBenchmark: makeBenchmarkRow(),
      existingValues: [existingValue({ valueRaw: "75", valueNum: "75.000000" })]
    });

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(result.appended).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(mock.captured.insertedValues).toHaveLength(1);
    expect(mock.captured.touchedIds).not.toContain(501);
    expect(result.preview[0]).toMatchObject({ outcome: "appended", previousValue: "75" });
  });

  test("首次导入会写 benchmark_source_meta，source 带 text: 前缀", async () => {
    const { mock, importExternalBenchmarkRows } = await setup();

    await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });

    expect(mock.captured.sourceMetaRows).toHaveLength(1);
    expect(mock.captured.sourceMetaRows[0]).toMatchObject({
      source: "text:Artificial Analysis",
      benchmarkType: "Knowledge"
    });
  });

  test("新建的 benchmark 会被记进 createdBenchmarks，复用已有的则不记", async () => {
    const { importExternalBenchmarkRows: importFresh } = await setup();
    const created = await importFresh([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });
    expect(created.createdBenchmarks).toContain("MMLU-Pro");

    const { importExternalBenchmarkRows: importReused } = await setup({
      existingBenchmark: makeBenchmarkRow()
    });
    const result = await importReused([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis"
    });
    expect(result.createdBenchmarks).toEqual([]);
  });

  test("dryRun 返回统计且不把哨兵异常抛给调用方", async () => {
    const { importExternalBenchmarkRows } = await setup();

    const result = await importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "79.1" }], {
      source: "Artificial Analysis",
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.preview).toHaveLength(1);
  });

  test("同一批里落到同一槽位的第二行会跟第一行比，而不是跟库里的旧值比", async () => {
    const { mock, importExternalBenchmarkRows } = await setup({
      existingBenchmark: makeBenchmarkRow()
    });

    const result = await importExternalBenchmarkRows(
      [
        { ...BASE_ROW, rawValue: "79.1" },
        { ...BASE_ROW, rawValue: "79.1" }
      ],
      { source: "Artificial Analysis" }
    );

    expect(result.inserted).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(mock.captured.insertedValues).toHaveLength(1);
  });

  test("空值行被跳过而不是写入", async () => {
    const { mock, importExternalBenchmarkRows } = await setup();

    const result = await importExternalBenchmarkRows(
      [
        { ...BASE_ROW, rawValue: "" },
        { ...BASE_ROW, rawValue: "-" }
      ],
      { source: "Artificial Analysis" }
    );

    expect(result.skipped).toBe(2);
    expect(mock.captured.insertedValues).toHaveLength(0);
    expect(result.preview.every((row) => row.outcome === "skipped")).toBe(true);
  });

  test("缺少 source 时直接报错", async () => {
    const { importExternalBenchmarkRows } = await setup();

    await expect(
      importExternalBenchmarkRows([{ ...BASE_ROW, rawValue: "1" }], { source: "   " })
    ).rejects.toThrow("必须指定 source");
  });
});
