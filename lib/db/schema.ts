import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const providers = pgTable(
  "providers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name"),
    brandColor: text("brand_color"),
    brandTextColor: text("brand_text_color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    slugUnique: uniqueIndex("providers_slug_unique").on(table.slug)
  })
);

export const providerPrefixRules = pgTable(
  "provider_prefix_rules",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
    prefixKey: text("prefix_key").notNull(),
    priority: integer("priority").notNull().default(0),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    prefixKeyUnique: uniqueIndex("provider_prefix_rules_prefix_key_unique").on(table.prefixKey),
    providerIdx: index("provider_prefix_rules_provider_idx").on(table.providerId)
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

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
  note: text("note")
});
