import { beforeEach, describe, expect, test, vi } from "vitest";

vi.unmock("@/lib/cache-versions");
const state = vi.hoisted(() => ({
  busy: false,
  poolReads: 0,
  committed: false,
  rolledBack: false,
  rule: { lowercase: true, removeHyphen: false, removeSpace: true, removeDot: false } as Record<string, boolean> | null,
  failRule: false,
  inserted: [] as unknown[][]
}));

// Exercise Drizzle's real transaction and error wrapping, without a live server.
// A second pool checkout is rejected just as an exhausted single-connection pool would be.
vi.mock("@/lib/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { getTableColumns } = await import("drizzle-orm");
  const schema = await import("@/lib/db/schema");
  const values = (table: typeof schema.models | typeof schema.providers | typeof schema.benchmarks, row: Record<string, unknown>) =>
    Object.keys(getTableColumns(table)).map((key) => row[key] ?? null);

  class SingleConnectionPool {
    async connect() {
      if (state.busy) throw new Error("timeout exceeded when trying to connect");
      state.busy = true;
      return {
        query: async (query: string | { text: string }, params: unknown[] = []) => {
          const sql = typeof query === "string" ? query : query.text;
          if (sql === "commit") state.committed = true;
          if (sql === "rollback") state.rolledBack = true;
          if (sql.includes('from "settings"')) {
            if (state.failRule) throw new Error("timeout exceeded when trying to connect");
            return { rows: state.rule ? [[state.rule]] : [] };
          }
          if (sql.includes('from "providers"')) return { rows: [values(schema.providers, {
            id: 1, name: "Provider", slug: "provider", config: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01"
          })] };
          if (sql.startsWith('insert into "models"')) {
            state.inserted.push(params);
            return { rows: [values(schema.models, {
              id: 2, providerId: 1, modelName: "Model-A",
              canonicalKey: params.find((value) => value === "model-a" || value === "modela"),
              paramsIsEstimated: false, createdAt: "2026-01-01"
            })] };
          }
          if (sql.startsWith('insert into "benchmarks"')) {
            state.inserted.push(params);
            return { rows: [values(schema.benchmarks, {
              id: 3, benchmarkName: "Bench-A", benchmarkType: "General", unit: "score", higherIsBetter: true,
              modalities: [], canonicalKey: params.find((value) => typeof value === "string" && value.includes(":")),
              createdAt: "2026-01-01"
            })] };
          }
          return { rows: [] };
        },
        release: () => { state.busy = false; }
      };
    }
    async query(query: string | { text: string }, params: unknown[]) {
      state.poolReads++;
      const connection = await this.connect();
      try { return await connection.query(query, params); } finally { connection.release(); }
    }
  }
  return { db: drizzle(new SingleConnectionPool() as never, { schema }) };
});

import { ensureBenchmark, ensureModelByProviderId } from "@/lib/admin-service";

beforeEach(() => {
  state.busy = false; state.poolReads = 0; state.committed = false; state.rolledBack = false;
  state.rule = { lowercase: true, removeHyphen: false, removeSpace: true, removeDot: false };
  state.failRule = false; state.inserted = [];
});

describe("transaction rule reads use the pinned connection", () => {
  test("model creation respects a nondefault rule using a single connection", async () => {
    const model = await ensureModelByProviderId({ providerId: 1, modelName: "Model-A" });
    expect(model.canonicalKey).toBe("model-a");
    expect(state.inserted[0]).toContain("model-a");
    expect(state.poolReads).toBe(0);
    expect(state.committed).toBe(true);
  });
  test("benchmark creation reads the configured rule on its transaction", async () => {
    const benchmark = await ensureBenchmark({ benchmarkName: "Bench-A", benchmarkType: "General" });
    expect(benchmark.canonicalKey).toBe("bench-a:general");
    expect(state.poolReads).toBe(0);
    expect(state.committed).toBe(true);
  });
  test("a missing setting still uses defaults", async () => {
    state.rule = null;
    const model = await ensureModelByProviderId({ providerId: 1, modelName: "Model-A" });
    expect(model.canonicalKey).toBe("modela");
    expect(state.committed).toBe(true);
  });
  test("a wrapped database failure aborts without inserting under a default rule", async () => {
    state.failRule = true;
    await expect(ensureModelByProviderId({ providerId: 1, modelName: "Model-A" }))
      .rejects.toThrow('Failed query: select "value_json"');
    expect(state.inserted).toHaveLength(0);
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(state.poolReads).toBe(0);
  });
});
