import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { getSettings, invalidateAllCaches, saveSetting } from "@/lib/db/queries";
import { externalModelMappings, models, providers } from "@/lib/db/schema";
import { normalizeProviderConfig } from "@/lib/provider-config";
import {
  ensureModelByProviderId,
  ensureProvider,
  importExternalBenchmarkRows,
  type ExternalImportResult
} from "@/lib/admin-service";
import {
  ARTIFICIAL_ANALYSIS_ATTRIBUTION_URL,
  ARTIFICIAL_ANALYSIS_SETTINGS_KEY,
  ARTIFICIAL_ANALYSIS_SOURCE_ID,
  ARTIFICIAL_ANALYSIS_SOURCE_LABEL,
  buildImportRows,
  getArtificialAnalysisSnapshot,
  hasArtificialAnalysisApiKey,
  normalizeImportConfig,
  resolveModelMatches,
  type ArtificialAnalysisImportConfig,
  type ArtificialAnalysisModel,
  type ExternalMatchStatus,
  type LocalModelInput,
  type MetricCatalogEntry,
  type ModelMatchConflict,
  type ModelMatchResult
} from "./artificial-analysis";
import { isReasoningEffort, type ReasoningEffort } from "./reasoning-effort";

/**
 * artificialanalysis.ai 导入的服务层：把纯逻辑模块（artificial-analysis.ts）与数据库、
 * settings 表接起来。API 路由只调用这里的函数。
 */

export type ExternalMappingRow = {
  modelId: number;
  modelName: string;
  providerName: string;
  externalModelId: string | null;
  externalModelName: string | null;
  externalCreator: string | null;
  reasoningEffort: ReasoningEffort | null;
  matchStatus: ExternalMatchStatus;
  matchConfidence: number;
  matchReason: string;
  manualOverride: boolean;
  /** 上游是否还存在这条：人工绑定的上游 id 可能在上游改名后失效 */
  externalMissing: boolean;
};

export type UpstreamOnlyModel = {
  externalModelId: string;
  externalModelName: string;
  externalModelSlug: string | null;
  externalCreator: string | null;
};

export type ArtificialAnalysisAdminSnapshot = {
  apiKeyConfigured: boolean;
  fetchedAt: string | null;
  sourceLabel: string;
  attributionUrl: string;
  catalog: MetricCatalogEntry[];
  config: ArtificialAnalysisImportConfig;
  mappings: ExternalMappingRow[];
  upstreamOnly: UpstreamOnlyModel[];
  conflicts: ModelMatchConflict[];
  /** 上游可选条目，供后台手动改绑的下拉框使用 */
  upstreamOptions: UpstreamOnlyModel[];
  /** Intelligence Index 版本；AA 明确说跨版本分数不可直接比较 */
  intelligenceIndexVersion: number | null;
  /** 本次拉取翻了几页新 API */
  freePageCount: number;
  /** 旧 API（逐项 benchmark 的来源）失败时的原因 */
  legacyWarning: string | null;
};

async function getLocalModels(): Promise<Array<LocalModelInput & { providerDisplayName: string | null }>> {
  const rows = await db
    .select({
      id: models.id,
      modelName: models.modelName,
      sourceModelId: models.sourceModelId,
      providerName: providers.name,
      providerSlug: providers.slug,
      providerConfig: providers.config
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(isNull(models.mergedIntoModelId))
    // 模型匹配列表按添加顺序展示：新添加的模型优先
    .orderBy(desc(models.createdAt), desc(models.id));

  return rows.map((row) => ({
    id: row.id,
    modelName: row.modelName,
    sourceModelId: row.sourceModelId,
    providerName: row.providerName,
    providerSlug: row.providerSlug,
    providerDisplayName: normalizeProviderConfig(row.providerConfig).displayName ?? null
  }));
}

async function getStoredMappings() {
  return db
    .select()
    .from(externalModelMappings)
    .where(eq(externalModelMappings.source, ARTIFICIAL_ANALYSIS_SOURCE_ID));
}

export async function getArtificialAnalysisConfig(): Promise<ArtificialAnalysisImportConfig> {
  const settingsMap = await getSettings();
  return normalizeImportConfig(settingsMap[ARTIFICIAL_ANALYSIS_SETTINGS_KEY]);
}

function toUpstreamOption(model: ArtificialAnalysisModel): UpstreamOnlyModel {
  return {
    externalModelId: model.id,
    externalModelName: model.name,
    externalModelSlug: model.slug,
    externalCreator: model.creatorName
  };
}

/**
 * 拉取上游 + 自动匹配 + 合并已保存的人工修正，产出后台页签需要的全部数据。
 *
 * 已勾「手动覆盖」的映射完全跳过自动匹配，直接沿用库里存的绑定关系；
 * 标记为 ignored 的同理，避免每次拉取都把人工判断冲掉。
 */
export async function getArtificialAnalysisAdminSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<ArtificialAnalysisAdminSnapshot> {
  const [config, localModels, storedMappings] = await Promise.all([
    getArtificialAnalysisConfig(),
    getLocalModels(),
    getStoredMappings()
  ]);

  if (!hasArtificialAnalysisApiKey()) {
    return {
      apiKeyConfigured: false,
      fetchedAt: null,
      sourceLabel: ARTIFICIAL_ANALYSIS_SOURCE_LABEL,
      attributionUrl: ARTIFICIAL_ANALYSIS_ATTRIBUTION_URL,
      catalog: [],
      config,
      mappings: [],
      upstreamOnly: [],
      conflicts: [],
      upstreamOptions: [],
      intelligenceIndexVersion: null,
      freePageCount: 0,
      legacyWarning: null
    };
  }

  const snapshot = await getArtificialAnalysisSnapshot({ forceRefresh: options?.forceRefresh });
  const upstreamById = new Map(snapshot.models.map((model) => [model.id, model]));

  const pinnedMatches = new Map<number, ModelMatchResult>();
  const manualByModelId = new Map<number, (typeof storedMappings)[number]>();
  for (const stored of storedMappings) {
    if (stored.modelId === null) continue;
    manualByModelId.set(stored.modelId, stored);

    if (!stored.manualOverride && stored.matchStatus !== "ignored") continue;

    pinnedMatches.set(stored.modelId, {
      modelId: stored.modelId,
      externalModelId: stored.externalModelId,
      externalModelName: stored.externalModelName,
      externalModelSlug: stored.externalModelSlug,
      externalCreator: stored.externalCreator,
      reasoningEffort: isReasoningEffort(stored.reasoningEffort) ? stored.reasoningEffort : null,
      matchStatus: stored.matchStatus as ExternalMatchStatus,
      matchConfidence: stored.matchConfidence,
      matchReason: stored.matchReason ?? "manual"
    });
  }

  const { matches, conflicts } = resolveModelMatches(localModels, snapshot.models, pinnedMatches);
  const localById = new Map(localModels.map((model) => [model.id, model]));

  const mappings: ExternalMappingRow[] = matches.map((match) => {
    const local = localById.get(match.modelId)!;
    const stored = manualByModelId.get(match.modelId);
    const upstream = match.externalModelId ? upstreamById.get(match.externalModelId) : undefined;

    return {
      modelId: match.modelId,
      modelName: local.modelName,
      providerName: local.providerDisplayName ?? local.providerName,
      externalModelId: match.externalModelId,
      // 上游若已存在，展示名以上游为准，避免库里存着改名前的旧名字
      externalModelName: upstream ? upstream.name : match.externalModelName,
      externalCreator: upstream?.creatorName ?? match.externalCreator,
      reasoningEffort: match.reasoningEffort,
      matchStatus: match.matchStatus,
      matchConfidence: match.matchConfidence,
      matchReason: match.matchReason,
      manualOverride: stored?.manualOverride ?? false,
      externalMissing: match.externalModelId !== null && !upstream
    };
  });

  const boundExternalIds = new Set(
    mappings.map((mapping) => mapping.externalModelId).filter((id): id is string => id !== null)
  );
  const upstreamOnly = snapshot.models
    .filter((model) => !boundExternalIds.has(model.id))
    .map(toUpstreamOption);

  return {
    apiKeyConfigured: true,
    fetchedAt: snapshot.fetchedAt,
    sourceLabel: ARTIFICIAL_ANALYSIS_SOURCE_LABEL,
    attributionUrl: ARTIFICIAL_ANALYSIS_ATTRIBUTION_URL,
    catalog: snapshot.catalog,
    config,
    mappings,
    upstreamOnly,
    conflicts,
    upstreamOptions: snapshot.models.map(toUpstreamOption),
    intelligenceIndexVersion: snapshot.intelligenceIndexVersion,
    freePageCount: snapshot.freePageCount,
    legacyWarning: snapshot.legacyWarning
  };
}

// ---------------------------------------------------------------------------
// 保存人工修正
// ---------------------------------------------------------------------------

const mappingUpdateSchema = z.object({
  modelId: z.number().int().positive(),
  externalModelId: z.string().trim().min(1).nullable(),
  reasoningEffort: z.string().trim().nullable().optional(),
  matchStatus: z.enum(["matched", "unmatched", "ignored", "manual"]).optional(),
  manualOverride: z.boolean().optional()
});

export type ArtificialAnalysisMappingUpdate = z.input<typeof mappingUpdateSchema>;

const MAX_MAPPING_BATCH_SIZE = 2000;

/**
 * 批量保存匹配关系。
 *
 * 整批先校验再落库：任何一条不合法就整批拒绝，避免后台「保存匹配」出现存了一半的中间态。
 * 同一个 modelId 重复出现时以最后一条为准。
 */
export async function saveArtificialAnalysisMappings(inputs: unknown) {
  if (!Array.isArray(inputs)) {
    throw new Error("保存匹配关系需要传入数组");
  }
  if (inputs.length > MAX_MAPPING_BATCH_SIZE) {
    throw new Error(`单次最多保存 ${MAX_MAPPING_BATCH_SIZE} 条匹配关系`);
  }

  const parsedByModelId = new Map<number, z.output<typeof mappingUpdateSchema>>();
  for (const [index, input] of inputs.entries()) {
    const result = mappingUpdateSchema.safeParse(input);
    if (!result.success) {
      const rawModelId = (input as { modelId?: unknown } | null | undefined)?.modelId;
      const label = typeof rawModelId === "number" ? `模型 #${rawModelId}` : `第 ${index + 1} 条`;
      const detail = result.error.issues
        .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
        .join("; ");
      throw new Error(`${label} 的匹配关系不合法（${detail}）`);
    }

    if (result.data.reasoningEffort && !isReasoningEffort(result.data.reasoningEffort)) {
      throw new Error(`模型 #${result.data.modelId} 的推理强度取值不合法：${result.data.reasoningEffort}`);
    }

    parsedByModelId.set(result.data.modelId, result.data);
  }

  const updates = [...parsedByModelId.values()];
  if (updates.length === 0) return { updatedCount: 0 };

  // 一个上游条目只能绑一个本地模型，同批里出现重复直接拒绝，
  // 否则会撞上 (source, external_model_id) 的唯一索引，报错信息也不好懂。
  const seenExternalIds = new Map<string, number>();
  for (const update of updates) {
    if (!update.externalModelId || update.matchStatus === "ignored") continue;
    const owner = seenExternalIds.get(update.externalModelId);
    if (owner !== undefined) {
      throw new Error(`上游条目 ${update.externalModelId} 被模型 #${owner} 和 #${update.modelId} 同时绑定`);
    }
    seenExternalIds.set(update.externalModelId, update.modelId);
  }

  const snapshot = hasArtificialAnalysisApiKey() ? await getArtificialAnalysisSnapshot() : null;
  const upstreamById = new Map((snapshot?.models ?? []).map((model) => [model.id, model]));
  const now = new Date();

  await db.transaction(async (tx) => {
    // 先清掉这批模型原本占用的上游绑定，避免唯一索引在「A、B 互换绑定」时中途冲突
    const externalIds = updates
      .map((update) => update.externalModelId)
      .filter((id): id is string => id !== null);
    if (externalIds.length > 0) {
      await tx
        .delete(externalModelMappings)
        .where(
          and(
            eq(externalModelMappings.source, ARTIFICIAL_ANALYSIS_SOURCE_ID),
            inArray(externalModelMappings.externalModelId, externalIds)
          )
        );
    }

    await tx.delete(externalModelMappings).where(
      and(
        eq(externalModelMappings.source, ARTIFICIAL_ANALYSIS_SOURCE_ID),
        inArray(
          externalModelMappings.modelId,
          updates.map((update) => update.modelId)
        )
      )
    );

    const rows = updates.map((update) => {
      const upstream = update.externalModelId ? upstreamById.get(update.externalModelId) : undefined;
      const matchStatus =
        update.matchStatus ?? (update.externalModelId ? "manual" : "ignored");
      const manualOverride = update.manualOverride ?? true;

      return {
        source: ARTIFICIAL_ANALYSIS_SOURCE_ID,
        modelId: update.modelId,
        externalModelId: update.externalModelId,
        externalModelName: upstream?.name ?? upstream?.slug ?? update.externalModelId,
        externalModelSlug: upstream?.slug ?? null,
        externalCreator: upstream?.creatorName ?? null,
        reasoningEffort: update.reasoningEffort ?? null,
        matchStatus,
        matchConfidence: manualOverride ? 100 : 0,
        matchReason: manualOverride ? "manual" : "auto",
        manualOverride,
        rawJson: {},
        lastSyncedAt: now,
        updatedAt: now
      };
    });

    await tx.insert(externalModelMappings).values(rows);
  });

  return { updatedCount: updates.length };
}

export async function saveArtificialAnalysisConfig(input: unknown) {
  const config = normalizeImportConfig(input);
  await saveSetting({
    key: ARTIFICIAL_ANALYSIS_SETTINGS_KEY,
    valueJson: config,
    updatedBy: "admin",
    note: "Artificial Analysis 导入配置"
  });
  await invalidateAllCaches();
  return config;
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

export type ArtificialAnalysisImportSummary = ExternalImportResult & {
  createdModels: string[];
  matchedModelCount: number;
  metricCount: number;
};

/**
 * 执行（或预览）导入。
 *
 * `createExternalModelIds` 是后台勾选的「上游有、本地没有」的条目：先按上游 creator
 * 建 provider 与 model，再把它们并入正常导入流程。默认为空 —— 不勾就一个都不建。
 */
export async function runArtificialAnalysisImport(options: {
  dryRun?: boolean;
  createExternalModelIds?: string[];
}): Promise<ArtificialAnalysisImportSummary> {
  if (!hasArtificialAnalysisApiKey()) {
    throw new Error("未配置 ARTIFICIAL_ANALYSIS_API_KEY，无法导入 Artificial Analysis 数据");
  }

  const dryRun = options.dryRun === true;
  const createIds = Array.from(new Set(options.createExternalModelIds ?? []));
  const snapshot = await getArtificialAnalysisSnapshot();
  const config = await getArtificialAnalysisConfig();

  if (config.selectedMetrics.length === 0) {
    throw new Error("请先勾选至少一个要导入的数据项");
  }

  const createdModels: string[] = [];

  // 预览阶段不建模型：新建实体属于不可回滚的副作用，不该被「看一眼」触发
  if (!dryRun && createIds.length > 0) {
    const upstreamById = new Map(snapshot.models.map((model) => [model.id, model]));
    const now = new Date();

    for (const externalModelId of createIds) {
      const upstream = upstreamById.get(externalModelId);
      if (!upstream) continue;

      const modelName = upstream.name;
      const providerName = upstream.creatorName?.trim() || "Unknown";
      const provider = await ensureProvider(providerName);
      const created = await ensureModelByProviderId({
        providerId: provider.id,
        modelName,
        sourceModelId: upstream.slug ?? upstream.id
      });

      await db
        .insert(externalModelMappings)
        .values({
          source: ARTIFICIAL_ANALYSIS_SOURCE_ID,
          modelId: created.id,
          externalModelId: upstream.id,
          externalModelName: modelName,
          externalModelSlug: upstream.slug,
          externalCreator: upstream.creatorName,
          matchStatus: "manual",
          matchConfidence: 100,
          matchReason: "created-from-upstream",
          manualOverride: true,
          rawJson: {},
          lastSyncedAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [externalModelMappings.source, externalModelMappings.modelId],
          set: {
            externalModelId: sql`excluded.external_model_id`,
            externalModelName: sql`excluded.external_model_name`,
            externalModelSlug: sql`excluded.external_model_slug`,
            externalCreator: sql`excluded.external_creator`,
            matchStatus: sql`excluded.match_status`,
            matchConfidence: sql`excluded.match_confidence`,
            matchReason: sql`excluded.match_reason`,
            manualOverride: sql`excluded.manual_override`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            updatedAt: sql`excluded.updated_at`
          }
        });

      createdModels.push(modelName);
    }
  }

  const adminSnapshot = await getArtificialAnalysisAdminSnapshot();
  const localModelsById = new Map(
    adminSnapshot.mappings.map((mapping) => [
      mapping.modelId,
      { modelName: mapping.modelName, providerName: mapping.providerName }
    ])
  );

  const matches: ModelMatchResult[] = adminSnapshot.mappings.map((mapping) => ({
    modelId: mapping.modelId,
    externalModelId: mapping.externalModelId,
    externalModelName: mapping.externalModelName,
    externalModelSlug: null,
    externalCreator: mapping.externalCreator,
    reasoningEffort: mapping.reasoningEffort,
    matchStatus: mapping.matchStatus,
    matchConfidence: mapping.matchConfidence,
    matchReason: mapping.matchReason
  }));

  const rows = buildImportRows({
    upstreamModels: snapshot.models,
    catalog: snapshot.catalog,
    config,
    matches,
    localModelsById
  });

  const result = await importExternalBenchmarkRows(rows, {
    source: ARTIFICIAL_ANALYSIS_SOURCE_LABEL,
    dryRun
  });

  if (!dryRun) {
    await saveSetting({
      key: ARTIFICIAL_ANALYSIS_SETTINGS_KEY,
      valueJson: { ...config, lastImportedAt: new Date().toISOString() },
      updatedBy: "admin",
      note: "Artificial Analysis 导入配置"
    });
  }

  return {
    ...result,
    createdModels,
    matchedModelCount: matches.filter(
      (match) => match.matchStatus === "matched" || match.matchStatus === "manual"
    ).length,
    metricCount: config.selectedMetrics.length
  };
}
