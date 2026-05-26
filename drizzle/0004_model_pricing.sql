CREATE TABLE IF NOT EXISTS "model_pricing" (
  "id" SERIAL PRIMARY KEY,
  "model_id" INTEGER NOT NULL REFERENCES "models"("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL DEFAULT 'models.dev',
  "source_provider_id" TEXT,
  "source_provider_name" TEXT,
  "source_model_id" TEXT,
  "source_model_name" TEXT,
  "input_cost" NUMERIC(14, 6),
  "output_cost" NUMERIC(14, 6),
  "reasoning_cost" NUMERIC(14, 6),
  "cache_read_cost" NUMERIC(14, 6),
  "cache_write_cost" NUMERIC(14, 6),
  "input_audio_cost" NUMERIC(14, 6),
  "output_audio_cost" NUMERIC(14, 6),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "unit" TEXT NOT NULL DEFAULT 'per_1m_tokens',
  "match_confidence" INTEGER NOT NULL DEFAULT 0,
  "match_status" TEXT NOT NULL DEFAULT 'unmatched',
  "manual_override" BOOLEAN NOT NULL DEFAULT false,
  "raw_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "note" TEXT,
  "last_synced_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "model_pricing_cost_non_negative" CHECK (
    ("input_cost" IS NULL OR "input_cost" >= 0)
    AND ("output_cost" IS NULL OR "output_cost" >= 0)
    AND ("reasoning_cost" IS NULL OR "reasoning_cost" >= 0)
    AND ("cache_read_cost" IS NULL OR "cache_read_cost" >= 0)
    AND ("cache_write_cost" IS NULL OR "cache_write_cost" >= 0)
    AND ("input_audio_cost" IS NULL OR "input_audio_cost" >= 0)
    AND ("output_audio_cost" IS NULL OR "output_audio_cost" >= 0)
  ),
  CONSTRAINT "model_pricing_match_confidence_range" CHECK ("match_confidence" >= 0 AND "match_confidence" <= 100),
  CONSTRAINT "model_pricing_match_status_check" CHECK ("match_status" IN ('matched', 'unmatched', 'ignored', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "model_pricing_model_id_unique" ON "model_pricing" ("model_id");
CREATE INDEX IF NOT EXISTS "model_pricing_match_status_idx" ON "model_pricing" ("match_status");
CREATE INDEX IF NOT EXISTS "model_pricing_source_provider_idx" ON "model_pricing" ("source_provider_id");