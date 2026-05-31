CREATE INDEX IF NOT EXISTS "benchmark_values_time_id_desc_idx"
  ON "benchmark_values" ("bench_time" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "benchmark_values_source_time_id_desc_idx"
  ON "benchmark_values" ("source", "bench_time" DESC, "id" DESC);
