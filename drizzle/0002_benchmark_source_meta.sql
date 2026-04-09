CREATE TABLE IF NOT EXISTS "benchmark_source_meta" (
  "id" SERIAL PRIMARY KEY,
  "benchmark_id" INTEGER NOT NULL REFERENCES "benchmarks"("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL,
  "benchmark_type" TEXT NOT NULL,
  "modalities" TEXT[] NOT NULL DEFAULT ARRAY['Text']::TEXT[],
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_source_meta_benchmark_source_unique"
  ON "benchmark_source_meta" ("benchmark_id", "source");

CREATE INDEX IF NOT EXISTS "benchmark_source_meta_benchmark_idx"
  ON "benchmark_source_meta" ("benchmark_id");

CREATE INDEX IF NOT EXISTS "benchmark_source_meta_source_idx"
  ON "benchmark_source_meta" ("source");
