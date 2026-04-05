import { parse } from "csv-parse/sync";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  buildBenchmarkCanonicalKey,
  buildModelCanonicalKey,
  normalizeModelDedupeRule,
  toProviderSlug
} from "@/lib/db/normalize";
import { parseBenchmarkValue } from "@/lib/db/parse-value";
import type { ParsedImportRecord } from "@/lib/import/xlsm";
import { benchmarkValues, benchmarks, models, providers, settings } from "@/lib/db/schema";

type EnsureBenchmarkInput = {
  benchmarkName: string;
  benchmarkType: string;
  unit?: string;
  higherIsBetter?: boolean;
  modalities?: string[];
  sourceBenchmarkId?: string | null;
};

function normalizeModalities(modalities?: string[]): string[] {
  if (!modalities || modalities.length === 0) return ["Text"];

  const normalized = modalities
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item[0].toUpperCase() + item.slice(1).toLowerCase());

  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["Text"];
}

function parseBoolean(input: string | undefined, fallback = true): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();

  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function toNullableText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferProviderNameFromModel(modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) return "Unknown";

  const alphaPrefix = trimmed.match(/^[A-Za-z]+/);
  if (alphaPrefix?.[0]) {
    return alphaPrefix[0];
  }

  const tokenized = trimmed.split(/[\s\-_:]/).map((item) => item.trim()).filter(Boolean);
  if (tokenized.length > 0) {
    return tokenized[0];
  }

  return "Unknown";
}

function inferModalitiesFromCategory(category: string | null): string[] {
  if (!category) return ["Text"];
  const normalized = category.toLowerCase();

  if (normalized.includes("vision")) return ["Vision"];
  if (normalized.includes("audio")) return ["Audio"];
  if (normalized.includes("video")) return ["Video"];
  if (normalized.includes("multimodal") || normalized.includes("multi")) return ["Multimodal"];

  return ["Text"];
}

function firstResultRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) {
    return result[0] as T | undefined;
  }

  if (result && typeof result === "object" && "rows" in (result as Record<string, unknown>)) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
  }

  return undefined;
}

async function getModelDedupeRule() {
  const [setting] = await db
    .select({ valueJson: settings.valueJson })
    .from(settings)
    .where(eq(settings.key, "model_dedupe_rule"))
    .limit(1);

  return normalizeModelDedupeRule(setting?.valueJson);
}

export async function ensureProvider(name: string) {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("provider name is required");
  }

  const slug = toProviderSlug(cleanName);

  const providerResult = await db
    .insert(providers)
    .values({
      name: cleanName,
      slug
    })
    .onConflictDoUpdate({
      target: providers.slug,
      set: {
        name: cleanName
      }
    })
    .returning();

  const provider = firstResultRow<typeof providers.$inferSelect>(providerResult);
  if (!provider) {
    throw new Error("failed to upsert provider");
  }

  return provider;
}

export async function ensureModelByProviderId(input: {
  providerId: number;
  modelName: string;
  modelAlias?: string | null;
  sourceModelId?: string | null;
}) {
  const cleanName = input.modelName.trim();
  if (!cleanName) {
    throw new Error("modelName is required");
  }

  const [provider] = await db.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);

  if (!provider) {
    throw new Error(`provider not found: ${input.providerId}`);
  }

  const rule = await getModelDedupeRule();
  const canonicalKey = buildModelCanonicalKey(cleanName, rule);
  const [existing] = await db.select().from(models).where(eq(models.canonicalKey, canonicalKey)).limit(1);

  if (existing) {
    return existing;
  }

  const createdResult = await db
    .insert(models)
    .values({
      providerId: provider.id,
      modelName: cleanName,
      modelAlias: input.modelAlias ?? null,
      canonicalKey,
      sourceModelId: input.sourceModelId ?? null
    })
    .returning();

  const created = firstResultRow<typeof models.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create model");
  }

  return created;
}

export async function ensureBenchmark(input: EnsureBenchmarkInput) {
  const cleanName = input.benchmarkName.trim();
  const cleanType = input.benchmarkType.trim() || "general";

  if (!cleanName) {
    throw new Error("benchmarkName is required");
  }

  const canonicalKey = buildBenchmarkCanonicalKey(cleanName, cleanType);
  const modalities = normalizeModalities(input.modalities);

  const [existing] = await db.select().from(benchmarks).where(eq(benchmarks.canonicalKey, canonicalKey)).limit(1);

  if (existing) {
    return existing;
  }

  const createdResult = await db
    .insert(benchmarks)
    .values({
      benchmarkName: cleanName,
      benchmarkType: cleanType,
      unit: input.unit?.trim() || "score",
      higherIsBetter: input.higherIsBetter ?? true,
      modalities,
      canonicalKey,
      sourceBenchmarkId: input.sourceBenchmarkId ?? null
    })
    .returning();

  const created = firstResultRow<typeof benchmarks.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create benchmark");
  }

  return created;
}

export async function createBenchmarkValue(input: {
  modelId: number;
  benchmarkId: number;
  benchTime: Date;
  valueRaw: string;
  source?: string | null;
}) {
  const parsed = parseBenchmarkValue(input.valueRaw);

  const createdResult = await db
    .insert(benchmarkValues)
    .values({
      modelId: input.modelId,
      benchmarkId: input.benchmarkId,
      benchTime: input.benchTime,
      valueRaw: parsed.valueRaw,
      valueNum: parsed.valueNum !== null ? String(parsed.valueNum) : null,
      valueNum2: parsed.valueNum2 !== null ? String(parsed.valueNum2) : null,
      valueNote: parsed.valueNote,
      source: input.source ?? null
    })
    .returning();

  const created = firstResultRow<typeof benchmarkValues.$inferSelect>(createdResult);
  if (!created) {
    throw new Error("failed to create benchmark value");
  }

  return created;
}

export async function mergeEntity(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
}) {
  if (input.sourceId === input.targetId) {
    throw new Error("sourceId and targetId cannot be the same");
  }

  await db.transaction(async (tx: any) => {
    if (input.entityType === "model") {
      await tx
        .update(benchmarkValues)
        .set({ modelId: input.targetId })
        .where(eq(benchmarkValues.modelId, input.sourceId));

      await tx
        .update(models)
        .set({ mergedIntoModelId: input.targetId })
        .where(and(eq(models.id, input.sourceId), isNull(models.mergedIntoModelId)));

      return;
    }

    await tx
      .update(benchmarkValues)
      .set({ benchmarkId: input.targetId })
      .where(eq(benchmarkValues.benchmarkId, input.sourceId));

    await tx
      .update(benchmarks)
      .set({ mergedIntoBenchmarkId: input.targetId })
      .where(and(eq(benchmarks.id, input.sourceId), isNull(benchmarks.mergedIntoBenchmarkId)));
  });
}

export async function importParsedRecords(
  records: ParsedImportRecord[],
  options?: {
    benchTime?: Date;
    source?: string | null;
  }
) {
  let inserted = 0;

  for (const record of records) {
    if (!record.valid) continue;

    const providerName = inferProviderNameFromModel(record.modelName);
    const provider = await ensureProvider(providerName);

    const model = await ensureModelByProviderId({
      providerId: provider.id,
      modelName: record.modelName
    });

    const benchmarkType = (record.category || "general").trim() || "general";
    const benchmark = await ensureBenchmark({
      benchmarkName: record.benchmarkName,
      benchmarkType,
      unit: "score",
      higherIsBetter: true,
      modalities: inferModalitiesFromCategory(record.category)
    });

    await createBenchmarkValue({
      modelId: model.id,
      benchmarkId: benchmark.id,
      benchTime: options?.benchTime ?? new Date(),
      valueRaw: record.rawValue,
      source: options?.source ?? "xlsm-import"
    });

    inserted += 1;
  }

  return {
    total: records.length,
    inserted
  };
}

export async function importBenchmarkCsv(csvText: string) {
  const rows = parse(csvText, {
    columns: true,
    skipEmptyLines: true,
    trim: true
  }) as Record<string, string>[];

  let inserted = 0;

  for (const row of rows) {
    const providerName = row.provider || row.provider_name;
    const modelName = row.model || row.model_name;
    const benchmarkName = row.benchmark || row.benchmark_name;
    const benchmarkType = row.benchmark_type || row.type || "general";
    const valueRaw = row.value_raw || row.value;

    if (!providerName || !modelName || !benchmarkName || !valueRaw) {
      continue;
    }

    const provider = await ensureProvider(providerName);
    const model = await ensureModelByProviderId({
      providerId: provider.id,
      modelName,
      modelAlias: toNullableText(row.model_alias),
      sourceModelId: toNullableText(row.source_model_id)
    });

    const benchmark = await ensureBenchmark({
      benchmarkName,
      benchmarkType,
      unit: row.unit || "score",
      higherIsBetter: parseBoolean(row.higher_is_better, true),
      modalities: (row.modalities || "Text").split(","),
      sourceBenchmarkId: toNullableText(row.source_benchmark_id)
    });

    const benchTimeRaw = row.bench_time || row.time || row.date || new Date().toISOString();
    const benchTime = new Date(benchTimeRaw);

    if (Number.isNaN(benchTime.getTime())) {
      continue;
    }

    await createBenchmarkValue({
      modelId: model.id,
      benchmarkId: benchmark.id,
      benchTime,
      valueRaw,
      source: toNullableText(row.source)
    });

    inserted += 1;
  }

  return {
    total: rows.length,
    inserted
  };
}

export async function clearNonSettingsData() {
  await db.transaction(async (tx: any) => {
    await tx.delete(benchmarkValues);
    await tx.delete(models);
    await tx.delete(benchmarks);
    await tx.delete(providers);
  });

  return {
    ok: true
  };
}
