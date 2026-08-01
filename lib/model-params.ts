import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { models, providers } from "@/lib/db/schema";
import { hasParamsSuggestionValue, parseModelParamsFromName } from "@/lib/model-params-parse";

/**
 * 参数量是模型自身属性，直接存在 models 表上。
 *
 * 这里不需要 pricing 那套 manualOverride / matchConfidence：没有后台自动同步，
 * 名称解析只作为建议呈现，落库的值全部经过管理员确认。
 */

export type ModelParamsAdminRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  /** 模型在数据库中的添加时间，用于列表排序 */
  modelCreatedAt: string;
  totalParamsB: number | null;
  activatedParamsB: number | null;
  isEstimated: boolean;
  note: string | null;
  /** 由模型名推断出的建议值，前端展示为「可采纳」提示 */
  suggestion: {
    totalParamsB: number | null;
    activatedParamsB: number | null;
    isEstimated: boolean;
    note: string | null;
  } | null;
};

export type ModelParamsApplySuggestionsResult = {
  appliedCount: number;
  skippedCount: number;
};

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function selectModelParamsRows() {
  return db
    .select({
      modelId: models.id,
      modelName: models.modelName,
      modelCreatedAt: models.createdAt,
      providerName: providers.name,
      totalParamsB: models.totalParamsB,
      activatedParamsB: models.activatedParamsB,
      paramsIsEstimated: models.paramsIsEstimated,
      paramsNote: models.paramsNote
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(isNull(models.mergedIntoModelId))
    .orderBy(providers.name, models.modelName);
}

export async function getAdminModelParamsRows(): Promise<ModelParamsAdminRow[]> {
  const rows = await selectModelParamsRows();

  return rows
    .map((row) => {
      const parsed = parseModelParamsFromName(row.modelName);

      return {
        modelId: row.modelId,
        modelName: row.modelName,
        providerName: row.providerName,
        modelCreatedAt: row.modelCreatedAt instanceof Date
          ? row.modelCreatedAt.toISOString()
          : "1970-01-01T00:00:00.000Z",
        totalParamsB: toNullableNumber(row.totalParamsB),
        activatedParamsB: toNullableNumber(row.activatedParamsB),
        isEstimated: row.paramsIsEstimated,
        note: row.paramsNote,
        suggestion: parsed
      };
    })
    .sort((a, b) => Date.parse(b.modelCreatedAt) - Date.parse(a.modelCreatedAt));
}

const nullableParams = z.number().positive().max(100_000).nullable().optional();

const updateSchema = z
  .object({
    modelId: z.number().int().positive(),
    totalParamsB: nullableParams,
    activatedParamsB: nullableParams,
    isEstimated: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional()
  })
  .refine(
    (input) =>
      input.totalParamsB === null ||
      input.totalParamsB === undefined ||
      input.activatedParamsB === null ||
      input.activatedParamsB === undefined ||
      input.activatedParamsB <= input.totalParamsB,
    { message: "激活参数量不能大于总参数量", path: ["activatedParamsB"] }
  );

export type ModelParamsUpdateInput = z.input<typeof updateSchema>;

export async function updateModelParams(input: ModelParamsUpdateInput) {
  const parsed = updateSchema.parse(input);

  const updateValues: Partial<typeof models.$inferInsert> = {};

  if (parsed.totalParamsB !== undefined) {
    updateValues.totalParamsB = parsed.totalParamsB === null ? null : parsed.totalParamsB.toString();
  }
  if (parsed.activatedParamsB !== undefined) {
    updateValues.activatedParamsB = parsed.activatedParamsB === null ? null : parsed.activatedParamsB.toString();
  }
  if (parsed.isEstimated !== undefined) {
    updateValues.paramsIsEstimated = parsed.isEstimated;
  }
  if (parsed.note !== undefined) {
    updateValues.paramsNote = parsed.note && parsed.note.length > 0 ? parsed.note : null;
  }

  if (Object.keys(updateValues).length === 0) {
    return { ok: true, modelId: parsed.modelId, updated: false };
  }

  const [updated] = await db
    .update(models)
    .set(updateValues)
    .where(eq(models.id, parsed.modelId))
    .returning({ id: models.id, modelName: models.modelName });

  if (!updated) {
    throw new Error(`model not found: ${parsed.modelId}`);
  }

  return { ok: true, modelId: updated.id, modelName: updated.modelName, updated: true };
}

/**
 * 批量采纳模型名解析建议。
 *
 * 只填空字段：已有数值的模型一律跳过，避免覆盖人工录入的结果。
 */
export async function applyModelParamsSuggestions(
  modelIds?: number[]
): Promise<ModelParamsApplySuggestionsResult> {
  const rows = await selectModelParamsRows();
  const targetIds = modelIds && modelIds.length > 0 ? new Set(modelIds) : null;

  let appliedCount = 0;
  let skippedCount = 0;
  const updates: Array<{ modelId: number; totalParamsB: string; activatedParamsB: string | null; isEstimated: boolean }> = [];

  for (const row of rows) {
    if (targetIds && !targetIds.has(row.modelId)) continue;

    const hasExistingValue =
      toNullableNumber(row.totalParamsB) !== null || toNullableNumber(row.activatedParamsB) !== null;
    if (hasExistingValue) {
      skippedCount += 1;
      continue;
    }

    const parsed = parseModelParamsFromName(row.modelName);
    if (!hasParamsSuggestionValue(parsed) || parsed?.totalParamsB == null) {
      skippedCount += 1;
      continue;
    }

    updates.push({
      modelId: row.modelId,
      totalParamsB: parsed.totalParamsB.toString(),
      activatedParamsB: parsed.activatedParamsB === null ? null : parsed.activatedParamsB.toString(),
      isEstimated: parsed.isEstimated
    });
    appliedCount += 1;
  }

  if (updates.length > 0) {
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(models)
          .set({
            totalParamsB: update.totalParamsB,
            activatedParamsB: update.activatedParamsB,
            paramsIsEstimated: update.isEstimated
          })
          .where(eq(models.id, update.modelId));
      }
    });
  }

  return { appliedCount, skippedCount };
}

export async function getModelParamsFilledCount(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(sql`${models.mergedIntoModelId} is null and ${models.totalParamsB} is not null`);

  return Number(result?.count ?? 0);
}
