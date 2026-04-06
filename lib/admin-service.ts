import { parse } from "csv-parse/sync";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

type NormalizedTextImportRow = {
  rowNumber: number;
  providerName: string;
  modelName: string;
  benchmarkName: string;
  benchmarkType: string;
  valueRaw: string;
  benchTime: Date;
  unit: string;
  higherIsBetter: boolean;
  modalities: string[];
  source: string | null;
  modelAlias?: string | null;
  sourceModelId?: string | null;
  sourceBenchmarkId?: string | null;
};

const EMPTY_VALUE_MARKERS = new Set(["", "-", "--", "—", "na", "n/a", "null", "none"]);

function normalizeImportedValueRaw(rawInput: string): string {
  return rawInput.replace(/[％%]/g, "").trim();
}

function isEmptyImportValue(rawInput: string | undefined): boolean {
  if (!rawInput) return true;
  const normalized = normalizeImportedValueRaw(rawInput).toLowerCase();
  return EMPTY_VALUE_MARKERS.has(normalized);
}

function splitTableLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((item) => item.trim());
  }

  return line
    .trim()
    .split(/\s{2,}/)
    .map((item) => item.trim());
}

function looksLikeStructuredCsv(firstLine: string): boolean {
  if (!firstLine.includes(",")) return false;

  const lowered = firstLine.toLowerCase();
  return ["provider", "model", "benchmark", "value", "bench_time", "source"].some((token) =>
    lowered.includes(token)
  );
}

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

function normalizeTextImportSource(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("text:")) {
    const plain = trimmed.slice(5).trim();
    return plain ? `text:${plain}` : "text:";
  }

  return `text:${trimmed}`;
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

export async function updateMergedEntityRecord(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
  targetId: number;
}) {
  if (input.sourceId === input.targetId) {
    throw new Error("sourceId and targetId cannot be the same");
  }

  if (input.entityType === "model") {
    await db
      .update(models)
      .set({ mergedIntoModelId: input.targetId })
      .where(eq(models.id, input.sourceId));
    return { ok: true };
  }

  await db
    .update(benchmarks)
    .set({ mergedIntoBenchmarkId: input.targetId })
    .where(eq(benchmarks.id, input.sourceId));

  return { ok: true };
}

export async function deleteMergedEntityRecord(input: {
  entityType: "model" | "benchmark";
  sourceId: number;
}) {
  if (input.entityType === "model") {
    await db
      .update(models)
      .set({ mergedIntoModelId: null })
      .where(eq(models.id, input.sourceId));
    return { ok: true };
  }

  await db
    .update(benchmarks)
    .set({ mergedIntoBenchmarkId: null })
    .where(eq(benchmarks.id, input.sourceId));

  return { ok: true };
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

function parseStructuredCsvRows(inputText: string, defaultSource: string | null): {
  format: "structured-csv";
  rows: NormalizedTextImportRow[];
  skipped: number;
} {
  const parsedRows = parse(inputText, {
    columns: true,
    skipEmptyLines: true,
    trim: true
  }) as Record<string, string>[];

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;

  parsedRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const modelName = (row.model || row.model_name || "").trim();
    const benchmarkName = (row.benchmark || row.benchmark_name || "").trim();
    const valueRawInput = row.value_raw || row.value || "";

    if (!modelName || !benchmarkName || isEmptyImportValue(valueRawInput)) {
      skipped += 1;
      return;
    }

    const valueRaw = normalizeImportedValueRaw(valueRawInput);
    const providerName = (row.provider || row.provider_name || "").trim() || inferProviderNameFromModel(modelName);
    const benchmarkType = (row.benchmark_type || row.type || "general").trim() || "general";
    const benchTimeRaw = row.bench_time || row.time || row.date || new Date().toISOString();
    const benchTime = new Date(benchTimeRaw);

    if (Number.isNaN(benchTime.getTime())) {
      skipped += 1;
      return;
    }

    rows.push({
      rowNumber,
      providerName,
      modelName,
      benchmarkName,
      benchmarkType,
      valueRaw,
      benchTime,
      unit: (row.unit || "score").trim() || "score",
      higherIsBetter: parseBoolean(row.higher_is_better, true),
      modalities: (row.modalities || "Text").split(",").map((item) => item.trim()).filter(Boolean),
      source: normalizeTextImportSource(toNullableText(row.source)) ?? defaultSource,
      modelAlias: toNullableText(row.model_alias),
      sourceModelId: toNullableText(row.source_model_id),
      sourceBenchmarkId: toNullableText(row.source_benchmark_id)
    });
  });

  return {
    format: "structured-csv",
    rows,
    skipped
  };
}

function parseMatrixTextRows(inputText: string, defaultSource: string | null): {
  format: "matrix-table";
  rows: NormalizedTextImportRow[];
  skipped: number;
} {
  const rawLines = inputText
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      format: "matrix-table",
      rows: [],
      skipped: 0
    };
  }

  const headerCells = splitTableLine(rawLines[0]);
  const modelNames = headerCells.slice(1).map((cell) => cell.trim()).filter(Boolean);

  if (modelNames.length === 0) {
    return {
      format: "matrix-table",
      rows: [],
      skipped: rawLines.length - 1
    };
  }

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;

  for (let lineIndex = 1; lineIndex < rawLines.length; lineIndex += 1) {
    const cells = splitTableLine(rawLines[lineIndex]);
    const benchmarkName = (cells[0] || "").trim();

    if (!benchmarkName) {
      skipped += 1;
      continue;
    }

    for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex += 1) {
      const modelName = modelNames[modelIndex];
      const rawInput = (cells[modelIndex + 1] || "").trim();

      if (!modelName || isEmptyImportValue(rawInput)) {
        continue;
      }

      rows.push({
        rowNumber: lineIndex + 1,
        providerName: inferProviderNameFromModel(modelName),
        modelName,
        benchmarkName,
        benchmarkType: "general",
        valueRaw: normalizeImportedValueRaw(rawInput),
        benchTime: new Date(),
        unit: "score",
        higherIsBetter: true,
        modalities: ["Text"],
        source: defaultSource,
        modelAlias: null,
        sourceModelId: null,
        sourceBenchmarkId: null
      });
    }
  }

  return {
    format: "matrix-table",
    rows,
    skipped
  };
}

function parseBenchmarkTextRows(inputText: string, sourceInput?: string | null) {
  const defaultSource = normalizeTextImportSource(sourceInput);
  const firstLine = inputText
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim() || "";

  if (looksLikeStructuredCsv(firstLine)) {
    return parseStructuredCsvRows(inputText, defaultSource);
  }

  return parseMatrixTextRows(inputText, defaultSource);
}

export async function previewBenchmarkTextImport(inputText: string, sourceInput?: string | null) {
  const parsed = parseBenchmarkTextRows(inputText, sourceInput);

  const previewRows = parsed.rows.map((row) => {
    const parsedValue = parseBenchmarkValue(row.valueRaw);

    return {
      rowNumber: row.rowNumber,
      providerName: row.providerName,
      modelName: row.modelName,
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      rawValue: parsedValue.valueRaw,
      valueNum: parsedValue.valueNum,
      valueNum2: parsedValue.valueNum2,
      valueNote: parsedValue.valueNote,
      source: row.source,
      valid: parsedValue.valueRaw.length > 0
    };
  });

  return {
    format: parsed.format,
    total: parsed.rows.length,
    skipped: parsed.skipped,
    previewRows
  };
}

export async function importBenchmarkCsv(inputText: string, sourceInput?: string | null) {
  const parsed = parseBenchmarkTextRows(inputText, sourceInput);
  let inserted = 0;

  for (const row of parsed.rows) {
    const provider = await ensureProvider(row.providerName);
    const model = await ensureModelByProviderId({
      providerId: provider.id,
      modelName: row.modelName,
      modelAlias: row.modelAlias,
      sourceModelId: row.sourceModelId
    });

    const benchmark = await ensureBenchmark({
      benchmarkName: row.benchmarkName,
      benchmarkType: row.benchmarkType,
      unit: row.unit,
      higherIsBetter: row.higherIsBetter,
      modalities: row.modalities,
      sourceBenchmarkId: row.sourceBenchmarkId
    });

    await createBenchmarkValue({
      modelId: model.id,
      benchmarkId: benchmark.id,
      benchTime: row.benchTime,
      valueRaw: row.valueRaw,
      source: row.source
    });

    inserted += 1;
  }

  return {
    format: parsed.format,
    total: parsed.rows.length,
    skipped: parsed.skipped,
    inserted
  };
}

export async function deleteModelAndAllValues(modelId: number) {
  const [existing] = await db
    .select({ id: models.id, modelName: models.modelName })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);

  if (!existing) {
    throw new Error(`model not found: ${modelId}`);
  }

  await db.transaction(async (tx: any) => {
    await tx
      .update(models)
      .set({ mergedIntoModelId: null })
      .where(eq(models.mergedIntoModelId, modelId));

    await tx.delete(models).where(eq(models.id, modelId));
  });

  return {
    ok: true,
    modelId: existing.id,
    modelName: existing.modelName
  };
}

export async function deleteBenchmarkValuesBySource(sourceInput: string) {
  const rawSource = sourceInput.trim();
  if (!rawSource) {
    throw new Error("source is required");
  }

  const normalizedSource = normalizeTextImportSource(rawSource);
  if (!normalizedSource) {
    throw new Error("source is required");
  }

  const unprefixed = normalizedSource.slice(5).trim();
  const candidates = new Set<string>([normalizedSource, rawSource]);
  if (unprefixed) {
    candidates.add(unprefixed);
  }

  const matchedSources = Array.from(candidates).filter(Boolean);
  const deletedRows = await db
    .delete(benchmarkValues)
    .where(inArray(benchmarkValues.source, matchedSources))
    .returning({ id: benchmarkValues.id });

  return {
    ok: true,
    source: rawSource,
    normalizedSource,
    matchedSources,
    deleted: deletedRows.length
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
