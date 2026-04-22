-- Add display/brand columns to providers (all nullable, zero-impact on existing rows)
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "display_name" TEXT,
  ADD COLUMN IF NOT EXISTS "brand_color" TEXT,
  ADD COLUMN IF NOT EXISTS "brand_text_color" TEXT;

-- Create provider_prefix_rules table
CREATE TABLE IF NOT EXISTS "provider_prefix_rules" (
  "id" SERIAL PRIMARY KEY,
  "provider_id" INTEGER NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
  "prefix" TEXT NOT NULL,
  "prefix_key" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "is_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_prefix_rules_prefix_key_unique" ON "provider_prefix_rules" ("prefix_key");
CREATE INDEX IF NOT EXISTS "provider_prefix_rules_provider_idx" ON "provider_prefix_rules" ("provider_id");
