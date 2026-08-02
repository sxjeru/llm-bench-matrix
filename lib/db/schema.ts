import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type ProviderConfigPrefixRule = {
  prefix: string;
  enabled: boolean;
  priority?: number;
  note?: string;
};

export type ProviderConfig = {
  displayName?: string;
  displayTargetProviderId?: number;
  prefixRules?: ProviderConfigPrefixRule[];
  branding?: {
    color?: string;
  };
  pricing?: {
    modelsDevProviderId?: string;
    modelsDevProviderAliases?: string[];
    disabled?: boolean;
  };
};

export const providers = pgTable(
  "providers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    config: jsonb("config").$type<ProviderConfig>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    slugUnique: uniqueIndex("providers_slug_unique").on(table.slug)
  })
);

export const models = pgTable(
  "models",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelName: text("model_name").notNull(),
    modelAlias: text("model_alias"),
    canonicalKey: text("canonical_key").notNull(),
    sourceModelId: text("source_model_id"),
    mergedIntoModelId: integer("merged_into_model_id"),
    totalParamsB: numeric("total_params_b", { precision: 10, scale: 3 }),
    activatedParamsB: numeric("activated_params_b", { precision: 10, scale: 3 }),
    paramsIsEstimated: boolean("params_is_estimated").notNull().default(false),
    paramsNote: text("params_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    canonicalUnique: uniqueIndex("models_canonical_key_unique").on(table.canonicalKey),
    providerNameUnique: uniqueIndex("models_provider_name_unique").on(table.providerId, table.modelName),
    mergedIntoIdx: index("models_merged_into_idx").on(table.mergedIntoModelId)
  })
);

export const benchmarks = pgTable(
  "benchmarks",
  {
    id: serial("id").primaryKey(),
    benchmarkName: text("benchmark_name").notNull(),
    benchmarkType: text("benchmark_type").notNull(),
    unit: text("unit").notNull().default("score"),
    higherIsBetter: boolean("higher_is_better").notNull().default(true),
    modalities: text("modalities")
      .array()
      .notNull()
      .default(sql`ARRAY['Text']::text[]`),
    canonicalKey: text("canonical_key").notNull(),
    sourceBenchmarkId: text("source_benchmark_id"),
    mergedIntoBenchmarkId: integer("merged_into_benchmark_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    canonicalUnique: uniqueIndex("benchmarks_canonical_key_unique").on(table.canonicalKey),
    nameTypeUnique: uniqueIndex("benchmarks_name_type_unique").on(table.benchmarkName, table.benchmarkType),
    mergedIntoIdx: index("benchmarks_merged_into_idx").on(table.mergedIntoBenchmarkId)
  })
);

export const benchmarkSourceMeta = pgTable(
  "benchmark_source_meta",
  {
    id: serial("id").primaryKey(),
    benchmarkId: integer("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    benchmarkType: text("benchmark_type").notNull(),
    modalities: text("modalities")
      .array()
      .notNull()
      .default(sql`ARRAY['Text']::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    benchmarkSourceUnique: uniqueIndex("benchmark_source_meta_benchmark_source_unique").on(
      table.benchmarkId,
      table.source
    ),
    benchmarkIdx: index("benchmark_source_meta_benchmark_idx").on(table.benchmarkId),
    sourceIdx: index("benchmark_source_meta_source_idx").on(table.source)
  })
);

export const benchmarkValues = pgTable(
  "benchmark_values",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    benchmarkId: integer("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    benchTime: timestamp("bench_time", { withTimezone: true }).notNull(),
    valueRaw: text("value_raw").notNull(),
    valueNum: numeric("value_num", { precision: 14, scale: 6 }),
    valueNum2: numeric("value_num2", { precision: 14, scale: 6 }),
    valueNote: text("value_note"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    modelBenchmarkTimeIdx: index("benchmark_values_model_benchmark_time_idx").on(
      table.modelId,
      table.benchmarkId,
      table.benchTime
    ),
    benchmarkTimeIdx: index("benchmark_values_benchmark_time_idx").on(table.benchmarkId, table.benchTime),
    sourceIdx: index("benchmark_values_source_idx").on(table.source)
  })
);

export const modelPricing = pgTable(
  "model_pricing",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("models.dev"),
    sourceProviderId: text("source_provider_id"),
    sourceProviderName: text("source_provider_name"),
    sourceModelId: text("source_model_id"),
    sourceModelName: text("source_model_name"),
    inputCost: numeric("input_cost", { precision: 14, scale: 6 }),
    outputCost: numeric("output_cost", { precision: 14, scale: 6 }),
    reasoningCost: numeric("reasoning_cost", { precision: 14, scale: 6 }),
    cacheReadCost: numeric("cache_read_cost", { precision: 14, scale: 6 }),
    cacheWriteCost: numeric("cache_write_cost", { precision: 14, scale: 6 }),
    inputAudioCost: numeric("input_audio_cost", { precision: 14, scale: 6 }),
    outputAudioCost: numeric("output_audio_cost", { precision: 14, scale: 6 }),
    currency: text("currency").notNull().default("USD"),
    unit: text("unit").notNull().default("per_1m_tokens"),
    matchConfidence: integer("match_confidence").notNull().default(0),
    matchStatus: text("match_status").notNull().default("unmatched"),
    manualOverride: boolean("manual_override").notNull().default(false),
    rawJson: jsonb("raw_json").notNull().default(sql`'{}'::jsonb`),
    note: text("note"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    modelUnique: uniqueIndex("model_pricing_model_id_unique").on(table.modelId),
    statusIdx: index("model_pricing_match_status_idx").on(table.matchStatus),
    sourceProviderIdx: index("model_pricing_source_provider_idx").on(table.sourceProviderId)
  })
);

/**
 * 外部数据提供商（当前为 artificialanalysis.ai）的模型匹配关系。
 *
 * 两端都可空：`model_id` 为空表示「上游有、本地库没有」的条目，`external_model_id`
 * 为空表示本地模型被人工标记为不从该数据源导入。Postgres 的唯一索引不会对 NULL
 * 去重，所以两列各自可空的同时仍能保证同一 source 下的 1:1 绑定。
 */
export const externalModelMappings = pgTable(
  "external_model_mappings",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("artificial-analysis"),
    modelId: integer("model_id").references(() => models.id, { onDelete: "cascade" }),
    externalModelId: text("external_model_id"),
    externalModelName: text("external_model_name"),
    externalModelSlug: text("external_model_slug"),
    externalCreator: text("external_creator"),
    reasoningEffort: text("reasoning_effort"),
    matchStatus: text("match_status").notNull().default("unmatched"),
    matchConfidence: integer("match_confidence").notNull().default(0),
    matchReason: text("match_reason"),
    manualOverride: boolean("manual_override").notNull().default(false),
    rawJson: jsonb("raw_json").notNull().default(sql`'{}'::jsonb`),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    sourceModelUnique: uniqueIndex("external_model_mappings_source_model_unique").on(table.source, table.modelId),
    sourceExternalUnique: uniqueIndex("external_model_mappings_source_external_unique").on(
      table.source,
      table.externalModelId
    ),
    statusIdx: index("external_model_mappings_status_idx").on(table.source, table.matchStatus)
  })
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
  note: text("note")
});
