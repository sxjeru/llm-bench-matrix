import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { benchmarkValues, benchmarks, models, providers, settings } from "@/lib/db/schema";

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type DashboardRow = {
  id: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  modalities: string[];
  benchTime: string;
  valueRaw: string;
  valueNum: number | null;
  valueNum2: number | null;
  valueNote: string | null;
  source: string | null;
};

export async function getDashboardRows(limit = 300): Promise<DashboardRow[]> {
  const rows = await db
    .select({
      id: benchmarkValues.id,
      providerName: providers.name,
      modelName: models.modelName,
      benchmarkName: benchmarks.benchmarkName,
      benchmarkType: benchmarks.benchmarkType,
      modalities: benchmarks.modalities,
      benchTime: benchmarkValues.benchTime,
      valueRaw: benchmarkValues.valueRaw,
      valueNum: benchmarkValues.valueNum,
      valueNum2: benchmarkValues.valueNum2,
      valueNote: benchmarkValues.valueNote,
      source: benchmarkValues.source
    })
    .from(benchmarkValues)
    .innerJoin(models, eq(benchmarkValues.modelId, models.id))
    .innerJoin(providers, eq(models.providerId, providers.id))
    .innerJoin(benchmarks, eq(benchmarkValues.benchmarkId, benchmarks.id))
    .where(and(isNull(models.mergedIntoModelId), isNull(benchmarks.mergedIntoBenchmarkId)))
    .orderBy(desc(benchmarkValues.benchTime), desc(benchmarkValues.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    providerName: row.providerName,
    modelName: row.modelName,
    benchmarkName: row.benchmarkName,
    benchmarkType: row.benchmarkType,
    modalities: row.modalities ?? [],
    benchTime: row.benchTime.toISOString(),
    valueRaw: row.valueRaw,
    valueNum: toNullableNumber(row.valueNum),
    valueNum2: toNullableNumber(row.valueNum2),
    valueNote: row.valueNote,
    source: row.source
  }));
}

export async function getActiveEntities() {
  const [providerRows, modelRows, benchmarkRows] = await Promise.all([
    db.select().from(providers).orderBy(providers.name),
    db
      .select()
      .from(models)
      .where(isNull(models.mergedIntoModelId))
      .orderBy(models.modelName),
    db
      .select()
      .from(benchmarks)
      .where(isNull(benchmarks.mergedIntoBenchmarkId))
      .orderBy(benchmarks.benchmarkName)
  ]);

  return {
    providers: providerRows,
    models: modelRows,
    benchmarks: benchmarkRows
  };
}

export async function getSettings() {
  const rows = await db.select().from(settings);

  return rows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.key] = row.valueJson;
    return acc;
  }, {});
}

export type MergedEntityRecord = {
  entityType: "model" | "benchmark";
  sourceId: number;
  sourceName: string;
  targetId: number;
  targetName: string;
};

export async function getMergedEntityRecords(): Promise<MergedEntityRecord[]> {
  const [allModels, allBenchmarks, mergedModels, mergedBenchmarks] = await Promise.all([
    db.select({ id: models.id, modelName: models.modelName }).from(models),
    db
      .select({ id: benchmarks.id, benchmarkName: benchmarks.benchmarkName, benchmarkType: benchmarks.benchmarkType })
      .from(benchmarks),
    db
      .select({ sourceId: models.id, sourceName: models.modelName, targetId: models.mergedIntoModelId })
      .from(models)
      .where(isNotNull(models.mergedIntoModelId)),
    db
      .select({ sourceId: benchmarks.id, sourceName: benchmarks.benchmarkName, targetId: benchmarks.mergedIntoBenchmarkId })
      .from(benchmarks)
      .where(isNotNull(benchmarks.mergedIntoBenchmarkId))
  ]);

  const modelNameById = new Map(allModels.map((item) => [item.id, item.modelName]));
  const benchmarkNameById = new Map(
    allBenchmarks.map((item) => [item.id, `${item.benchmarkName} (${item.benchmarkType})`])
  );

  const modelRecords: MergedEntityRecord[] = mergedModels
    .filter((item) => item.targetId !== null)
    .map((item) => ({
      entityType: "model",
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      targetId: item.targetId as number,
      targetName: modelNameById.get(item.targetId as number) ?? `#${item.targetId}`
    }));

  const benchmarkRecords: MergedEntityRecord[] = mergedBenchmarks
    .filter((item) => item.targetId !== null)
    .map((item) => ({
      entityType: "benchmark",
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      targetId: item.targetId as number,
      targetName: benchmarkNameById.get(item.targetId as number) ?? `#${item.targetId}`
    }));

  return [...modelRecords, ...benchmarkRecords].sort((a, b) => {
    const typeCompare = a.entityType.localeCompare(b.entityType);
    if (typeCompare !== 0) return typeCompare;
    return a.sourceName.localeCompare(b.sourceName, "zh-Hans-CN");
  });
}

export async function saveSetting(input: {
  key: string;
  valueJson: unknown;
  updatedBy?: string;
  note?: string;
}) {
  await db
    .insert(settings)
    .values({
      key: input.key,
      valueJson: input.valueJson,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
      note: input.note
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueJson: input.valueJson,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
        note: input.note
      }
    });
}
