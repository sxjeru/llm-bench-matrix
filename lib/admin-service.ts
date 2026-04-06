import { parse } from "csv-parse/sync";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  buildBenchmarkCanonicalKey,
  buildModelCanonicalKey,
  normalizeModelDedupeRule,
  toProviderSlug
} from "@/lib/db/normalize";
import { parseBenchmarkValue, type ParsedBenchmarkValue } from "@/lib/db/parse-value";
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

type DbExecutor = any;

const EMPTY_VALUE_MARKERS = new Set(["", "-", "--", "—", "na", "n/a", "null", "none"]);
const LOWER_IS_BETTER_BENCHMARK_RULES = [/fleurs/i, /omnidocbench\s*1\.5/i];
const OMNIDOCBENCH_15_MATCHER = /omnidocbench\s*1\.5/i;

function isLowerBetterBenchmark(benchmarkName: string): boolean {
  return LOWER_IS_BETTER_BENCHMARK_RULES.some((rule) => rule.test(benchmarkName));
}

function normalizeStoredBenchmarkValue(benchmarkName: string, parsed: ParsedBenchmarkValue): ParsedBenchmarkValue {
  if (!OMNIDOCBENCH_15_MATCHER.test(benchmarkName)) {
    return parsed;
  }

  const toNormalized = (value: number | null) => {
    if (value === null || value <= 1) return value;
    return Number(((100 - value) / 100).toFixed(6));
  };

  const normalizedNum = toNormalized(parsed.valueNum);
  const normalizedNum2 = toNormalized(parsed.valueNum2);

  if (normalizedNum === parsed.valueNum && normalizedNum2 === parsed.valueNum2) {
    return parsed;
  }

  const normalizedNote = parsed.valueNote
    ? `${parsed.valueNote}; normalized-omnidocbench-1.5`
    : "normalized-omnidocbench-1.5";

  return {
    valueRaw: parsed.valueRaw,
    valueNum: normalizedNum,
    valueNum2: normalizedNum2,
    valueNote: normalizedNote
  };
}

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

function isMatrixTypeMarker(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;

  // 常见“分组标题行”特征：短文本、无数值特征、通常独立一行
  if (/[\d%/()]/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return true;
  return words.length <= 3 && trimmed.length <= 28;
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

export async function rebuildModelCanonicalKeysByRule(rawRule: unknown) {
  const dedupeRule = normalizeModelDedupeRule(rawRule);
  const allModels = await db
    .select({
      id: models.id,
      modelName: models.modelName,
      mergedIntoModelId: models.mergedIntoModelId
    })
    .from(models)
    .orderBy(models.id);

  const groupMap = new Map<string, Array<{ id: number; modelName: string; mergedIntoModelId: number | null }>>();

  allModels.forEach((model) => {
    const canonicalKey = buildModelCanonicalKey(model.modelName, dedupeRule);
    if (!groupMap.has(canonicalKey)) {
      groupMap.set(canonicalKey, []);
    }
    groupMap.get(canonicalKey)?.push(model);
  });

  const tempSuffix = Date.now();
  let mergedCount = 0;

  await db.transaction(async (tx: any) => {
    for (const model of allModels) {
      await tx
        .update(models)
        .set({ canonicalKey: `tmp-model-${model.id}-${tempSuffix}` })
        .where(eq(models.id, model.id));
    }

    for (const [canonicalKey, groupedModels] of groupMap.entries()) {
      const keeper = groupedModels.find((item) => item.mergedIntoModelId === null) ?? groupedModels[0];
      if (!keeper) continue;

      await tx
        .update(models)
        .set({ canonicalKey, mergedIntoModelId: null })
        .where(eq(models.id, keeper.id));

      for (const duplicate of groupedModels) {
        if (duplicate.id === keeper.id) continue;

        await tx
          .update(benchmarkValues)
          .set({ modelId: keeper.id })
          .where(eq(benchmarkValues.modelId, duplicate.id));

        await tx
          .update(models)
          .set({ mergedIntoModelId: keeper.id })
          .where(eq(models.mergedIntoModelId, duplicate.id));

        await tx
          .update(models)
          .set({
            canonicalKey: `${canonicalKey}#merged-${duplicate.id}`,
            mergedIntoModelId: keeper.id
          })
          .where(eq(models.id, duplicate.id));

        mergedCount += 1;
      }
    }
  });

  return {
    ok: true,
    totalModels: allModels.length,
    canonicalGroups: groupMap.size,
    mergedCount
  };
}

export async function ensureProvider(name: string, options?: { db?: DbExecutor }) {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("provider name is required");
  }

  const executor = options?.db ?? db;

  const slug = toProviderSlug(cleanName);

  const providerResult = await executor
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
}, options?: { dedupeRule?: ReturnType<typeof normalizeModelDedupeRule>; db?: DbExecutor }) {
  const cleanName = input.modelName.trim();
  if (!cleanName) {
    throw new Error("modelName is required");
  }

  const executor = options?.db ?? db;

  const [provider] = await executor.select().from(providers).where(eq(providers.id, input.providerId)).limit(1);

  if (!provider) {
    throw new Error(`provider not found: ${input.providerId}`);
  }

  const rule = options?.dedupeRule ?? await getModelDedupeRule();
  const canonicalKey = buildModelCanonicalKey(cleanName, rule);
  const [existing] = await executor.select().from(models).where(eq(models.canonicalKey, canonicalKey)).limit(1);

  if (existing) {
    return existing;
  }

  const createdResult = await executor
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

export async function ensureBenchmark(input: EnsureBenchmarkInput, options?: { db?: DbExecutor }) {
  const cleanName = input.benchmarkName.trim();
  const cleanType = input.benchmarkType.trim() || "general";

  if (!cleanName) {
    throw new Error("benchmarkName is required");
  }

  const canonicalKey = buildBenchmarkCanonicalKey(cleanName, cleanType);
  const modalities = normalizeModalities(input.modalities);
  const higherIsBetter = isLowerBetterBenchmark(cleanName) ? false : (input.higherIsBetter ?? true);
  const executor = options?.db ?? db;

  const [existing] = await executor.select().from(benchmarks).where(eq(benchmarks.canonicalKey, canonicalKey)).limit(1);

  if (existing) {
    if (isLowerBetterBenchmark(cleanName) && existing.higherIsBetter) {
      const updatedResult = await executor
        .update(benchmarks)
        .set({ higherIsBetter: false })
        .where(eq(benchmarks.id, existing.id))
        .returning();
      const updated = firstResultRow<typeof benchmarks.$inferSelect>(updatedResult);
      return updated ?? { ...existing, higherIsBetter: false };
    }

    return existing;
  }

  const createdResult = await executor
    .insert(benchmarks)
    .values({
      benchmarkName: cleanName,
      benchmarkType: cleanType,
      unit: input.unit?.trim() || "score",
      higherIsBetter,
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
  benchmarkName?: string | null;
}) {
  let benchmarkName = input.benchmarkName?.trim();
  if (!benchmarkName) {
    const [benchmark] = await db
      .select({ benchmarkName: benchmarks.benchmarkName })
      .from(benchmarks)
      .where(eq(benchmarks.id, input.benchmarkId))
      .limit(1);
    benchmarkName = benchmark?.benchmarkName;
  }

  const parsed = benchmarkName
    ? normalizeStoredBenchmarkValue(benchmarkName, parseBenchmarkValue(input.valueRaw))
    : parseBenchmarkValue(input.valueRaw);

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
  const rows: NormalizedTextImportRow[] = records
    .filter((record) => record.valid)
    .map((record, index) => ({
      rowNumber: record.rowNumber ?? index + 1,
      providerName: inferProviderNameFromModel(record.modelName),
      modelName: record.modelName,
      benchmarkName: record.benchmarkName,
      benchmarkType: (record.category || "general").trim() || "general",
      valueRaw: record.rawValue,
      benchTime: options?.benchTime ?? new Date(),
      unit: "score",
      higherIsBetter: true,
      modalities: inferModalitiesFromCategory(record.category),
      source: options?.source ?? "xlsm-import",
      modelAlias: null,
      sourceModelId: null,
      sourceBenchmarkId: null
    }));

  const { inserted } = await importNormalizedRows(rows);

  return {
    total: records.length,
    inserted
  };
}

async function importNormalizedRows(rows: NormalizedTextImportRow[]) {
  if (rows.length === 0) {
    return { inserted: 0 };
  }

  const dedupeRule = await getModelDedupeRule();

  return db.transaction(async (tx: any) => {
    const providerCache = new Map<string, Awaited<ReturnType<typeof ensureProvider>>>();
    const modelCache = new Map<string, Awaited<ReturnType<typeof ensureModelByProviderId>>>();
    const benchmarkCache = new Map<string, Awaited<ReturnType<typeof ensureBenchmark>>>();
    const valueRows: Array<typeof benchmarkValues.$inferInsert> = [];

    for (const row of rows) {
      try {
        const providerName = row.providerName.trim() || "Unknown";
        const providerKey = toProviderSlug(providerName);
        let provider = providerCache.get(providerKey);
        if (!provider) {
          provider = await ensureProvider(providerName, { db: tx });
          providerCache.set(providerKey, provider);
        }

        const modelCanonicalKey = buildModelCanonicalKey(row.modelName, dedupeRule);
        let model = modelCache.get(modelCanonicalKey);
        if (!model) {
          model = await ensureModelByProviderId(
            {
              providerId: provider.id,
              modelName: row.modelName,
              modelAlias: row.modelAlias,
              sourceModelId: row.sourceModelId
            },
            { dedupeRule, db: tx }
          );
          modelCache.set(modelCanonicalKey, model);
        }

        const benchmarkType = row.benchmarkType.trim() || "general";
        const benchmarkCanonicalKey = buildBenchmarkCanonicalKey(row.benchmarkName, benchmarkType);
        let benchmark = benchmarkCache.get(benchmarkCanonicalKey);
        if (!benchmark) {
          benchmark = await ensureBenchmark(
            {
              benchmarkName: row.benchmarkName,
              benchmarkType,
              unit: row.unit,
              higherIsBetter: row.higherIsBetter,
              modalities: row.modalities,
              sourceBenchmarkId: row.sourceBenchmarkId
            },
            { db: tx }
          );
          benchmarkCache.set(benchmarkCanonicalKey, benchmark);
        }

        const parsedValue = parseBenchmarkValue(row.valueRaw);
        const normalizedValue = normalizeStoredBenchmarkValue(benchmark.benchmarkName, parsedValue);
        valueRows.push({
          modelId: model.id,
          benchmarkId: benchmark.id,
          benchTime: row.benchTime,
          valueRaw: normalizedValue.valueRaw,
          valueNum: normalizedValue.valueNum !== null ? String(normalizedValue.valueNum) : null,
          valueNum2: normalizedValue.valueNum2 !== null ? String(normalizedValue.valueNum2) : null,
          valueNote: normalizedValue.valueNote,
          source: row.source ?? null
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown import error";
        throw new Error(
          `导入失败：row=${row.rowNumber}，model=${row.modelName}，benchmark=${row.benchmarkName}，raw=${row.valueRaw}，原因=${message}`
        );
      }
    }

    const batchSize = 500;
    for (let index = 0; index < valueRows.length; index += batchSize) {
      const chunk = valueRows.slice(index, index + batchSize);
      if (chunk.length === 0) continue;
      await tx.insert(benchmarkValues).values(chunk);
    }

    return { inserted: valueRows.length };
  });
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
    const modalitiesInput = (row.modalities || "").trim();
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
      modalities: modalitiesInput
        ? modalitiesInput.split(",").map((item) => item.trim()).filter(Boolean)
        : inferModalitiesFromCategory(benchmarkType),
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

function inferTypeFromPreambleLine(line: string): string | null {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("vision")) return "Vision";
  if (normalized.includes("audio")) return "Audio";
  if (normalized.includes("video")) return "Video";
  if (normalized.includes("multimodal") || normalized.includes("multi")) return "Multimodal";
  return null;
}

function looksLikeModelHeaderRow(cells: string[]): boolean {
  const nonEmpty = cells.map((cell) => cell.trim()).filter(Boolean);
  if (nonEmpty.length < 2) return false;

  const numericLikeCount = nonEmpty.filter((cell) => {
    const normalized = normalizeImportedValueRaw(cell);
    if (!/\d/.test(normalized)) return false;
    const parsed = parseBenchmarkValue(normalized);
    return parsed.valueNum !== null || parsed.valueNum2 !== null;
  }).length;

  return numericLikeCount <= 1;
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

  let headerLineIndex = rawLines.findIndex((line) => looksLikeModelHeaderRow(splitTableLine(line)));
  if (headerLineIndex < 0) {
    headerLineIndex = 0;
  }

  let preambleTypeHint: string | null = null;
  for (let index = 0; index < headerLineIndex; index += 1) {
    const hint = inferTypeFromPreambleLine(rawLines[index]);
    if (hint) {
      preambleTypeHint = hint;
    }
  }

  const headerCells = splitTableLine(rawLines[headerLineIndex]);
  const firstHeaderCell = (headerCells[0] || "").trim();
  const startsWithBenchmarkLabel =
    !firstHeaderCell
    || /benchmark|type|category|指标|类别|分类/i.test(firstHeaderCell);

  const modelStartIndex = startsWithBenchmarkLabel ? 1 : 0;
  const modelNames = headerCells.slice(modelStartIndex).map((cell) => cell.trim()).filter(Boolean);

  if (modelNames.length === 0) {
    return {
      format: "matrix-table",
      rows: [],
      skipped: rawLines.length - 1
    };
  }

  const rows: NormalizedTextImportRow[] = [];
  let skipped = 0;
  let currentBenchmarkType = preambleTypeHint ?? "General";

  for (let lineIndex = headerLineIndex + 1; lineIndex < rawLines.length; lineIndex += 1) {
    const cells = splitTableLine(rawLines[lineIndex]);
    const benchmarkName = (cells[0] || "").trim();

    if (!benchmarkName) {
      skipped += 1;
      continue;
    }

    const allModelValuesEmpty = modelNames.every((_, modelIndex) =>
      isEmptyImportValue((cells[modelIndex + 1] || "").trim())
    );

    if (allModelValuesEmpty && isMatrixTypeMarker(benchmarkName)) {
      currentBenchmarkType = benchmarkName;
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
        benchmarkType: currentBenchmarkType,
        valueRaw: normalizeImportedValueRaw(rawInput),
        benchTime: new Date(),
        unit: "score",
        higherIsBetter: true,
        modalities: inferModalitiesFromCategory(currentBenchmarkType),
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
  const { inserted } = await importNormalizedRows(parsed.rows);

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
