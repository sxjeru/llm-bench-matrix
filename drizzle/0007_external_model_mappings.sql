CREATE TABLE IF NOT EXISTS "external_model_mappings" (
  "id" SERIAL PRIMARY KEY,
  "source" TEXT NOT NULL DEFAULT 'artificial-analysis',
  -- 可空：用于记录「上游有、本地库没有」的条目（忽略或待创建）
  "model_id" INTEGER REFERENCES "models"("id") ON DELETE CASCADE,
  -- 可空：用于记录「本地有、上游没有」的条目（人工标记为忽略）
  "external_model_id" TEXT,
  "external_model_name" TEXT,
  "external_model_slug" TEXT,
  "external_creator" TEXT,
  -- 解析或人工指定的推理强度档位，见 lib/external-providers/reasoning-effort.ts
  "reasoning_effort" TEXT,
  "match_status" TEXT NOT NULL DEFAULT 'unmatched',
  "match_confidence" INTEGER NOT NULL DEFAULT 0,
  "match_reason" TEXT,
  "manual_override" BOOLEAN NOT NULL DEFAULT false,
  "raw_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "external_model_mappings_confidence_range" CHECK ("match_confidence" >= 0 AND "match_confidence" <= 100),
  CONSTRAINT "external_model_mappings_status_check" CHECK ("match_status" IN ('matched', 'unmatched', 'ignored', 'manual')),
  -- 至少要有一端，否则这条映射没有任何意义
  CONSTRAINT "external_model_mappings_endpoint_required" CHECK ("model_id" IS NOT NULL OR "external_model_id" IS NOT NULL)
);

-- Postgres 的 UNIQUE 索引不会对 NULL 去重，因此两列各自可空的同时仍能保证 1:1 绑定
CREATE UNIQUE INDEX IF NOT EXISTS "external_model_mappings_source_model_unique"
  ON "external_model_mappings" ("source", "model_id");
CREATE UNIQUE INDEX IF NOT EXISTS "external_model_mappings_source_external_unique"
  ON "external_model_mappings" ("source", "external_model_id");
CREATE INDEX IF NOT EXISTS "external_model_mappings_status_idx"
  ON "external_model_mappings" ("source", "match_status");
