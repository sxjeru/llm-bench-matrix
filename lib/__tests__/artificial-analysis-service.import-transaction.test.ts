import { beforeEach, describe, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  committed: false,
  historyChanged: true,
  publicChanged: true,
  rows: [] as Array<Record<string, unknown>>,
  tx: {} as Record<string, unknown>,
  failSave: false
}));
vi.mock("@/lib/db/client", () => ({ db: {
  transaction: vi.fn(async (write) => {
    const result = await write(state.tx); state.committed = true; return result;
  })
} }));
vi.mock("@/lib/db/queries", () => ({
  getSettings: vi.fn(async () => ({ "external_import:artificial-analysis": { selectedMetrics: ["evaluations.test"] } })),
  saveSetting: vi.fn(async () => { if (state.failSave) throw new Error("save failed"); })
}));
vi.mock("@/lib/admin-service", () => ({
  ensureProvider: vi.fn(async () => ({ id: 1 })),
  ensureModelByProviderId: vi.fn(async () => {
    state.rows.push({ id: 2, modelName: "New", providerName: "Provider", providerSlug: "provider", providerConfig: {} });
    return { id: 2 };
  }),
  importExternalBenchmarkRows: vi.fn(async (_rows, options) => {
    if (state.publicChanged) options.onChanged(["dashboard", "admin_entities"]);
    return { publicChanged: state.publicChanged, benchTime: "2026-11-20T00:00:00.000Z", inserted: 1, preview: [] };
  }),
  resolveMergedModelTargets: vi.fn(() => new Map())
}));
vi.mock("@/lib/external-providers/artificial-analysis", async (original) => {
  const actual = await original<typeof import("@/lib/external-providers/artificial-analysis")>();
  return { ...actual,
    hasArtificialAnalysisApiKey: vi.fn(() => true),
    getArtificialAnalysisSnapshot: vi.fn(async () => ({
      models: [{ id: "upstream", name: "New", creatorName: "Provider", slug: "new", metrics: {} }],
      catalog: [], intelligenceIndexVersion: 6, fetchedAt: "now", freePageCount: 1
    })),
    resolveModelMatches: vi.fn((rows) => ({ matches: rows.map((row: { id: number }) => ({ modelId: row.id, externalModelId: "upstream", matchStatus: "matched" })), conflicts: [] })),
    buildImportRows: vi.fn(() => []),
    mergeIntelligenceIndexVersionHistory: vi.fn(() => ({ changed: state.historyChanged, history: [{ version: 6, effectiveFrom: "2026-11-20T00:00:00.000Z" }] }))
  };
});
import { runArtificialAnalysisImport } from "@/lib/external-providers/artificial-analysis-service";
import { bumpCacheVersions } from "@/lib/cache-versions";
import { saveSetting } from "@/lib/db/queries";
import { ensureModelByProviderId, importExternalBenchmarkRows } from "@/lib/admin-service";
import { getArtificialAnalysisSnapshot } from "@/lib/external-providers/artificial-analysis";
import { db } from "@/lib/db/client";

beforeEach(async () => {
  vi.clearAllMocks(); state.committed = false; state.historyChanged = true; state.publicChanged = true; state.failSave = false;
  state.rows = [{ id: 1, modelName: "Old", providerName: "Provider", providerSlug: "provider", providerConfig: {} }];
  const { models, externalModelMappings } = await import("@/lib/db/schema");
  state.tx = {
    select: () => ({ from: (table: unknown) => {
      const rows = table === models ? state.rows : table === externalModelMappings ? [] : [];
      const where = Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows });
      const query = { where: () => where, orderBy: async () => rows, innerJoin: () => query };
      return query;
    } }),
    insert: vi.fn(() => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }))
  };
});

describe("Artificial Analysis import transaction", () => {
  test("created entities, records, and version history publish once on the same transaction", async () => {
    const result = await runArtificialAnalysisImport({ createExternalModelIds: ["upstream"] });
    expect(result.createdModels).toEqual(["New"]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(getArtificialAnalysisSnapshot).toHaveBeenCalledTimes(1);
    expect(ensureModelByProviderId).toHaveBeenCalledWith(expect.anything(), { db: state.tx });
    expect(importExternalBenchmarkRows).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executor: state.tx, dryRun: false }));
    expect(saveSetting).toHaveBeenCalledWith(expect.anything(), state.tx);
    expect(bumpCacheVersions).toHaveBeenCalledTimes(1);
    expect(bumpCacheVersions).toHaveBeenCalledWith(["dashboard", "admin_entities", "pricing", "settings"], state.tx);
    expect(state.committed).toBe(true);
  });
  test("config failure aborts the whole import without publishing versions", async () => {
    state.failSave = true;
    await expect(runArtificialAnalysisImport({ createExternalModelIds: ["upstream"] })).rejects.toThrow("save failed");
    expect(state.committed).toBe(false); expect(bumpCacheVersions).not.toHaveBeenCalled();
  });
  test("preview rolls back and never publishes or creates entities", async () => {
    const result = await runArtificialAnalysisImport({ dryRun: true, createExternalModelIds: ["upstream"] });
    expect(result.dryRun).toBe(true); expect(state.committed).toBe(false);
    expect(ensureModelByProviderId).not.toHaveBeenCalled(); expect(saveSetting).not.toHaveBeenCalled();
    expect(bumpCacheVersions).not.toHaveBeenCalled();
  });
  test("unchanged import and history do not bump unrelated domains", async () => {
    state.publicChanged = false; state.historyChanged = false;
    await runArtificialAnalysisImport({});
    expect(bumpCacheVersions).not.toHaveBeenCalled();
  });
});
