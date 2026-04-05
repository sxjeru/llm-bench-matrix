CREATE TABLE IF NOT EXISTS "providers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "providers_slug_unique" ON "providers" ("slug");

CREATE TABLE IF NOT EXISTS "models" (
  "id" SERIAL PRIMARY KEY,
  "provider_id" INTEGER NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
  "model_name" TEXT NOT NULL,
  "model_alias" TEXT,
  "canonical_key" TEXT NOT NULL,
  "source_model_id" TEXT,
  "merged_into_model_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "models"
  DROP CONSTRAINT IF EXISTS "models_merged_into_model_id_models_id_fk";
ALTER TABLE "models"
  ADD CONSTRAINT "models_merged_into_model_id_models_id_fk"
  FOREIGN KEY ("merged_into_model_id") REFERENCES "models"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "models_canonical_key_unique" ON "models" ("canonical_key");
CREATE UNIQUE INDEX IF NOT EXISTS "models_provider_name_unique" ON "models" ("provider_id", "model_name");
CREATE INDEX IF NOT EXISTS "models_merged_into_idx" ON "models" ("merged_into_model_id");

CREATE TABLE IF NOT EXISTS "benchmarks" (
  "id" SERIAL PRIMARY KEY,
  "benchmark_name" TEXT NOT NULL,
  "benchmark_type" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'score',
  "higher_is_better" BOOLEAN NOT NULL DEFAULT TRUE,
  "modalities" TEXT[] NOT NULL DEFAULT ARRAY['Text']::TEXT[],
  "canonical_key" TEXT NOT NULL,
  "source_benchmark_id" TEXT,
  "merged_into_benchmark_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "benchmarks"
  DROP CONSTRAINT IF EXISTS "benchmarks_merged_into_benchmark_id_benchmarks_id_fk";
ALTER TABLE "benchmarks"
  ADD CONSTRAINT "benchmarks_merged_into_benchmark_id_benchmarks_id_fk"
  FOREIGN KEY ("merged_into_benchmark_id") REFERENCES "benchmarks"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "benchmarks_canonical_key_unique" ON "benchmarks" ("canonical_key");
CREATE UNIQUE INDEX IF NOT EXISTS "benchmarks_name_type_unique" ON "benchmarks" ("benchmark_name", "benchmark_type");
CREATE INDEX IF NOT EXISTS "benchmarks_merged_into_idx" ON "benchmarks" ("merged_into_benchmark_id");

CREATE TABLE IF NOT EXISTS "benchmark_values" (
  "id" SERIAL PRIMARY KEY,
  "model_id" INTEGER NOT NULL REFERENCES "models"("id") ON DELETE CASCADE,
  "benchmark_id" INTEGER NOT NULL REFERENCES "benchmarks"("id") ON DELETE CASCADE,
  "bench_time" TIMESTAMPTZ NOT NULL,
  "value_raw" TEXT NOT NULL,
  "value_num" NUMERIC(14,6),
  "value_num2" NUMERIC(14,6),
  "value_note" TEXT,
  "source" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "benchmark_values_model_benchmark_time_idx" ON "benchmark_values" ("model_id", "benchmark_id", "bench_time");
CREATE INDEX IF NOT EXISTS "benchmark_values_benchmark_time_idx" ON "benchmark_values" ("benchmark_id", "bench_time");

CREATE TABLE IF NOT EXISTS "settings" (
  "key" TEXT PRIMARY KEY,
  "value_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by" TEXT,
  "note" TEXT
);
